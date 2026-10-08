"""Fail-closed side-effect policy for checkpoint-replayed tool calls.

The run worker records which message IDs existed before the current run. A
tool call is a replay only when its originating AI message belongs to that
set. This distinguishes an actual checkpoint replay from an ordinary second
call that merely has similar arguments.

This middleware cannot manufacture exactly-once semantics after an external
system committed but crashed before returning. A ``keyed`` tool must therefore
accept and honor the named stable idempotency key itself; the middleware only
enforces that the key is present and records a non-secret fingerprint.
"""

from __future__ import annotations

import hashlib
from collections.abc import Awaitable, Callable, Mapping, Sequence
from typing import Any, Final, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command

from deerflow.agents.middlewares.tool_result_meta import normalize_tool_result
from deerflow.config.app_config import AppConfig
from deerflow.config.tool_config import ToolConfig, ToolReplayPolicy, ToolSideEffect
from deerflow.runtime.context_keys import CURRENT_RUN_PRE_EXISTING_MESSAGE_IDS_KEY

TOOL_EXECUTION_POLICY_KEY: Final[str] = "deerflow_tool_execution_policy"
TOOL_EXECUTION_POLICY_METADATA_KEY: Final[str] = "deerflow_execution_policy"
_SHORT_HASH_LEN = 16
_MAX_IDEMPOTENCY_KEY_LENGTH = 200
_LEGAL_TOOL_PREFIX = "law_"
_LEGAL_CONTEXT_HASH_DOMAIN = b"matrix-law-tool-context-v1\0"


def tool_execution_policy_payload(config: ToolConfig) -> dict[str, str | None]:
    """Return the stable policy payload attached to a configured tool."""
    side_effect = getattr(config, "side_effect", None)
    if not isinstance(side_effect, ToolSideEffect):
        side_effect = ToolSideEffect.EXTERNAL_WRITE
    replay_policy = getattr(config, "replay_policy", None)
    if not isinstance(replay_policy, ToolReplayPolicy):
        replay_policy = ToolReplayPolicy.FORBID
    key_arg = getattr(config, "idempotency_key_arg", None)
    if not isinstance(key_arg, str) or not key_arg:
        key_arg = None
    return {
        "side_effect": side_effect.value,
        "replay_policy": replay_policy.value,
        "idempotency_key_arg": key_arg,
    }


def attach_tool_execution_policy(tool: Any, config: ToolConfig) -> None:
    """Attach config policy to the resolved tool, surviving name mismatch."""
    metadata = dict(getattr(tool, "metadata", None) or {})
    metadata[TOOL_EXECUTION_POLICY_METADATA_KEY] = tool_execution_policy_payload(config)
    tool.metadata = metadata


def _policy_from_payload(payload: object) -> tuple[ToolSideEffect, ToolReplayPolicy, str | None] | None:
    if not isinstance(payload, Mapping):
        return None
    try:
        side_effect = ToolSideEffect(payload.get("side_effect"))
        replay_policy = ToolReplayPolicy(payload.get("replay_policy"))
    except (TypeError, ValueError):
        return None
    key_arg = payload.get("idempotency_key_arg")
    if key_arg is not None and not isinstance(key_arg, str):
        return None
    return side_effect, replay_policy, key_arg


