"""Exact upload reads stay within the native runtime's user/thread bucket."""

import asyncio
import os
import threading
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from langchain.tools import ToolRuntime

from deerflow.config import paths as paths_module
from deerflow.extensions import artifacts
from deerflow.sandbox import tools


@pytest.fixture
def native(tmp_path, monkeypatch):
    paths = paths_module.Paths(base_dir=tmp_path)
    root = paths.sandbox_uploads_dir("thread-a", user_id="user-a")
    root.mkdir(parents=True)
    calls = []

    @asynccontextmanager
    async def scope(runtime):
        calls.append("authorized")
        yield

    sandbox = SimpleNamespace(download_file=lambda path: b"remote\r\n")
    monkeypatch.setattr(paths_module, "get_paths", lambda: paths)
    monkeypatch.setattr(tools, "sandbox_authorization_scope_async", scope)
    monkeypatch.setattr(tools, "ensure_sandbox_initialized_async", AsyncMock(return_value=sandbox))
    monkeypatch.setattr(tools, "ensure_sandbox_initialized", lambda runtime: sandbox)
    monkeypatch.setattr(tools, "is_local_sandbox", lambda runtime: True)
    runtime = ToolRuntime(state={"thread_data": {"uploads_path": str(root)}}, context={"thread_id": "thread-a", "user_id": "user-a"}, config={}, stream_writer=lambda _: None, tools=[], tool_call_id="synthetic-upload", store=None)
    return runtime, root, calls, sandbox, paths


def read(runtime, name="source.json", limit=2 * 1024 * 1024):
    return asyncio.run(artifacts.read_uploaded_bytes(runtime, "/mnt/user-data/uploads/" + name, limit))


def test_exact_two_mib_no_display_or_newline_conversion(native, monkeypatch):
    runtime, root, calls, _, _ = native
    payload = b"\xef\xbb\xbf" + b"x" * (2 * 1024 * 1024 - 5) + b"\r\n"
    (root / "source.json").write_bytes(payload)
    original = tools._resolve_and_validate_user_data_path

    def resolve(*args):
        calls.append(threading.get_ident())
        return original(*args)

    monkeypatch.setattr(tools, "_resolve_and_validate_user_data_path", resolve)
    assert read(runtime) == payload
    assert calls[0] == "authorized"
    assert all(call != threading.get_ident() for call in calls if isinstance(call, int))


@pytest.mark.parametrize(
    "path",
    [
        "/etc/passwd",
        "file:///mnt/user-data/uploads/x",
        "/mnt/user-data/outputs/x",
        "/mnt/user-data/uploadsX/x",
        "/mnt/user-data/uploads/../outputs/x",
        "/mnt/user-data/uploads/.upload-1.part",
        "/mnt/user-data/uploads/dir/.secret",
        "/mnt/user-data/uploads/./x",
        "/mnt/user-data/uploads//x",
        "/mnt/user-data/uploads/x/",
        "/mnt/user-data/uploads/dir\\x",
        "/mnt/user-data/uploads/x\x00",
    ],
)
def test_invalid_paths_rejected_before_authorization(native, path):
    runtime, _, calls, _, _ = native
    with pytest.raises((ValueError, PermissionError)):
        asyncio.run(artifacts.read_uploaded_bytes(runtime, path, 100))
    assert not calls


@pytest.mark.parametrize("limit", [0, -1, True, 1.5, 16 * 1024 * 1024 + 1])
def test_invalid_budget_before_io(native, limit):
    runtime, _, calls, _, _ = native
    with pytest.raises(ValueError):
        read(runtime, limit=limit)
    assert not calls


def test_missing_directory_fifo_and_overflow_fail_closed(native):
    runtime, root, _, _, _ = native
    with pytest.raises(FileNotFoundError):
        read(runtime)
    (root / "source.json").mkdir()
    with pytest.raises(OSError):
        read(runtime)
    os.mkfifo(root / "pipe")
    with pytest.raises(OSError):
        read(runtime, "pipe")
    (root / "big").write_bytes(b"12345")
    with pytest.raises(ValueError, match="budget"):
        read(runtime, "big", 4)


@pytest.mark.parametrize("other_user,other_thread", [("user-b", "thread-a"), ("user-a", "thread-b")])
def test_foreign_state_bucket_rejected(native, other_user, other_thread):
    runtime, _, _, _, paths = native
    foreign = paths.sandbox_uploads_dir(other_thread, user_id=other_user)
    foreign.mkdir(parents=True)
    (foreign / "source.json").write_bytes(b"private")
    runtime.state["thread_data"]["uploads_path"] = str(foreign)
    with pytest.raises(PermissionError):
        read(runtime)


