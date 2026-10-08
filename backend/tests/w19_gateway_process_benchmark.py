"""Run the W19 synthetic Agent benchmark through a separate Uvicorn process.

This is a local diagnostic, not a provider or production-capacity benchmark.
It boots a disposable Matrix-Law Gateway against temporary SQLite state and
replaces only model generation with the fixed-latency fake used by
``test_runtime_lifecycle_e2e``. All HTTP requests use loopback.

Run from ``backend/`` with the project virtualenv::

    .venv/bin/python tests/w19_gateway_process_benchmark.py
"""

from __future__ import annotations

import asyncio
import json
import multiprocessing
import os
import platform
import socket
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from importlib import import_module
from pathlib import Path
from typing import Any

import httpx
import pytest
import uvicorn

# A direct invocation of the project virtualenv does not add the repository's
# backend application and editable workspace packages to ``sys.path``.
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
for _source_path in (
    _BACKEND_ROOT,
    _BACKEND_ROOT / "packages" / "harness",
    _BACKEND_ROOT / "packages" / "extension-api",
):
    sys.path.insert(0, str(_source_path))

_runtime_test_helpers = import_module("test_runtime_lifecycle_e2e")
_MINIMAL_CONFIG_YAML = _runtime_test_helpers._MINIMAL_CONFIG_YAML
_SyntheticW19ChatModel = _runtime_test_helpers._SyntheticW19ChatModel
_create_thread = _runtime_test_helpers._create_thread
_drain_stream = _runtime_test_helpers._drain_stream
_parse_sse = _runtime_test_helpers._parse_sse
_preserve_process_config_singletons = _runtime_test_helpers._preserve_process_config_singletons
_register_user = _runtime_test_helpers._register_user
_reset_process_singletons = _runtime_test_helpers._reset_process_singletons
_run_body = _runtime_test_helpers._run_body
_run_id_from_response = _runtime_test_helpers._run_id_from_response


def _synthetic_model_factory(*args: Any, **kwargs: Any) -> _SyntheticW19ChatModel:
    del args, kwargs
    from langchain_core.messages import AIMessage

    return _SyntheticW19ChatModel(responses=[AIMessage(content="Synthetic W19 Agent response.")])


def _run_server(app: Any, port: int, started: Any, stop: Any) -> None:
    class _ReadyServer(uvicorn.Server):
        async def startup(self, sockets: list[socket.socket] | None = None) -> None:
            await super().startup(sockets=sockets)
            if self.started:
                started.set()

    server = _ReadyServer(
        uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            log_level="error",
            access_log=False,
            lifespan="on",
        )
    )

    async def serve_until_stopped() -> None:
        serving = asyncio.create_task(server.serve())
        await asyncio.to_thread(stop.wait)
        server.should_exit = True
        await serving

    asyncio.run(serve_until_stopped())


def _available_loopback_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _prepare_app(temp_root: Path) -> tuple[Any, pytest.MonkeyPatch]:
    home = temp_root / "deer-flow-home"
    home.mkdir(mode=0o700)
    config_path = temp_root / "config.yaml"
    config_path.write_text(_MINIMAL_CONFIG_YAML.replace("log_level: info", "log_level: error"), encoding="utf-8")
    extensions_path = temp_root / "extensions_config.json"
    extensions_path.write_text('{"mcpServers": {}, "skills": {}}', encoding="utf-8")

    os.environ.update(
        {
            "DEER_FLOW_HOME": str(home),
            "DEER_FLOW_CONFIG_PATH": str(config_path),
            "DEER_FLOW_EXTENSIONS_CONFIG_PATH": str(extensions_path),
            "OPENAI_API_KEY": "sk-w19-synthetic-model-not-used",
            "OPENAI_API_BASE": "https://example.invalid",
            "AUTH_JWT_SECRET": "w19-process-benchmark-only-secret-not-for-deployment",
        }
    )

    monkeypatch = pytest.MonkeyPatch()
    _preserve_process_config_singletons(monkeypatch)
    _reset_process_singletons(monkeypatch)

    from deerflow.config import app_config as app_config_module

    config = app_config_module.get_app_config()
    config.database.sqlite_dir = str(home / "db")

    from app.gateway.app import create_app
    from deerflow.agents.lead_agent import agent as lead_agent_module

    monkeypatch.setattr(lead_agent_module, "create_chat_model", _synthetic_model_factory)
    _SyntheticW19ChatModel.reset_counters()
    return create_app(), monkeypatch


