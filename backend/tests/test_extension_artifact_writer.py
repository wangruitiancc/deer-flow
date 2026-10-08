"""New outputs use native authorization, resolution, locks and provider IO."""

import asyncio
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from deerflow_extension_api import ExtensionData, ExtensionRuntimeDeps, TaskWriteGateBinding
from deerflow_extension_api.runtime_bridge import EXTENSION_TASK_STORE_KEY
from langchain.tools import ToolRuntime

from deerflow.extensions import artifacts
from deerflow.sandbox import tools
from deerflow.sandbox.local.local_sandbox import LocalSandbox


@pytest.fixture
def native(tmp_path, monkeypatch):
    calls = []
    sandbox = LocalSandbox("synthetic-output")

    @asynccontextmanager
    async def scope(runtime):
        calls.append("authorized")
        yield

    monkeypatch.setattr(tools, "sandbox_authorization_scope_async", scope)
    monkeypatch.setattr(tools, "ensure_sandbox_initialized_async", AsyncMock(return_value=sandbox))
    monkeypatch.setattr(tools, "ensure_sandbox_initialized", lambda runtime: sandbox)
    monkeypatch.setattr(tools, "ensure_thread_directories_exist", lambda runtime: None)
    monkeypatch.setattr(tools, "is_local_sandbox", lambda runtime: True)
    monkeypatch.setattr(tools, "get_thread_data", lambda runtime: {"outputs_path": str(tmp_path)})

    def resolve(path, thread_data):
        calls.append(("resolve", threading.get_ident()))
        assert path.startswith("/mnt/user-data/outputs/draft-")
        return str(tmp_path / Path(path).name)

    monkeypatch.setattr(tools, "_resolve_and_validate_user_data_path", resolve)
    # Keep native publisher normalization and local path validation in this test.
    import importlib

    publisher = importlib.import_module("deerflow.tools.builtins.present_file_tool")
    paths = SimpleNamespace(resolve_virtual_path=lambda thread, path, **kwargs: tmp_path / Path(path).name)
    monkeypatch.setattr(publisher, "get_paths", lambda: paths)
    runtime = ToolRuntime(state={"thread_data": {"outputs_path": str(tmp_path)}}, context={"thread_id": "synthetic-output"}, config={}, stream_writer=lambda _: None, tools=[], tool_call_id="synthetic-output", store=None)
    return runtime, sandbox, tmp_path, calls


def test_creates_distinct_exact_files_using_real_local_provider_off_thread(native):
    runtime, _, directory, calls = native
    first = asyncio.run(artifacts.create_output_text(runtime, "中文\n", ".md"))
    second = asyncio.run(artifacts.create_output_text(runtime, "other", ".md"))
    assert first != second
    assert (directory / Path(first).name).read_bytes() == "中文\n".encode()
    assert calls[0] == "authorized"
    assert all(item[1] != threading.get_ident() for item in calls if isinstance(item, tuple))


def test_native_output_write_holds_admitted_workspace_gate(native, monkeypatch):
    runtime, sandbox, _, _ = native

    class Gate:
        active = False

        @asynccontextmanager
        async def hold(self, *, operation):
            assert operation == "workspace_tool_write"
            self.active = True
            try:
                yield
            finally:
                self.active = False

    gate = Gate()
    task_store = ExtensionData("legal-task")
    task_store.set(TaskWriteGateBinding(gate))
    runtime.context[EXTENSION_TASK_STORE_KEY] = task_store
    update_file = sandbox.update_file

    def guarded_update(path, content):
        assert gate.active
        update_file(path, content)

    monkeypatch.setattr(sandbox, "update_file", guarded_update)
    path = asyncio.run(artifacts.create_output_text(runtime, "draft", ".md"))

    assert Path(path).name.startswith("draft-")
    assert not gate.active


