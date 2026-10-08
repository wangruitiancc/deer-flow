"""Exercise persisted Agent run recovery across an abrupt Gateway process loss.

This isolated W19 smoke uses a disposable SQLite home and synthetic model. It
starts a real Gateway process, blocks one run inside model generation, kills
that process, then starts a fresh Gateway process against the same state and
checks the durable run is terminalized before the new process serves it.

Run from ``backend/`` with the project virtualenv::

    .venv/bin/python tests/w19_gateway_process_crash_recovery.py
"""

from __future__ import annotations

import asyncio
import json
import multiprocessing
import os
import queue
import signal
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import httpx
from langchain_core.messages import AIMessage

_BACKEND_ROOT = Path(__file__).resolve().parents[1]
for _source_path in (
    _BACKEND_ROOT,
    _BACKEND_ROOT / "packages" / "harness",
    _BACKEND_ROOT / "packages" / "extension-api",
):
    sys.path.insert(0, str(_source_path))

from _agent_e2e_helpers import FakeToolCallingModel  # noqa: E402
from test_runtime_lifecycle_e2e import (  # noqa: E402
    _create_thread,
    _register_user,
    _run_body,
    _run_id_from_response,
)  # noqa: E402
from w19_gateway_process_benchmark import (  # noqa: E402
    _available_loopback_port,
    _prepare_app,
    _run_server,
    _synthetic_model_factory,
)


class _BlockedSyntheticModel(FakeToolCallingModel):
    """A deterministic model that holds the run open until its process dies."""

    def __init__(self, model_started: Any, release_model: Any) -> None:
        super().__init__(responses=[AIMessage(content="Synthetic crash-recovery response.")])
        self._model_started = model_started
        self._release_model = release_model

    async def ainvoke(self, *args: Any, **kwargs: Any) -> AIMessage:
        self._model_started.set()
        released = await asyncio.to_thread(self._release_model.wait, 120.0)
        if not released:
            raise TimeoutError("synthetic crash-recovery model release timed out")
        return await super().ainvoke(*args, **kwargs)


def _serve_gateway_process(
    temporary_root: str,
    process_slot: str,
    port: int,
    started: Any,
    stop: Any,
    *,
    block_model: bool,
    model_started: Any,
    release_model: Any,
) -> None:
    root = Path(temporary_root)
    app, monkeypatch = _prepare_app(root / process_slot)
    from deerflow.config import app_config as app_config_module

    app_config_module.get_app_config().database.sqlite_dir = str(root / "shared-db")
    from deerflow.agents.lead_agent import agent as lead_agent_module

    if block_model:

        def create_blocked_model(*args: Any, **kwargs: Any) -> _BlockedSyntheticModel:
            del args, kwargs
            return _BlockedSyntheticModel(model_started, release_model)

        monkeypatch.setattr(lead_agent_module, "create_chat_model", create_blocked_model)
    else:
        monkeypatch.setattr(lead_agent_module, "create_chat_model", _synthetic_model_factory)

    try:
        _run_server(app, port, started, stop)
    finally:
        monkeypatch.undo()


def _start_gateway(
    context: Any,
    manager: Any,
    temporary_root: Path,
    *,
    process_slot: str,
    block_model: bool,
) -> tuple[Any, int, Any, Any, Any]:
    slot_root = temporary_root / process_slot
    slot_root.mkdir(mode=0o700)
    port = _available_loopback_port()
    started = manager.Event()
    stop = manager.Event()
    model_started = manager.Event()
    release_model = manager.Event()
    process = context.Process(
        target=_serve_gateway_process,
        args=(str(temporary_root), process_slot, port, started, stop),
        kwargs={
            "block_model": block_model,
            "model_started": model_started,
            "release_model": release_model,
        },
        daemon=True,
    )
    process.start()
    if not started.wait(timeout=30):
        process.terminate()
        process.join(timeout=5)
        raise RuntimeError("isolated Gateway process did not complete startup")
    return process, port, stop, model_started, release_model


