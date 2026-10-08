"""Gateway Prometheus metrics and privacy/cardinality contract."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.responses import StreamingResponse

from app.gateway.metrics import GatewayMetricsMiddleware, GatewayMetricsRegistry


def test_registry_uses_route_templates_and_bounded_labels() -> None:
    registry = GatewayMetricsRegistry(duration_buckets=(0.1, 1.0))
    app = FastAPI()
    app.add_middleware(GatewayMetricsMiddleware, registry=registry)

    @app.get("/items/{item_id}")
    async def item(item_id: str) -> dict[str, str]:
        return {"item_id": item_id}

    client = TestClient(app)
    assert client.get("/items/tenant-a-secret").status_code == 200
    assert client.get("/items/tenant-b-secret").status_code == 200

    metrics = registry.render(ready=True)
    assert 'route="/items/{item_id}"' in metrics
    assert "tenant-a-secret" not in metrics
    assert "tenant-b-secret" not in metrics
    assert 'deerflow_gateway_http_requests_total{method="GET",route="/items/{item_id}",status_class="2xx"} 2' in metrics
    assert 'deerflow_gateway_http_request_duration_seconds_count{method="GET",route="/items/{item_id}",response_kind="request"} 2' in metrics
    assert 'deerflow_gateway_http_request_duration_seconds_bucket{method="GET",route="/items/{item_id}",response_kind="request",le="+Inf"} 2' in metrics


def test_stream_latency_is_separate_from_ordinary_request_latency() -> None:
    registry = GatewayMetricsRegistry(duration_buckets=(1.0,))
    app = FastAPI()
    app.add_middleware(GatewayMetricsMiddleware, registry=registry)

    @app.get("/events")
    async def events() -> StreamingResponse:
        async def body():
            yield "data: done\\n\\n"

        return StreamingResponse(body(), media_type="text/event-stream")

    assert TestClient(app).get("/events").status_code == 200
    metrics = registry.render(ready=True)
    assert 'route="/events",response_kind="stream"' in metrics
    assert 'route="/events",response_kind="request"' not in metrics


def test_unmatched_and_exception_requests_are_bounded_and_inflight_recovers() -> None:
    registry = GatewayMetricsRegistry(duration_buckets=(1.0,))
    app = FastAPI()
    app.add_middleware(GatewayMetricsMiddleware, registry=registry)

    @app.get("/explode")
    async def explode() -> None:
        raise RuntimeError("synthetic failure")

    client = TestClient(app, raise_server_exceptions=False)
    assert client.get("/private/customer-123").status_code == 404
    assert client.get("/explode").status_code == 500

    metrics = registry.render(ready=False)
    assert "customer-123" not in metrics
    assert 'route="__unmatched__",status_class="4xx"} 1' in metrics
    assert 'route="/explode",status_class="5xx"} 1' in metrics
    assert "deerflow_gateway_http_requests_in_flight 0" in metrics
    assert "deerflow_gateway_ready 0" in metrics


def test_metrics_route_is_explicitly_enabled_public_and_does_not_measure_itself(
    monkeypatch,
) -> None:
    from app.gateway.app import create_app
    from app.gateway.auth_middleware import _is_public

    assert _is_public("/metrics") is True
    assert _is_public("/metricsevil") is False

    monkeypatch.delenv("DEER_FLOW_METRICS_ENABLED", raising=False)
    disabled = TestClient(create_app())
    assert disabled.get("/metrics").status_code == 404

    monkeypatch.setenv("DEER_FLOW_METRICS_ENABLED", "true")
    app = create_app()
    enabled = TestClient(app)
    assert enabled.get("/health").status_code == 200
    response = enabled.get("/metrics")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/plain; version=0.0.4")
    assert 'route="/health",status_class="2xx"} 1' in response.text
    assert 'route="/metrics"' not in response.text
    assert "deerflow_gateway_ready 0" in response.text


def test_histogram_buckets_must_be_strictly_increasing() -> None:
    for buckets in ((), (0.0,), (1.0, 0.5), (1.0, 1.0)):
        try:
            GatewayMetricsRegistry(duration_buckets=buckets)
        except ValueError:
            continue
        raise AssertionError(f"invalid buckets accepted: {buckets}")


def test_capacity_rejection_metric_has_only_bounded_product_scopes() -> None:
    registry = GatewayMetricsRegistry(duration_buckets=(1.0,))
    registry.record_run_capacity_rejection("tenant")
    registry.record_run_capacity_rejection("tenant-secret-123")

    metrics = registry.render(ready=True)
    assert 'deerflow_gateway_run_capacity_rejections_total{scope="tenant"} 1' in metrics
    assert 'deerflow_gateway_run_capacity_rejections_total{scope="other"} 1' in metrics
    assert "tenant-secret-123" not in metrics


def test_background_worker_metrics_have_fixed_labels_and_capture_batch_costs() -> None:
    registry = GatewayMetricsRegistry(duration_buckets=(1.0,))
    registry.record_background_worker_batch(
        worker="ocr",
        claimed_jobs=4,
        duration_seconds=2.5,
    )
    registry.record_background_worker_batch(
        worker="speech-private-tenant-123",
        claimed_jobs=-3,
        duration_seconds=float("inf"),
        failed=True,
    )

    metrics = registry.render(ready=True)
    assert 'matrix_law_background_worker_batches_total{worker="ocr"} 1' in metrics
    assert 'matrix_law_background_worker_jobs_claimed_total{worker="ocr"} 4' in metrics
    assert 'matrix_law_background_worker_batch_errors_total{worker="ocr"} 0' in metrics
    assert 'matrix_law_background_worker_batch_duration_seconds_count{worker="ocr"} 1' in metrics
    assert 'matrix_law_background_worker_batches_total{worker="speech"} 0' in metrics
    assert "speech-private-tenant-123" not in metrics
    assert "tenant-123" not in metrics


def test_background_worker_queue_metrics_keep_fixed_labels_and_last_good_snapshot() -> None:
    registry = GatewayMetricsRegistry(duration_buckets=(1.0,))
    registry.record_background_worker_queue(
        worker="ocr",
        queue_depth=7,
        oldest_task_age_seconds=42.5,
    )
    registry.record_background_worker_queue(
        worker="speech-private-tenant-123",
        queue_depth=-2,
        oldest_task_age_seconds=float("inf"),
    )
    registry.record_background_worker_queue(
        worker="ocr",
        queue_depth=0,
        oldest_task_age_seconds=0,
        failed=True,
    )

    metrics = registry.render(ready=True)
    assert 'matrix_law_background_worker_queue_depth{worker="ocr"} 7' in metrics
    assert 'matrix_law_background_worker_queue_oldest_task_age_seconds{worker="ocr"} 42.500000000' in metrics
    assert 'matrix_law_background_worker_queue_observation_errors_total{worker="ocr"} 1' in metrics
    assert 'matrix_law_background_worker_queue_depth{worker="speech"} 0' in metrics
    assert 'matrix_law_background_worker_queue_oldest_task_age_seconds{worker="speech"} 0.000000000' in metrics
    assert 'matrix_law_background_worker_queue_observation_errors_total{worker="speech"} 0' in metrics
    assert "speech-private-tenant-123" not in metrics
    assert "tenant-123" not in metrics
    observed_at = next(line.split()[-1] for line in metrics.splitlines() if line.startswith('matrix_law_background_worker_queue_observation_timestamp_seconds{worker="ocr"}'))
    assert float(observed_at) > 0


def test_ocr_provider_outcomes_use_bounded_categories_without_provider_names() -> None:
    registry = GatewayMetricsRegistry()
    registry.record_ocr_provider_outcome(provider_class="personal", outcome="success")
    registry.record_ocr_provider_outcome(
        provider_class="tenant-controlled-resource-secret",
        outcome='provider error: "private detail"',
    )

    metrics = registry.render(ready=True)
    assert 'matrix_law_ocr_provider_outcomes_total{provider_class="personal",outcome="success"} 1' in metrics
    assert 'matrix_law_ocr_provider_outcomes_total{provider_class="other",outcome="error"} 1' in metrics
    assert "tenant-controlled-resource-secret" not in metrics
    assert "private detail" not in metrics
