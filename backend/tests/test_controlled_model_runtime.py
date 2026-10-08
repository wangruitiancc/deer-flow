"""CP-02 task-scoped controlled-model adapter tests (no provider calls)."""

from __future__ import annotations

import ssl
from collections.abc import AsyncIterator, Mapping

import httpx
import pytest
from deerflow_extension_api import ControlledGatewayTransport, ControlledModelRuntimeBinding, ExtensionData

from deerflow.config.app_config import AppConfig
from deerflow.config.model_config import ModelConfig
from deerflow.config.sandbox_config import SandboxConfig
from deerflow.models import create_chat_model
from deerflow.models.controlled import (
    ControlledGatewayChatModel,
    _ControlledCall,
    _ControlledGatewayAuth,
    _current_call,
    controlled_model_runtime_scope,
    create_controlled_gateway_model,
    get_controlled_model_runtime,
    iter_with_controlled_model_runtime,
)


class _Runtime:
    gateway_base_url = "https://gateway.example.test/v2/proxy/model/v1"

    def __init__(self, *, allowed: bool = True, model_name: str = "controlled-model") -> None:
        self.allowed = allowed
        self.model_name = model_name
        self.calls: list[tuple[str, str, str, str]] = []

    def allows_model(self, model_name: str) -> bool:
        return self.allowed and model_name == self.model_name

    def request_headers(
        self,
        *,
        model_name: str,
        purpose: str,
        call_id: str,
        attempt_id: str,
    ) -> Mapping[str, str]:
        self.calls.append((model_name, purpose, call_id, attempt_id))
        return {
            "Authorization": "Bearer law-private-signing-secret",
            "X-Capability-Call-Id": call_id,
            "X-Capability-Attempt-Id": attempt_id,
            "X-Capability-Root-Run-Id": "root-run-1",
            "X-Capability-Purpose": purpose,
        }


class _RequestBoundRuntime(_Runtime):
    def __init__(self) -> None:
        super().__init__()
        self.bound_requests: list[tuple[str, str, bytes]] = []

    def request_headers_for_request(
        self,
        *,
        model_name: str,
        purpose: str,
        call_id: str,
        attempt_id: str,
        request_method: str,
        request_path: str,
        request_body: bytes,
    ) -> Mapping[str, str]:
        self.bound_requests.append((request_method, request_path, request_body))
        return self.request_headers(
            model_name=model_name,
            purpose=purpose,
            call_id=call_id,
            attempt_id=attempt_id,
        )


class _MtlsRuntime(_RequestBoundRuntime):
    gateway_base_url = "https://gateway.example.test/v3/proxy/model/v1"

    def __init__(self, context: ssl.SSLContext | None = None) -> None:
        super().__init__()
        self._context = context or ssl.create_default_context()

    @property
    def gateway_transport(self) -> ControlledGatewayTransport:
        return ControlledGatewayTransport(ssl_context=self._context)


class _InsecureTransportRuntime(_MtlsRuntime):
    gateway_base_url = "http://gateway.example.test/v3/proxy/model/v1"


def _config() -> AppConfig:
    return AppConfig(
        models=[
            ModelConfig(
                name="controlled-model",
                model="controlled-model",
                use="langchain_openai:ChatOpenAI",
                api_key="upstream-provider-secret",
                base_url="https://provider.example.test/v1",
            )
        ],
        sandbox=SandboxConfig(use="deerflow.sandbox.local:LocalSandboxProvider"),
    )


def test_factory_uses_gateway_only_inside_a_live_task_scope() -> None:
    runtime = _Runtime()
    store = ExtensionData("task-1")
    store.set(ControlledModelRuntimeBinding(runtime))

    assert get_controlled_model_runtime() is None
    with controlled_model_runtime_scope(store):
        model = create_chat_model(
            name="controlled-model",
            app_config=_config(),
            attach_tracing=False,
            purpose="title",
        )
        assert isinstance(model, ControlledGatewayChatModel)
        assert model.openai_api_base == runtime.gateway_base_url
        assert model.controlled_purpose == "title"
        assert get_controlled_model_runtime() is runtime
        serialized = model.model_dump_json()
        assert "upstream-provider-secret" not in serialized
        assert "law-private-signing-secret" not in serialized
        assert "controlled_runtime" not in serialized
    assert get_controlled_model_runtime() is None


def test_factory_refuses_a_denied_model_without_provider_fallback() -> None:
    store = ExtensionData("task-1")
    store.set(ControlledModelRuntimeBinding(_Runtime(allowed=False)))

    with controlled_model_runtime_scope(store), pytest.raises(ValueError, match="Controlled model runtime rejected"):
        create_chat_model(name="controlled-model", app_config=_config(), attach_tracing=False)


