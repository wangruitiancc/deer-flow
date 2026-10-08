"""Native extension byte operations keep filesystem work off the event loop."""

import asyncio
import importlib
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from langchain.tools import ToolRuntime

from deerflow.config import paths as paths_module
from deerflow.extensions import artifacts
from deerflow.sandbox import tools
from deerflow.sandbox.local.local_sandbox import LocalSandbox

publisher = importlib.import_module("deerflow.tools.builtins.present_file_tool")


@pytest.fixture
def native(tmp_path, monkeypatch):
    paths = paths_module.Paths(base_dir=tmp_path)
    uploads = paths.sandbox_uploads_dir("thread-a", user_id="user-a")
    outputs = paths.sandbox_outputs_dir("thread-a", user_id="user-a")
    uploads.mkdir(parents=True)
    outputs.mkdir(parents=True)
    sandbox = LocalSandbox("synthetic-bytes")

    @asynccontextmanager
    async def scope(runtime):
        yield

    monkeypatch.setattr(paths_module, "get_paths", lambda: paths)
    monkeypatch.setattr(publisher, "get_paths", lambda: paths)
    monkeypatch.setattr(tools, "sandbox_authorization_scope_async", scope)
    monkeypatch.setattr(tools, "ensure_sandbox_initialized_async", AsyncMock(return_value=sandbox))
    monkeypatch.setattr(tools, "ensure_sandbox_initialized", lambda runtime: sandbox)
    monkeypatch.setattr(tools, "ensure_thread_directories_exist", lambda runtime: None)
    monkeypatch.setattr(tools, "is_local_sandbox", lambda runtime: True)
    runtime = ToolRuntime(
        state={"thread_data": {"uploads_path": str(uploads), "outputs_path": str(outputs)}},
        context={"thread_id": "thread-a", "user_id": "user-a"},
        config={},
        stream_writer=lambda _: None,
        tools=[],
        tool_call_id="synthetic-bytes",
        store=None,
    )
    return runtime, uploads, outputs


@pytest.mark.asyncio
async def test_exact_upload_read_is_nonblocking(native):
    runtime, uploads, _ = native
    payload = b"\xef\xbb\xbfdata\r\n"
    await asyncio.to_thread((uploads / "source.json").write_bytes, payload)
    assert await artifacts.read_uploaded_bytes(runtime, "/mnt/user-data/uploads/source.json", 100) == payload


@pytest.mark.asyncio
async def test_exact_output_create_and_readback_is_nonblocking(native):
    runtime, _, outputs = native
    payload = b"\xef\xbb\xbfdata\r\n"
    path = await artifacts.create_output_bytes(runtime, payload, ".import-report.json")
    assert await asyncio.to_thread((outputs / Path(path).name).read_bytes) == payload
