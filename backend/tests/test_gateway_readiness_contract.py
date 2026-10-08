"""Regression coverage for Gateway liveness, readiness, and Helm drain wiring."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[2]
CHART = REPO_ROOT / "deploy" / "helm" / "deer-flow"
GATEWAY_TEMPLATE = CHART / "templates" / "gateway-deployment.yaml"
VALUES = CHART / "values.yaml"


def _render_gateway(*settings: str) -> dict:
    helm = shutil.which("helm")
    if helm is None:
        pytest.skip("helm is unavailable")
    command = [helm, "template", "deer-flow", str(CHART)]
    for setting in settings:
        command.extend(["--set", setting])
    rendered = subprocess.run(command, check=True, capture_output=True, text=True).stdout
    documents = [document for document in yaml.safe_load_all(rendered) if isinstance(document, dict)]
    return next(document for document in documents if document.get("kind") == "Deployment" and document["metadata"]["name"].endswith("-gateway"))


def _render_documents(*settings: str) -> list[dict]:
    helm = shutil.which("helm")
    if helm is None:
        pytest.skip("helm is unavailable")
    command = [helm, "template", "deer-flow", str(CHART)]
    for setting in settings:
        command.extend(["--set", setting])
    rendered = subprocess.run(command, check=True, capture_output=True, text=True).stdout
    return [document for document in yaml.safe_load_all(rendered) if isinstance(document, dict)]


def test_gateway_readiness_is_fail_closed_and_drain_marker_aware(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    marker = tmp_path / "gateway-draining"
    monkeypatch.setenv("DEER_FLOW_GATEWAY_DRAIN_MARKER", str(marker))

    from app.gateway.app import create_app

    app = create_app()
    client = TestClient(app)

    assert client.get("/health").status_code == 200
    not_started = client.get("/ready")
    assert not_started.status_code == 503
    assert not_started.json()["status"] == "not_ready"

    app.state.gateway_ready = True
    assert client.get("/ready").status_code == 200

    marker.touch()
    draining = client.get("/ready")
    assert draining.status_code == 503
    assert draining.json()["status"] == "draining"
    assert client.get("/health").status_code == 200


def test_gateway_readiness_is_public() -> None:
    from app.gateway.auth_middleware import _is_public

    assert _is_public("/ready") is True
    assert _is_public("/readyevil") is False


def test_helm_gateway_uses_distinct_probes_exec_pid1_and_pre_stop_marker() -> None:
    deployment = _render_gateway("gateway.preStopSleepSeconds=7")
    pod_spec = deployment["spec"]["template"]["spec"]
    gateway = next(container for container in pod_spec["containers"] if container["name"] == "gateway")

    assert gateway["readinessProbe"]["httpGet"]["path"] == "/ready"
    assert gateway["readinessProbe"]["failureThreshold"] == 1
    assert gateway["livenessProbe"]["httpGet"]["path"] == "/health"

    launch = " ".join(gateway["args"])
    assert "exec env PYTHONPATH=. uv run --no-sync uvicorn" in launch

    pre_stop = gateway["lifecycle"]["preStop"]["exec"]["command"]
    assert pre_stop[:2] == ["sh", "-c"]
    assert "DEER_FLOW_GATEWAY_DRAIN_MARKER" in pre_stop[2]
    assert "sleep 7" in pre_stop[2]


def test_helm_gateway_can_disable_pre_stop_hook() -> None:
    deployment = _render_gateway("gateway.preStopSleepSeconds=0")
    pod_spec = deployment["spec"]["template"]["spec"]
    gateway = next(container for container in pod_spec["containers"] if container["name"] == "gateway")

    assert "lifecycle" not in gateway


def test_gateway_template_never_regresses_to_health_as_readiness() -> None:
    template = GATEWAY_TEMPLATE.read_text(encoding="utf-8")

    readiness = template.split("readinessProbe:", 1)[1].split("livenessProbe:", 1)[0]
    assert "path: /ready" in readiness
    assert "path: /health" not in readiness
    assert "exec env PYTHONPATH=. uv run --no-sync uvicorn" in template
    assert "DEER_FLOW_GATEWAY_DRAIN_MARKER" in template
    assert 'touch "$DEER_FLOW_GATEWAY_DRAIN_MARKER"' in template


def test_default_termination_budget_covers_drain_and_shutdown_windows() -> None:
    values = yaml.safe_load(VALUES.read_text(encoding="utf-8"))
    gateway = values["gateway"]

    assert gateway["preStopSleepSeconds"] >= 10
    # Default shutdown upper bounds: channel 5s + browser 5s + run drain 5s +
    # memory flush 30s, plus a 10s safety margin. preStop counts against the
    # same Kubernetes termination grace period.
    minimum = gateway["preStopSleepSeconds"] + 5 + 5 + 5 + 30 + 10
    assert gateway["terminationGracePeriodSeconds"] >= minimum


def test_helm_gateway_metrics_env_and_internal_scrape_annotations() -> None:
    documents = _render_documents()
    deployment = next(document for document in documents if document.get("kind") == "Deployment" and document["metadata"]["name"].endswith("-gateway"))
    gateway = next(container for container in deployment["spec"]["template"]["spec"]["containers"] if container["name"] == "gateway")
    env = {entry["name"]: entry.get("value") for entry in gateway["env"]}
    assert env["DEER_FLOW_METRICS_ENABLED"] == "true"

    service = next(document for document in documents if document.get("kind") == "Service" and document["metadata"]["name"] == "gateway")
    annotations = service["metadata"]["annotations"]
    assert annotations == {
        "prometheus.io/path": "/metrics",
        "prometheus.io/port": "8001",
        "prometheus.io/scrape": "true",
    }


def test_helm_config_enables_cluster_aware_run_capacity() -> None:
    documents = _render_documents()
    config_map = next(
        document
        for document in documents
        if document.get("kind") == "ConfigMap" and document["metadata"]["name"].endswith("-config")
    )
    config = yaml.safe_load(config_map["data"]["config.yaml"])

    assert config["config_version"] == 42
    assert config["database"]["backend"] == "postgres"
    assert config["run_capacity"] == {
        "max_active_global": 32,
        "max_active_per_tenant": 8,
        "max_active_per_user": 4,
        "retry_after_seconds": 5,
    }


def test_helm_metrics_crds_are_opt_in_and_render_bounded_alerts() -> None:
    defaults = _render_documents()
    assert not any(document.get("kind") in {"ServiceMonitor", "PrometheusRule"} for document in defaults)

    documents = _render_documents(
        "gateway.metrics.serviceMonitor.enabled=true",
        "gateway.metrics.prometheusRule.enabled=true",
    )
    monitor = next(document for document in documents if document.get("kind") == "ServiceMonitor")
    assert monitor["spec"]["endpoints"] == [
        {
            "port": "http",
            "path": "/metrics",
            "interval": "15s",
            "scrapeTimeout": "5s",
        }
    ]

    rule = next(document for document in documents if document.get("kind") == "PrometheusRule")
    rules = rule["spec"]["groups"][0]["rules"]
    assert {item["alert"] for item in rules} == {
        "DeerFlowGatewayHigh5xxRatio",
        "DeerFlowGatewayHighP99Latency",
        "DeerFlowGatewayNoAvailableReplicas",
    }
    expressions = "\n".join(item["expr"] for item in rules)
    assert "tenant" not in expressions
    assert "user_id" not in expressions
    assert "thread_id" not in expressions
    assert 'status_class="5xx"' in expressions
    assert "histogram_quantile" in expressions
    assert 'response_kind="request"' in expressions


def test_metrics_templates_statically_preserve_privacy_and_opt_in_crds() -> None:
    deployment = GATEWAY_TEMPLATE.read_text(encoding="utf-8")
    service_monitor = (CHART / "templates" / "gateway-servicemonitor.yaml").read_text(encoding="utf-8")
    prometheus_rule = (CHART / "templates" / "gateway-prometheusrule.yaml").read_text(encoding="utf-8")

    assert "DEER_FLOW_METRICS_ENABLED" in deployment
    assert "serviceMonitor.enabled" in service_monitor
    assert "prometheusRule.enabled" in prometheus_rule
    assert "histogram_quantile" in prometheus_rule
    assert 'response_kind="request"' in prometheus_rule
    assert "tenant_id" not in prometheus_rule
    assert "user_id" not in prometheus_rule
    assert "thread_id" not in prometheus_rule
