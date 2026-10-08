"""Opaque, task-scoped bridge for platform-managed MCP tools.

The implementation deliberately has no HTTP client or config parser: a legal
extension owns transport, mTLS and short-lived assertions.  When bound, this
module replaces local ``extensions_config.json`` discovery for that task.
"""

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any
from uuid import uuid4

from deerflow_extension_api import ControlledMcpRuntime, ControlledMcpRuntimeBinding, ExtensionData, ManagedMcpTool
from langchain.tools import ToolRuntime
from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field

from deerflow.mcp.runtime_identity import extract_thread_id
from deerflow.mcp.tasks.models import TaskReference, TaskSnapshot, TaskStatus, TaskSubmission, TaskSubmitRequest
from deerflow.mcp.tasks.runtime import get_mcp_task_submitter

MANAGED_MCP_TASK_DRIVER = "controlled-managed"
_retained_runtimes: dict[str, ControlledMcpRuntime] = {}

_runtime: ContextVar[ControlledMcpRuntime | None] = ContextVar("deerflow_controlled_mcp_runtime", default=None)
_loaded_tools: ContextVar[tuple[BaseTool, ...] | None] = ContextVar("deerflow_controlled_mcp_tools", default=None)


class _ManagedArguments(BaseModel):
    arguments: dict[str, Any] = Field(default_factory=dict)


def get_controlled_mcp_runtime() -> ControlledMcpRuntime | None:
    return _runtime.get()


def get_loaded_controlled_mcp_tools() -> list[BaseTool] | None:
    cached = _loaded_tools.get()
    return list(cached) if cached is not None else None


def retain_controlled_mcp_runtime(runtime: ControlledMcpRuntime) -> str:
    """Keep an opaque runtime reference for background work in this process.

    A restart without an extension-provided persistent resolver fails closed;
    this registry stores no endpoint, assertion, or secret.
    """

    reference = f"managed-mcp-{uuid4().hex}"
    _retained_runtimes[reference] = runtime
    return reference


def clear_retained_controlled_mcp_runtimes() -> None:
    _retained_runtimes.clear()


def _retained(reference: object) -> ControlledMcpRuntime:
    runtime = _retained_runtimes.get(reference) if isinstance(reference, str) else None
    if runtime is None:
        raise PermissionError("managed MCP runtime reference is unavailable after task admission")
    return runtime


@contextmanager
def controlled_mcp_runtime_scope(task_store: ExtensionData | None) -> Iterator[None]:
    binding = task_store.get(ControlledMcpRuntimeBinding) if task_store is not None else None
    token = _runtime.set(binding.runtime if binding is not None else None)
    loaded_token = _loaded_tools.set(None)
    try:
        yield
    finally:
        _loaded_tools.reset(loaded_token)
        _runtime.reset(token)


