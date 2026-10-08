"""Runtime dependency checks exposed by the Gateway readiness endpoint."""

from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient


def test_ready_rejects_unavailable_stream_bridge_and_recovers(monkeypatch, tmp_path) -> None:
    marker = tmp_path / "gateway-draining"
    monkeypatch.setenv("DEER_FLOW_GATEWAY_DRAIN_MARKER", str(marker))

    from app.gateway.app import create_app

    class StreamBridgeProbe:
        available = False

        async def readiness_probe(self) -> bool:
            if self.available:
                return True
            raise RuntimeError("redis://private-host:6379/0 credential=must-not-leak")

    app = create_app()
    app.state.gateway_ready = True
    app.state.stream_bridge = StreamBridgeProbe()
    client = TestClient(app)

    unavailable = client.get("/ready")
    assert unavailable.status_code == 503
    assert unavailable.json() == {
        "status": "dependency_not_ready",
        "service": "deer-flow-gateway",
        "checks": {"stream_bridge": "unavailable"},
    }
    assert "private-host" not in unavailable.text
    assert "credential" not in unavailable.text
    assert client.get("/health").status_code == 200

    app.state.stream_bridge.available = True
    recovered = client.get("/ready")
    assert recovered.status_code == 200
    assert recovered.json()["status"] == "ready"
    assert recovered.json()["checks"] == {"stream_bridge": "ready"}


def test_ready_bounds_a_stalled_stream_bridge_probe(monkeypatch, tmp_path) -> None:
    marker = tmp_path / "gateway-draining"
    monkeypatch.setenv("DEER_FLOW_GATEWAY_DRAIN_MARKER", str(marker))

    from app.gateway.app import create_app

    class StalledStreamBridge:
        async def readiness_probe(self) -> bool:
            await asyncio.Event().wait()

    app = create_app()
    app.state.gateway_ready = True
    app.state.stream_bridge = StalledStreamBridge()
    response = TestClient(app).get("/ready")

    assert response.status_code == 503
    assert response.json()["checks"] == {"stream_bridge": "unavailable"}
    assert response.elapsed.total_seconds() < 1.0


def test_redis_stream_bridge_readiness_uses_ping_only() -> None:
    from deerflow.runtime.stream_bridge.redis import RedisStreamBridge

    class RedisPingClient:
        calls = 0

        async def ping(self) -> bool:
            self.calls += 1
            return True

    async def verify() -> None:
        redis = RedisPingClient()
        bridge = RedisStreamBridge(redis_url="redis://unused", client=redis)

        assert await bridge.readiness_probe() is True
        assert redis.calls == 1

    asyncio.run(verify())