@pytest.mark.parametrize("content", ["\ufeff# {{title}}\r\n{{date:YYYY年MM月DD日}}\r\n", "", "example /mnt/user-data/outputs/source.md"])
def test_exact_template_like_text_is_not_newline_normalized_or_path_rewritten(native, monkeypatch, content):
    runtime, sandbox, directory, _ = native
    monkeypatch.setattr(sandbox, "_resolve_paths_in_content", lambda text: text.replace("/mnt/user-data", "/private/host"))
    path = asyncio.run(artifacts.create_output_text(runtime, content, ".md"))
    assert (directory / Path(path).name).read_bytes() == content.encode("utf-8")


def test_collision_never_overwrites_existing_file(native, monkeypatch):
    runtime, _, directory, _ = native
    monkeypatch.setattr(artifacts, "uuid4", lambda: SimpleNamespace(hex="fixed"))
    target = directory / "draft-fixed.md"
    target.write_text("keep", encoding="utf-8")
    with pytest.raises(FileExistsError):
        asyncio.run(artifacts.create_output_text(runtime, "replace", ".md"))
    assert target.read_text() == "keep"


@pytest.mark.parametrize("failure", [PermissionError("private diagnostic"), "Error: remote missing", "existing"])
def test_uncertain_absence_or_permission_error_never_writes(native, monkeypatch, failure):
    runtime, sandbox, directory, _ = native

    def read(*args):
        if isinstance(failure, Exception):
            raise failure
        return failure

    monkeypatch.setattr(sandbox, "read_file", read)
    with pytest.raises(OSError):
        asyncio.run(artifacts.create_output_text(runtime, "new", ".md"))
    assert not list(directory.iterdir())


def test_corrupt_or_failed_write_cannot_report_success(native, monkeypatch):
    runtime, sandbox, _, _ = native
    monkeypatch.setattr(sandbox, "update_file", lambda path, content: Path(path).write_bytes(b"truncated"))
    with pytest.raises(OSError):
        asyncio.run(artifacts.create_output_text(runtime, "complete", ".md"))


def test_denied_authorization_never_initializes_or_writes(native, monkeypatch):
    runtime, _, directory, _ = native

    @asynccontextmanager
    async def denied(runtime):
        raise PermissionError("denied")
        yield

    monkeypatch.setattr(tools, "sandbox_authorization_scope_async", denied)
    with pytest.raises(PermissionError):
        asyncio.run(artifacts.create_output_text(runtime, "new", ".md"))
    tools.ensure_sandbox_initialized_async.assert_not_awaited()
    assert not list(directory.iterdir())


@pytest.mark.parametrize("content,suffix", [("x", "../../escape"), ("中" * 22000, ".md"), (None, ".md")])
def test_invalid_payload_rejected_before_authorization(native, content, suffix):
    runtime, _, _, calls = native
    with pytest.raises(ValueError):
        asyncio.run(artifacts.create_output_text(runtime, content, suffix))
    assert not calls


def test_port_is_optional_on_old_hosts():
    assert ExtensionRuntimeDeps().create_output_text is None
    assert ExtensionRuntimeDeps().present_output_files is None
    assert ExtensionRuntimeDeps().create_output_bytes is None
    assert ExtensionRuntimeDeps().read_uploaded_bytes is None


@pytest.mark.parametrize("suffix", [".law-authorities.json", ".import-report.json"])
def test_binary_port_preserves_full_two_mib_and_compound_suffix(native, monkeypatch, suffix):
    runtime, _, directory, _ = native
    monkeypatch.setenv("DEERFLOW_WRITE_FILE_MAX_BYTES", str(2 * 1024 * 1024))
    payload = b"\xef\xbb\xbf" + b"x" * (2 * 1024 * 1024 - 5) + b"\r\n"
    path = asyncio.run(artifacts.create_output_bytes(runtime, payload, suffix))
    assert path.endswith(suffix)
    assert (directory / Path(path).name).read_bytes() == payload


