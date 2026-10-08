"""Exercise a keyed Agent write across a provider commit/response failure."""

from __future__ import annotations

import argparse
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.client import RemoteDisconnected
from types import SimpleNamespace
from typing import Any
from urllib.error import URLError
from urllib.parse import quote

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.prebuilt.tool_node import ToolCallRequest

from deerflow.agents.middlewares.tool_error_handling_middleware import (
    ToolErrorHandlingMiddleware,
)
from deerflow.agents.middlewares.tool_execution_policy_middleware import (
    TOOL_EXECUTION_POLICY_KEY,
    ToolExecutionPolicyMiddleware,
)
from deerflow.agents.middlewares.tool_receipt import TOOL_RECEIPT_KEY
from deerflow.agents.middlewares.tool_receipt_middleware import ToolReceiptMiddleware
from deerflow.config.app_config import AppConfig
from deerflow.runtime.context_keys import CURRENT_RUN_PRE_EXISTING_MESSAGE_IDS_KEY


def app_config() -> AppConfig:
    return AppConfig.model_validate(
        {
            "sandbox": {"use": "test"},
            "tools": [
                {
                    "name": "submit_legal_delivery",
                    "group": "law:delivery",
                    "use": "synthetic:submit_legal_delivery",
                    "side_effect": "external_write",
                    "replay_policy": "keyed",
                    "idempotency_key_arg": "idempotency_key",
                }
            ],
        }
    )


def tool_request(
    *,
    key: str,
    replay: bool,
    fault: bool,
    document_reference: str = "synthetic-document-10g",
) -> ToolCallRequest:
    args = {
        "idempotency_key": key,
        "matter_reference": "synthetic-matter-10g",
        "document_reference": document_reference,
        "fault_after_commit": fault,
    }
    message = AIMessage(
        id="ai-delivery-call",
        content="",
        tool_calls=[{"name": "submit_legal_delivery", "args": args, "id": "call-delivery-1"}],
    )
    return ToolCallRequest(
        tool_call={
            "name": "submit_legal_delivery",
            "args": args,
            "id": "call-delivery-1",
        },
        tool=None,
        state={"messages": [message]},
        runtime=SimpleNamespace(
            context={
                "thread_id": "synthetic-thread-10g",
                "run_id": "synthetic-run-10g",
                CURRENT_RUN_PRE_EXISTING_MESSAGE_IDS_KEY: (frozenset({"ai-delivery-call"}) if replay else frozenset()),
            }
        ),
    )


