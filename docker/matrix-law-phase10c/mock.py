"""Deterministic OpenAI-compatible model used by the Phase 10C failover test."""

from __future__ import annotations

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


MODEL_NAME = "phase10c-mock"
SLOW_MARKER = "PHASE10C_SLOW"
RECOVERY_MARKER = "PHASE10C_RECOVERY_OK"


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        del format, args

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"status": "ok"})
            return
        if self.path == "/v1/models":
            self._json(
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "id": MODEL_NAME,
                            "object": "model",
                            "owned_by": "matrix-law-phase10c",
                        }
                    ],
                },
            )
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/v1/chat/completions":
            self._json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(length) or b"{}")
        messages = request.get("messages", [])
        last_user_content = ""
        if isinstance(messages, list):
            for message in reversed(messages):
                if isinstance(message, dict) and message.get("role") in {
                    "user",
                    "human",
                }:
                    last_user_content = json.dumps(
                        message.get("content", ""), ensure_ascii=False
                    )
                    break
        slow = SLOW_MARKER in last_user_content
        content = (
            " ".join(f"phase10c-chunk-{index:02d}" for index in range(40))
            if slow
            else f"{RECOVERY_MARKER}: the replacement run completed on the surviving Gateway."
        )

        if request.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.end_headers()
            parts = content.split(" ") if slow else [content]
            try:
                for index, part in enumerate(parts):
                    chunk = {
                        "id": "phase10c-stream",
                        "object": "chat.completion.chunk",
                        "created": 1788520000,
                        "model": MODEL_NAME,
                        "choices": [
                            {
                                "index": 0,
                                "delta": {
                                    **({"role": "assistant"} if index == 0 else {}),
                                    "content": f"{part} ",
                                },
                                "finish_reason": None,
                            }
                        ],
                    }
                    self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                    self.wfile.flush()
                    if slow:
                        time.sleep(0.35)

                final_chunk = {
                    "id": "phase10c-stream",
                    "object": "chat.completion.chunk",
                    "created": 1788520000,
                    "model": MODEL_NAME,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                    "usage": {
                        "prompt_tokens": 16,
                        "completion_tokens": len(parts) * 2,
                        "total_tokens": 16 + len(parts) * 2,
                    },
                }
                self.wfile.write(("data: " + json.dumps(final_chunk) + "\n\n").encode())
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        self._json(
            200,
            {
                "id": "phase10c-response",
                "object": "chat.completion",
                "created": 1788520000,
                "model": MODEL_NAME,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": content},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 16,
                    "completion_tokens": 16,
                    "total_tokens": 32,
                },
            },
        )


ThreadingHTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