@pytest.mark.parametrize(
    "payload,suffix", [("text", ".json"), (b"x", "../x"), (b"x", ".json/escape"), (b"x", "."), (b"x", ".JSON"), (b"x" * (16 * 1024 * 1024 + 1), ".json")], ids=["text", "traversal", "slash", "empty-extension", "uppercase", "oversized"]
)
def test_binary_port_rejects_invalid_input_before_io(native, payload, suffix):
    runtime, _, directory, calls = native
    with pytest.raises(ValueError):
        asyncio.run(artifacts.create_output_bytes(runtime, payload, suffix))
    assert not calls
    assert not list(directory.iterdir())


def test_binary_port_honors_native_write_budget(native, monkeypatch):
    runtime, _, directory, _ = native
    monkeypatch.setenv("DEERFLOW_WRITE_FILE_MAX_BYTES", "4")
    with pytest.raises(ValueError, match="native write budget"):
        asyncio.run(artifacts.create_output_bytes(runtime, b"12345", ".json"))
    assert not list(directory.iterdir())


def test_binary_port_empty_file_and_collision(native, monkeypatch):
    runtime, _, directory, _ = native
    monkeypatch.setattr(artifacts, "uuid4", lambda: SimpleNamespace(hex="fixed"))
    path = asyncio.run(artifacts.create_output_bytes(runtime, b"", ".json"))
    with pytest.raises(FileExistsError):
        asyncio.run(artifacts.create_output_bytes(runtime, b"replace", ".json"))
    assert (directory / Path(path).name).read_bytes() == b""


def test_publication_invokes_real_native_tool_and_delivery_attribution(native):
    from langchain_core.callbacks import BaseCallbackHandler
    from langgraph.types import Command

    from deerflow.runtime.runs.worker import _delivery_content_with_outputs

    class Recorder(BaseCallbackHandler):
        def __init__(self):
            self.active = {}
            self.by_tool = {}

        def on_tool_start(self, serialized, input_str, *, run_id, **kwargs):
            self.active[run_id] = serialized["name"]

        def on_tool_end(self, output, *, run_id, **kwargs):
            if isinstance(output, Command) and output.update.get("artifacts"):
                self.by_tool[self.active[run_id]] = output.update["artifacts"]

    runtime, _, _, _ = native
    recorder = Recorder()
    runtime.config = {"callbacks": [recorder]}
    runtime.tool_call_id = "synthetic-parent-tool"
    path = asyncio.run(artifacts.create_output_text(runtime, "draft", ".md"))
    result = asyncio.run(artifacts.present_output_files(runtime, [path]))
    assert result.update["artifacts"] == [path]
    assert result.update["messages"][0].tool_call_id == "synthetic-parent-tool"
    assert recorder.by_tool == {"present_files": [path]}
    assert _delivery_content_with_outputs({"by_tool": recorder.by_tool}, [path])["satisfied"] is True


def test_publisher_path_rejection_does_not_emit_artifact(native):
    runtime, _, _, _ = native
    runtime.tool_call_id = "synthetic-denied"
    result = asyncio.run(artifacts.present_output_files(runtime, ["/outside.md"]))
    assert not result.update.get("artifacts")


@pytest.mark.parametrize("corrupt", [False, True])
def test_remote_output_uses_native_binary_update_and_download(native, monkeypatch, corrupt):
    runtime, sandbox, _, _ = native
    payloads = {}

    def absent(path):
        raise FileNotFoundError(path)

    def update(path, body):
        payloads[path] = body

    monkeypatch.setattr(tools, "is_local_sandbox", lambda runtime: False)
    monkeypatch.setattr(sandbox, "read_file", absent)
    monkeypatch.setattr(sandbox, "update_file", update)
    monkeypatch.setattr(sandbox, "download_file", lambda path: b"wrong" if corrupt else payloads[path])
    content = "\ufeff{{title}}\r\n/mnt/user-data/outputs/source.md"
    if corrupt:
        with pytest.raises(OSError, match="verification"):
            asyncio.run(artifacts.create_output_text(runtime, content, ".md"))
    else:
        path = asyncio.run(artifacts.create_output_text(runtime, content, ".md"))
        assert payloads[path] == content.encode("utf-8")