@pytest.mark.parametrize("target_kind", ["outside", "outputs", "inside"])
def test_symlink_files_rejected_including_other_thread_roots(native, target_kind):
    runtime, root, _, _, paths = native
    target = root / "real" if target_kind == "inside" else paths.sandbox_outputs_dir("thread-a", user_id="user-a") / "real" if target_kind == "outputs" else paths.sandbox_uploads_dir("thread-b", user_id="user-a") / "real"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"private")
    (root / "source.json").symlink_to(target)
    with pytest.raises((OSError, ValueError)):
        read(runtime)


def test_nested_real_file_allowed_but_linked_directory_rejected(native):
    runtime, root, _, _, _ = native
    (root / "nested").mkdir()
    (root / "nested" / "x").write_bytes(b"nested\r\n")
    assert read(runtime, "nested/x") == b"nested\r\n"
    (root / "alias").symlink_to(root / "nested", target_is_directory=True)
    with pytest.raises(OSError):
        read(runtime, "alias/x")


@pytest.mark.parametrize("component", ["file", "directory"])
def test_symlink_swap_after_native_validation_is_rejected(native, monkeypatch, component):
    runtime, root, _, _, _ = native
    (root / "nested").mkdir()
    (root / "nested" / "x").write_bytes(b"before")
    (root / "other").mkdir()
    (root / "other" / "x").write_bytes(b"must-not-read")
    original = tools._resolve_and_validate_user_data_path

    def resolve(*args):
        result = original(*args)
        target = root / "nested" if component == "directory" else root / "nested" / "x"
        target.rename(target.with_name(target.name + "-old"))
        target.symlink_to(root / "other" if component == "directory" else root / "other" / "x")
        return result

    monkeypatch.setattr(tools, "_resolve_and_validate_user_data_path", resolve)
    with pytest.raises(OSError):
        read(runtime, "nested/x")


@pytest.mark.parametrize("missing", ["thread", "state", "uploads"])
def test_missing_runtime_scope_fails_closed(native, missing):
    runtime, _, _, _, _ = native
    if missing == "thread":
        runtime.context = {}
    elif missing == "state":
        runtime.state = {}
    else:
        runtime.state["thread_data"] = {}
    with pytest.raises(PermissionError):
        read(runtime)


@pytest.mark.parametrize("channel", ["server-info", "runnable-config"])
def test_server_auth_identity_wins_over_ordinary_context(native, monkeypatch, channel):
    runtime, root, _, _, _ = native
    (root / "source.json").write_bytes(b"private")
    if channel == "server-info":
        runtime.server_info = SimpleNamespace(user=SimpleNamespace(identity="user-b"))
    else:
        monkeypatch.setattr("langgraph.config.get_config", lambda: {"configurable": {"langgraph_auth_user_id": "user-b"}})
    with pytest.raises(PermissionError):
        read(runtime)


def test_authorization_and_cancellation_do_not_initialize(native, monkeypatch):
    runtime, _, _, _, _ = native
    for error in [PermissionError, asyncio.CancelledError]:

        @asynccontextmanager
        async def denied(runtime):
            raise error()
            yield

        monkeypatch.setattr(tools, "sandbox_authorization_scope_async", denied)
        with pytest.raises(error):
            read(runtime)
    tools.ensure_sandbox_initialized_async.assert_not_awaited()


@pytest.mark.parametrize("payload", [b"\xef\xbb\xbfremote\r\n", b"", b"x" * 11, "Error: missing", None])
def test_remote_uses_native_download_with_explicit_post_read_budget(native, monkeypatch, payload):
    runtime, _, calls, sandbox, _ = native
    monkeypatch.setattr(tools, "is_local_sandbox", lambda runtime: False)

    def download(path):
        assert path == "/mnt/user-data/uploads/source.json"
        calls.append(threading.get_ident())
        return payload

    sandbox.download_file = download
    if not isinstance(payload, bytes) or len(payload) > 10:
        with pytest.raises((OSError, ValueError)):
            read(runtime, limit=10)
    else:
        assert read(runtime, limit=10) == payload
    assert all(call != threading.get_ident() for call in calls if isinstance(call, int))