def post_delivery(provider: str, args: dict[str, Any]) -> ToolMessage:
    body = json.dumps(
        {
            "matter_reference": args["matter_reference"],
            "document_reference": args["document_reference"],
        },
        sort_keys=True,
    ).encode()
    headers = {
        "Content-Type": "application/json",
        "Idempotency-Key": str(args["idempotency_key"]),
    }
    if args["fault_after_commit"]:
        headers["X-Fault-After-Commit"] = "1"
    request = urllib.request.Request(
        f"{provider}/deliveries",
        data=body,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        result = json.loads(response.read())
    return ToolMessage(
        content=json.dumps(result, sort_keys=True),
        tool_call_id="call-delivery-1",
        name="submit_legal_delivery",
    )


def provider_state(provider: str, key: str) -> dict[str, Any]:
    with urllib.request.urlopen(f"{provider}/state/{quote(key, safe='')}", timeout=5) as response:
        return json.loads(response.read())


def invoke(
    provider: str,
    *,
    key: str,
    replay: bool,
    fault: bool,
    document_reference: str = "synthetic-document-10g",
) -> ToolMessage:
    config = app_config()
    layers = [
        ToolReceiptMiddleware(),
        ToolExecutionPolicyMiddleware(app_config=config),
        ToolErrorHandlingMiddleware(app_config=config),
    ]

    def terminal(request: ToolCallRequest) -> ToolMessage:
        return post_delivery(provider, request.tool_call["args"])

    handler = terminal
    for layer in reversed(layers):
        inner = handler

        def handler(request: ToolCallRequest, middleware=layer, next_handler=inner):
            return middleware.wrap_tool_call(request, next_handler)

    result = handler(
        tool_request(
            key=key,
            replay=replay,
            fault=fault,
            document_reference=document_reference,
        )
    )
    assert isinstance(result, ToolMessage)
    return result


def exercise(provider: str, key: str) -> None:
    initial = provider_state(provider, key)
    assert initial["delivery_commit_count"] == 0, initial

    lost = invoke(provider, key=key, replay=False, fault=True)
    assert lost.status == "error", lost
    assert "RemoteDisconnected" in str(lost.content), lost
    assert lost.additional_kwargs[TOOL_EXECUTION_POLICY_KEY]["action"] == "executed"
    assert lost.additional_kwargs[TOOL_RECEIPT_KEY]["status"] == "error"

    after_loss = provider_state(provider, key)
    assert after_loss["delivery_commit_count"] == 1, after_loss
    assert after_loss["request_attempt_count"] == 1, after_loss
    assert after_loss["response_dropped"] is True, after_loss

    recovered = invoke(provider, key=key, replay=True, fault=False)
    assert recovered.status != "error", recovered
    assert recovered.additional_kwargs[TOOL_EXECUTION_POLICY_KEY]["replay_detected"] is True
    assert recovered.additional_kwargs[TOOL_RECEIPT_KEY]["status"] == "success"

    final = provider_state(provider, key)
    assert final["delivery_commit_count"] == 1, final
    assert final["request_attempt_count"] == 2, final
    assert json.loads(recovered.content) == final["response"], (recovered, final)
    assert key not in repr(recovered.additional_kwargs)

    conflict = invoke(
        provider,
        key=key,
        replay=True,
        fault=False,
        document_reference="different-synthetic-document",
    )
    assert conflict.status == "error", conflict
    assert "HTTP Error 409" in str(conflict.content), conflict
    assert conflict.additional_kwargs[TOOL_RECEIPT_KEY]["status"] == "error"
    final = provider_state(provider, key)
    assert final["delivery_commit_count"] == 1, final
    assert final["request_attempt_count"] == 3, final
    print(
        json.dumps(
            {
                "mode": "exercise",
                "first_result": "connection_lost_after_provider_commit",
                "first_receipt_status": "error",
                "replay_result": "cached_provider_response",
                "replay_receipt_status": "success",
                "same_key_different_payload": "rejected_409",
                **final,
                "raw_key_in_receipts": False,
            },
            indent=2,
        )
    )


def confirm_after_restart(provider: str, key: str) -> None:
    before = provider_state(provider, key)
    assert before["delivery_commit_count"] == 1, before
    assert before["request_attempt_count"] == 3, before
    confirmed = invoke(provider, key=key, replay=True, fault=False)
    assert confirmed.status != "error", confirmed
    after = provider_state(provider, key)
    assert after["delivery_commit_count"] == 1, after
    assert after["request_attempt_count"] == 4, after
    assert json.loads(confirmed.content) == before["response"] == after["response"]
    print(
        json.dumps(
            {
                "mode": "confirm_after_provider_restart",
                **after,
                "stable_response": True,
            },
            indent=2,
        )
    )


def concurrent_retries(provider: str, key: str) -> None:
    initial = provider_state(provider, key)
    assert initial["delivery_commit_count"] == 0, initial
    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(
            executor.map(
                lambda _: invoke(provider, key=key, replay=False, fault=False),
                range(8),
            )
        )
    assert all(result.status != "error" for result in results), results
    responses = {result.content for result in results}
    assert len(responses) == 1, responses
    state = provider_state(provider, key)
    assert state["delivery_commit_count"] == 1, state
    assert state["request_attempt_count"] == 8, state
    print(
        json.dumps(
            {
                "mode": "concurrent_same_key",
                "parallel_requests": 8,
                "distinct_responses": len(responses),
                **state,
            },
            indent=2,
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("exercise", "confirm", "concurrent"))
    parser.add_argument("--provider", default="http://provider:8080")
    parser.add_argument("--key", default="phase10g-delivery-20260905-1")
    args = parser.parse_args()
    if args.mode == "exercise":
        exercise(args.provider, args.key)
    elif args.mode == "confirm":
        confirm_after_restart(args.provider, args.key)
    else:
        concurrent_retries(args.provider, args.key)


if __name__ == "__main__":
    try:
        main()
    except (RemoteDisconnected, URLError) as exc:
        raise SystemExit(f"unexpected provider connection failure: {exc}") from exc
