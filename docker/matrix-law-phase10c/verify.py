"""Black-box Phase 10C multi-Gateway Agent failover verification."""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import secrets
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Iterator
from typing import Any


class ApiClient:
    def __init__(self) -> None:
        self.cookies = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookies)
        )

    def csrf_token(self) -> str | None:
        return next(
            (cookie.value for cookie in self.cookies if cookie.name == "csrf_token"),
            None,
        )

    def request(
        self,
        method: str,
        base_url: str,
        path: str,
        payload: dict[str, Any] | None = None,
        *,
        headers: dict[str, str] | None = None,
        timeout: float = 30,
    ) -> tuple[int, dict[str, Any], dict[str, str]]:
        body = None if payload is None else json.dumps(payload).encode()
        request_headers = {"Accept": "application/json", **(headers or {})}
        if body is not None:
            request_headers["Content-Type"] = "application/json"
        if method not in {"GET", "HEAD", "OPTIONS"} and (csrf := self.csrf_token()):
            request_headers["X-CSRF-Token"] = csrf
        request = urllib.request.Request(
            f"{base_url}{path}",
            data=body,
            headers=request_headers,
            method=method,
        )
        try:
            with self.opener.open(request, timeout=timeout) as response:
                raw = response.read()
                decoded = json.loads(raw) if raw else {}
                return response.status, decoded, dict(response.headers.items())
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            decoded = json.loads(raw) if raw else {}
            raise AssertionError(
                f"{method} {path} returned {exc.code}: {decoded}"
            ) from exc

    def sse(
        self,
        base_url: str,
        path: str,
        *,
        last_event_id: str | None = None,
        timeout: float = 45,
    ) -> Iterator[dict[str, Any]]:
        headers = {"Accept": "text/event-stream"}
        if last_event_id is not None:
            headers["Last-Event-ID"] = last_event_id
        request = urllib.request.Request(
            f"{base_url}{path}", headers=headers, method="GET"
        )
        with self.opener.open(request, timeout=timeout) as response:
            assert response.status == 200, response.status
            frame: dict[str, Any] = {}
            while True:
                raw = response.readline()
                if not raw:
                    return
                line = raw.decode().rstrip("\r\n")
                if not line:
                    if frame:
                        if "data" in frame:
                            frame["data"] = json.loads(frame["data"])
                        yield frame
                        frame = {}
                    continue
                if line.startswith(":"):
                    continue
                key, separator, value = line.partition(":")
                if separator:
                    frame[key] = value.lstrip()


def require_status(actual: int, expected: int, operation: str) -> None:
    if actual != expected:
        raise AssertionError(f"{operation}: expected HTTP {expected}, got {actual}")