def _run_benchmark(
    *, requests_per_stage: int = 8, concurrency_levels: tuple[int, ...] = (1, 2, 4, 8)
) -> dict[str, Any]:
    if requests_per_stage < 1 or not concurrency_levels:
        raise ValueError("requests per stage and concurrency levels must be positive")
    if any(level < 1 or level > requests_per_stage for level in concurrency_levels):
        raise ValueError("each concurrency level must be positive and cannot exceed requests per stage")
    if tuple(sorted(set(concurrency_levels))) != concurrency_levels:
        raise ValueError("concurrency levels must be unique and ascending")
    try:
        context = multiprocessing.get_context("fork")
    except ValueError as exc:  # pragma: no cover - unsupported process model
        raise RuntimeError("this diagnostic requires a local OS with multiprocessing fork support") from exc

    original_environment = {
        key: os.environ.get(key)
        for key in (
            "DEER_FLOW_HOME",
            "DEER_FLOW_CONFIG_PATH",
            "DEER_FLOW_EXTENSIONS_CONFIG_PATH",
            "OPENAI_API_KEY",
            "OPENAI_API_BASE",
            "AUTH_JWT_SECRET",
        )
    }
    with tempfile.TemporaryDirectory(prefix="matrix-law-w19-process-") as temporary:
        temp_root = Path(temporary)
        app, monkeypatch = _prepare_app(temp_root)
        port = _available_loopback_port()
        started = context.Event()
        stop = context.Event()
        process = context.Process(target=_run_server, args=(app, port, started, stop), daemon=True)
        process.start()
        base_url = f"http://127.0.0.1:{port}"
        try:
            if not started.wait(timeout=20):
                raise RuntimeError("Uvicorn worker process did not complete application startup")

            with httpx.Client(base_url=base_url, timeout=30.0) as setup_client:
                csrf_token = _register_user(setup_client, email="w19-process-synthetic@example.com")
                measured_runs = requests_per_stage * len(concurrency_levels)
                thread_ids = [_create_thread(setup_client, csrf_token) for _ in range(measured_runs + 1)]
                cookies = dict(setup_client.cookies)

            def run_one(index: int) -> dict[str, Any]:
                started_at = time.perf_counter()
                with httpx.Client(base_url=base_url, cookies=cookies, timeout=httpx.Timeout(30.0)) as client:
                    with client.stream(
                        "POST",
                        f"/api/threads/{thread_ids[index]}/runs/stream",
                        json=_run_body(
                            input={"messages": [{"role": "user", "content": f"Synthetic W19 process prompt {index}"}]}
                        ),
                        headers={"X-CSRF-Token": csrf_token},
                    ) as response:
                        if response.status_code != 200:
                            raise RuntimeError(f"run stream failed with HTTP {response.status_code}")
                        run_id = _run_id_from_response(response)
                        events = _parse_sse(_drain_stream(response, timeout=30.0))
                elapsed_ms = (time.perf_counter() - started_at) * 1000
                if [event.get("event") for event in events][-1:] != ["end"]:
                    raise RuntimeError("run stream ended without a terminal SSE event")
                if not any(
                    event.get("data", {}).get("messages", [{}])[-1].get("content") == "Synthetic W19 Agent response."
                    for event in events
                    if event.get("event") == "values"
                ):
                    raise RuntimeError("run stream did not contain the synthetic model response")
                return {"thread_id": thread_ids[index], "run_id": run_id, "duration_ms": elapsed_ms}

            def statuses_for(results: list[dict[str, Any]]) -> list[str | None]:
                with httpx.Client(base_url=base_url, cookies=cookies, timeout=10.0) as status_client:
                    statuses = []
                    for result in results:
                        status = status_client.get(
                            f"/api/threads/{result['thread_id']}/runs/{result['run_id']}"
                        )
                        if status.status_code != 200:
                            raise RuntimeError(f"run status check failed with HTTP {status.status_code}")
                        statuses.append(status.json().get("status"))
                return statuses

            def summarize_stage(level: int, results: list[dict[str, Any]], wall_ms: float) -> dict[str, Any]:
                latencies = sorted(float(result["duration_ms"]) for result in results)
                statuses = statuses_for(results)

                def percentile(fraction: float) -> float:
                    index = max(0, min(len(latencies) - 1, int(len(latencies) * fraction + 0.999999) - 1))
                    return round(latencies[index], 2)

                stage_summary = {
                    "requests": len(results),
                    "client_concurrency": level,
                    "successful_streams": sum(status == "success" for status in statuses),
                    "run_statuses": {value: statuses.count(value) for value in sorted(set(statuses))},
                    "wall_ms": round(wall_ms, 2),
                    "runs_per_second": round(len(results) * 1000 / wall_ms, 4),
                    "p50_ms": percentile(0.50),
                    "p95_ms": percentile(0.95),
                }
                if stage_summary["successful_streams"] != len(results):
                    raise RuntimeError(f"not all synthetic Gateway runs succeeded at concurrency {level}")
                return stage_summary

            # Warm the graph and SQLite path once; exclude this first run from
            # every measured stage so the curve is not dominated by startup.
            warmup = run_one(0)
            if statuses_for([warmup]) != ["success"]:
                raise RuntimeError("synthetic Gateway warmup did not succeed")

            stages = []
            next_index = 1
            for level in concurrency_levels:
                indexes = range(next_index, next_index + requests_per_stage)
                next_index += requests_per_stage
                started_at = time.perf_counter()
                results: list[dict[str, Any]] = []
                with ThreadPoolExecutor(max_workers=level) as pool:
                    futures = [pool.submit(run_one, index) for index in indexes]
                    for future in as_completed(futures):
                        results.append(future.result())
                wall_ms = (time.perf_counter() - started_at) * 1000
                stages.append(summarize_stage(level, results, wall_ms))

            summary = {
                "scope": "separate Uvicorn OS process; real loopback HTTP; synthetic local model only",
                "host": {
                    "system": platform.system(),
                    "machine": platform.machine(),
                    "python": platform.python_version(),
                    "logical_cpu_count": os.cpu_count(),
                },
                "warmup_runs_excluded": 1,
                "requests_per_stage": requests_per_stage,
                "concurrency_levels": list(concurrency_levels),
                "stages": stages,
                "measured_requests": measured_runs,
                "synthetic_model_delay_ms": 50,
                "provider_calls": 0,
                "case_data": "none",
            }
            return summary
        finally:
            stop.set()
            process.join(timeout=10)
            if process.is_alive():
                process.terminate()
                process.join(timeout=5)
            monkeypatch.undo()
            for key, value in original_environment.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
            if process.exitcode not in (0, None):
                raise RuntimeError(f"Uvicorn worker process exited with {process.exitcode}")


def main() -> None:
    summary = _run_benchmark()
    print("W19_PROCESS_AGENT_LOAD_SUMMARY=" + json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    main()
