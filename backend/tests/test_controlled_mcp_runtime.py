"""CP-04 managed MCP bridge tests; no external MCP or credentials."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from deerflow_extension_api import ControlledMcpRuntimeBinding, ExtensionData, ManagedMcpTool
from langchain_core.messages import AIMessage
from langgraph.graph import MessagesState, StateGraph
from langgraph.prebuilt import ToolNode

from deerflow.mcp.controlled import (
    ControlledMcpTaskDriver,
    cancel_controlled_mcp_task,
    controlled_mcp_runtime_scope,
    get_controlled_mcp_runtime,
    get_controlled_mcp_tools,
    get_loaded_controlled_mcp_tools,
    poll_controlled_mcp_task,
    retain_controlled_mcp_runtime,
)
from deerflow.mcp.tasks.models import TaskReference, TaskStatus, TaskSubmitRequest
from deerflow.mcp.tasks.runtime import set_mcp_task_submitter
from deerflow.mcp.tools import get_mcp_tools
from deerflow.tools.tools import _ensure_sync_invocable_tool


class _Runtime:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.polls: list[dict[str, object]] = []
        self.cancels: list[dict[str, object]] = []
        self.catalog_calls = 0

    async def catalog(self):
        self.catalog_calls += 1
        return [ManagedMcpTool(tool_id="tool-v1", name="managed_lookup", description="safe", effects="read")]

    async def call(self, **kwargs):
        self.calls.append(kwargs)
        return {"status": "completed", "result": {"ok": True}}

    async def poll(self, **kwargs):
        self.polls.append(kwargs)
        return {"status": "submitted"}

    async def cancel(self, **kwargs):
        self.cancels.append(kwargs)
        return {"status": "cancel_requested"}


class _DurableRuntime(_Runtime):
    async def catalog(self):
        return [ManagedMcpTool(tool_id="tool-v1", name="managed_lookup", description="safe", execution_mode="durable")]

    async def call(self, **kwargs):
        self.calls.append(kwargs)
        return {"status": "submitted", "job_id": "remote-secret-job"}

    async def poll(self, **kwargs):
        self.polls.append(kwargs)
        return {"status": "completed", "result": {"done": True}}


class _Submitter:
    def __init__(self) -> None:
        self.requests = []

    async def submit(self, *, driver_name, request, now=None):
        self.requests.append((driver_name, request))
        return {"id": "local-task-1", "status": "submitted"}


@pytest.mark.asyncio
async def test_managed_runtime_replaces_local_discovery_and_binds_run_attempt() -> None:
    authority = _Runtime()
    store = ExtensionData("task")
    store.set(ControlledMcpRuntimeBinding(authority))
    assert get_controlled_mcp_runtime() is None
    with controlled_mcp_runtime_scope(store):
        # The public loader must not consult extensions_config.json while the
        # managed binding is present.
        tools = await get_mcp_tools()
        assert [tool.name for tool in tools] == ["managed_lookup"]
        assert [tool.name for tool in get_loaded_controlled_mcp_tools() or []] == ["managed_lookup"]
        assert [tool.name for tool in await get_controlled_mcp_tools()] == ["managed_lookup"]
        assert authority.catalog_calls == 1
        result = await tools[0].coroutine(arguments={"matter": "m1"}, runtime=SimpleNamespace(context={"run_id": "run-1", "root_run_id": "root-1"}, tool_call_id="call-1"))
        assert result == {"status": "completed", "result": {"ok": True}}
    assert get_controlled_mcp_runtime() is None
    assert get_loaded_controlled_mcp_tools() is None
    assert authority.calls[0] == {"tool_id": "tool-v1", "arguments": {"matter": "m1"}, "root_run_id": "root-1", "run_id": "run-1", "call_id": "call-1", "attempt_id": "call-1.a1"}


@pytest.mark.asyncio
async def test_managed_runtime_receives_persisted_identity_from_tool_node() -> None:
    authority = _Runtime()
    store = ExtensionData("task")
    store.set(ControlledMcpRuntimeBinding(authority))
    with controlled_mcp_runtime_scope(store):
        tool = _ensure_sync_invocable_tool((await get_controlled_mcp_tools())[0])
        builder = StateGraph(MessagesState, context_schema=dict)
        builder.add_node("tools", ToolNode([tool]))
        builder.set_entry_point("tools")
        builder.set_finish_point("tools")
        graph = builder.compile()
        result = await graph.ainvoke(
            {
                "messages": [
                    AIMessage(
                        content="",
                        tool_calls=[
                            {
                                "name": "managed_lookup",
                                "args": {"arguments": {"matter": "m1"}},
                                "id": "call-node-1",
                                "type": "tool_call",
                            }
                        ],
                    )
                ]
            },
            context={"thread_id": "thread-1", "run_id": "run-node-1", "root_run_id": "root-node-1"},
        )
    assert result["messages"][-1].status == "success"
    assert authority.calls == [
        {
            "tool_id": "tool-v1",
            "arguments": {"matter": "m1"},
            "root_run_id": "root-node-1",
            "run_id": "run-node-1",
            "call_id": "call-node-1",
            "attempt_id": "call-node-1.a1",
        }
    ]


@pytest.mark.asyncio
async def test_managed_poll_and_cancel_keep_original_call_and_attempt_binding() -> None:
    authority = _Runtime()
    store = ExtensionData("task")
    store.set(ControlledMcpRuntimeBinding(authority))
    runtime = SimpleNamespace(context={"run_id": "run-1", "root_run_id": "root-1"})
    with controlled_mcp_runtime_scope(store):
        assert await poll_controlled_mcp_task(task_id="task-1", runtime=runtime, call_id="call-1", attempt_id="call-1.a1") == {"status": "submitted"}
        assert await cancel_controlled_mcp_task(task_id="task-1", runtime=runtime, call_id="call-1", attempt_id="call-1.a1") == {"status": "cancel_requested"}
        with pytest.raises(PermissionError, match="call_id"):
            await poll_controlled_mcp_task(task_id="task-1", runtime=runtime, call_id="", attempt_id="call-1.a1")
    expected = {"task_id": "task-1", "root_run_id": "root-1", "run_id": "run-1", "call_id": "call-1", "attempt_id": "call-1.a1"}
    assert authority.polls == [expected]
    assert authority.cancels == [expected]


@pytest.mark.asyncio
async def test_managed_runtime_fails_closed_without_signed_run_context() -> None:
    store = ExtensionData("task")
    store.set(ControlledMcpRuntimeBinding(_Runtime()))
    with controlled_mcp_runtime_scope(store):
        tool = (await get_controlled_mcp_tools())[0]
        with pytest.raises(PermissionError, match="run_id"):
            await tool.coroutine(arguments={}, runtime=SimpleNamespace(context={}, tool_call_id="call-missing-run"))


@pytest.mark.asyncio
async def test_durable_driver_hides_remote_handle_and_background_paths_fail_closed() -> None:
    runtime = _DurableRuntime()
    data = {"runtime_ref": retain_controlled_mcp_runtime(runtime), "tool_id": "tool-v1", "root_run_id": "root-1", "run_id": "run-1", "call_id": "call-1", "attempt_id": "call-1.a1"}
    assert json.loads(json.dumps(data)) == data
    assert "remote-secret-job" not in json.dumps(data)
    driver = ControlledMcpTaskDriver()
    submitted = await driver.submit(TaskSubmitRequest(user_id="user-1", thread_id="thread-1", run_id="run-1", tool_call_id="call-1", server_name="managed", task_name="tool-v1", arguments={}, driver_data=data))
    assert submitted.remote_task_id == "remote-secret-job"
    snapshot = await driver.get_status(TaskReference(local_task_id="local-1", user_id="user-1", thread_id="thread-1", server_name="managed", remote_task_id=submitted.remote_task_id, driver_data=data))
    assert snapshot.status is TaskStatus.COMPLETED
    cancelled = await driver.cancel(TaskReference(local_task_id="local-1", user_id="user-1", thread_id="thread-1", server_name="managed", remote_task_id=submitted.remote_task_id, driver_data=data))
    assert cancelled.status is TaskStatus.WORKING
    expected = {"task_id": "remote-secret-job", "root_run_id": "root-1", "run_id": "run-1", "call_id": "call-1", "attempt_id": "call-1.a1"}
    assert runtime.polls == [expected]
    assert runtime.cancels == [expected]
    with pytest.raises(PermissionError, match="reference"):
        await driver.get_status(TaskReference(local_task_id="local-2", user_id="user-1", thread_id="thread-1", server_name="managed", remote_task_id="remote", driver_data={**data, "runtime_ref": "missing"}))
    for field in ("call_id", "attempt_id"):
        with pytest.raises(PermissionError, match=field):
            await driver.get_status(
                TaskReference(
                    local_task_id=f"local-missing-{field}",
                    user_id="user-1",
                    thread_id="thread-1",
                    server_name="managed",
                    remote_task_id="remote",
                    driver_data={key: value for key, value in data.items() if key != field},
                )
            )


@pytest.mark.asyncio
async def test_durable_wrapper_uses_runtime_config_and_authenticated_user_identity() -> None:
    """Managed durable tasks share local MCP's config/auth identity extraction."""
    authority = _DurableRuntime()
    submitter = _Submitter()
    store = ExtensionData("task")
    store.set(ControlledMcpRuntimeBinding(authority))
    runtime = SimpleNamespace(
        context={"run_id": "run-1", "root_run_id": "root-1"},
        config={"configurable": {"thread_id": "thread-from-config"}},
        server_info=SimpleNamespace(user={"identity": "auth-user"}),
        tool_call_id="call-1",
    )
    set_mcp_task_submitter(submitter)
    try:
        with controlled_mcp_runtime_scope(store):
            tool = (await get_controlled_mcp_tools())[0]
            result = await tool.coroutine(arguments={"matter": "m1"}, runtime=runtime)
    finally:
        set_mcp_task_submitter(None)
    assert result == {"task_id": "local-task-1", "status": "submitted"}
    driver_name, request = submitter.requests[0]
    assert driver_name == "controlled-managed"
    assert request.user_id == "auth-user"
    assert request.thread_id == "thread-from-config"
    assert request.driver_data["call_id"] == "call-1"
    assert request.driver_data["attempt_id"] == "call-1.a1"
