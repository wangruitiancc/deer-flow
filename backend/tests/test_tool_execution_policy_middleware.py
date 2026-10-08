"""Tool side-effect and checkpoint-replay execution contract."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import AIMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest
from pydantic import ValidationError

from deerflow.config.app_config import AppConfig
from deerflow.config.tool_config import ToolConfig, ToolReplayPolicy, ToolSideEffect
from deerflow.runtime.context_keys import CURRENT_RUN_PRE_EXISTING_MESSAGE_IDS_KEY


def _request(
    *,
    name: str = "legal_write",
    args: dict | None = None,
    call_id: str = "call-1",
    message_id: str = "ai-1",
    pre_existing_ids: frozenset[str] = frozenset(),
    context: dict | None = None,
) -> ToolCallRequest:
    ai = AIMessage(
        id=message_id,
        content="",
        tool_calls=[{"name": name, "args": args or {}, "id": call_id}],
    )
    runtime_context = {
        "thread_id": "thread-1",
        "run_id": "run-1",
        CURRENT_RUN_PRE_EXISTING_MESSAGE_IDS_KEY: pre_existing_ids,
    }
    if context:
        runtime_context.update(context)
    runtime = SimpleNamespace(context=runtime_context)
    return ToolCallRequest(
        tool_call={"name": name, "args": args or {}, "id": call_id},
        tool=None,
        state={"messages": [ai]},
        runtime=runtime,
    )


def _config(tool: dict, *, name: str = "legal_write", group: str = "law") -> AppConfig:
    return AppConfig.model_validate(
        {
            "sandbox": {"use": "test"},
            "tools": [{"name": name, "group": group, "use": "pkg:tool", **tool}],
        }
    )


def _legal_task_context() -> dict:
    from deerflow_extension_api import EXTENSION_TASK_STORE_KEY, ExtensionData
    from matrix_law_extension.runtime.context import TrustedMatterContext

    store = ExtensionData("tool-policy-test")
    store.set(
        TrustedMatterContext(
            user_id="user-a",
            tenant_id="tenant-secret-a",
            membership_id="membership-a",
            tenant_role="member",
            matter_id="matter-secret-a",
            work_kind="contract_review",
            matter_member_id="matter-member-a",
            matter_role="owner",
            thread_id="thread-secret-a",
            mapping_id="mapping-secret-a",
            policy_version="phase-test",
            context_version=7,
        )
    )
    return {EXTENSION_TASK_STORE_KEY: store}


def test_tool_policy_defaults_fail_safe_for_legacy_or_dynamic_tools() -> None:
    config = ToolConfig(name="custom", group="custom", use="pkg:tool")

    assert config.side_effect is ToolSideEffect.EXTERNAL_WRITE
    assert config.replay_policy is ToolReplayPolicy.FORBID
    assert config.idempotency_key_arg is None


def test_keyed_replay_policy_requires_a_named_key_argument() -> None:
    with pytest.raises(ValidationError, match="idempotency_key_arg"):
        ToolConfig(
            name="custom",
            group="custom",
            use="pkg:tool",
            side_effect="external_write",
            replay_policy="keyed",
        )

    with pytest.raises(ValidationError, match="only valid"):
        ToolConfig(
            name="custom",
            group="custom",
            use="pkg:tool",
            side_effect="read_only",
            replay_policy="safe",
            idempotency_key_arg="request_id",
        )


def test_keyed_external_write_is_blocked_without_key_on_first_execution() -> None:
    from deerflow.agents.middlewares.tool_execution_policy_middleware import ToolExecutionPolicyMiddleware

    middleware = ToolExecutionPolicyMiddleware(
        app_config=_config(
            {
                "side_effect": "external_write",
                "replay_policy": "keyed",
                "idempotency_key_arg": "idempotency_key",
            }
        )
    )
    terminal = MagicMock(return_value=ToolMessage(content="committed", tool_call_id="call-1", name="legal_write"))

    result = middleware.wrap_tool_call(_request(args={"payload": "x"}), terminal)

    terminal.assert_not_called()
    assert result.status == "error"
    assert "idempotency_key" in str(result.content)
    assert result.additional_kwargs["deerflow_tool_execution_policy"]["action"] == "blocked_missing_idempotency_key"


def test_keyed_external_write_executes_and_stamps_only_key_fingerprint() -> None:
    from deerflow.agents.middlewares.tool_execution_policy_middleware import ToolExecutionPolicyMiddleware

    middleware = ToolExecutionPolicyMiddleware(
        app_config=_config(
            {
                "side_effect": "external_write",
                "replay_policy": "keyed",
                "idempotency_key_arg": "idempotency_key",
            }
        )
    )
    terminal = MagicMock(return_value=ToolMessage(content="committed", tool_call_id="call-1", name="legal_write"))

    result = middleware.wrap_tool_call(
        _request(args={"payload": "x", "idempotency_key": "tenant-1:operation-9"}),
        terminal,
    )

    terminal.assert_called_once()
    policy = result.additional_kwargs["deerflow_tool_execution_policy"]
    assert policy["action"] == "executed"
    assert policy["replay_detected"] is False
    assert len(policy["idempotency_key_sha256"]) == 16
    assert "tenant-1:operation-9" not in repr(policy)


@pytest.mark.parametrize(
    "invalid_key",
    [" leading-space", "trailing-space ", "x" * 201],
)
def test_keyed_external_write_rejects_noncanonical_or_oversized_key(invalid_key: str) -> None:
    from deerflow.agents.middlewares.tool_execution_policy_middleware import ToolExecutionPolicyMiddleware

    middleware = ToolExecutionPolicyMiddleware(
        app_config=_config(
            {
                "side_effect": "external_write",
                "replay_policy": "keyed",
                "idempotency_key_arg": "idempotency_key",
            }
        )
    )
    terminal = MagicMock(return_value=ToolMessage(content="committed", tool_call_id="call-1", name="legal_write"))

    result = middleware.wrap_tool_call(
        _request(args={"payload": "x", "idempotency_key": invalid_key}),
        terminal,
    )

    terminal.assert_not_called()
    assert result.status == "error"
    assert result.additional_kwargs["deerflow_tool_execution_policy"]["action"] == "blocked_missing_idempotency_key"


def test_forbidden_preexisting_tool_call_is_not_replayed() -> None:
    from deerflow.agents.middlewares.tool_execution_policy_middleware import ToolExecutionPolicyMiddleware

    middleware = ToolExecutionPolicyMiddleware(app_config=_config({"side_effect": "local_write", "replay_policy": "forbid"}))
    terminal = MagicMock(return_value=ToolMessage(content="wrote twice", tool_call_id="call-1", name="legal_write"))

    result = middleware.wrap_tool_call(
        _request(pre_existing_ids=frozenset({"ai-1"})),
        terminal,
    )

    terminal.assert_not_called()
    assert result.status == "error"
    assert "checkpoint replay" in str(result.content)
    assert result.additional_kwargs["deerflow_tool_execution_policy"]["action"] == "blocked_replay"


def test_forbidden_policy_allows_fresh_call_and_safe_policy_allows_replay() -> None:
    from deerflow.agents.middlewares.tool_execution_policy_middleware import ToolExecutionPolicyMiddleware

    terminal = MagicMock(side_effect=lambda request: ToolMessage(content="ok", tool_call_id=request.tool_call["id"], name=request.tool_call["name"]))
    forbidden = ToolExecutionPolicyMiddleware(app_config=_config({"side_effect": "local_write", "replay_policy": "forbid"}))
    safe = ToolExecutionPolicyMiddleware(app_config=_config({"side_effect": "read_only", "replay_policy": "safe"}))

    fresh = forbidden.wrap_tool_call(_request(), terminal)
    replayed_read = safe.wrap_tool_call(_request(pre_existing_ids=frozenset({"ai-1"})), terminal)

    assert fresh.status != "error"
    assert replayed_read.status != "error"
    assert replayed_read.additional_kwargs["deerflow_tool_execution_policy"]["replay_detected"] is True
    assert terminal.call_count == 2


def test_law_tool_requires_admitted_matter_context() -> None:
    from deerflow.agents.middlewares.tool_execution_policy_middleware import ToolExecutionPolicyMiddleware

    middleware = ToolExecutionPolicyMiddleware(
        app_config=_config(
            {"side_effect": "read_only", "replay_policy": "safe"},
            name="law_read_citation",
        )
    )
    terminal = MagicMock(return_value=ToolMessage(content="citation", tool_call_id="call-1", name="law_read_citation"))

    result = middleware.wrap_tool_call(_request(name="law_read_citation"), terminal)

    terminal.assert_not_called()
    assert result.status == "error"
    assert "requires an admitted Matrix Law matter context" in str(result.content)
    policy = result.additional_kwargs["deerflow_tool_execution_policy"]
    assert policy["action"] == "blocked_missing_legal_context"
    assert policy["legal_context"]["legal_tool"] is True


def test_law_tool_result_is_stamped_with_hashed_matter_context() -> None:
    from deerflow.agents.middlewares.tool_execution_policy_middleware import ToolExecutionPolicyMiddleware

    middleware = ToolExecutionPolicyMiddleware(
        app_config=_config(
            {"side_effect": "read_only", "replay_policy": "safe"},
            name="law_read_citation",
        )
    )
    terminal = MagicMock(return_value=ToolMessage(content="citation", tool_call_id="call-1", name="law_read_citation"))

    result = middleware.wrap_tool_call(
        _request(name="law_read_citation", context=_legal_task_context()),
        terminal,
    )

    terminal.assert_called_once()
    assert result.status != "error"
    policy = result.additional_kwargs["deerflow_tool_execution_policy"]
    legal_context = policy["legal_context"]
    assert legal_context["legal_tool"] is True
    assert legal_context["work_kind"] == "contract_review"
    assert legal_context["matter_role"] == "owner"
    assert legal_context["policy_version"] == "phase-test"
    assert legal_context["context_version"] == 7
    serialized = repr(legal_context)
    assert "tenant-secret-a" not in serialized
    assert "matter-secret-a" not in serialized
    assert "thread-secret-a" not in serialized
    assert len(legal_context["tenant_sha256"]) == 16
    assert len(legal_context["matter_sha256"]) == 16


@pytest.mark.asyncio
async def test_async_keyed_replay_uses_the_same_contract() -> None:
    from deerflow.agents.middlewares.tool_execution_policy_middleware import ToolExecutionPolicyMiddleware

    middleware = ToolExecutionPolicyMiddleware(
        app_config=_config(
            {
                "side_effect": "external_write",
                "replay_policy": "keyed",
                "idempotency_key_arg": "idempotency_key",
            }
        )
    )
    terminal = AsyncMock(return_value=ToolMessage(content="same result", tool_call_id="call-1", name="legal_write"))

    result = await middleware.awrap_tool_call(
        _request(
            args={"idempotency_key": "stable-key"},
            pre_existing_ids=frozenset({"ai-1"}),
        ),
        terminal,
    )

    terminal.assert_awaited_once()
    policy = result.additional_kwargs["deerflow_tool_execution_policy"]
    assert policy["replay_detected"] is True
    assert policy["action"] == "executed"


def test_runtime_chain_keeps_receipt_outside_replay_gate() -> None:
    from deerflow.agents.middlewares.tool_error_handling_middleware import _build_runtime_middlewares

    middlewares = _build_runtime_middlewares(
        app_config=_config({"side_effect": "local_write", "replay_policy": "forbid"}),
        include_uploads=False,
        include_dangling_tool_call_patch=False,
    )
    names = [type(middleware).__name__ for middleware in middlewares]

    assert names.index("ToolReceiptMiddleware") < names.index("ToolExecutionPolicyMiddleware")
    assert names.index("ToolExecutionPolicyMiddleware") < names.index("ToolErrorHandlingMiddleware")


def test_execution_policy_participates_in_release_fingerprint() -> None:
    from deerflow.agents.middlewares.tool_execution_policy_middleware import ToolExecutionPolicyMiddleware

    safe = ToolExecutionPolicyMiddleware(app_config=_config({"side_effect": "read_only", "replay_policy": "safe"})).release_policy_parameters()
    blocked = ToolExecutionPolicyMiddleware(app_config=_config({"side_effect": "local_write", "replay_policy": "forbid"})).release_policy_parameters()

    assert safe["configured_tool_count"] == 1
    assert safe["configured_policies_hash"] != blocked["configured_policies_hash"]
    assert safe["undeclared_default"] == {
        "side_effect": "external_write",
        "replay_policy": "forbid",
    }


def test_configured_policy_is_attached_to_resolved_tool() -> None:
    from deerflow.agents.middlewares.tool_execution_policy_middleware import TOOL_EXECUTION_POLICY_METADATA_KEY
    from deerflow.tools import get_available_tools

    config = AppConfig.model_validate(
        {
            "sandbox": {"use": "test"},
            "tools": [
                {
                    "name": "read_file",
                    "group": "file:read",
                    "use": "deerflow.sandbox.tools:read_file_tool",
                    "side_effect": "read_only",
                    "replay_policy": "safe",
                }
            ],
        }
    )

    tools = get_available_tools(
        groups=["file:read"],
        include_mcp=False,
        include_upload_tool=False,
        app_config=config,
    )
    read_file = next(tool for tool in tools if tool.name == "read_file")

    assert read_file.metadata[TOOL_EXECUTION_POLICY_METADATA_KEY] == {
        "side_effect": "read_only",
        "replay_policy": "safe",
        "idempotency_key_arg": None,
    }


def test_receipt_is_stamped_for_a_replay_block() -> None:
    from deerflow.agents.middlewares.tool_error_handling_middleware import _build_runtime_middlewares
    from deerflow.agents.middlewares.tool_receipt import TOOL_RECEIPT_KEY

    middlewares = _build_runtime_middlewares(
        app_config=_config({"side_effect": "local_write", "replay_policy": "forbid"}),
        include_uploads=False,
        include_dangling_tool_call_patch=False,
    )
    selected = [middleware for middleware in middlewares if type(middleware).__name__ in {"ToolReceiptMiddleware", "ToolExecutionPolicyMiddleware", "ToolErrorHandlingMiddleware"}]
    terminal = MagicMock(return_value=ToolMessage(content="duplicate", tool_call_id="call-1", name="legal_write"))
    handler = terminal
    for middleware in reversed(selected):
        next_handler = handler

        def handler(request, mw=middleware, inner=next_handler):
            return mw.wrap_tool_call(request, inner)

    result = handler(_request(pre_existing_ids=frozenset({"ai-1"})))

    terminal.assert_not_called()
    assert result.additional_kwargs[TOOL_RECEIPT_KEY]["status"] == "error"
    assert result.additional_kwargs["deerflow_tool_execution_policy"]["action"] == "blocked_replay"


def test_execution_policy_metadata_is_server_owned_at_gateway_boundary() -> None:
    from app.gateway.services import _SERVER_OWNED_MESSAGE_METADATA_KEYS
    from deerflow.agents.middlewares.tool_execution_policy_middleware import TOOL_EXECUTION_POLICY_KEY

    assert TOOL_EXECUTION_POLICY_KEY in _SERVER_OWNED_MESSAGE_METADATA_KEYS
