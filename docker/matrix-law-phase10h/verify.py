"""Black-box HTTP verification for the final Gateway metrics image."""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import statistics
import time
import urllib.error
import urllib.request


def request(url: str) -> tuple[int, str, float]:
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            status = response.status
            body = response.read().decode()
    except urllib.error.HTTPError as exc:
        status = exc.code
        body = exc.read().decode()
    return status, body, time.perf_counter() - started


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(len(ordered) * fraction) - 1))
    return ordered[index]


def metric_value(exposition: str, series: str) -> int:
    prefix = series + " "
    for line in exposition.splitlines():
        if line.startswith(prefix):
            return int(float(line.removeprefix(prefix)))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8021")
    parser.add_argument("--requests", type=int, default=50)
    args = parser.parse_args()

    status, initial_metrics, _ = request(f"{args.base_url}/metrics")
    assert status == 200
    health_series = 'deerflow_gateway_http_requests_total{method="GET",route="/health",status_class="2xx"}'
    unmatched_series = 'deerflow_gateway_http_requests_total{method="GET",route="__unmatched__",status_class="4xx"}'
    initial_health = metric_value(initial_metrics, health_series)
    initial_unmatched = metric_value(initial_metrics, unmatched_series)

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        results = list(
            executor.map(
                lambda _: request(f"{args.base_url}/health"),
                range(args.requests),
            )
        )
    assert all(status == 200 for status, _, _ in results), results

    secret_paths = ("tenant-alpha-secret", "tenant-beta-secret")
    unmatched_statuses: list[int] = []
    for value in secret_paths:
        status, _, _ = request(f"{args.base_url}/unmatched/{value}")
        # The production AuthMiddleware is fail-closed and may return 401
        # before routing reaches the 404 fallback. Both remain one bounded 4xx
        # series and neither may expose the raw path as a metric label.
        assert status in {401, 404}
        unmatched_statuses.append(status)

    status, metrics, _ = request(f"{args.base_url}/metrics")
    assert status == 200
    final_health = metric_value(metrics, health_series)
    final_unmatched = metric_value(metrics, unmatched_series)
    assert final_health - initial_health == args.requests, (initial_health, final_health)
    assert final_unmatched - initial_unmatched == len(secret_paths), (
        initial_unmatched,
        final_unmatched,
    )
    assert 'route="/metrics"' not in metrics
    assert 'route="/health",response_kind="request"' in metrics
    assert 'route="/health",response_kind="stream"' not in metrics
    assert "deerflow_gateway_http_requests_in_flight 0" in metrics
    assert "deerflow_gateway_ready 0" in metrics
    assert not any(value in metrics for value in secret_paths)

    durations = [duration for _, _, duration in results]
    print(
        json.dumps(
            {
                "health_requests": len(results),
                "health_failures": 0,
                "health_counter_delta": final_health - initial_health,
                "unmatched_requests": len(secret_paths),
                "unmatched_statuses": unmatched_statuses,
                "unmatched_counter_delta": final_unmatched - initial_unmatched,
                "raw_identifiers_in_metrics": False,
                "metrics_self_observed": False,
                "health_response_kind": "request",
                "in_flight_after_completion": 0,
                "readiness_gauge": 0,
                "client_latency_ms": {
                    "mean": round(statistics.mean(durations) * 1000, 3),
                    "p95": round(percentile(durations, 0.95) * 1000, 3),
                    "p99": round(percentile(durations, 0.99) * 1000, 3),
                    "max": round(max(durations) * 1000, 3),
                },
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