def _wait_for_run_status(
    client: httpx.Client,
    thread_id: str,
    run_id: str,
    expected: str,
    *,
    timeout: float = 10.0,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        response = client.get(f"/api/threads/{thread_id}/runs/{run_id}")
        if response.status_code != 200:
            raise RuntimeError(f"run status lookup failed with HTTP {response.status_code}")
        last = response.json()
        if last.get("status") == expected:
            return last
        time.sleep(0.05)
    raise RuntimeError(f"run did not reach {expected!r}; last status={last.get('status')!r}")


def run_crash_recovery_smoke() -> dict[str, Any]:
    try:
        context = multiprocessing.get_context("spawn")
    except ValueError as exc:  # pragma: no cover - unsupported process model
        raise RuntimeError("this diagnostic requires multiprocessing spawn support") from exc

    with context.Manager() as manager, tempfile.TemporaryDirectory(prefix="matrix-law-w19-gateway-crash-") as temporary:
        temporary_root = Path(temporary)
        temporary_root.chmod(0o700)
        process_a, port_a, stop_a, model_started, release_model = _start_gateway(
            context,
            manager,
            temporary_root,
            process_slot="gateway-a",
            block_model=True,
        )
        stream_finished = threading.Event()
        run_id_queue: queue.Queue[str | BaseException] = queue.Queue(maxsize=1)
        run_id: str | None = None
        thread_id: str | None = None
        cookies: dict[str, str] = {}
        try:
            with httpx.Client(base_url=f"http://127.0.0.1:{port_a}", timeout=10.0) as setup_client:
                csrf_token = _register_user(setup_client, email="w19-crash-recovery@example.com")
                thread_id = _create_thread(setup_client, csrf_token)
                cookies = dict(setup_client.cookies)

            def submit_blocked_run() -> None:
                try:
                    with httpx.Client(
                        base_url=f"http://127.0.0.1:{port_a}",
                        cookies=cookies,
                        timeout=httpx.Timeout(30.0),
                    ) as client:
                        with client.stream(
                            "POST",
                            f"/api/threads/{thread_id}/runs/stream",
                            json=_run_body(input={"messages": [{"role": "user", "content": "Synthetic process crash recovery"}]}),
                            headers={"X-CSRF-Token": csrf_token},
                        ) as response:
                            if response.status_code != 200:
                                raise RuntimeError(f"run admission returned HTTP {response.status_code}")
                            run_id_queue.put(_run_id_from_response(response))
                            for _chunk in response.iter_bytes():
                                pass
                except BaseException as exc:  # the expected result is connection loss after SIGKILL
                    if run_id_queue.empty():
                        run_id_queue.put(exc)
                finally:
                    stream_finished.set()

            stream_thread = threading.Thread(target=submit_blocked_run, daemon=True)
            stream_thread.start()
            run_result = run_id_queue.get(timeout=30)
            if isinstance(run_result, BaseException):
                raise RuntimeError("could not admit the synthetic blocked run") from run_result
            run_id = run_result
            if not model_started.wait(timeout=20):
                raise RuntimeError("synthetic model did not start before process termination")

            with httpx.Client(base_url=f"http://127.0.0.1:{port_a}", cookies=cookies, timeout=10.0) as client:
                active = _wait_for_run_status(client, thread_id, run_id, "running")
            if active.get("status") != "running":
                raise RuntimeError("the run was not durable as running before process termination")

            os.kill(process_a.pid, signal.SIGKILL)
            process_a.join(timeout=10)
            if process_a.is_alive():
                raise RuntimeError("crashed Gateway process did not exit after SIGKILL")
            if process_a.exitcode != -signal.SIGKILL:
                raise RuntimeError(f"Gateway process exited unexpectedly with code {process_a.exitcode}")
            stream_thread.join(timeout=5)
            if stream_thread.is_alive() or not stream_finished.is_set():
                raise RuntimeError("SSE client did not release after the Gateway process died")

            process_b, port_b, stop_b, _unused_model_started, _unused_release_model = _start_gateway(
                context,
                manager,
                temporary_root,
                process_slot="gateway-b",
                block_model=False,
            )
            try:
                with httpx.Client(base_url=f"http://127.0.0.1:{port_b}", cookies=cookies, timeout=10.0) as client:
                    recovered = _wait_for_run_status(client, thread_id, run_id, "error")
                    if recovered.get("stop_reason") != "orphan_recovered":
                        raise RuntimeError(f"recovered run has unexpected stop reason {recovered.get('stop_reason')!r}")
            finally:
                stop_b.set()
                process_b.join(timeout=10)
                if process_b.is_alive():
                    process_b.terminate()
                    process_b.join(timeout=5)

            return {
                "scope": "two real Uvicorn Gateway OS processes; disposable SQLite; synthetic blocked model; loopback HTTP",
                "first_process": "SIGKILL while a durable run was running",
                "recovery_process": "startup reconciled the orphan before serving the status request",
                "recovered_status": recovered.get("status"),
                "recovered_stop_reason": recovered.get("stop_reason"),
                "provider_calls": 0,
                "case_data": "none",
            }
        finally:
            if process_a.is_alive():
                stop_a.set()
                process_a.join(timeout=10)
            if process_a.is_alive():
                process_a.terminate()
                process_a.join(timeout=5)
            release_model.set()


if __name__ == "__main__":
    print("W19_GATEWAY_CRASH_RECOVERY=" + json.dumps(run_crash_recovery_smoke(), sort_keys=True))
