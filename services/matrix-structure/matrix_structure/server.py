from __future__ import annotations

import hashlib
import hmac
import json
import os
import tempfile
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Protocol

from matrix_structure import MODEL_VERSION, PROTOCOL_VERSION
from matrix_structure.assets import verify_assets
from matrix_structure.config import Settings


class Backend(Protocol):
    model_version: str

    def analyze(
        self, image_path: Path, *, enable_table: bool, enable_formula: bool
    ) -> dict[str, Any]: ...


class RequestError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class StructureServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], settings: Settings, backend: Backend) -> None:
        super().__init__(address, StructureRequestHandler)
        self.settings = settings
        self.backend = backend


class StructureRequestHandler(BaseHTTPRequestHandler):
    server: StructureServer

    def log_message(self, format: str, *args: object) -> None:
        return

    def do_GET(self) -> None:
        self._handle()

    def do_POST(self) -> None:
        self._handle()

    def _handle(self) -> None:
        request_id = str(uuid.uuid4())
        started = time.monotonic()
        status = 500
        error_code: str | None = None
        try:
            self._authenticate()
            if self.path == "/v1/structure/health":
                if self.command != "GET":
                    raise RequestError(405, "METHOD_NOT_ALLOWED", "Method not allowed")
                status = 200
                self._send_json(
                    status,
                    request_id,
                    {
                        "status": "ready",
                        "version": PROTOCOL_VERSION,
                        "model_version": self.server.backend.model_version,
                        "capabilities": {"table_structure": True, "formula_structure": True},
                    },
                )
                return
            if self.path != "/v1/structure/analyze":
                raise RequestError(404, "NOT_FOUND", "Route not found")
            if self.command != "POST":
                raise RequestError(405, "METHOD_NOT_ALLOWED", "Method not allowed")
            payload = self._analyze()
            status = 200
            self._send_json(status, request_id, payload)
        except RequestError as exc:
            status = exc.status
            error_code = exc.code
            self._send_json(
                status, request_id, {"error": {"code": exc.code, "message": str(exc)}}
            )
        except Exception:
            status = 500
            error_code = "STRUCTURE_FAILED"
            self._send_json(
                status,
                request_id,
                {"error": {"code": error_code, "message": "Structure analysis failed"}},
            )
        finally:
            event = {
                "request_id": request_id,
                "method": self.command,
                "path": self.path,
                "status": status,
                "duration_ms": round((time.monotonic() - started) * 1000),
            }
            if error_code:
                event["error_code"] = error_code
            print(json.dumps(event, separators=(",", ":")), flush=True)

    def _authenticate(self) -> None:
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {self.server.settings.token}"
        if not hmac.compare_digest(supplied.encode(), expected.encode()):
            raise RequestError(401, "UNAUTHORIZED", "Authentication required")

    def _required_header(self, name: str) -> str:
        value = self.headers.get(name, "").strip()
        if not value:
            raise RequestError(400, "INVALID_REQUEST", f"Missing {name} header")
        return value

    def _boolean_header(self, name: str) -> bool:
        value = self._required_header(name)
        if value == "true":
            return True
        if value == "false":
            return False
        raise RequestError(400, "INVALID_REQUEST", f"{name} must be true or false")

    def _analyze(self) -> dict[str, Any]:
        if self._required_header("Content-Type").lower() != "image/png":
            raise RequestError(415, "UNSUPPORTED_MEDIA_TYPE", "Only PNG pages are accepted")
        raw_length = self._required_header("Content-Length")
        if not raw_length.isascii() or not raw_length.isdigit():
            raise RequestError(413, "UPLOAD_LIMIT", "Structure source size is invalid")
        byte_size = int(raw_length)
        if byte_size < 1 or byte_size > self.server.settings.max_upload_bytes:
            raise RequestError(413, "UPLOAD_LIMIT", "Structure source size is invalid")
        expected_sha = self._required_header("X-Structure-Source-SHA256").lower()
        if len(expected_sha) != 64 or any(char not in "0123456789abcdef" for char in expected_sha):
            raise RequestError(400, "INVALID_REQUEST", "Structure source SHA-256 is invalid")
        enable_table = self._boolean_header("X-Structure-Enable-Table")
        enable_formula = self._boolean_header("X-Structure-Enable-Formula")
        if not enable_table and not enable_formula:
            raise RequestError(400, "INVALID_REQUEST", "At least one structure mode is required")
        data = self.rfile.read(byte_size)
        if len(data) != byte_size:
            raise RequestError(400, "SOURCE_MISMATCH", "Structure source size mismatch")
        if hashlib.sha256(data).hexdigest() != expected_sha:
            raise RequestError(400, "SOURCE_MISMATCH", "Structure source SHA-256 mismatch")
        directory = str(self.server.settings.temp_root) if self.server.settings.temp_root else None
        descriptor, raw_path = tempfile.mkstemp(
            prefix="matrix-structure-", suffix=".png", dir=directory
        )
        image_path = Path(raw_path)
        try:
            os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            return self.server.backend.analyze(
                image_path, enable_table=enable_table, enable_formula=enable_formula
            )
        finally:
            image_path.unlink(missing_ok=True)

    def _send_json(self, status: int, request_id: str, body: object) -> None:
        encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Request-ID", request_id)
        self.end_headers()
        self.wfile.write(encoded)


def build_server(settings: Settings, backend: Backend) -> StructureServer:
    return StructureServer((settings.bind_host, settings.port), settings, backend)


def main() -> None:
    settings = Settings.from_env()
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(settings.cache_root)
    os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "BOS")
    verify_assets(settings.cache_root, settings.manifest_path)
    from matrix_structure.backend import PaddleStructureBackend

    backend = PaddleStructureBackend(settings.cache_root)
    server = build_server(settings, backend)
    print(
        json.dumps(
            {
                "event": "ready",
                "bind_host": settings.bind_host,
                "port": settings.port,
                "version": PROTOCOL_VERSION,
                "model_version": MODEL_VERSION,
            },
            separators=(",", ":"),
        ),
        flush=True,
    )
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
