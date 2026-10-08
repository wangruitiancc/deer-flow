"""Gateway liveness/readiness state for orchestrated startup and draining."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from fastapi import FastAPI

DRAIN_MARKER_ENV = "DEER_FLOW_GATEWAY_DRAIN_MARKER"
DEFAULT_DRAIN_MARKER_PATH = "/tmp/deer-flow-gateway-draining"


def drain_marker_path() -> Path:
    """Return the operator-configured marker used by a preStop hook."""
    return Path(os.environ.get(DRAIN_MARKER_ENV, DEFAULT_DRAIN_MARKER_PATH))


def prepare_gateway_startup(app: FastAPI) -> None:
    """Fail closed until startup finishes and clear a stale local drain marker."""
    app.state.gateway_ready = False
    app.state.gateway_dependencies_ready = True
    drain_marker_path().unlink(missing_ok=True)


def mark_gateway_ready(app: FastAPI) -> None:
    """Admit the Gateway to load-balancer endpoints after startup succeeds."""
    app.state.gateway_dependencies_ready = True
    app.state.gateway_ready = True


def mark_gateway_not_ready(app: FastAPI) -> None:
    """Remove the Gateway from readiness before shutdown work begins."""
    app.state.gateway_ready = False


def gateway_readiness_status(app: FastAPI) -> str:
    """Return startup, dependency, or drain state without side effects."""
    lifecycle_status = gateway_lifecycle_status(app)
    if lifecycle_status != "ready":
        return lifecycle_status
    if not bool(getattr(app.state, "gateway_dependencies_ready", True)):
        return "dependency_not_ready"
    return "ready"


def gateway_lifecycle_status(app: FastAPI) -> str:
    """Return ``ready``, ``not_ready``, or ``draining`` from process state."""
    if not bool(getattr(app.state, "gateway_ready", False)):
        return "not_ready"
    if drain_marker_path().exists():
        return "draining"
    return "ready"


async def probe_gateway_dependencies(app: FastAPI) -> dict[str, str]:
    """Boundedly check configured runtime dependencies and store safe status."""
    stream_bridge = getattr(app.state, "stream_bridge", None)
    if stream_bridge is None:
        app.state.gateway_dependencies_ready = True
        app.state.gateway_dependency_checks = {}
        return {}

    probe = getattr(stream_bridge, "readiness_probe", None)
    if not callable(probe):
        available = False
    else:
        try:
            available = bool(await asyncio.wait_for(probe(), timeout=0.5))
        except Exception:
            available = False

    checks = {"stream_bridge": "ready" if available else "unavailable"}
    app.state.gateway_dependencies_ready = available
    app.state.gateway_dependency_checks = checks
    return checks
