"""The extension reader reuses native output resolution and sandbox authorization."""

import asyncio
import importlib
import threading
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
from deerflow_extension_api import ExtensionRuntimeDeps

from deerflow.extensions.artifacts import read_output_text
from deerflow.sandbox import tools

present_file_tool = importlib.import_module("deerflow.tools.builtins.present_file_tool")


@pytest.fixture
def native(monkeypatch):
    calls = []

    @asynccontextmanager
    async def scope(runtime):
        calls.append(("authorize", runtime))
        yield

    def resolve(runtime, path):
        calls.append(("resolve", runtime, path))
        if path == "/outside":
            raise ValueError("outside current output scope")
        return "/mnt/user-data/outputs/resolved.json"

    def read(runtime, path):
        calls.append(("read", runtime, path, threading.get_ident()))
        return "中文" * 30000

    monkeypatch.setattr(tools, "sandbox_authorization_scope_async", scope)
    monkeypatch.setattr(tools, "ensure_sandbox_initialized_async", AsyncMock())
    monkeypatch.setattr(present_file_tool, "_normalize_presented_filepath", resolve)
    monkeypatch.setattr(tools, "read_current_file_content", read)
    return calls


def test_full_text_not_display_truncation_and_io_off_event_loop(native):
    runtime = object()
    result = asyncio.run(read_output_text(runtime, "host-alias", 200000))
    assert result == "中文" * 30000
    assert native[0] == ("authorize", runtime)
    assert native[1] == ("resolve", runtime, "host-alias")
    assert native[2][2] == "/mnt/user-data/outputs/resolved.json"
    assert native[2][3] != threading.get_ident()


def test_utf8_size_checked_without_silent_truncation(native):
    with pytest.raises(ValueError):
        asyncio.run(read_output_text(object(), "alias", 60000))


def test_native_scope_rejection_prevents_read(native):
    with pytest.raises(ValueError):
        asyncio.run(read_output_text(object(), "/outside", 200000))
    assert not any(call[0] == "read" for call in native)


def test_authorization_rejection_prevents_resolution(native, monkeypatch):
    @asynccontextmanager
    async def denied(runtime):
        raise PermissionError("denied")
        yield

    monkeypatch.setattr(tools, "sandbox_authorization_scope_async", denied)
    with pytest.raises(PermissionError):
        asyncio.run(read_output_text(object(), "alias", 200000))
    assert not native


@pytest.mark.parametrize("value", ["Error: synthetic remote failure", None])
def test_remote_error_strings_are_not_file_contents(native, monkeypatch, value):
    monkeypatch.setattr(tools, "read_current_file_content", lambda *args: value)
    with pytest.raises(OSError):
        asyncio.run(read_output_text(object(), "alias", 200000))


def test_runtime_deps_reader_is_optional_for_old_hosts():
    assert ExtensionRuntimeDeps().read_output_text is None
