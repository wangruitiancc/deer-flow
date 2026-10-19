"""Matrix Law tenant admission at the Gateway run boundary."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from matrix_law_extension.runtime import MatterContextAdmission, TrustedMatterContext
from matrix_law_extension.runtime.context import TenantWritesFrozenError

from app.gateway.legal_run_admission import (
    gate_matrix_law_thread_write,
    matrix_law_manages_model_selection,
    matrix_law_thread_write_scope,
    resolve_tenant_capacity_key,
    validate_matrix_law_product,
    validate_matrix_law_run_request,
    validate_matrix_law_runtime_config,
)


def _trusted(tenant_id: str) -> TrustedMatterContext:
    return TrustedMatterContext(
        user_id="user-a",
        tenant_id=tenant_id,
        membership_id="membership-a",
        tenant_role="member",
        matter_id="matter-a",
        work_kind="consultation",
        matter_member_id="matter-member-a",
        matter_role="member",
        thread_id="thread-a",
        mapping_id="mapping-a",
        policy_version="test",
        context_version=1,
    )


def _write_request(admission: MatterContextAdmission | None = None):
    task_admission = (("matrix-law", admission),) if admission is not None else ()
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(extensions=SimpleNamespace(task_admission=task_admission))))


@pytest.mark.anyio
async def test_workspace_write_scope_remains_optional_for_generic_deerflow(monkeypatch) -> None:
    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "0")

    async with matrix_law_thread_write_scope(SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace())), thread_id="thread-a", user_id="user-a"):
        pass


@pytest.mark.anyio
async def test_thread_http_write_route_runs_inside_tenant_write_gate(monkeypatch) -> None:
    events: list[str] = []
    admission = object.__new__(MatterContextAdmission)

    class Gate:
        @staticmethod
        async def _context(operation: str):
            events.append(f"enter:{operation}")
            yield
            events.append("exit")

        def hold(self, *, operation: str):
            from contextlib import asynccontextmanager

            return asynccontextmanager(self._context)(operation)

    async def write_gate_for_thread(*, thread_id: str, user_id: str | None):
        assert (thread_id, user_id) == ("thread-a", "user-a")
        return Gate()

    monkeypatch.setattr(admission, "write_gate_for_thread", write_gate_for_thread)
    monkeypatch.setattr("app.gateway.legal_run_admission.get_effective_user_id", lambda: "user-a")

    @gate_matrix_law_thread_write
    async def endpoint(*, thread_id: str, request):
        events.append("write")
        return {"ok": True}

    result = await endpoint(thread_id="thread-a", request=_write_request(admission))

    assert result == {"ok": True}
    assert events == ["enter:workspace_tool_write", "write", "exit"]


@pytest.mark.anyio
async def test_frozen_tenant_rejects_gateway_thread_write_before_handler(monkeypatch) -> None:
    admission = object.__new__(MatterContextAdmission)

    class FrozenGate:
        @staticmethod
        async def _context(operation: str):
            assert operation == "workspace_tool_write"
            raise TenantWritesFrozenError("frozen")
            yield

        def hold(self, *, operation: str):
            from contextlib import asynccontextmanager

            return asynccontextmanager(self._context)(operation)

    async def write_gate_for_thread(*, thread_id: str, user_id: str | None):
        return FrozenGate()

    monkeypatch.setattr(admission, "write_gate_for_thread", write_gate_for_thread)
    monkeypatch.setattr("app.gateway.legal_run_admission.get_effective_user_id", lambda: "user-a")

    @gate_matrix_law_thread_write
    async def endpoint(*, thread_id: str, request):
        pytest.fail("Frozen tenant must not reach the write handler")

    with pytest.raises(HTTPException) as caught:
        await endpoint(thread_id="thread-a", request=_write_request(admission))

    assert caught.value.status_code == 423


@pytest.mark.anyio
async def test_trusted_tenant_is_hashed_before_it_reaches_run_capacity(monkeypatch) -> None:
    admission = object.__new__(MatterContextAdmission)

    async def resolve_run_context(*, thread_id: str, user_id: str | None):
        assert (thread_id, user_id) == ("thread-a", "user-a")
        return _trusted("tenant-secret-a")

    monkeypatch.setattr(admission, "resolve_run_context", resolve_run_context)
    extensions = SimpleNamespace(task_admission=(("matrix-law", admission),))

    key = await resolve_tenant_capacity_key(extensions, thread_id="thread-a", user_id="user-a")

    assert key is not None and len(key) == 64
    assert "tenant-secret-a" not in key
    assert key == await resolve_tenant_capacity_key(extensions, thread_id="thread-a", user_id="user-a")


@pytest.mark.anyio
async def test_untrusted_legal_thread_is_rejected(monkeypatch) -> None:
    admission = object.__new__(MatterContextAdmission)

    async def resolve_run_context(*, thread_id: str, user_id: str | None):
        return object()

    monkeypatch.setattr(admission, "resolve_run_context", resolve_run_context)
    extensions = SimpleNamespace(task_admission=(("matrix-law", admission),))

    with pytest.raises(PermissionError, match="not trusted"):
        await resolve_tenant_capacity_key(extensions, thread_id="thread-a", user_id="user-a")


@pytest.mark.anyio
async def test_duplicate_matrix_law_admission_is_rejected() -> None:
    first = object.__new__(MatterContextAdmission)
    second = object.__new__(MatterContextAdmission)
    extensions = SimpleNamespace(task_admission=(("one", first), ("two", second)))

    with pytest.raises(RuntimeError, match="exactly one"):
        await resolve_tenant_capacity_key(extensions, thread_id="thread-a", user_id="user-a")


@pytest.mark.anyio
async def test_missing_matrix_law_admission_is_rejected(monkeypatch) -> None:
    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "1")
    extensions = SimpleNamespace(task_admission=())

    with pytest.raises(RuntimeError, match="is required"):
        await resolve_tenant_capacity_key(extensions, thread_id="thread-a", user_id="user-a")


def test_matrix_law_product_startup_rejects_missing_admission(monkeypatch) -> None:
    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "1")

    with pytest.raises(RuntimeError, match="exactly one"):
        validate_matrix_law_product(SimpleNamespace(task_admission=()))


def test_matrix_law_runtime_rejects_unfenced_redis_checkpoint_cache(monkeypatch) -> None:
    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "1")
    app_config = SimpleNamespace(
        database=SimpleNamespace(
            checkpoint_channel_mode="delta",
            checkpoint_cache=SimpleNamespace(type="redis", max_entries=128),
        )
    )

    with pytest.raises(RuntimeError, match="Redis delta checkpoint history cache"):
        validate_matrix_law_runtime_config(app_config)


@pytest.mark.parametrize(
    "cache_config",
    [
        SimpleNamespace(checkpoint_channel_mode="delta", checkpoint_cache=SimpleNamespace(type="memory", max_entries=128)),
        SimpleNamespace(checkpoint_channel_mode="delta", checkpoint_cache=SimpleNamespace(type="redis", max_entries=0)),
        SimpleNamespace(checkpoint_channel_mode="full", checkpoint_cache=SimpleNamespace(type="redis", max_entries=128)),
    ],
)
def test_matrix_law_runtime_allows_memory_or_disabled_checkpoint_cache(monkeypatch, cache_config) -> None:
    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "1")

    validate_matrix_law_runtime_config(SimpleNamespace(database=cache_config))


def test_engine_compatibility_mode_does_not_require_legal_admission(monkeypatch) -> None:
    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "0")

    validate_matrix_law_product(SimpleNamespace(task_admission=()))


def test_matrix_law_controlled_runtime_owns_synchronized_model_selection(monkeypatch) -> None:
    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "1")
    admission = object.__new__(MatterContextAdmission)
    admission._service = SimpleNamespace(
        settings=SimpleNamespace(
            capability_platform=SimpleNamespace(controlled_models_enabled=True),
        )
    )
    extensions = SimpleNamespace(task_admission=(("matrix-law", admission),))

    assert matrix_law_manages_model_selection(extensions) is True


def test_generic_or_uncontrolled_runtime_keeps_static_model_allowlist(monkeypatch) -> None:
    admission = object.__new__(MatterContextAdmission)
    admission._service = SimpleNamespace(
        settings=SimpleNamespace(
            capability_platform=SimpleNamespace(controlled_models_enabled=False),
        )
    )
    extensions = SimpleNamespace(task_admission=(("matrix-law", admission),))

    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "1")
    assert matrix_law_manages_model_selection(extensions) is False
    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "0")
    admission._service.settings.capability_platform.controlled_models_enabled = True
    assert matrix_law_manages_model_selection(extensions) is False


@pytest.mark.parametrize(
    "body",
    [
        SimpleNamespace(assistant_id="general-purpose", context=None, config=None),
        SimpleNamespace(assistant_id="lead_agent", context={"agent_name": "custom"}, config=None),
        SimpleNamespace(
            assistant_id="lead_agent",
            context=None,
            config={"configurable": {"agent_name": "custom"}},
        ),
    ],
)
def test_matrix_law_product_rejects_generic_agent_selection(monkeypatch, body) -> None:
    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "1")

    with pytest.raises(ValueError, match="agent"):
        validate_matrix_law_run_request(body)


def test_matrix_law_product_accepts_only_the_dedicated_lead_agent(monkeypatch) -> None:
    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "1")

    validate_matrix_law_run_request(SimpleNamespace(assistant_id="lead_agent", context={"model_name": "legal-model"}, config=None))


def test_matrix_law_product_does_not_mount_generic_control_plane(monkeypatch) -> None:
    monkeypatch.setenv("MATRIX_LAW_PRODUCT_REQUIRED", "1")

    from pathlib import Path

    from app.gateway.app import create_app
    from deerflow.config.app_config import AppConfig

    config = AppConfig.from_file(str(Path(__file__).resolve().parents[2] / "config.example.yaml"))
    monkeypatch.setattr("app.gateway.app.get_app_config", lambda: config)
    product_app = create_app()
    paths = {route.path for route in product_app.routes}

    assert product_app.title == "Matrix-Law API Gateway"
    assert "/api/law/health" in paths
    for generic_prefix in (
        "/api/agents",
        "/api/assistants",
        "/api/channels",
        "/api/console",
        "/api/integrations",
        "/api/mcp",
        "/api/memory",
        "/api/scheduled-tasks",
        "/api/skills",
        "/api/subagents",
    ):
        assert not any(path == generic_prefix or path.startswith(f"{generic_prefix}/") for path in paths)


@pytest.mark.asyncio
async def test_thread_write_decorator_binds_positional_and_keyword_arguments(monkeypatch):
    from contextlib import asynccontextmanager

    from app.gateway import legal_run_admission as admission

    calls = []

    @asynccontextmanager
    async def scope(request, *, thread_id, user_id):
        calls.append((request, thread_id))
        yield

    monkeypatch.setattr(admission, "matrix_law_thread_write_scope", scope)

    @admission.gate_matrix_law_thread_write
    async def operation(thread_id, payload, request=None):
        return payload

    request = object()
    assert await operation("thread-a", "positional", request) == "positional"
    assert await operation(thread_id="thread-b", payload="keyword", request=request) == "keyword"
    assert calls == [(request, "thread-a"), (request, "thread-b")]
