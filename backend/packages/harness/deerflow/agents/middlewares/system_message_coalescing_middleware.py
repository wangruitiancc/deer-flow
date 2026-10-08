"""Middleware to coalesce multiple SystemMessages into a single leading one.

Strict OpenAI-compatible backends (vLLM, SGLang, Qwen) and Anthropic reject
non-leading SystemMessages with errors like "System message must be at the
beginning" or "Received multiple non-consecutive system messages". The
official OpenAI API tolerates mid-conversation system messages, so the issue
only surfaces on strict backends.

DeerFlow's lead agent accumulates multiple SystemMessages because
DynamicContextMiddleware uses the ID-swap technique to replace the first or
last HumanMessage with a triplet whose first element is a SystemMessage
reminder (framework-owned date/metadata must not masquerade as user input,
per OWASP LLM01). On midnight crossings a second SystemMessage (date update)
is injected. create_agent holds the static system_prompt in the separate
``request.system_message`` field and only flattens it into the message list
inside the model-call handler (``[request.system_message, *messages]``).

This middleware runs in wrap_model_call — before the handler flattens the two
— and merges ``request.system_message`` plus every SystemMessage found in
``request.messages`` into a single leading SystemMessage emitted via the
``system_message`` field. It only touches the request payload; the persistent
conversation state (checkpoint) is unchanged, so middleware that scans history
by marker (e.g. is_dynamic_context_reminder) keeps working.

Note: Mirrors the per-request coalescing already done for Claude in
claude_provider._coalesce_system_messages but at a provider-agnostic layer so
every backend benefits from a single fix instead of per-provider patches.
"""

from collections.abc import Awaitable, Callable
from typing import override

from deerflow_extension_api import ContentKind, provenance_kwargs
from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelCallResult, ModelRequest, ModelResponse
from langchain_core.messages import SystemMessage

from deerflow.agents.middlewares.dynamic_context_middleware import is_dynamic_context_reminder

_STALE_DEERFLOW_IDENTITY_MARKERS = (
    "You are DeerFlow 2.0",
    "我是 DeerFlow 2.0",
    "open-source super agent",
    "open-source AI agent",
    "开源的 AI Agent",
    "AI Agent 框架",
)
_LEGAL_IDENTITY_MARKERS = (
    "法律工作台中的律师助手",
    "律师助手",
)


def _contains_any(content: str, markers: tuple[str, ...]) -> bool:
    lowered = content.casefold()
    return any(marker.casefold() in lowered for marker in markers)


def _system_message_content(message: SystemMessage | str) -> str:
    if isinstance(message, SystemMessage):
        return _flatten_content(message.content)
    return _flatten_content(message)


def _as_system_message(message: SystemMessage | str) -> SystemMessage:
    if isinstance(message, SystemMessage):
        return message
    return SystemMessage(content=message)


def _is_stale_deerflow_identity_message(message: SystemMessage) -> bool:
    """Detect old product-identity prompts persisted in checkpoints.

    Existing long-lived threads can carry a SystemMessage created before the
    Matrix Law legal identity replaced the upstream DeerFlow identity. Keeping
    that stale block in the coalesced prompt makes the model reintroduce
    "DeerFlow 2.0" even when the current static prompt is legal-specific.
    """
    return _contains_any(_system_message_content(message), _STALE_DEERFLOW_IDENTITY_MARKERS)


def _has_legal_identity(message: SystemMessage | str | None) -> bool:
    if message is None:
        return False
    return _contains_any(_system_message_content(message), _LEGAL_IDENTITY_MARKERS)


