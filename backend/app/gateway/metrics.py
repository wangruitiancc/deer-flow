"""Bounded-cardinality Prometheus metrics for the Gateway HTTP surface."""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from math import isfinite
from typing import Final

from starlette.types import ASGIApp, Message, Receive, Scope, Send

METRICS_ENABLED_ENV: Final[str] = "DEER_FLOW_METRICS_ENABLED"
METRICS_PATH: Final[str] = "/metrics"
PROMETHEUS_CONTENT_TYPE: Final[str] = "text/plain; version=0.0.4; charset=utf-8"

DEFAULT_DURATION_BUCKETS: Final[tuple[float, ...]] = (
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    30.0,
    60.0,
)
_KNOWN_METHODS = frozenset({"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})
_STREAM_CONTENT_TYPE = b"text/event-stream"
_CAPACITY_SCOPES = frozenset({"global", "tenant", "user"})
_BACKGROUND_WORKERS: Final[tuple[str, ...]] = ("ocr", "speech")
_OCR_PROVIDER_CLASSES: Final[tuple[str, ...]] = ("platform", "personal", "local", "other")
_OCR_PROVIDER_OUTCOMES: Final[tuple[str, ...]] = ("success", "error", "unknown", "infrastructure_error")
_BACKGROUND_WORKER_DURATION_BUCKETS: Final[tuple[float, ...]] = (
    0.1,
    0.5,
    1.0,
    2.5,
    5.0,
    10.0,
    30.0,
    60.0,
    120.0,
    300.0,
    600.0,
    1800.0,
)


def gateway_metrics_enabled() -> bool:
    """Return the explicit process-level opt-in for the public scrape route."""
    return os.environ.get(METRICS_ENABLED_ENV, "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _labels(**values: str) -> str:
    return "{" + ",".join(f'{name}="{_escape_label(value)}"' for name, value in values.items()) + "}"


def _method(scope: Scope) -> str:
    method = str(scope.get("method") or "").upper()
    return method if method in _KNOWN_METHODS else "OTHER"


def _route_template(scope: Scope) -> str:
    route = scope.get("route")
    path = getattr(route, "path", None)
    if isinstance(path, str) and path.startswith("/"):
        return path
    return "__unmatched__"


def _status_class(status: int) -> str:
    return f"{status // 100}xx" if 100 <= status <= 599 else "unknown"


def _response_kind(message: Message) -> str:
    """Classify latency without turning arbitrary response headers into labels."""
    for name, value in message.get("headers", ()):  # ASGI headers are lowercase bytes.
        if name.lower() == b"content-type" and value.lower().startswith(_STREAM_CONTENT_TYPE):
            return "stream"
    return "request"


@dataclass
class _Histogram:
    buckets: list[int]
    count: int = 0
    total: float = 0.0


class GatewayMetricsRegistry:
    """Small dependency-free registry with only bounded labels."""

    def __init__(self, *, duration_buckets: Sequence[float] = DEFAULT_DURATION_BUCKETS) -> None:
        normalized = tuple(float(value) for value in duration_buckets)
        if not normalized or any(value <= 0 for value in normalized):
            raise ValueError("duration buckets must be positive and non-empty")
        if tuple(sorted(set(normalized))) != normalized:
            raise ValueError("duration buckets must be strictly increasing")
        self.duration_buckets = normalized
        self._lock = threading.Lock()
        self._in_flight = 0
        self._requests: dict[tuple[str, str, str], int] = defaultdict(int)
        self._durations: dict[tuple[str, str, str], _Histogram] = {}
        self._capacity_rejections: dict[str, int] = defaultdict(int)
        self._worker_batches: dict[str, int] = defaultdict(int)
        self._worker_jobs_claimed: dict[str, int] = defaultdict(int)
        self._worker_batch_errors: dict[str, int] = defaultdict(int)
        self._worker_durations: dict[str, _Histogram] = {}
        self._worker_queue_depth = dict.fromkeys(_BACKGROUND_WORKERS, 0)
        self._worker_queue_oldest_task_age: dict[str, float] = dict.fromkeys(_BACKGROUND_WORKERS, 0.0)
        self._worker_queue_observed_at: dict[str, float] = dict.fromkeys(_BACKGROUND_WORKERS, 0.0)
        self._worker_queue_observation_errors: dict[str, int] = defaultdict(int)
        self._ocr_provider_outcomes: dict[tuple[str, str], int] = defaultdict(int)

    def begin_request(self) -> None:
        with self._lock:
            self._in_flight += 1

    def finish_request(
        self,
        *,
        method: str,
        route: str,
        response_kind: str,
        status: int,
        duration_seconds: float,
    ) -> None:
        key = (method, route, response_kind)
        with self._lock:
            self._in_flight = max(0, self._in_flight - 1)
            self._requests[(method, route, _status_class(status))] += 1
            histogram = self._durations.get(key)
            if histogram is None:
                histogram = _Histogram(buckets=[0] * len(self.duration_buckets))
                self._durations[key] = histogram
            histogram.count += 1
            histogram.total += max(0.0, duration_seconds)
            for index, upper_bound in enumerate(self.duration_buckets):
                if duration_seconds <= upper_bound:
                    histogram.buckets[index] += 1

    def record_run_capacity_rejection(self, scope: str) -> None:
        """Count overload decisions with a fixed, identity-free label set."""
        normalized = scope if scope in _CAPACITY_SCOPES else "other"
        with self._lock:
            self._capacity_rejections[normalized] += 1

    def record_background_worker_batch(
        self,
        *,
        worker: str,
        claimed_jobs: int,
        duration_seconds: float,
        failed: bool = False,
    ) -> None:
        """Record a worker polling batch using fixed worker labels only."""
        normalized = worker if worker in _BACKGROUND_WORKERS else "other"
        claimed = max(0, int(claimed_jobs))
        duration = float(duration_seconds)
        if not isfinite(duration) or duration < 0:
            duration = 0.0
        with self._lock:
            self._worker_batches[normalized] += 1
            self._worker_jobs_claimed[normalized] += claimed
            if failed:
                self._worker_batch_errors[normalized] += 1
            histogram = self._worker_durations.get(normalized)
            if histogram is None:
                histogram = _Histogram(buckets=[0] * len(_BACKGROUND_WORKER_DURATION_BUCKETS))
                self._worker_durations[normalized] = histogram
            histogram.count += 1
            histogram.total += duration
            for index, upper_bound in enumerate(_BACKGROUND_WORKER_DURATION_BUCKETS):
                if duration <= upper_bound:
                    histogram.buckets[index] += 1

    def record_background_worker_queue(
        self,
        *,
        worker: str,
        queue_depth: int,
        oldest_task_age_seconds: float,
        failed: bool = False,
    ) -> None:
        """Record aggregate queue depth and age with fixed worker labels only."""
        normalized = worker if worker in _BACKGROUND_WORKERS else "other"
        with self._lock:
            if failed:
                self._worker_queue_observation_errors[normalized] += 1
                return
            try:
                depth = max(0, int(queue_depth))
            except (TypeError, ValueError, OverflowError):
                depth = 0
            try:
                age = float(oldest_task_age_seconds)
            except (TypeError, ValueError, OverflowError):
                age = 0.0
            if not isfinite(age) or age < 0:
                age = 0.0
            self._worker_queue_depth[normalized] = depth
            self._worker_queue_oldest_task_age[normalized] = age
            self._worker_queue_observed_at[normalized] = time.time()

    def record_ocr_provider_outcome(self, *, provider_class: str, outcome: str) -> None:
        """Record an OCR processor attempt with a fixed provider class and outcome."""
        normalized_provider = provider_class if provider_class in _OCR_PROVIDER_CLASSES else "other"
        normalized_outcome = outcome if outcome in _OCR_PROVIDER_OUTCOMES else "error"
        with self._lock:
            self._ocr_provider_outcomes[(normalized_provider, normalized_outcome)] += 1

    def render(self, *, ready: bool) -> str:
        with self._lock:
            in_flight = self._in_flight
            requests = dict(self._requests)
            durations = {
                key: _Histogram(
                    buckets=list(histogram.buckets),
                    count=histogram.count,
                    total=histogram.total,
                )
                for key, histogram in self._durations.items()
            }
            capacity_rejections = dict(self._capacity_rejections)
            worker_batches = dict(self._worker_batches)
            worker_jobs_claimed = dict(self._worker_jobs_claimed)
            worker_batch_errors = dict(self._worker_batch_errors)
            worker_queue_depth = dict(self._worker_queue_depth)
            worker_queue_oldest_task_age = dict(self._worker_queue_oldest_task_age)
            worker_queue_observed_at = dict(self._worker_queue_observed_at)
            worker_queue_observation_errors = dict(self._worker_queue_observation_errors)
            ocr_provider_outcomes = dict(self._ocr_provider_outcomes)
            worker_durations = {
                key: _Histogram(
                    buckets=list(histogram.buckets),
                    count=histogram.count,
                    total=histogram.total,
                )
                for key, histogram in self._worker_durations.items()
            }

        lines = [
            "# HELP deerflow_gateway_info Static Gateway build information.",
            "# TYPE deerflow_gateway_info gauge",
            'deerflow_gateway_info{service="deer-flow-gateway"} 1',
            "# HELP deerflow_gateway_ready Whether this Gateway currently admits traffic.",
            "# TYPE deerflow_gateway_ready gauge",
            f"deerflow_gateway_ready {1 if ready else 0}",
            "# HELP deerflow_gateway_http_requests_in_flight Current HTTP requests excluding the metrics scrape.",
            "# TYPE deerflow_gateway_http_requests_in_flight gauge",
            f"deerflow_gateway_http_requests_in_flight {in_flight}",
            "# HELP deerflow_gateway_http_requests_total Completed Gateway HTTP requests.",
            "# TYPE deerflow_gateway_http_requests_total counter",
        ]
        for (method, route, status_class), count in sorted(requests.items()):
            lines.append("deerflow_gateway_http_requests_total" + _labels(method=method, route=route, status_class=status_class) + f" {count}")

        lines.extend(
            (
                "# HELP deerflow_gateway_run_capacity_rejections_total Rejected Agent runs by bounded capacity scope.",
                "# TYPE deerflow_gateway_run_capacity_rejections_total counter",
            )
        )
        for scope, count in sorted(capacity_rejections.items()):
            lines.append("deerflow_gateway_run_capacity_rejections_total" + _labels(scope=scope) + f" {count}")

        lines.extend(
            (
                "# HELP matrix_law_background_worker_batches_total Completed OCR and speech worker polling batches.",
                "# TYPE matrix_law_background_worker_batches_total counter",
            )
        )
        for worker in _BACKGROUND_WORKERS:
            lines.append("matrix_law_background_worker_batches_total" + _labels(worker=worker) + f" {worker_batches.get(worker, 0)}")

        lines.extend(
            (
                "# HELP matrix_law_background_worker_jobs_claimed_total Jobs claimed by OCR and speech workers.",
                "# TYPE matrix_law_background_worker_jobs_claimed_total counter",
            )
        )
        for worker in _BACKGROUND_WORKERS:
            lines.append("matrix_law_background_worker_jobs_claimed_total" + _labels(worker=worker) + f" {worker_jobs_claimed.get(worker, 0)}")

        lines.extend(
            (
                "# HELP matrix_law_background_worker_batch_errors_total Worker polling batches that raised an unhandled error.",
                "# TYPE matrix_law_background_worker_batch_errors_total counter",
            )
        )
        for worker in _BACKGROUND_WORKERS:
            lines.append("matrix_law_background_worker_batch_errors_total" + _labels(worker=worker) + f" {worker_batch_errors.get(worker, 0)}")

        lines.extend(
            (
                "# HELP matrix_law_background_worker_queue_depth Claimable OCR and speech tasks waiting at the last successful observation.",
                "# TYPE matrix_law_background_worker_queue_depth gauge",
            )
        )
        for worker in _BACKGROUND_WORKERS:
            lines.append("matrix_law_background_worker_queue_depth" + _labels(worker=worker) + f" {worker_queue_depth.get(worker, 0)}")

        lines.extend(
            (
                "# HELP matrix_law_background_worker_queue_oldest_task_age_seconds Age of the oldest claimable queued task at the last successful observation.",
                "# TYPE matrix_law_background_worker_queue_oldest_task_age_seconds gauge",
            )
        )
        for worker in _BACKGROUND_WORKERS:
            lines.append("matrix_law_background_worker_queue_oldest_task_age_seconds" + _labels(worker=worker) + f" {worker_queue_oldest_task_age.get(worker, 0.0):.9f}")

        lines.extend(
            (
                "# HELP matrix_law_background_worker_queue_observation_timestamp_seconds Unix timestamp of the last successful queue observation, or zero if none has succeeded.",
                "# TYPE matrix_law_background_worker_queue_observation_timestamp_seconds gauge",
            )
        )
        for worker in _BACKGROUND_WORKERS:
            lines.append("matrix_law_background_worker_queue_observation_timestamp_seconds" + _labels(worker=worker) + f" {worker_queue_observed_at.get(worker, 0.0):.3f}")

        lines.extend(
            (
                "# HELP matrix_law_background_worker_queue_observation_errors_total Failed aggregate OCR and speech queue observations.",
                "# TYPE matrix_law_background_worker_queue_observation_errors_total counter",
            )
        )
        for worker in _BACKGROUND_WORKERS:
            lines.append("matrix_law_background_worker_queue_observation_errors_total" + _labels(worker=worker) + f" {worker_queue_observation_errors.get(worker, 0)}")

        lines.extend(
            (
                "# HELP matrix_law_ocr_provider_outcomes_total OCR processor call outcomes aggregated by a bounded provider class and result.",
                "# TYPE matrix_law_ocr_provider_outcomes_total counter",
            )
        )
        for provider_class in _OCR_PROVIDER_CLASSES:
            for outcome in _OCR_PROVIDER_OUTCOMES:
                count = ocr_provider_outcomes.get((provider_class, outcome), 0)
                lines.append("matrix_law_ocr_provider_outcomes_total" + _labels(provider_class=provider_class, outcome=outcome) + f" {count}")

        lines.extend(
            (
                "# HELP matrix_law_background_worker_batch_duration_seconds Time spent claiming and processing a worker batch.",
                "# TYPE matrix_law_background_worker_batch_duration_seconds histogram",
            )
        )
        for worker in _BACKGROUND_WORKERS:
            histogram = worker_durations.get(worker, _Histogram(buckets=[0] * len(_BACKGROUND_WORKER_DURATION_BUCKETS)))
            base = {"worker": worker}
            for upper_bound, count in zip(
                _BACKGROUND_WORKER_DURATION_BUCKETS,
                histogram.buckets,
                strict=True,
            ):
                lines.append("matrix_law_background_worker_batch_duration_seconds_bucket" + _labels(**base, le=f"{upper_bound:g}") + f" {count}")
            lines.append("matrix_law_background_worker_batch_duration_seconds_bucket" + _labels(**base, le="+Inf") + f" {histogram.count}")
            lines.append("matrix_law_background_worker_batch_duration_seconds_sum" + _labels(**base) + f" {histogram.total:.9f}")
            lines.append("matrix_law_background_worker_batch_duration_seconds_count" + _labels(**base) + f" {histogram.count}")

        lines.extend(
            (
                "# HELP deerflow_gateway_http_request_duration_seconds End-to-end Gateway HTTP request duration.",
                "# TYPE deerflow_gateway_http_request_duration_seconds histogram",
            )
        )
        for (method, route, response_kind), histogram in sorted(durations.items()):
            base = {"method": method, "route": route, "response_kind": response_kind}
            for upper_bound, count in zip(
                self.duration_buckets,
                histogram.buckets,
                strict=True,
            ):
                lines.append("deerflow_gateway_http_request_duration_seconds_bucket" + _labels(**base, le=f"{upper_bound:g}") + f" {count}")
            lines.append("deerflow_gateway_http_request_duration_seconds_bucket" + _labels(**base, le="+Inf") + f" {histogram.count}")
            lines.append("deerflow_gateway_http_request_duration_seconds_sum" + _labels(**base) + f" {histogram.total:.9f}")
            lines.append("deerflow_gateway_http_request_duration_seconds_count" + _labels(**base) + f" {histogram.count}")
        return "\n".join(lines) + "\n"


class GatewayMetricsMiddleware:
    """Measure full HTTP responses without retaining request identities."""

    def __init__(self, app: ASGIApp, *, registry: GatewayMetricsRegistry) -> None:
        self.app = app
        self.registry = registry

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") == METRICS_PATH:
            await self.app(scope, receive, send)
            return

        self.registry.begin_request()
        started = time.perf_counter()
        status = 500
        response_kind = "request"

        async def capture_status(message: Message) -> None:
            nonlocal status, response_kind
            if message["type"] == "http.response.start":
                status = int(message["status"])
                response_kind = _response_kind(message)
            await send(message)

        try:
            await self.app(scope, receive, capture_status)
        finally:
            self.registry.finish_request(
                method=_method(scope),
                route=_route_template(scope),
                response_kind=response_kind,
                status=status,
                duration_seconds=time.perf_counter() - started,
            )