def wait_for_run(
    client: ApiClient,
    base_url: str,
    thread_id: str,
    run_id: str,
    expected_status: str,
    *,
    timeout: float = 30,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    latest: dict[str, Any] = {}
    while time.monotonic() < deadline:
        status, latest, _ = client.request(
            "GET", base_url, f"/api/threads/{thread_id}/runs/{run_id}"
        )
        require_status(status, 200, "read run")
        if latest.get("status") == expected_status:
            return latest
        time.sleep(0.25)
    raise AssertionError(f"run {run_id} did not become {expected_status}: {latest}")


def frame_contains(frame: dict[str, Any], marker: str) -> bool:
    return marker in json.dumps(frame.get("data"), ensure_ascii=False)


def wait_for_health(base_url: str, *, timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    latest_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"{base_url}/ready", timeout=2) as response:
                if response.status == 200:
                    return
        except Exception as exc:  # noqa: BLE001 - polling reports the final cause
            latest_error = exc
        time.sleep(0.25)
    raise AssertionError(
        f"Gateway did not become ready after restart: {latest_error}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway-a", default="http://127.0.0.1:8019")
    parser.add_argument("--gateway-b", default="http://127.0.0.1:8020")
    parser.add_argument("--gateway-a-container", required=True)
    args = parser.parse_args()

    client = ApiClient()
    suffix = f"{int(time.time())}-{secrets.token_hex(4)}"
    email = f"phase10c-{suffix}@example.com"
    password = f"phase10c-{secrets.token_urlsafe(20)}-Aa1"

    status, _, _ = client.request(
        "POST",
        args.gateway_a,
        "/api/v1/auth/register",
        {"email": email, "password": password, "remember_me": True},
    )
    require_status(status, 201, "register")
    if client.csrf_token() is None:
        raise AssertionError("registration did not establish a CSRF token")

    thread_id = str(uuid.uuid4())
    status, thread, _ = client.request(
        "POST",
        args.gateway_a,
        "/api/threads",
        {"thread_id": thread_id, "metadata": {}},
    )
    require_status(status, 200, "create thread")
    assert thread["thread_id"] == thread_id

    status, tenant_body, _ = client.request(
        "POST",
        args.gateway_a,
        "/api/law/tenants",
        {
            "slug": f"phase10c-{suffix}",
            "name": "Phase 10C Agent Failover",
            "owner_display_name": "Failover Owner",
        },
        headers={"Idempotency-Key": f"phase10c-tenant-{suffix}"},
    )
    require_status(status, 201, "create tenant")
    tenant_id = tenant_body["data"]["tenant"]["id"]

    status, matter_body, _ = client.request(
        "POST",
        args.gateway_a,
        f"/api/law/tenants/{tenant_id}/matters",
        {
            "case_number": f"PHASE10C-{suffix}",
            "title": "Synthetic Agent owner loss",
            "stage": "intake",
            "classification": "normal",
        },
        headers={"Idempotency-Key": f"phase10c-matter-{suffix}"},
    )
    require_status(status, 201, "create matter")
    matter_id = matter_body["data"]["matter"]["id"]

    status, _, _ = client.request(
        "POST",
        args.gateway_a,
        f"/api/law/tenants/{tenant_id}/matters/{matter_id}/threads",
        {"thread_id": thread_id, "purpose": "matter-chat"},
        headers={"Idempotency-Key": f"phase10c-bind-{suffix}"},
    )
    require_status(status, 201, "bind thread")

    status, context_body, _ = client.request(
        "GET",
        args.gateway_b,
        f"/api/law/context/by-thread/{thread_id}",
    )
    require_status(status, 200, "resolve legal context on Gateway B")
    assert context_body["data"]["context"]["matter_id"] == matter_id

    status, failed_run, _ = client.request(
        "POST",
        args.gateway_a,
        f"/api/threads/{thread_id}/runs",
        {
            "input": {
                "messages": [
                    {
                        "role": "user",
                        "content": "PHASE10C_SLOW prove cross-Gateway stream recovery",
                    }
                ]
            },
            "context": {"model_name": "phase10c-mock", "thinking_enabled": False},
            "stream_mode": ["messages-tuple"],
            "on_disconnect": "continue",
        },
    )
    require_status(status, 200, "start slow run")
    failed_run_id = failed_run["run_id"]
    join_path = f"/api/threads/{thread_id}/runs/{failed_run_id}/join"

    first_event_id: str | None = None
    for frame in client.sse(args.gateway_b, join_path):
        if frame_contains(frame, "phase10c-chunk-00"):
            first_event_id = frame.get("id")
            break
    if first_event_id is None:
        raise AssertionError("Gateway B did not observe Gateway A's first model chunk")

    time.sleep(1.2)
    replay_event_id: str | None = None
    observed_after_cursor: list[str] = []
    recovery_event: dict[str, Any] | None = None
    gateway_stopped = False
    try:
        for frame in client.sse(
            args.gateway_b, join_path, last_event_id=first_event_id
        ):
            event_id = frame.get("id")
            if event_id:
                if event_id == first_event_id:
                    raise AssertionError(
                        "Last-Event-ID replay repeated the acknowledged event"
                    )
                observed_after_cursor.append(event_id)
            if not gateway_stopped and frame_contains(frame, "phase10c-chunk-"):
                replay_event_id = event_id
                subprocess.run(
                    ["docker", "stop", "--time", "0", args.gateway_a_container],
                    check=True,
                    stdout=subprocess.DEVNULL,
                )
                gateway_stopped = True
            if frame.get("event") == "custom":
                data = frame.get("data")
                if isinstance(data, dict) and data.get("type") == "run_recovery_required":
                    recovery_event = data
            if frame.get("event") == "end":
                break
        if not gateway_stopped:
            raise AssertionError(
                "the owning Gateway was not stopped during the replayed stream"
            )
        if replay_event_id is None or not observed_after_cursor:
            raise AssertionError(
                "Gateway B did not replay retained events after Last-Event-ID"
            )
        if recovery_event != {
            "type": "run_recovery_required",
            "code": "orphan_recovered",
            "run_id": failed_run_id,
            "recovery": "start_new_run",
        }:
            raise AssertionError(
                "Gateway B did not receive the expected recovery control event: "
                f"{recovery_event}"
            )

        recovered = wait_for_run(
            client,
            args.gateway_b,
            thread_id,
            failed_run_id,
            "error",
            timeout=30,
        )
        assert recovered.get("stop_reason") == "orphan_recovered", recovered

        status, replacement_run, _ = client.request(
            "POST",
            args.gateway_b,
            f"/api/threads/{thread_id}/runs",
            {
                "input": {
                    "messages": [
                        {
                            "role": "user",
                            "content": "Complete the legal conversation after the failed run.",
                        }
                    ]
                },
                "context": {"model_name": "phase10c-mock", "thinking_enabled": False},
                "stream_mode": ["values", "messages-tuple"],
                "on_disconnect": "continue",
            },
        )
        require_status(status, 200, "start replacement run")
        replacement_run_id = replacement_run["run_id"]
        replacement = wait_for_run(
            client,
            args.gateway_b,
            thread_id,
            replacement_run_id,
            "success",
            timeout=30,
        )
        assert replacement.get("total_tokens", 0) > 0, replacement

        status, messages, _ = client.request(
            "GET",
            args.gateway_b,
            f"/api/threads/{thread_id}/messages?limit=50",
        )
        require_status(status, 200, "read replacement messages")
        if "PHASE10C_RECOVERY_OK" not in json.dumps(messages, ensure_ascii=False):
            raise AssertionError(
                "replacement result was not durably visible in thread history"
            )

        subprocess.run(
            ["docker", "start", args.gateway_a_container],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        wait_for_health(args.gateway_a)
        gateway_stopped = False

        status, restarted_context, _ = client.request(
            "GET",
            args.gateway_a,
            f"/api/law/context/by-thread/{thread_id}",
        )
        require_status(
            status,
            200,
            "reuse authenticated legal context on restarted Gateway A",
        )
        assert restarted_context["data"]["context"]["matter_id"] == matter_id
        status, restarted_failed_run, _ = client.request(
            "GET",
            args.gateway_a,
            f"/api/threads/{thread_id}/runs/{failed_run_id}",
        )
        require_status(status, 200, "read recovered run on restarted Gateway A")
        assert restarted_failed_run["status"] == "error"
        assert restarted_failed_run["stop_reason"] == "orphan_recovered"

        print(
            json.dumps(
                {
                    "tenant_id": tenant_id,
                    "matter_id": matter_id,
                    "thread_id": thread_id,
                    "failed_run_id": failed_run_id,
                    "failed_run_status": recovered["status"],
                    "failed_run_stop_reason": recovered["stop_reason"],
                    "first_event_id": first_event_id,
                    "replayed_event_id": replay_event_id,
                    "recovery_event": recovery_event,
                    "replacement_run_id": replacement_run_id,
                    "replacement_run_status": replacement["status"],
                    "replacement_total_tokens": replacement["total_tokens"],
                    "legal_context_seen_on_gateway_b": True,
                    "replacement_message_durable": True,
                    "session_and_recovered_run_seen_on_restarted_gateway_a": True,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        if gateway_stopped:
            subprocess.run(
                ["docker", "start", args.gateway_a_container],
                check=False,
                stdout=subprocess.DEVNULL,
            )


if __name__ == "__main__":
    main()
