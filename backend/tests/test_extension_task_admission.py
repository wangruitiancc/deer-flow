"""Fail-closed task admission for security-sensitive extensions."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from deerflow_extension_api import ExtensionData, TaskInfo
from langgraph.checkpoint.memory import InMemorySaver

from deerflow.extensions.admission import admit_task
from deerflow.extensions.registry import ExtensionRegistry
from deerflow.runtime.runs.manager import RunManager
from deerflow.runtime.runs.schemas import RunStatus
from deerflow.runtime.runs.worker import RunContext, run_agent


def _info() -> TaskInfo:
    return TaskInfo(
        task_id="task-1",
        run_id="run-1",
        thread_id="thread-1",
        kind="lead",
        user_id="user-1",
    )


def _extensions(*contributors):
    registry = ExtensionRegistry()
    for index, contributor in enumerate(contributors):
        with registry.attributed_to(f"ext{index}:install"):
            registry.task_admission(contributor)
    return registry.build()


@pytest.mark.asyncio
async def test_admission_reaches_contributors_in_registration_order():
    reached: list[str] = []

    class _Allow:
        def __init__(self, name: str) -> None:
            self.name = name

        async def admit_task(self, app_store, task_store, info):
            reached.append(self.name)

    await admit_task(
        _extensions(_Allow("first"), _Allow("second")),
        ExtensionData("task-1"),
        _info(),
    )

    assert reached == ["first", "second"]


@pytest.mark.asyncio
async def test_admission_failure_propagates_and_stops_later_contributors():
    reached: list[str] = []

    class _Deny:
        async def admit_task(self, app_store, task_store, info):
            reached.append("deny")
            raise PermissionError("matter access revoked")

    class _MustNotRun:
        async def admit_task(self, app_store, task_store, info):
            reached.append("later")

    with pytest.raises(PermissionError, match="access revoked"):
        await admit_task(
            _extensions(_Deny(), _MustNotRun()),
            ExtensionData("task-1"),
            _info(),
        )

    assert reached == ["deny"]


@pytest.mark.asyncio
async def test_admission_timeout_fails_closed():
    class _Hang:
        async def admit_task(self, app_store, task_store, info):
            await asyncio.sleep(10)

    with pytest.raises(TimeoutError):
        await admit_task(
            _extensions(_Hang()),
            ExtensionData("task-1"),
            _info(),
            timeout=0.02,
        )


def _bridge():
    return SimpleNamespace(
        publish=AsyncMock(),
        publish_end=AsyncMock(),
        cleanup=AsyncMock(),
    )


class _Agent:
    def __init__(self) -> None:
        self.called = False

    async def astream(self, graph_input, config=None, stream_mode=None, subgraphs=False):
        self.called = True
        yield {"messages": []}


@pytest.mark.asyncio
async def test_lead_run_passes_server_user_to_admission_before_agent_execution():
    infos: list[TaskInfo] = []

    class _Capture:
        async def admit_task(self, app_store, task_store, info):
            infos.append(info)

    manager = RunManager()
    record = await manager.create("thread-owned", user_id="user-owned")
    agent = _Agent()

    await run_agent(
        _bridge(),
        manager,
        record,
        ctx=RunContext(checkpointer=InMemorySaver(), extensions=_extensions(_Capture())),
        agent_factory=lambda *, config: agent,
        graph_input={},
        config={},
    )

    assert record.status is RunStatus.success
    assert infos == [
        TaskInfo(
            task_id=record.run_id,
            run_id=record.run_id,
            thread_id="thread-owned",
            kind="lead",
            user_id="user-owned",
        )
    ]
    assert agent.called is True


@pytest.mark.asyncio
async def test_lead_run_admission_failure_prevents_agent_execution():
    class _Deny:
        async def admit_task(self, app_store, task_store, info):
            raise PermissionError("revoked")

    manager = RunManager()
    record = await manager.create("thread-denied", user_id="user-denied")
    agent = _Agent()

    await run_agent(
        _bridge(),
        manager,
        record,
        ctx=RunContext(checkpointer=InMemorySaver(), extensions=_extensions(_Deny())),
        agent_factory=lambda *, config: agent,
        graph_input={},
        config={},
    )

    assert record.status is RunStatus.error
    assert agent.called is False
