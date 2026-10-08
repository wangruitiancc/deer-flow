"""Task-scoped adapter for the capability Gateway's controlled model route.

This module intentionally knows only the public extension contract. A legal
or other vertical extension supplies an opaque runtime binding after trusted
task admission; DeerFlow never imports that extension or receives its signing
material. The binding is held in ContextVars/model client fields excluded from
Pydantic serialization, never in RunnableConfig or checkpoint state.
"""

from __future__ import annotations

import ssl
from collections.abc import AsyncIterator, Iterator, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, TypeVar
from uuid import uuid4

import httpx
from deerflow_extension_api import (
    ControlledGatewayTransport,
    ControlledModelRuntime,
    ControlledModelRuntimeBinding,
    ExtensionData,
)
from langchain_core.callbacks.manager import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.messages import BaseMessage
from langchain_core.outputs import ChatGenerationChunk, ChatResult
from langchain_openai import ChatOpenAI
from pydantic import Field

from deerflow.mcp.controlled import controlled_mcp_runtime_scope

_current_runtime: ContextVar[ControlledModelRuntime | None] = ContextVar("deerflow_controlled_model_runtime", default=None)
_current_call: ContextVar[_ControlledCall | None] = ContextVar("deerflow_controlled_model_call", default=None)
_StreamItem = TypeVar("_StreamItem")
_DEFAULT_CONTROLLED_MAX_TOKENS = 4096


def get_controlled_model_runtime() -> ControlledModelRuntime | None:
    """Return the active task authority, if a trusted admission installed one."""

    return _current_runtime.get()


@contextmanager
def controlled_model_runtime_scope(task_store: ExtensionData | None) -> Iterator[None]:
    """Bind the extension-owned model authority only for live task execution."""

    from deerflow.skills.managed import managed_skill_runtime_scope

    binding = task_store.get(ControlledModelRuntimeBinding) if task_store is not None else None
    # Always set a value, including ``None``.  A nested subagent starts with a
    # fresh task store; merely yielding when its admission forgot to install a
    # binding would inherit the parent ContextVar and let it reuse parent model
    # authority.  Absence is therefore an explicit fail-closed scope.
    token = _current_runtime.set(binding.runtime if binding is not None else None)
    try:
        # Managed MCP authority is bound and cleared with the same live task
        # boundary. A child task store therefore cannot inherit either model
        # or MCP authority from its parent.
        with controlled_mcp_runtime_scope(task_store), managed_skill_runtime_scope(task_store):
            yield
    finally:
        _current_runtime.reset(token)


def iter_with_controlled_model_runtime[StreamItem](
    task_store: ExtensionData | None,
    stream: AsyncIterator[StreamItem],
) -> AsyncIterator[StreamItem]:
    """Bind authority per iterator step and forward explicit stream cleanup.

    Closing remains owned by the worker, whose abort/error policy handles
    cleanup failures. No authority binding is held across a yielded item.
    """

    class BoundStream:
        def __aiter__(self):
            return self

        async def __anext__(self):
            with controlled_model_runtime_scope(task_store):
                return await anext(stream)

        async def aclose(self):
            with controlled_model_runtime_scope(task_store):
                close = getattr(stream, "aclose", None)
                if close is not None:
                    await close()

    return BoundStream()


@dataclass
class _ControlledCall:
    runtime: ControlledModelRuntime
    model_name: str
    purpose: str
    call_id: str
    attempts: int = 0

    def headers(self, request: httpx.Request | None = None) -> Mapping[str, str]:
        self.attempts += 1
        attempt_id = f"{self.call_id}.a{self.attempts}"
        if request is None:
            supplied = dict(
                self.runtime.request_headers(
                    model_name=self.model_name,
                    purpose=self.purpose,
                    call_id=self.call_id,
                    attempt_id=attempt_id,
                )
            )
        else:
            # requires_request_body makes HTTPX materialize this before auth
            # runs. A vertical runtime can bind its assertion to the actual
            # method/path/body without DeerFlow interpreting deployment data.
            signer = getattr(self.runtime, "request_headers_for_request", None)
            if callable(signer):
                supplied = dict(
                    signer(
                        model_name=self.model_name,
                        purpose=self.purpose,
                        call_id=self.call_id,
                        attempt_id=attempt_id,
                        request_method=request.method,
                        request_path=request.url.path,
                        request_body=request.content,
                    )
                )
            else:
                supplied = dict(
                    self.runtime.request_headers(
                        model_name=self.model_name,
                        purpose=self.purpose,
                        call_id=self.call_id,
                        attempt_id=attempt_id,
                    )
                )
        if not supplied.get("Authorization"):
            raise PermissionError("controlled model runtime did not supply a bearer assertion")
        # These values are derived from the runtime authority, not model input.
        supplied.setdefault("X-Capability-Call-Id", self.call_id)
        supplied.setdefault("X-Capability-Attempt-Id", attempt_id)
        supplied.setdefault("X-Capability-Purpose", self.purpose)
        for key, value in supplied.items():
            if not isinstance(key, str) or not isinstance(value, str) or "\r" in value or "\n" in value:
                raise PermissionError("controlled model runtime returned unsafe request headers")
        return supplied


