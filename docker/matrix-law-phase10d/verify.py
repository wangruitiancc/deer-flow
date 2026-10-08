"""Black-box Phase 10D graceful rolling-restart verification."""

from __future__ import annotations

import importlib.util
import json
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from types import ModuleType
from typing import Any


def _load_phase10c_verifier() -> ModuleType:
    path = Path(__file__).parents[1] / "matrix-law-phase10c" / "verify.py"
    spec = importlib.util.spec_from_file_location("matrix_law_phase10c_verify", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load Phase 10C verifier helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


phase10c = _load_phase10c_verifier()
ApiClient = phase10c.ApiClient
frame_contains = phase10c.frame_contains
require_status = phase10c.require_status
wait_for_health = phase10c.wait_for_health
wait_for_run = phase10c.wait_for_run


class HealthSampler:
    """Continuously probe the load balancer while one Gateway is replaced."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.statuses: list[int | str] = []
        self.upstreams: list[str] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                with urllib.request.urlopen(self.url, timeout=2) as response:
                    self.statuses.append(response.status)
                    upstream = response.headers.get("X-Matrix-Test-Upstream")
                    if upstream:
                        self.upstreams.append(upstream)
            except urllib.error.HTTPError as exc:
                self.statuses.append(exc.code)
            except Exception as exc:  # noqa: BLE001 - retain the exact probe failure
                self.statuses.append(type(exc).__name__)
            time.sleep(0.05)

    def __enter__(self) -> HealthSampler:
        self._thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self._stop.set()
        self._thread.join(timeout=3)

    def assert_available(self, operation: str) -> None:
        if len(self.statuses) < 3:
            raise AssertionError(f"{operation}: collected too few health samples: {self.statuses}")
        failures = [status for status in self.statuses if status != 200]
        if failures:
            raise AssertionError(f"{operation}: load balancer health failures: {failures}")


def docker(*args: str) -> None:
    subprocess.run(
        ["docker", *args],
        check=True,
        stdout=subprocess.DEVNULL,
    )


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway-a", default="http://127.0.0.1:8019")
    parser.add_argument("--gateway-b", default="http://127.0.0.1:8020")
    parser.add_argument("--load-balancer", default="http://127.0.0.1:8018")
    parser.add_argument("--gateway-a-container", required=True)
    parser.add_argument("--gateway-b-container", required=True)
    args = parser.parse_args()

    client = ApiClient()
    suffix = f"{int(time.time())}-{secrets.token_hex(4)}"
    email = f"phase10d-{suffix}@example.com"
    password = f"phase10d-{secrets.token_urlsafe(20)}-Aa1"

    status, _, _ = client.request(
        "POST",
        args.gateway_a,
        "/api/v1/auth/register",
        {"email": email, "password": password, "remember_me": True},
    )
    require_status(status, 201, "register")

    thread_id = str(uuid.uuid4())
    status, _, _ = client.request(
        "POST",
        args.gateway_a,
        "/api/threads",
        {"thread_id": thread_id, "metadata": {}},
    )
    require_status(status, 200, "create thread")

    status, tenant_body, _ = client.request(
        "POST",
        args.gateway_a,
        "/api/law/tenants",
        {
            "slug": f"phase10d-{suffix}",
            "name": "Phase 10D Rolling Restart",
            "owner_display_name": "Rolling Owner",
        },
        headers={"Idempotency-Key": f"phase10d-tenant-{suffix}"},
    )
    require_status(status, 201, "create tenant")
    tenant_id = tenant_body["data"]["tenant"]["id"]

    status, matter_body, _ = client.request(
        "POST",
        args.gateway_a,
        f"/api/law/tenants/{tenant_id}/matters",
        {
            "case_number": f"PHASE10D-{suffix}",
            "title": "Synthetic rolling restart",
            "stage": "intake",
            "classification": "normal",
        },
        headers={"Idempotency-Key": f"phase10d-matter-{suffix}"},
    )
    require_status(status, 201, "create matter")
    matter_id = matter_body["data"]["matter"]["id"]

    status, _, _ = client.request(
        "POST",
        args.gateway_a,
        f"/api/law/tenants/{tenant_id}/matters/{matter_id}/threads",
        {"thread_id": thread_id, "purpose": "matter-chat"},
        headers={"Idempotency-Key": f"phase10d-bind-{suffix}"},
    )
    require_status(status, 201, "bind thread")

    gateway_a_running = True
    gateway_b_running = True
    try:
        with HealthSampler(f"{args.load_balancer}/health") as non_owner_health:
            docker("restart", "--timeout", "15", args.gateway_b_container)
            wait_for_health(args.gateway_b)
            # Nginx OSS uses passive health. Direct container readiness can
            # become green before its one-second fail_timeout quarantine has
            # expired, so a correct rolling sequence must wait for re-entry
            # before removing the other replica.
            time.sleep(1.25)
        non_owner_health.assert_available("restart idle Gateway B")

        status, context_body, _ = client.request(
            "GET",
            args.gateway_b,
            f"/api/law/context/by-thread/{thread_id}",
        )
        require_status(status, 200, "resolve legal context after Gateway B restart")
        assert context_body["data"]["context"]["matter_id"] == matter_id

        status, interrupted_run, _ = client.request(
            "POST",
            args.gateway_a,
            f"/api/threads/{thread_id}/runs",
            {
                "input": {
                    "messages": [
                        {
                            "role": "user",
                            "content": "PHASE10C_SLOW verify graceful rolling restart",
                        }
                    ]
                },
                "context": {
                    "model_name": "phase10c-mock",
                    "thinking_enabled": False,
                },
                "stream_mode": ["messages-tuple"],
                "on_disconnect": "continue",
            },
        )
        require_status(status, 200, "start slow run")
        interrupted_run_id = interrupted_run["run_id"]
        join_path = f"/api/threads/{thread_id}/runs/{interrupted_run_id}/join"

        first_event_id: str | None = None
        recovery_event: dict[str, Any] | None = None
        owner_health: HealthSampler | None = None
        for frame in client.sse(args.gateway_b, join_path, timeout=60):
            if first_event_id is None and frame_contains(frame, "phase10c-chunk-00"):
                first_event_id = frame.get("id")
                owner_health = HealthSampler(f"{args.load_balancer}/health")
                owner_health.__enter__()
                docker("stop", "--timeout", "15", args.gateway_a_container)
                gateway_a_running = False
            if frame.get("event") == "custom":
                data = frame.get("data")
                if isinstance(data, dict) and data.get("type") == "run_recovery_required":
                    recovery_event = data
            if frame.get("event") == "end":
                break

        if first_event_id is None:
            raise AssertionError("Gateway B did not observe the slow run before rolling restart")
        if recovery_event != {
            "type": "run_recovery_required",
            "code": "gateway_shutdown",
            "run_id": interrupted_run_id,
            "recovery": "start_new_run",
        }:
            raise AssertionError(f"unexpected graceful-shutdown recovery event: {recovery_event}")

        interrupted = wait_for_run(
            client,
            args.gateway_b,
            thread_id,
            interrupted_run_id,
            "interrupted",
        )
        assert interrupted.get("stop_reason") == "gateway_shutdown", interrupted

        docker("start", args.gateway_a_container)
        gateway_a_running = True
        wait_for_health(args.gateway_a)
        assert owner_health is not None
        owner_health.__exit__()
        owner_health.assert_available("replace active-run Gateway A")

        status, replacement_run, replacement_headers = client.request(
            "POST",
            args.load_balancer,
            f"/api/threads/{thread_id}/runs",
            {
                "input": {
                    "messages": [
                        {
                            "role": "user",
                            "content": "Complete the conversation after the rolling restart.",
                        }
                    ]
                },
                "context": {
                    "model_name": "phase10c-mock",
                    "thinking_enabled": False,
                },
                "stream_mode": ["values", "messages-tuple"],
                "on_disconnect": "continue",
            },
        )
        require_status(status, 200, "start replacement run through load balancer")
        replacement_run_id = replacement_run["run_id"]
        replacement = wait_for_run(
            client,
            args.load_balancer,
            thread_id,
            replacement_run_id,
            "success",
        )

        status, restarted_run, _ = client.request(
            "GET",
            args.gateway_a,
            f"/api/threads/{thread_id}/runs/{interrupted_run_id}",
        )
        require_status(status, 200, "read interrupted run on restarted Gateway A")
        assert restarted_run["status"] == "interrupted"
        assert restarted_run["stop_reason"] == "gateway_shutdown"

        status, messages, _ = client.request(
            "GET",
            args.load_balancer,
            f"/api/threads/{thread_id}/messages?limit=50",
        )
        require_status(status, 200, "read durable replacement messages")
        if "PHASE10C_RECOVERY_OK" not in json.dumps(messages, ensure_ascii=False):
            raise AssertionError("replacement result was not durably visible")

        print(
            json.dumps(
                {
                    "tenant_id": tenant_id,
                    "matter_id": matter_id,
                    "thread_id": thread_id,
                    "interrupted_run_id": interrupted_run_id,
                    "interrupted_status": interrupted["status"],
                    "interrupted_stop_reason": interrupted["stop_reason"],
                    "recovery_event": recovery_event,
                    "replacement_run_id": replacement_run_id,
                    "replacement_status": replacement["status"],
                    "replacement_total_tokens": replacement["total_tokens"],
                    "replacement_upstream": replacement_headers.get(
                        "X-Matrix-Test-Upstream"
                    ),
                    "idle_gateway_restart_health_samples": len(
                        non_owner_health.statuses
                    ),
                    "passive_upstream_reentry_wait_seconds": 1.25,
                    "active_gateway_restart_health_samples": len(
                        owner_health.statuses
                    ),
                    "load_balancer_failures": 0,
                    "legal_context_durable": True,
                    "session_durable": True,
                    "replacement_message_durable": True,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        if not gateway_a_running:
            subprocess.run(
                ["docker", "start", args.gateway_a_container],
                check=False,
                stdout=subprocess.DEVNULL,
            )
        if not gateway_b_running:
            subprocess.run(
                ["docker", "start", args.gateway_b_container],
                check=False,
                stdout=subprocess.DEVNULL,
            )


if __name__ == "__main__":
    main()