def test_factory_uses_a_platform_catalog_model_with_the_local_safety_profile() -> None:
    runtime = _Runtime(model_name="MiniMax-M3")
    store = ExtensionData("task-dynamic-model")
    store.set(ControlledModelRuntimeBinding(runtime))

    with controlled_model_runtime_scope(store):
        model = create_chat_model(name="MiniMax-M3", app_config=_config(), attach_tracing=False)
        assert isinstance(model, ControlledGatewayChatModel)
        assert model.model_name == "MiniMax-M3"
        assert model.max_tokens == 4096
        assert model.openai_api_base == runtime.gateway_base_url
        model.http_client.close()
        import asyncio

        asyncio.run(model.http_async_client.aclose())


def test_factory_attaches_extension_owned_verified_tls_context_without_serializing_it() -> None:
    runtime = _MtlsRuntime()
    store = ExtensionData("task-mtls")
    store.set(ControlledModelRuntimeBinding(runtime))
    with controlled_model_runtime_scope(store):
        model = create_chat_model(
            name="controlled-model",
            app_config=_config(),
            attach_tracing=False,
            purpose="agent",
        )

        assert model.http_client._transport._pool._ssl_context is runtime._context
        assert model.http_async_client._transport._pool._ssl_context is runtime._context
        assert "gateway_transport" not in model.model_dump_json()
        model.http_client.close()
        import asyncio

        asyncio.run(model.http_async_client.aclose())


def test_factory_rejects_plain_http_when_runtime_requires_tls_transport() -> None:
    with pytest.raises(PermissionError, match="requires HTTPS"):
        create_controlled_gateway_model(
            name="controlled-model",
            purpose="agent",
            runtime=_InsecureTransportRuntime(),
            model_settings={},
            kwargs={},
        )


def test_fresh_subtask_store_cannot_inherit_parent_model_authority() -> None:
    parent_runtime = _Runtime()
    parent_store = ExtensionData("lead-task")
    parent_store.set(ControlledModelRuntimeBinding(parent_runtime))
    child_store = ExtensionData("subtask-without-admission")

    with controlled_model_runtime_scope(parent_store):
        assert get_controlled_model_runtime() is parent_runtime
        with controlled_model_runtime_scope(child_store):
            assert get_controlled_model_runtime() is None
        assert get_controlled_model_runtime() is parent_runtime


def test_gateway_auth_mints_a_fresh_assertion_for_each_http_attempt() -> None:
    runtime = _Runtime()
    call = _ControlledCall(runtime=runtime, model_name="controlled-model", purpose="subagent", call_id="call-1")
    token = _current_call.set(call)
    try:
        first = next(_ControlledGatewayAuth().auth_flow(httpx.Request("POST", "https://gateway.example.test/v2/proxy/model/v1/chat/completions")))
        second = next(_ControlledGatewayAuth().auth_flow(httpx.Request("POST", "https://gateway.example.test/v2/proxy/model/v1/chat/completions")))
    finally:
        _current_call.reset(token)

    assert first.headers["Authorization"] == "Bearer law-private-signing-secret"
    assert first.headers["X-Capability-Attempt-Id"] == "call-1.a1"
    assert second.headers["X-Capability-Attempt-Id"] == "call-1.a2"
    assert [attempt_id for _, _, _, attempt_id in runtime.calls] == ["call-1.a1", "call-1.a2"]


def test_gateway_auth_offers_final_http_request_to_new_runtime_contract() -> None:
    runtime = _RequestBoundRuntime()
    call = _ControlledCall(runtime=runtime, model_name="controlled-model", purpose="agent", call_id="call-body")
    raw = '{"model":"controlled-model","temperature":1.0,"messages":[{"role":"user","content":"法务🧪"}]}'.encode()
    token = _current_call.set(call)
    try:
        request = httpx.Request(
            "POST",
            "https://gateway.example.test/v3/proxy/model/v1/chat/completions",
            content=raw,
        )
        next(_ControlledGatewayAuth().auth_flow(request))
    finally:
        _current_call.reset(token)

    assert runtime.bound_requests == [
        (
            "POST",
            "/v3/proxy/model/v1/chat/completions",
            raw,
        ),
    ]


@pytest.mark.asyncio
async def test_stream_scope_does_not_leak_the_service_identity_after_cancellation() -> None:
    runtime = _Runtime()
    store = ExtensionData("task-1")
    store.set(ControlledModelRuntimeBinding(runtime))

    async def source() -> AsyncIterator[int]:
        assert get_controlled_model_runtime() is runtime
        yield 1
        assert get_controlled_model_runtime() is runtime
        yield 2

    iterator = iter_with_controlled_model_runtime(store, source())
    assert await anext(iterator) == 1
    await iterator.aclose()
    assert get_controlled_model_runtime() is None
