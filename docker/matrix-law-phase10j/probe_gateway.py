"""Black-box HTTP checks for the hardened Matrix Law Gateway image."""

from __future__ import annotations

import concurrent.futures
import json
import os
import urllib.error
import urllib.request


BASE_URL = os.environ["GATEWAY_URL"].rstrip("/")
SENSITIVE_MARKER = "tenant-raw-secret-phase10j"


def request(path: str, *, headers: dict[str, str] | None = None) -> tuple[int, bytes, dict[str, str]]:
    inbound = urllib.request.Request(f"{BASE_URL}{path}", headers=headers or {})
    try:
        with urllib.request.urlopen(inbound, timeout=10) as response:
            return response.status, response.read(), dict(response.headers.items())
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers.items())


def main() -> None:
    health_status, health_body, _ = request("/health")
    ready_status, ready_body, _ = request("/ready")
    law_status, law_body, _ = request(
        "/api/law/health",
        headers={"X-DeerFlow-Internal-Token": os.environ["INTERNAL_AUTH_TOKEN"]},
    )
    protected_status, _, _ = request(f"/api/law/tenants/{SENSITIVE_MARKER}")
    internal_headers = {"X-DeerFlow-Internal-Token": os.environ["INTERNAL_AUTH_TOKEN"]}
    generic_control_plane = {
        path: request(path, headers=internal_headers)[0]
        for path in (
            "/api/agents",
            "/api/channels/providers",
            "/api/integrations/lark/status",
            "/api/mcp/config",
            "/api/memory",
            "/api/scheduled-tasks",
            "/api/skills",
            "/api/subagents",
        )
    }

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as executor:
        health_results = list(executor.map(lambda _: request("/health")[0], range(50)))

    metrics_status, metrics_body, metrics_headers = request("/metrics")
    metrics_text = metrics_body.decode("utf-8")
    metrics_content_type = next(
        value for name, value in metrics_headers.items() if name.lower() == "content-type"
    )
    law_payload = json.loads(law_body)

    assert health_status == 200, (health_status, health_body)
    assert json.loads(health_body)["service"] == "matrix-law-gateway"
    assert ready_status == 200, (ready_status, ready_body)
    assert law_status == 200, (law_status, law_body)
    assert law_payload["extension"] == "matrix-law"
    assert law_payload["status"] == "ready"
    assert law_payload["migration"] == {
        "current": "0014_legal_work_kinds",
        "expected": "0014_legal_work_kinds",
    }
    assert law_payload["capabilities"]["task_admission"] is True
    assert law_payload["capabilities"]["trusted_legal_work_context"] is True
    assert protected_status == 401
    assert set(generic_control_plane.values()) == {404}, generic_control_plane
    assert health_results == [200] * 50
    assert metrics_status == 200
    assert metrics_content_type.startswith("text/plain")
    assert "deerflow_gateway_ready 1" in metrics_text
    assert "deerflow_gateway_http_requests_in_flight 0" in metrics_text
    assert SENSITIVE_MARKER not in metrics_text
    assert 'route="__unmatched__"' in metrics_text

    print(
        json.dumps(
            {
                "health": health_status,
                "ready": ready_status,
                "matrix_law_health": law_status,
                "matrix_law_extension": law_payload["extension"],
                "matrix_law_migration": law_payload["migration"]["current"],
                "task_admission": law_payload["capabilities"]["task_admission"],
                "trusted_legal_work_context": law_payload["capabilities"]["trusted_legal_work_context"],
                "unauthenticated_legal_route": protected_status,
                "generic_control_plane": generic_control_plane,
                "concurrent_health_requests": len(health_results),
                "raw_tenant_marker_in_metrics": False,
                "metrics_in_flight_after_probe": 0,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
