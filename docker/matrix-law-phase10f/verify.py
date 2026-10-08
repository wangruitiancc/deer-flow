"""Verify tool side-effect and checkpoint-replay policy in the runtime image."""

from __future__ import annotations

import json
from types import SimpleNamespace

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest

from app.gateway.services import _SERVER_OWNED_MESSAGE_METADATA_KEYS
from deerflow.agents.middlewares.tool_execution_policy_middleware import (
    TOOL_EXECUTION_POLICY_KEY,
    ToolExecutionPolicyMiddleware,
)
from deerflow.config.app_config import AppConfig
from deerflow.runtime.context_keys import CURRENT_RUN_PRE_EXISTING_MESSAGE_IDS_KEY


def config(*, side_effect: str, replay_policy: str, key_arg: str | None = None) -> AppConfig:
    tool: dict[str, object] = {
        "name": "legal_write",
        "group": "law",
        "use": "pkg:tool",
        "side_effect": side_effect,
        "replay_policy": replay_policy,
    }
    if key_arg is not None:
        tool["idempotency_key_arg"] = key_arg
    return AppConfig.model_validate({"sandbox": {"use": "test"}, "tools": [tool]})


def request(*, args: dict[str, object], replay: bool) -> ToolCallRequest:
    message = AIMessage(
        id="ai-before-run",
        content="",
        tool_calls=[{"name": "legal_write", "args": args, "id": "call-1"}],
    )
    runtime = SimpleNamespace(
        context={
            "thread_id": "thread-1",
            "run_id": "run-1",
            CURRENT_RUN_PRE_EXISTING_MESSAGE_IDS_KEY: (frozenset({"ai-before-run"}) if replay else frozenset()),
        }
    )
    return ToolCallRequest(
        tool_call={"name": "legal_write", "args": args, "id": "call-1"},
        tool=None,
        state={"messages": [message]},
        runtime=runtime,
    )


def execute(middleware: ToolExecutionPolicyMiddleware, call: ToolCallRequest) -> tuple[ToolMessage, int]:
    count = 0

    def handler(tool_request: ToolCallRequest) -> ToolMessage:
        nonlocal count
        count += 1
        return ToolMessage(
            content="provider result",
            tool_call_id=tool_request.tool_call["id"],
            name=tool_request.tool_call["name"],
        )

    result = middleware.wrap_tool_call(call, handler)
    assert isinstance(result, ToolMessage)
    return result, count


def main() -> None:
    forbidden = ToolExecutionPolicyMiddleware(app_config=config(side_effect="external_write", replay_policy="forbid"))
    fresh, fresh_calls = execute(forbidden, request(args={"value": "x"}, replay=False))
    blocked, blocked_calls = execute(forbidden, request(args={"value": "x"}, replay=True))
    assert fresh_calls == 1
    assert fresh.additional_kwargs[TOOL_EXECUTION_POLICY_KEY]["action"] == "executed"
    assert blocked_calls == 0 and blocked.status == "error"
    assert blocked.additional_kwargs[TOOL_EXECUTION_POLICY_KEY]["action"] == "blocked_replay"

    safe = ToolExecutionPolicyMiddleware(app_config=config(side_effect="read_only", replay_policy="safe"))
    safe_result, safe_calls = execute(safe, request(args={"query": "law"}, replay=True))
    assert safe_calls == 1
    assert safe_result.additional_kwargs[TOOL_EXECUTION_POLICY_KEY]["replay_detected"] is True

    keyed = ToolExecutionPolicyMiddleware(
        app_config=config(
            side_effect="external_write",
            replay_policy="keyed",
            key_arg="idempotency_key",
        )
    )
    missing, missing_calls = execute(keyed, request(args={"value": "x"}, replay=False))
    assert missing_calls == 0 and missing.status == "error"

    raw_key = "tenant-1:operation-1"
    keyed_result, keyed_calls = execute(
        keyed,
        request(args={"value": "x", "idempotency_key": raw_key}, replay=True),
    )
    keyed_policy = keyed_result.additional_kwargs[TOOL_EXECUTION_POLICY_KEY]
    assert keyed_calls == 1
    assert keyed_policy["action"] == "executed"
    assert keyed_policy["replay_detected"] is True
    assert len(keyed_policy["idempotency_key_sha256"]) == 16
    assert raw_key not in repr(keyed_policy)

    release = keyed.release_policy_parameters()
    assert release["configured_tool_count"] == 1
    assert len(str(release["configured_policies_hash"])) == 64
    assert TOOL_EXECUTION_POLICY_KEY in _SERVER_OWNED_MESSAGE_METADATA_KEYS

    print(
        json.dumps(
            {
                "fresh_forbid_handler_calls": fresh_calls,
                "checkpoint_forbid_handler_calls": blocked_calls,
                "checkpoint_forbid_action": blocked.additional_kwargs[TOOL_EXECUTION_POLICY_KEY]["action"],
                "safe_replay_handler_calls": safe_calls,
                "keyed_missing_handler_calls": missing_calls,
                "keyed_replay_handler_calls": keyed_calls,
                "raw_key_in_receipt": raw_key in repr(keyed_policy),
                "release_policy_hash_length": len(str(release["configured_policies_hash"])),
                "gateway_policy_metadata_server_owned": True,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
