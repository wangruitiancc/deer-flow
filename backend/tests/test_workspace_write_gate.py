from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from deerflow_extension_api import ExtensionData, TaskWriteGateBinding
from deerflow_extension_api.runtime_bridge import EXTENSION_TASK_STORE_KEY

from deerflow.sandbox import tools


class _Gate:
    def __init__(self) -> None:
        self.active = False
        self.frozen = False
        self.operations: list[str] = []

    @asynccontextmanager
    async def hold(self, *, operation: str):
        self.operations.append(operation)
        if self.frozen:
            raise PermissionError("frozen")
        self.active = True
        try:
            yield
        finally:
            self.active = False


def _runtime_with_gate(gate: _Gate):
    task_store = ExtensionData("legal-task")
    task_store.set(TaskWriteGateBinding(gate))
    return SimpleNamespace(context={EXTENSION_TASK_STORE_KEY: task_store}, state={})


@pytest.mark.asyncio
async def test_workspace_mutation_runs_inside_admitted_write_gate(monkeypatch):
    gate = _Gate()
    runtime = _runtime_with_gate(gate)
    mutated: list[bool] = []

    @asynccontextmanager
    async def authorized(_runtime):
        yield

    async def initialized(_runtime):
        return None

    async def run_sync(func, _runtime, *args):
        assert gate.active
        return func(*args)

    monkeypatch.setattr(tools, "sandbox_authorization_scope_async", authorized)
    monkeypatch.setattr(tools, "ensure_sandbox_initialized_async", initialized)
    monkeypatch.setattr(tools, "run_sync_lifecycle_operation", run_sync)

    result = await tools._run_sync_tool_after_async_sandbox_init(
        lambda: mutated.append(True) or "OK",
        runtime,
        write_operation="workspace_tool_write",
    )

    assert result == "OK"
    assert mutated == [True]
    assert gate.operations == ["workspace_tool_write"]
    assert not gate.active


@pytest.mark.asyncio
async def test_frozen_workspace_gate_rejects_before_mutation(monkeypatch):
    gate = _Gate()
    gate.frozen = True
    runtime = _runtime_with_gate(gate)
    mutated: list[bool] = []

    @asynccontextmanager
    async def authorized(_runtime):
        yield

    async def initialized(_runtime):
        return None

    async def run_sync(func, _runtime, *args):
        return func(*args)

    monkeypatch.setattr(tools, "sandbox_authorization_scope_async", authorized)
    monkeypatch.setattr(tools, "ensure_sandbox_initialized_async", initialized)
    monkeypatch.setattr(tools, "run_sync_lifecycle_operation", run_sync)

    result = await tools._run_sync_tool_after_async_sandbox_init(
        lambda: mutated.append(True) or "OK",
        runtime,
        write_operation="workspace_tool_write",
    )

    assert result.startswith("Error:")
    assert mutated == []


@pytest.mark.asyncio
async def test_text_mutation_tools_request_workspace_gate(monkeypatch):
    requested_operations: list[str | None] = []

    async def capture(_func, _runtime, *args, write_operation=None):
        requested_operations.append(write_operation)
        return "OK"

    monkeypatch.setattr(tools, "_run_sync_tool_after_async_sandbox_init", capture)
    runtime = SimpleNamespace()
    assert await tools._write_file_tool_async(runtime, "/workspace/doc.txt", "text") == "OK"
    assert await tools._str_replace_tool_async(runtime, "/workspace/doc.txt", "old", "new") == "OK"
    assert requested_operations == ["workspace_tool_write", "workspace_tool_write"]