class ToolExecutionPolicyMiddleware(AgentMiddleware[AgentState]):
    """Enforce keyed writes and stop unsafe checkpoint re-execution."""

    state_schema = AgentState

    def __init__(self, *, app_config: AppConfig) -> None:
        super().__init__()
        self._app_config = app_config

    def release_policy_parameters(self) -> dict[str, object]:
        """Expose the effective configured policy without leaking tool inputs."""
        from deerflow_extension_api import canonical_hash

        declared = [{"name": config.name, **tool_execution_policy_payload(config)} for config in sorted(self._app_config.tools, key=lambda item: item.name)]
        return {
            "undeclared_default": {
                "side_effect": ToolSideEffect.EXTERNAL_WRITE.value,
                "replay_policy": ToolReplayPolicy.FORBID.value,
            },
            "max_idempotency_key_length": _MAX_IDEMPOTENCY_KEY_LENGTH,
            "configured_tool_count": len(declared),
            "configured_policies_hash": canonical_hash(declared),
        }

    def _resolve_policy(self, request: ToolCallRequest) -> tuple[ToolSideEffect, ToolReplayPolicy, str | None]:
        tool = getattr(request, "tool", None)
        metadata = getattr(tool, "metadata", None)
        if isinstance(metadata, Mapping):
            resolved = _policy_from_payload(metadata.get(TOOL_EXECUTION_POLICY_METADATA_KEY))
            if resolved is not None:
                return resolved

        name = str(request.tool_call.get("name") or "")
        config = self._app_config.get_tool_config(name)
        if config is not None:
            return config.side_effect, config.replay_policy, config.idempotency_key_arg

        # Built-ins, MCP tools, and a config/tool-name mismatch are conservative:
        # normal execution remains compatible, but no old checkpoint may invoke
        # them again until the operator declares a policy.
        return ToolSideEffect.EXTERNAL_WRITE, ToolReplayPolicy.FORBID, None

    @staticmethod
    def _context(request: ToolCallRequest) -> Mapping[str, Any]:
        runtime = getattr(request, "runtime", None)
        context = getattr(runtime, "context", None)
        return context if isinstance(context, Mapping) else {}

    @staticmethod
    def _messages(request: ToolCallRequest) -> Sequence[Any]:
        state = getattr(request, "state", None)
        if not isinstance(state, Mapping):
            return ()
        messages = state.get("messages")
        return messages if isinstance(messages, Sequence) and not isinstance(messages, str | bytes) else ()

    @staticmethod
    def _legal_context(request: ToolCallRequest) -> object | None:
        try:
            from deerflow_extension_api import task_store_from_runtime
            from matrix_law_extension.runtime.context import TrustedMatterContext
        except ImportError:
            return None

        store = task_store_from_runtime(getattr(request, "runtime", None))
        return store.get(TrustedMatterContext) if store is not None else None

    @staticmethod
    def _hash_context_value(value: object) -> str:
        raw = str(value).encode("utf-8")
        return hashlib.sha256(_LEGAL_CONTEXT_HASH_DOMAIN + raw).hexdigest()[:_SHORT_HASH_LEN]

    def _legal_context_payload(self, request: ToolCallRequest) -> tuple[dict[str, Any] | None, ToolMessage | None]:
        tool_name = str(request.tool_call.get("name") or "")
        if not tool_name.startswith(_LEGAL_TOOL_PREFIX):
            return None, None

        context = self._legal_context(request)
        tool_call_id = str(request.tool_call.get("id") or "missing-tool-call-id")
        if context is None:
            payload = {
                "legal_tool": True,
                "action": "blocked_missing_legal_context",
            }
            message = ToolMessage(
                content=(
                    f"Error: Legal tool '{tool_name}' requires an admitted Matrix Law matter context. "
                    "Bind the conversation to a legal matter before using legal evidence, citation, graph, authority, or drafting tools."
                ),
                tool_call_id=tool_call_id,
                name=tool_name or "unknown_tool",
                status="error",
            )
            return payload, normalize_tool_result(self._stamp(message, request, payload))

        return {
            "legal_tool": True,
            "tenant_sha256": self._hash_context_value(getattr(context, "tenant_id", "")),
            "matter_sha256": self._hash_context_value(getattr(context, "matter_id", "")),
            "thread_sha256": self._hash_context_value(getattr(context, "thread_id", "")),
            "mapping_sha256": self._hash_context_value(getattr(context, "mapping_id", "")),
            "work_kind": str(getattr(context, "work_kind", "")),
            "matter_role": str(getattr(context, "matter_role", "")),
            "policy_version": str(getattr(context, "policy_version", "")),
            "context_version": getattr(context, "context_version", None),
        }, None

    def _is_checkpoint_replay(self, request: ToolCallRequest) -> bool:
        raw_pre_existing = self._context(request).get(CURRENT_RUN_PRE_EXISTING_MESSAGE_IDS_KEY)
        if not isinstance(raw_pre_existing, (set, frozenset, list, tuple)):
            return False
        pre_existing = {str(value) for value in raw_pre_existing if value is not None}
        if not pre_existing:
            return False

        call_id = str(request.tool_call.get("id") or "")
        if not call_id:
            return False
        for message in reversed(self._messages(request)):
            if not isinstance(message, AIMessage):
                continue
            if not any(str(call.get("id") or "") == call_id for call in message.tool_calls):
                continue
            message_id = getattr(message, "id", None)
            return message_id is not None and str(message_id) in pre_existing
        return False

    @staticmethod
    def _key_fingerprint(args: object, key_arg: str | None) -> str | None:
        if key_arg is None or not isinstance(args, Mapping):
            return None
        raw = args.get(key_arg)
        if not isinstance(raw, str):
            return None
        if not raw or raw != raw.strip() or len(raw) > _MAX_IDEMPOTENCY_KEY_LENGTH:
            return None
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:_SHORT_HASH_LEN]

    @staticmethod
    def _stamp(
        result: ToolMessage | Command,
        request: ToolCallRequest,
        payload: dict[str, Any],
    ) -> ToolMessage | Command:
        def stamp_message(message: ToolMessage) -> None:
            kwargs = dict(message.additional_kwargs or {})
            kwargs[TOOL_EXECUTION_POLICY_KEY] = dict(payload)
            message.additional_kwargs = kwargs

        if isinstance(result, ToolMessage):
            stamp_message(result)
            return result
        update = result.update
        if not isinstance(update, dict):
            return result
        messages = update.get("messages", [])
        if isinstance(messages, ToolMessage):
            messages = [messages]
        call_id = str(request.tool_call.get("id") or "")
        if isinstance(messages, (list, tuple)):
            for message in messages:
                if isinstance(message, ToolMessage) and str(message.tool_call_id) == call_id:
                    stamp_message(message)
        return result

    def _decision(self, request: ToolCallRequest) -> tuple[dict[str, Any], ToolMessage | None]:
        side_effect, replay_policy, key_arg = self._resolve_policy(request)
        replay_detected = self._is_checkpoint_replay(request)
        key_fingerprint = self._key_fingerprint(request.tool_call.get("args"), key_arg)
        legal_payload, legal_blocked = self._legal_context_payload(request)
        base: dict[str, Any] = {
            "side_effect": side_effect.value,
            "replay_policy": replay_policy.value,
            "replay_detected": replay_detected,
        }
        if legal_payload is not None:
            base["legal_context"] = legal_payload
        if key_arg is not None:
            base["idempotency_key_arg"] = key_arg
        if key_fingerprint is not None:
            base["idempotency_key_sha256"] = key_fingerprint

        tool_name = str(request.tool_call.get("name") or "unknown_tool")
        tool_call_id = str(request.tool_call.get("id") or "missing-tool-call-id")
        if legal_blocked is not None:
            payload = {**base, "action": "blocked_missing_legal_context"}
            return payload, normalize_tool_result(self._stamp(legal_blocked, request, payload))
        if replay_policy is ToolReplayPolicy.KEYED and key_fingerprint is None:
            payload = {**base, "action": "blocked_missing_idempotency_key"}
            message = ToolMessage(
                content=(f"Error: Tool '{tool_name}' requires a non-empty '{key_arg}' argument (maximum {_MAX_IDEMPOTENCY_KEY_LENGTH} characters) on every call so an external retry cannot duplicate its side effect."),
                tool_call_id=tool_call_id,
                name=tool_name,
                status="error",
            )
            return payload, normalize_tool_result(self._stamp(message, request, payload))
        if replay_detected and replay_policy is ToolReplayPolicy.FORBID:
            payload = {**base, "action": "blocked_replay"}
            message = ToolMessage(
                content=(f"Error: Tool '{tool_name}' was not executed because this is a checkpoint replay and its policy forbids automatic re-execution. Re-plan from current state or use a tool with an explicit idempotency contract."),
                tool_call_id=tool_call_id,
                name=tool_name,
                status="error",
            )
            return payload, normalize_tool_result(self._stamp(message, request, payload))
        return {**base, "action": "executed"}, None

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        payload, blocked = self._decision(request)
        if blocked is not None:
            return blocked
        return self._stamp(handler(request), request, payload)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command]],
    ) -> ToolMessage | Command:
        payload, blocked = self._decision(request)
        if blocked is not None:
            return blocked
        return self._stamp(await handler(request), request, payload)