class _ControlledGatewayAuth(httpx.Auth):
    """Mint a short assertion at each outbound HTTP attempt, including retries."""

    requires_request_body = True

    @staticmethod
    def _apply(request: httpx.Request) -> None:
        call = _current_call.get()
        if call is None:
            raise PermissionError("controlled gateway request escaped its model-call scope")
        for key, value in call.headers(request).items():
            request.headers[key] = value

    def auth_flow(self, request: httpx.Request) -> Iterator[httpx.Request]:
        self._apply(request)
        yield request

    async def async_auth_flow(self, request: httpx.Request) -> AsyncIterator[httpx.Request]:
        self._apply(request)
        yield request


class ControlledGatewayChatModel(ChatOpenAI):
    """OpenAI-compatible client that carries an opaque runtime-only authority."""

    controlled_runtime: Any = Field(exclude=True)
    controlled_purpose: str = Field(exclude=True)

    @contextmanager
    def _controlled_call_scope(self) -> Iterator[None]:
        runtime = self.controlled_runtime
        model_name = self.model_name
        if not runtime.allows_model(model_name):
            raise PermissionError(f"controlled runtime rejected model {model_name!r}")
        call = _ControlledCall(
            runtime=runtime,
            model_name=model_name,
            purpose=self.controlled_purpose,
            call_id=f"call-{uuid4().hex}",
        )
        token = _current_call.set(call)
        try:
            yield
        finally:
            _current_call.reset(token)

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        with self._controlled_call_scope():
            return super()._generate(messages, stop=stop, run_manager=run_manager, **kwargs)

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        with self._controlled_call_scope():
            return await super()._agenerate(messages, stop=stop, run_manager=run_manager, **kwargs)

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        *,
        stream_usage: bool | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        with self._controlled_call_scope():
            yield from super()._stream(messages, stop=stop, run_manager=run_manager, stream_usage=stream_usage, **kwargs)

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        *,
        stream_usage: bool | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        with self._controlled_call_scope():
            async for chunk in super()._astream(
                messages,
                stop=stop,
                run_manager=run_manager,
                stream_usage=stream_usage,
                **kwargs,
            ):
                yield chunk


def create_controlled_gateway_model(
    *,
    name: str,
    purpose: str,
    runtime: ControlledModelRuntime,
    model_settings: Mapping[str, Any],
    kwargs: Mapping[str, Any],
) -> ControlledGatewayChatModel:
    """Build a client with a harmless placeholder key and per-attempt auth.

    ``http_client`` fields are excluded by the LangChain/Pydantic model. The
    real assertion is generated in ``_ControlledGatewayAuth`` only once an
    outbound request exists, so credentials cannot enter a prompt or a
    checkpoint through this construction path.
    """

    base_url = runtime.gateway_base_url.rstrip("/")
    if not base_url.startswith(("https://", "http://")):
        raise ValueError("controlled model gateway base URL must be an http(s) origin")
    # Older structurally-compatible extensions do not have the additive
    # property.  They retain the legacy client path; a deployment-aware
    # extension supplies the typed transport below.
    transport = getattr(runtime, "gateway_transport", None)
    client_kwargs: dict[str, Any] = {"auth": _ControlledGatewayAuth()}
    if transport is not None:
        if not isinstance(transport, ControlledGatewayTransport):
            raise PermissionError("controlled gateway transport must use the public transport contract")
        if transport.require_https and not base_url.startswith("https://"):
            raise PermissionError("controlled gateway transport requires HTTPS")
        context = transport.ssl_context
        if context is None:
            raise PermissionError("controlled gateway transport requires a verified TLS context")
        # A deployment transport is meaningful only when the server chain is
        # checked.  The extension owns loading its client certificate/key into
        # this context; the harness never accepts PEM strings or paths here.
        if context.verify_mode != ssl.CERT_REQUIRED:
            raise PermissionError("controlled gateway transport must verify the server certificate")
        client_kwargs["verify"] = context
    safe_settings = dict(model_settings)
    # The factory has already selected the stable catalog target.  Do not let
    # the regular provider profile override it during construction.
    safe_settings.pop("model", None)
    safe_settings.pop("api_key", None)
    safe_settings.pop("openai_api_key", None)
    safe_settings.pop("base_url", None)
    safe_settings.pop("openai_api_base", None)
    safe_settings.pop("api_base", None)
    safe_kwargs = dict(kwargs)
    safe_kwargs.pop("model", None)
    safe_kwargs.pop("api_key", None)
    safe_kwargs.pop("openai_api_key", None)
    safe_kwargs.pop("base_url", None)
    safe_kwargs.pop("openai_api_base", None)
    safe_kwargs.pop("api_base", None)
    if not any(key in safe_settings or key in safe_kwargs for key in ("max_tokens", "max_completion_tokens")):
        # The capability Gateway reserves budget before dispatch and therefore
        # requires a bounded output size on every controlled request.
        safe_settings["max_tokens"] = _DEFAULT_CONTROLLED_MAX_TOKENS
    return ControlledGatewayChatModel(
        model=name,
        base_url=base_url,
        api_key="runtime-only",
        http_client=httpx.Client(**client_kwargs),
        http_async_client=httpx.AsyncClient(**client_kwargs),
        controlled_runtime=runtime,
        controlled_purpose=purpose,
        **safe_kwargs,
        **safe_settings,
    )
