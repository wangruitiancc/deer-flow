"""Synthetic durable legal-delivery provider for commit/response fault tests."""

from __future__ import annotations

import hashlib
import json
import os
import socket
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

DB_PATH = Path(os.environ.get("PHASE10G_DB_PATH", "/state/provider.db"))


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS deliveries (
            idempotency_key TEXT PRIMARY KEY,
            payload_sha256 TEXT NOT NULL,
            response_json TEXT NOT NULL,
            response_dropped INTEGER NOT NULL DEFAULT 0,
            committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS attempts (
            attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
            idempotency_key TEXT NOT NULL,
            requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """
    )
    return connection


def canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


class Handler(BaseHTTPRequestHandler):
    server_version = "MatrixLawPhase10G/1.0"

    def log_message(self, format: str, *args: object) -> None:
        print(f"provider {self.address_string()} {format % args}", flush=True)

    def send_json(self, status: int, value: object, **headers: str) -> None:
        body = canonical_json(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for name, header_value in headers.items():
            self.send_header(name, header_value)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler contract
        path = urlparse(self.path).path
        if path == "/health":
            self.send_json(200, {"status": "healthy"})
            return
        if path.startswith("/state/"):
            key = unquote(path.removeprefix("/state/"))
            with connect() as connection:
                row = connection.execute(
                    "SELECT payload_sha256, response_json, response_dropped FROM deliveries WHERE idempotency_key = ?",
                    (key,),
                ).fetchone()
                attempts = connection.execute(
                    "SELECT COUNT(*) FROM attempts WHERE idempotency_key = ?",
                    (key,),
                ).fetchone()[0]
            self.send_json(
                200,
                {
                    "delivery_commit_count": 1 if row is not None else 0,
                    "request_attempt_count": attempts,
                    "response_dropped": bool(row["response_dropped"]) if row else False,
                    "response": json.loads(row["response_json"]) if row else None,
                },
            )
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler contract
        if urlparse(self.path).path != "/deliveries":
            self.send_json(404, {"error": "not_found"})
            return
        key = self.headers.get("Idempotency-Key", "")
        if not key or key != key.strip() or len(key) > 200:
            self.send_json(400, {"error": "invalid_idempotency_key"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "invalid_json"})
            return

        payload_hash = hashlib.sha256(canonical_json(payload)).hexdigest()
        should_drop = False
        replayed = False
        with connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("INSERT INTO attempts (idempotency_key) VALUES (?)", (key,))
            existing = connection.execute(
                "SELECT payload_sha256, response_json, response_dropped FROM deliveries WHERE idempotency_key = ?",
                (key,),
            ).fetchone()
            if existing is not None:
                if existing["payload_sha256"] != payload_hash:
                    connection.commit()
                    self.send_json(409, {"error": "idempotency_payload_conflict"})
                    return
                response_json = existing["response_json"]
                replayed = True
            else:
                delivery_id = "delivery-" + hashlib.sha256(key.encode()).hexdigest()[:20]
                response_json = canonical_json({"delivery_id": delivery_id, "status": "accepted"}).decode()
                should_drop = self.headers.get("X-Fault-After-Commit") == "1"
                connection.execute(
                    """
                    INSERT INTO deliveries (
                        idempotency_key, payload_sha256, response_json, response_dropped
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (key, payload_hash, response_json, int(should_drop)),
                )
            connection.commit()

        if should_drop:
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        self.send_json(
            200,
            json.loads(response_json),
            **{"Idempotency-Replayed": "true" if replayed else "false"},
        )


def main() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect():
        pass
    server = ThreadingHTTPServer(("0.0.0.0", 8080), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
