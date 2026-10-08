from __future__ import annotations

import hashlib
import http.client
import json
import threading
from pathlib import Path

from matrix_structure.config import Settings
from matrix_structure.server import build_server


class FakeBackend:
    model_version = "fake-structure-v1"

    def analyze(
        self, image_path: Path, *, enable_table: bool, enable_formula: bool
    ) -> dict[str, object]:
        assert image_path.stat().st_mode & 0o777 == 0o600
        return {
            "version": "matrix-structure-http-v1",
            "model_version": self.model_version,
            "width_pixels": 1,
            "height_pixels": 1,
            "blocks": [],
            "requested": [enable_table, enable_formula],
        }


def _server() -> tuple[object, threading.Thread, str]:
    token = "test-token-with-at-least-24-characters"
    settings = Settings(
        bind_host="127.0.0.1",
        port=0,
        token=token,
        max_upload_bytes=1024,
        cache_root=Path("/unused"),
        manifest_path=Path("/unused"),
        temp_root=None,
    )
    server = build_server(settings, FakeBackend())
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread, token


def test_health_requires_auth_and_reports_capabilities() -> None:
    server, thread, token = _server()
    try:
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        connection.request("GET", "/v1/structure/health")
        unauthorized = connection.getresponse()
        assert unauthorized.status == 401
        unauthorized.read()
        connection.request(
            "GET", "/v1/structure/health", headers={"Authorization": f"Bearer {token}"}
        )
        response = connection.getresponse()
        payload = json.loads(response.read())
        assert response.status == 200
        assert payload["capabilities"] == {
            "table_structure": True,
            "formula_structure": True,
        }
        assert response.getheader("Cache-Control") == "private, no-store"
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


def test_analyze_checks_digest_and_mode() -> None:
    server, thread, token = _server()
    body = b"not-a-real-image-for-the-fake-backend"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "image/png",
        "Content-Length": str(len(body)),
        "X-Structure-Source-SHA256": hashlib.sha256(body).hexdigest(),
        "X-Structure-Enable-Table": "true",
        "X-Structure-Enable-Formula": "false",
    }
    try:
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        connection.request("POST", "/v1/structure/analyze", body=body, headers=headers)
        response = connection.getresponse()
        payload = json.loads(response.read())
        assert response.status == 200
        assert payload["requested"] == [True, False]
        bad_headers = {**headers, "X-Structure-Source-SHA256": "0" * 64}
        connection.request("POST", "/v1/structure/analyze", body=body, headers=bad_headers)
        response = connection.getresponse()
        payload = json.loads(response.read())
        assert response.status == 400
        assert payload["error"]["code"] == "SOURCE_MISMATCH"
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()