def _required_text(value: object, *, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise PermissionError(f"managed MCP requires persisted {field}")
    return value


def _run_correlation(runtime: Any | None) -> tuple[str, str]:
    context = getattr(runtime, "context", None)
    if not isinstance(context, Mapping):
        context = {}
    run_id = _required_text(context.get("run_id"), field="run_id")
    root_run_id = _required_text(context.get("root_run_id") or run_id, field="root_run_id")
    return root_run_id, run_id


def _correlation(runtime: Any | None) -> tuple[str, str, str, str]:
    root_run_id, run_id = _run_correlation(runtime)
    call_id = str(getattr(runtime, "tool_call_id", None) or f"mcp-{uuid4().hex}")
    return root_run_id, run_id, call_id, f"{call_id}.a1"


def _task_correlation(data: Mapping[str, object]) -> tuple[str, str, str, str]:
    """Load the original durable execution identity; never invent it on poll."""
    return (
        _required_text(data.get("root_run_id"), field="root_run_id"),
        _required_text(data.get("run_id"), field="run_id"),
        _required_text(data.get("call_id"), field="call_id"),
        _required_text(data.get("attempt_id"), field="attempt_id"),
    )


def _provided_task_correlation(
    *,
    runtime: Any | None,
    call_id: str,
    attempt_id: str,
) -> tuple[str, str, str, str]:
    root_run_id, run_id = _run_correlation(runtime)
    return (
        root_run_id,
        run_id,
        _required_text(call_id, field="call_id"),
        _required_text(attempt_id, field="attempt_id"),
    )


def _task_identity(runtime: Any | None) -> tuple[str, str]:
    """Use the local MCP runtime identity contract, but reject its CLI defaults."""
    # Import only after the runtime package has completed initialization.  The
    # model task scope imports this module while that package is loading.
    from deerflow.runtime.user_context import DEFAULT_USER_ID, resolve_runtime_user_id

    user_id = resolve_runtime_user_id(runtime)
    thread_id = extract_thread_id(runtime)
    if user_id == DEFAULT_USER_ID or thread_id == "default":
        raise PermissionError("managed MCP durable task requires signed user and thread identity")
    if not user_id or not thread_id:
        raise PermissionError("managed MCP durable task requires signed user and thread identity")
    return user_id, thread_id


async def get_controlled_mcp_tools() -> list[BaseTool]:
    authority = get_controlled_mcp_runtime()
    if authority is None:
        return []
    cached = _loaded_tools.get()
    if cached is not None:
        return list(cached)
    tools: list[BaseTool] = []
    for item in await authority.catalog():
        if not isinstance(item, ManagedMcpTool) or not item.name or not item.tool_id:
            raise PermissionError("managed MCP catalog contains an invalid tool projection")

        async def call(*, arguments: dict[str, Any], runtime: ToolRuntime, _tool_id: str = item.tool_id, _mode: str = item.execution_mode) -> Mapping[str, Any]:
            active = get_controlled_mcp_runtime()
            if active is None:
                raise PermissionError("managed MCP call escaped its task scope")
            root_run_id, run_id, call_id, attempt_id = _correlation(runtime)
            if _mode != "durable":
                return await active.call(tool_id=_tool_id, arguments=arguments, root_run_id=root_run_id, run_id=run_id, call_id=call_id, attempt_id=attempt_id)
            user_id, thread_id = _task_identity(runtime)
            created = await get_mcp_task_submitter().submit(
                driver_name=MANAGED_MCP_TASK_DRIVER,
                request=TaskSubmitRequest(
                    user_id=user_id,
                    thread_id=thread_id,
                    run_id=run_id,
                    tool_call_id=call_id,
                    server_name="managed",
                    task_name=_tool_id,
                    arguments=arguments,
                    driver_data={"runtime_ref": retain_controlled_mcp_runtime(active), "tool_id": _tool_id, "root_run_id": root_run_id, "run_id": run_id, "call_id": call_id, "attempt_id": attempt_id},
                ),
            )
            return {"task_id": created["id"], "status": created["status"]}

        tools.append(
            StructuredTool(
                name=item.name,
                description=item.description,
                args_schema=_ManagedArguments,
                coroutine=call,
                metadata={
                    "deerflow_managed_mcp": True,
                    "effects": item.effects,
                    "risk": item.risk,
                    "execution_mode": item.execution_mode,
                },
            )
        )
    _loaded_tools.set(tuple(tools))
    return list(tools)


async def poll_controlled_mcp_task(
    *,
    task_id: str,
    runtime: Any | None,
    call_id: str,
    attempt_id: str,
) -> Mapping[str, Any]:
    """Poll one opaque managed task without creating another MCP call."""

    authority = get_controlled_mcp_runtime()
    if authority is None:
        raise PermissionError("managed MCP poll escaped its task scope")
    root_run_id, run_id, original_call_id, original_attempt_id = _provided_task_correlation(
        runtime=runtime,
        call_id=call_id,
        attempt_id=attempt_id,
    )
    return await authority.poll(
        task_id=task_id,
        root_run_id=root_run_id,
        run_id=run_id,
        call_id=original_call_id,
        attempt_id=original_attempt_id,
    )


async def cancel_controlled_mcp_task(
    *,
    task_id: str,
    runtime: Any | None,
    call_id: str,
    attempt_id: str,
) -> Mapping[str, Any]:
    """Request cancellation of one opaque managed task; terminality is remote-owned."""

    authority = get_controlled_mcp_runtime()
    if authority is None:
        raise PermissionError("managed MCP cancel escaped its task scope")
    root_run_id, run_id, original_call_id, original_attempt_id = _provided_task_correlation(
        runtime=runtime,
        call_id=call_id,
        attempt_id=attempt_id,
    )
    return await authority.cancel(
        task_id=task_id,
        root_run_id=root_run_id,
        run_id=run_id,
        call_id=original_call_id,
        attempt_id=original_attempt_id,
    )


class ControlledMcpTaskDriver:
    """Durable driver that retains only an opaque extension runtime reference."""

    async def submit(self, request: TaskSubmitRequest) -> TaskSubmission:
        runtime = _retained(request.driver_data.get("runtime_ref"))
        root_run_id, run_id, call_id, attempt_id = _task_correlation(request.driver_data)
        response = await runtime.call(
            tool_id=_required_text(request.driver_data.get("tool_id"), field="tool_id"),
            arguments=request.arguments,
            root_run_id=root_run_id,
            run_id=run_id,
            call_id=call_id,
            attempt_id=attempt_id,
        )
        remote = response.get("job_id")
        if response.get("status") != "submitted" or not isinstance(remote, str) or not remote:
            raise RuntimeError("managed MCP durable submit did not return an opaque job receipt")
        return TaskSubmission(remote_task_id=remote, snapshot=TaskSnapshot(status=TaskStatus.SUBMITTED), driver_data=dict(request.driver_data))

    async def get_status(self, task: TaskReference) -> TaskSnapshot:
        runtime = _retained(task.driver_data.get("runtime_ref"))
        root_run_id, run_id, call_id, attempt_id = _task_correlation(task.driver_data)
        result = await runtime.poll(
            task_id=task.remote_task_id,
            root_run_id=root_run_id,
            run_id=run_id,
            call_id=call_id,
            attempt_id=attempt_id,
        )
        status = str(result.get("status", "failed"))
        if status in {"cancel_requested", "reconciliation_pending"}:
            status = TaskStatus.WORKING
        return TaskSnapshot(status=TaskStatus(status), result=result.get("result"), error=result.get("error"))

    async def cancel(self, task: TaskReference) -> TaskSnapshot:
        runtime = _retained(task.driver_data.get("runtime_ref"))
        root_run_id, run_id, call_id, attempt_id = _task_correlation(task.driver_data)
        result = await runtime.cancel(
            task_id=task.remote_task_id,
            root_run_id=root_run_id,
            run_id=run_id,
            call_id=call_id,
            attempt_id=attempt_id,
        )
        status = TaskStatus.WORKING if result.get("status") == "cancel_requested" else TaskStatus(str(result.get("status", "failed")))
        return TaskSnapshot(status=status, result=result.get("result"), error=result.get("error"))
