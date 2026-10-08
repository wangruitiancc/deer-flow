"""Task-scoped write gating for persistent stream publications."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from deerflow_extension_api import TaskWriteGate

from deerflow.runtime.stream_bridge.base import StreamBridge, StreamItem


class WriteGatedStreamBridge(StreamBridge):
    """Run content publications under an extension-owned tenant write gate.

    The end marker is control flow needed to release stream consumers; it does
    not contain conversation content and remains publishable after a freeze.
    """

    def __init__(self, delegate: StreamBridge, gate: TaskWriteGate) -> None:
        super().__init__(heartbeat_interval=delegate.heartbeat_interval)
        self._delegate = delegate
        self._gate = gate
        self.supports_cross_process = delegate.supports_cross_process

    async def publish(self, run_id: str, event: str, data: Any) -> None:
        async with self._gate.hold(operation="run_stream_publish"):
            await self._delegate.publish(run_id, event, data)

    async def publish_end(self, run_id: str) -> None:
        await self._delegate.publish_end(run_id)

    async def readiness_probe(self) -> bool:
        return await self._delegate.readiness_probe()

    def subscribe(
        self,
        run_id: str,
        *,
        last_event_id: str | None = None,
        heartbeat_interval: float | None = None,
    ) -> AsyncIterator[StreamItem]:
        return self._delegate.subscribe(
            run_id,
            last_event_id=last_event_id,
            heartbeat_interval=heartbeat_interval,
        )

    async def cleanup(self, run_id: str, *, delay: float = 0) -> None:
        await self._delegate.cleanup(run_id, delay=delay)

    async def export_unmapped_retained(
        self,
        known_run_ids: set[str],
        *,
        max_entries: int,
        max_streams: int,
        max_bytes: int,
        max_scan_batches: int = 2048,
    ) -> list[dict[str, Any]]:
        exporter = getattr(self._delegate, "export_unmapped_retained", None)
        if not callable(exporter):
            raise NotImplementedError("stream bridge does not support tenant-wide retained export")
        return await exporter(
            known_run_ids,
            max_entries=max_entries,
            max_streams=max_streams,
            max_bytes=max_bytes,
            max_scan_batches=max_scan_batches,
        )

    async def delete_retained_many_if_unchanged(
        self,
        expected_fingerprints: dict[str, str],
        *,
        max_entries: int,
        max_bytes: int,
    ) -> int:
        deleter = getattr(self._delegate, "delete_retained_many_if_unchanged", None)
        if not callable(deleter):
            raise NotImplementedError("stream bridge does not support compare-before-delete")
        return await deleter(
            expected_fingerprints,
            max_entries=max_entries,
            max_bytes=max_bytes,
        )

    async def close(self) -> None:
        await self._delegate.close()
