"""Black-box Phase 10E Gateway readiness and drain-marker verification."""

from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from types import ModuleType
from typing import Any


def _load_phase10d_verifier() -> ModuleType:
    path = Path(__file__).parents[1] / "matrix-law-phase10d" / "verify.py"
    spec = importlib.util.spec_from_file_location("matrix_law_phase10d_verify", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load Phase 10D verifier helpers from {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


phase10d = _load_phase10d_verifier()
HealthSampler = phase10d.HealthSampler
wait_for_health = phase10d.wait_for_health


def request_json(base_url: str, path: str) -> tuple[int, dict[str, Any]]:
    try:
        with urllib.request.urlopen(f"{base_url}{path}", timeout=3) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read())


def docker(*args: str, capture: bool = False) -> str:
    result = subprocess.run(
        ["docker", *args],
        check=True,
        capture_output=capture,
        text=True,
    )
    return result.stdout.strip() if capture else ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gateway-a", default="http://127.0.0.1:8019")
    parser.add_argument("--gateway-b", default="http://127.0.0.1:8020")
    parser.add_argument("--load-balancer", default="http://127.0.0.1:8018")
    parser.add_argument("--gateway-a-container", required=True)
    parser.add_argument("--drain-marker", default="/tmp/deer-flow-gateway-draining")
    args = parser.parse_args()

    a_health = request_json(args.gateway_a, "/health")
    a_ready = request_json(args.gateway_a, "/ready")
    b_ready = request_json(args.gateway_b, "/ready")
    assert a_health[0] == 200 and a_health[1]["status"] == "healthy", a_health
    assert a_ready[0] == 200 and a_ready[1]["status"] == "ready", a_ready
    assert b_ready[0] == 200 and b_ready[1]["status"] == "ready", b_ready

    docker("exec", args.gateway_a_container, "touch", args.drain_marker)
    drain_ready = request_json(args.gateway_a, "/ready")
    drain_health = request_json(args.gateway_a, "/health")
    assert drain_ready[0] == 503 and drain_ready[1]["status"] == "draining", drain_ready
    assert drain_health[0] == 200 and drain_health[1]["status"] == "healthy", drain_health

    with HealthSampler(f"{args.load_balancer}/health") as sampler:
        docker("restart", "--timeout", "15", args.gateway_a_container)
        wait_for_health(args.gateway_a)
    sampler.assert_available("restart drain-marked Gateway A")

    restored_ready = request_json(args.gateway_a, "/ready")
    assert restored_ready[0] == 200 and restored_ready[1]["status"] == "ready", restored_ready
    subprocess.run(
        ["docker", "exec", args.gateway_a_container, "test", "!", "-e", args.drain_marker],
        check=True,
    )
    pid1 = docker(
        "exec",
        args.gateway_a_container,
        "sh",
        "-c",
        'tr "\\000" " " </proc/1/cmdline',
        capture=True,
    )
    assert pid1.startswith("uv run --no-sync uvicorn "), pid1

    print(
        json.dumps(
            {
                "initial_health": a_health[1]["status"],
                "initial_readiness": a_ready[1]["status"],
                "draining_readiness_status": drain_ready[0],
                "draining_readiness": drain_ready[1]["status"],
                "draining_liveness_status": drain_health[0],
                "post_restart_readiness": restored_ready[1]["status"],
                "stale_marker_cleared": True,
                "pid1": pid1,
                "load_balancer_health_samples": len(sampler.statuses),
                "load_balancer_failures": 0,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