def _flatten_content(content) -> str:
    """Convert message content to a plain string, handling both str and list types.

    langchain messages support list-type content for multimodal (e.g.
    ``[{"type": "text", "text": "..."}]``). SystemMessages in DeerFlow are always
    plain strings, but this helper ensures robustness for any content shape.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and "text" in item:
                parts.append(item["text"])
            else:
                parts.append(str(item))
        return "\n".join(parts)
    return str(content)


def _coalesce_request(request: ModelRequest) -> ModelRequest | None:
    """Merge ``request.system_message`` and in-``messages`` SystemMessages into one.

    On langchain >= 1.2.15 the static system prompt lives in the separate
    ``request.system_message`` field, not in ``request.messages``. The model-call
    handler flattens them at the very last moment (``[system_message, *messages]``),
    so a middleware that only scans ``messages`` cannot see the prompt and ends up
    a no-op. This helper inspects both sources, merges every SystemMessage into a
    single entry, and emits the result via ``system_message`` so the handler still
    prepends it correctly.

    Returns None when no SystemMessages live inside ``messages`` — in that case
    ``system_message`` (if set) is already the sole leading system block and the
    request can pass through with zero mutation, preserving prefix-cache hits.
    """
    in_msg_systems = [m for m in request.messages if isinstance(m, SystemMessage)]
    if not in_msg_systems:
        return None

    # Merge system_message (if any) + all in-messages SystemMessages. When the
    # current static prompt is the Matrix Law legal identity, drop stale
    # DeerFlow identity prompts that may have been checkpointed by older runs.
    parts: list[SystemMessage] = []
    if request.system_message is not None:
        parts.append(_as_system_message(request.system_message))
    drop_stale_deerflow_identity = _has_legal_identity(request.system_message)
    parts.extend(
        p
        for p in in_msg_systems
        if not (drop_stale_deerflow_identity and _is_stale_deerflow_identity_message(p))
    )
    if not parts:
        return request.override(system_message=None, messages=[m for m in request.messages if not isinstance(m, SystemMessage)])

    # Deduplicate dynamic_context_reminder SystemMessages: only keep the last
    # one (most recent date), drop earlier reminders. On midnight crossings
    # the merged content would otherwise contain two adjacent contradictory
    # <current_date> blocks with no temporal anchor — the intervening turns
    # that originally separated them are gone after coalescing. The model
    # should see only the latest date, not a stale one it must guess to
    # ignore.
    reminder_indices = [i for i, p in enumerate(parts) if is_dynamic_context_reminder(p)]
    if len(reminder_indices) > 1:
        keep_last = reminder_indices[-1]
        parts = [p for i, p in enumerate(parts) if i not in reminder_indices[:-1] or i == keep_last]

    # Preserve the id of the first SystemMessage (typically the static
    # system_prompt) so downstream consumers that key off the leading system
    # message id are unaffected. Merge additional_kwargs from all parts so
    # markers like hide_from_ui / dynamic_context_reminder from reminders are
    # retained on the coalesced block.
    first = parts[0]
    merged_kwargs: dict = {}
    for p in parts:
        merged_kwargs.update(p.additional_kwargs or {})
    merged_kwargs.update(provenance_kwargs(ContentKind.MIDDLEWARE_INJECTION, "system_coalescing"))
    merged = SystemMessage(
        content="\n\n".join(_flatten_content(p.content) for p in parts),
        id=first.id,
        additional_kwargs=merged_kwargs,
    )

    non_system = [m for m in request.messages if not isinstance(m, SystemMessage)]
    return request.override(system_message=merged, messages=non_system)


class SystemMessageCoalescingMiddleware(AgentMiddleware[AgentState]):
    """Merge all SystemMessages into a single leading SystemMessage.

    Uses wrap_model_call (not before_agent) so the merge runs on the final
    request payload — where ``system_message`` and ``messages`` are still
    separate fields — and never touches the persisted state["messages"]. This
    keeps the checkpoint structure intact for every consumer that scans history
    (memory builder, journal, summarization, dynamic-context detection).
    """

    def release_policy_parameters(self) -> dict[str, object]:
        # No constructor parameters: the merge strategy and reminder-dedup rule
        # below are the middleware's entire behaviour, so they are the policy.
        return {
            "strategy": "merge_leading_system_message",
            "dynamic_context_reminder_dedup": "keep_last",
        }

    @staticmethod
    def _maybe_coalesce(request: ModelRequest) -> ModelRequest:
        coalesced = _coalesce_request(request)
        if coalesced is None:
            return request
        return coalesced

    @override
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelCallResult:
        return handler(self._maybe_coalesce(request))

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelCallResult:
        return await handler(self._maybe_coalesce(request))
