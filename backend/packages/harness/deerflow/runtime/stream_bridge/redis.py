"""Redis Streams-backed stream bridge."""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
import re
from collections.abc import AsyncIterator, Mapping
from typing import Any

try:
    from redis.asyncio import Redis
    from redis.exceptions import RedisError, ResponseError, WatchError
except ImportError:  # pragma: no cover - only hit when the optional extra is missing
    # ``redis`` is an optional extra (mirrors the ``postgres``/asyncpg path in
    # persistence/engine.py). This module is imported lazily from
    # ``make_stream_bridge`` only when ``stream_bridge.type == "redis"``, so the
    # hint surfaces exactly when a Redis bridge is requested without the package.
    raise ImportError(
        "stream_bridge.type is set to 'redis' but the redis package is not installed.\n"
        "Install it with:\n"
        "    cd backend && uv sync --all-packages --extra redis\n"
        "On the next `make dev` the redis extra is auto-detected from config.yaml\n"
        "(stream_bridge.type: redis) and reinstalled, so it will not be wiped again.\n"
        "Or switch to stream_bridge.type: memory in config.yaml for single-process deployment."
    ) from None

from .base import DEFAULT_HEARTBEAT_INTERVAL_SECONDS, END_SENTINEL, HEARTBEAT_SENTINEL, StreamBridge, StreamEvent, StreamGap, StreamItem

logger = logging.getLogger(__name__)

_KIND_EVENT = "event"
_KIND_END = "end"
_REDIS_STREAM_ID_RE = re.compile(r"\d+(-\d+)?")

# Batch size for ``XREAD``. Reading more than one entry per round-trip collapses
# a large ``Last-Event-ID`` replay into far fewer calls; live tailing still
# yields each event as it arrives because the consume loop returns mid-batch on
# the end marker.
_XREAD_COUNT = 64

# Maximum consecutive transient Redis errors (``ConnectionError``,
# ``TimeoutError``, etc.) tolerated during ``subscribe`` before the error
# propagates to the caller.  Brief blips are retried with exponential backoff
# capped at ``heartbeat_interval``.
_MAX_SUBSCRIBE_RETRIES = 3


class RedisStreamBridge(StreamBridge):
    """Per-run stream bridge backed by Redis Streams.

    Each run is stored in one Redis Stream and subscribers read directly with
    ``XREAD``.  This keeps the SSE bridge usable across multiple gateway
    worker processes while preserving ``Last-Event-ID`` replay semantics.
    """

    supports_cross_process = True

    def __init__(
        self,
        *,
        redis_url: str,
        queue_maxsize: int = 256,
        key_prefix: str = "deerflow:stream_bridge",
        heartbeat_interval: float = DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
        max_connections: int | None = None,
        stream_ttl_seconds: int | None = 86400,
        client: Redis | None = None,
    ) -> None:
        super().__init__(heartbeat_interval=heartbeat_interval)
        self._redis_url = redis_url
        self._maxsize = max(1, queue_maxsize)
        self._key_prefix = key_prefix.rstrip(":")
        if stream_ttl_seconds is not None and stream_ttl_seconds > 0:
            self._stream_ttl_seconds = stream_ttl_seconds
        else:
            self._stream_ttl_seconds = None
        # Each live SSE subscriber holds one pooled connection blocked in
        # ``XREAD ... BLOCK`` for up to ``heartbeat_interval``. ``max_connections``
        # caps that pool; ``None`` keeps redis-py's effectively-unbounded default.
        self._redis = client if client is not None else Redis.from_url(redis_url, decode_responses=True, max_connections=max_connections)
        self._owns_client = client is None

    def _stream_key(self, run_id: str) -> str:
        return f"{self._key_prefix}:{run_id}"

    async def _xadd_retained(self, key: str, fields: dict[str, str], *, maxlen: int) -> None:
        if self._stream_ttl_seconds is None:
            await self._redis.xadd(
                key,
                fields,
                maxlen=maxlen,
                approximate=False,
            )
            return

        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.xadd(
                key,
                fields,
                maxlen=maxlen,
                approximate=False,
            )
            pipe.expire(key, self._stream_ttl_seconds)
            await pipe.execute()

    @staticmethod
    def _decode(value: Any) -> str:
        if isinstance(value, bytes):
            return value.decode("utf-8")
        return str(value)

    @classmethod
    def _normalise_fields(cls, fields: Mapping[Any, Any]) -> dict[str, str]:
        return {cls._decode(key): cls._decode(value) for key, value in fields.items()}

    @staticmethod
    def _encode_data(data: Any) -> str:
        return json.dumps(data, default=str, ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def _decode_data(raw: str | None) -> Any:
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Redis stream bridge received non-JSON event data")
            return raw

    def _entry_from_redis(self, event_id: str, fields: Mapping[Any, Any]) -> StreamEvent:
        payload = self._normalise_fields(fields)
        kind = payload.get("kind", _KIND_EVENT)
        if kind == _KIND_END:
            return END_SENTINEL
        return StreamEvent(
            id=event_id,
            event=payload.get("event", "message"),
            data=self._decode_data(payload.get("data")),
        )

    @classmethod
    def _is_end_entry(cls, fields: Mapping[Any, Any]) -> bool:
        return cls._normalise_fields(fields).get("kind") == _KIND_END

    @staticmethod
    def _parse_stream_id(event_id: str) -> tuple[int, int] | None:
        if _REDIS_STREAM_ID_RE.fullmatch(event_id) is None:
            return None
        milliseconds, separator, sequence = event_id.partition("-")
        return int(milliseconds), int(sequence) if separator else 0

    @classmethod
    def _stream_id_lt(cls, left: str, right: str) -> bool:
        left_parts = cls._parse_stream_id(left)
        right_parts = cls._parse_stream_id(right)
        return left_parts is not None and right_parts is not None and left_parts < right_parts

    @classmethod
    def _response_tail_id(cls, response: list[Any]) -> str | None:
        for _stream_name, entries in reversed(response):
            if entries:
                return cls._decode(entries[-1][0])
        return None

    async def publish(self, run_id: str, event: str, data: Any) -> None:
        key = self._stream_key(run_id)
        await self._xadd_retained(
            key,
            {
                "kind": _KIND_EVENT,
                "event": event,
                "data": self._encode_data(data),
            },
            maxlen=self._maxsize,
        )

    async def publish_end(self, run_id: str) -> None:
        # Keep the configured number of data events plus the internal end marker.
        key = self._stream_key(run_id)
        await self._xadd_retained(
            key,
            {"kind": _KIND_END},
            maxlen=self._maxsize + 1,
        )

    async def stream_exists(self, run_id: str) -> bool:
        """Return whether Redis still has retained stream data for *run_id*."""
        return bool(await self._redis.exists(self._stream_key(run_id)))

    async def readiness_probe(self) -> bool:
        """Check Redis reachability without reading or writing application data."""
        return bool(await self._redis.ping())

    async def export_retained(self, run_id: str, *, max_entries: int, max_bytes: int) -> list[dict[str, Any]]:
        """Return a bounded snapshot of the currently retained entries for one run.

        Callers must derive ``run_id`` from an authorized durable record. This
        method deliberately does not enumerate Redis keys. Stream TTL/trim may
        have removed older history; the result is only the retained window.
        """
        if max_entries < 0 or max_bytes < 0:
            raise ValueError("export limits must be non-negative")
        key = self._stream_key(run_id)
        first = await self._redis.xrange(key, min="-", max="+", count=1)
        last = await self._redis.xrevrange(key, max="+", min="-", count=1)
        if not first and not last:
            return []
        if not first or not last:
            raise ValueError("retained stream changed during export")
        first_id = self._decode(first[0][0])
        tail_id = self._decode(last[0][0])

        exported: list[dict[str, Any]] = []
        used_bytes = 0
        cursor = "-"
        while True:
            raw_entries = await self._redis.xrange(key, min=cursor, max=tail_id, count=1)
            if not raw_entries:
                break
            raw_id, raw_fields = raw_entries[0]
            event_id = self._decode(raw_id)
            if len(exported) >= max_entries:
                raise ValueError("retained stream exceeds export entry limit")
            fields = self._normalise_fields(raw_fields)
            kind = fields.get("kind")
            if kind == _KIND_EVENT and set(fields) == {"kind", "event", "data"}:
                item = {
                    "id": event_id,
                    "event": fields["event"],
                    "data": self._decode_data(fields["data"]),
                }
            elif kind == _KIND_END and set(fields) == {"kind"}:
                item = {"id": event_id, "kind": "end"}
            else:
                raise ValueError("retained stream entry has an unreviewed shape")
            item_bytes = len(json.dumps(item, ensure_ascii=False, separators=(",", ":"), default=str).encode())
            if used_bytes + item_bytes > max_bytes:
                raise ValueError("retained stream exceeds export byte limit")
            exported.append(item)
            used_bytes += item_bytes
            cursor = f"({event_id}"

        first_after = await self._redis.xrange(key, min="-", max="+", count=1)
        if not first_after or self._decode(first_after[0][0]) != first_id:
            raise ValueError("retained stream changed during export")
        return exported

    async def delete_retained_many_if_unchanged(
        self,
        expected_fingerprints: Mapping[str, str],
        *,
        max_entries: int,
        max_bytes: int,
    ) -> int:
        """Atomically delete a bounded set of run streams after fingerprint checks.

        WATCH covers present and absent keys alike. Each stream is read again
        while the watched transaction is open, then all keys are deleted in
        one MULTI/EXEC so an interrupted tenant purge cannot leave a partial
        set behind.
        """
        if max_entries < 0 or max_bytes < 0:
            raise ValueError("delete limits must be non-negative")
        if any(not isinstance(run_id, str) or not run_id for run_id in expected_fingerprints):
            raise ValueError("run identifiers must not be blank")
        if any(re.fullmatch(r"[0-9a-f]{64}", digest) is None for digest in expected_fingerprints.values()):
            raise ValueError("retained stream fingerprints must be SHA-256 hex digests")
        run_ids = sorted(expected_fingerprints)
        if not run_ids:
            return 0

        keys = [self._stream_key(run_id) for run_id in run_ids]
        total_entries = 0
        total_bytes = 0
        try:
            async with self._redis.pipeline(transaction=True) as pipe:
                await pipe.watch(*keys)
                for run_id in run_ids:
                    entries = await self.export_retained(
                        run_id,
                        max_entries=max_entries - total_entries,
                        max_bytes=max_bytes - total_bytes,
                    )
                    encoded = (
                        json.dumps(
                            entries,
                            ensure_ascii=False,
                            sort_keys=True,
                            separators=(",", ":"),
                            allow_nan=False,
                            default=str,
                        )
                        + "\n"
                    ).encode("utf-8")
                    digest = hashlib.sha256(encoded).hexdigest()
                    if digest != expected_fingerprints[run_id]:
                        raise ValueError("retained stream fingerprint changed")
                    total_entries += len(entries)
                    total_bytes += len(encoded)
                    if total_entries > max_entries or total_bytes > max_bytes:
                        raise ValueError("retained streams exceed delete limits")

                pipe.multi()
                pipe.delete(*keys)
                await pipe.execute()
        except WatchError as exc:
            raise ValueError("retained stream fingerprint changed during delete") from exc
        return total_entries

    async def export_unmapped_retained(
        self,
        known_run_ids: set[str],
        *,
        max_entries: int,
        max_streams: int,
        max_bytes: int,
        max_scan_batches: int = 2048,
    ) -> list[dict[str, Any]]:
        """Export retained streams under this bridge prefix absent from durable run rows.

        This is tenant-wide recovery data, not matter attribution. Callers must
        only use it for an owner-authorized tenant export. Redis SCAN and stream
        reads are not atomic with the database or concurrent writers; the
        returned key fingerprints support a later compare-before-purge plan.
        """
        if max_entries < 0 or max_streams < 0 or max_bytes < 0:
            raise ValueError("export limits must be non-negative")
        if max_scan_batches < 1 or max_scan_batches > 2048:
            raise ValueError("unmapped Redis scan batch limit is invalid")

        pattern = f"{self._key_prefix}:*"
        records: list[dict[str, Any]] = []
        entries_used = 0
        bytes_used = 0
        seen_run_ids: set[str] = set()
        cursor = 0
        scan_batches = 0
        while True:
            cursor, raw_keys = await self._redis.scan(cursor=cursor, match=pattern, count=500)
            for raw_key in raw_keys:
                key = self._decode(raw_key)
                if not key.startswith(f"{self._key_prefix}:"):
                    raise ValueError("Redis SCAN returned a key outside the reviewed prefix")
                run_id = key[len(self._key_prefix) + 1 :]
                if not run_id:
                    raise ValueError("Redis stream key has no run identifier")
                if run_id in known_run_ids or run_id in seen_run_ids:
                    continue
                if len(records) >= max_streams:
                    raise ValueError("unmapped Redis streams exceed export limits")
                seen_run_ids.add(run_id)
                remaining_entries = max_entries - entries_used
                if remaining_entries < 0:
                    raise ValueError("unmapped Redis streams exceed export limits")

                raw_type = await self._redis.type(key)
                key_type = self._decode(raw_type).lower()
                if key_type != "stream":
                    raise ValueError("unmapped Redis prefix contains an unreviewed key type")
                entries = await self.export_retained(
                    run_id,
                    max_entries=remaining_entries,
                    max_bytes=max_bytes - bytes_used,
                )
                if not await self._redis.exists(key):
                    raise ValueError("unmapped Redis stream changed during export")
                entry_bytes = len(self._encode_data(entries).encode("utf-8"))
                entries_used += len(entries)
                bytes_used += entry_bytes
                if entries_used > max_entries or bytes_used > max_bytes:
                    raise ValueError("unmapped Redis streams exceed export limits")
                serialized_entries = self._encode_data(entries).encode("utf-8")
                records.append(
                    {
                        "run_id": run_id,
                        "entry_count": len(entries),
                        "entries": entries,
                        "purge_plan": {
                            "key_sha256": hashlib.sha256(key.encode("utf-8")).hexdigest(),
                            "expected_entry_count": len(entries),
                            "entries_sha256": hashlib.sha256(serialized_entries).hexdigest(),
                            "status": "planned_not_executed",
                        },
                    }
                )
            scan_batches += 1
            if cursor == 0:
                break
            if scan_batches >= max_scan_batches:
                raise ValueError("unmapped Redis scan exceeds scan work limit")
        return records

    async def _resolve_start_stream_id(self, key: str, last_event_id: str | None) -> str:
        if last_event_id is None:
            return "0-0"
        if _REDIS_STREAM_ID_RE.fullmatch(last_event_id):
            return last_event_id
        entries = await self._redis.xrevrange(key, count=1)
        if not entries:
            return "0-0"
        event_id, fields = entries[0]
        payload = self._normalise_fields(fields)
        if payload.get("kind") == _KIND_END:
            return "0-0"
        return self._decode(event_id)

    async def _read_retained_snapshot(
        self,
        key: str,
        stream_id: str,
    ) -> tuple[list[Any], list[Any], list[Any]]:
        """Atomically read retained bounds and entries after ``stream_id``.

        A blocking ``XREAD`` cannot participate in a Redis transaction. Live
        subscribers therefore use this non-blocking atomic snapshot for
        correctness, and a separate blocking read only as a wake-up signal.
        This deliberately adds a three-command pipeline per poll (and a second
        round trip while idle) so retained-bound checks cannot race with reads.
        """
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.xrange(key, count=1)
            pipe.xrevrange(key, count=1)
            pipe.xread({key: stream_id}, count=_XREAD_COUNT)
            earliest, latest, response = await pipe.execute()
        return earliest, latest, response

    async def subscribe(
        self,
        run_id: str,
        *,
        last_event_id: str | None = None,
        heartbeat_interval: float | None = None,
    ) -> AsyncIterator[StreamItem]:
        heartbeat_interval = self._resolve_heartbeat_interval(heartbeat_interval)
        key = self._stream_key(run_id)
        stream_id = await self._resolve_start_stream_id(key, last_event_id)
        gap_detection_enabled = last_event_id is not None and self._parse_stream_id(last_event_id) is not None
        pending_initial_response: list[Any] | None = None
        block_ms = max(1, int(heartbeat_interval * 1000)) if heartbeat_interval > 0 else 1
        consecutive_errors = 0

        while True:
            snapshot_stream_id = stream_id
            pending_initial_tail_id = None
            if pending_initial_response is not None:
                pending_initial_tail_id = self._response_tail_id(pending_initial_response)
                if pending_initial_tail_id is None:
                    pending_initial_response = None
                else:
                    # The first blocking XREAD began against a proven-empty
                    # stream. Its response is a provisional live baseline, not
                    # yet client-visible data. Validate that baseline against
                    # the retained watermark before yielding any of it.
                    snapshot_stream_id = pending_initial_tail_id

            try:
                earliest_entries, latest_entries, response = await self._read_retained_snapshot(key, snapshot_stream_id)
            except ResponseError:
                # Last-Event-ID is client-controlled and validated before XREAD.
                # If Redis still rejects the id, fail instead of resetting to
                # 0-0, which would replay the whole retained buffer on reconnect.
                logger.warning(
                    "Redis rejected stream id %r for stream bridge subscription",
                    snapshot_stream_id,
                    exc_info=True,
                )
                raise
            except RedisError:
                consecutive_errors += 1
                if consecutive_errors > _MAX_SUBSCRIBE_RETRIES:
                    raise
                delay = min(2**consecutive_errors, heartbeat_interval)
                logger.warning(
                    "Transient Redis error in stream bridge subscriber (retry %d/%d); backing off %.1fs",
                    consecutive_errors,
                    _MAX_SUBSCRIBE_RETRIES,
                    delay,
                    exc_info=True,
                )
                await asyncio.sleep(delay)
                continue
            else:
                # A non-empty snapshot is forward progress. For an empty
                # snapshot, keep any preceding wake-up failure count until the
                # blocking XREAD itself succeeds; otherwise a permanently
                # failing blocking read could retry forever because the
                # non-blocking transaction succeeds between attempts.
                if response:
                    consecutive_errors = 0

            if earliest_entries and (gap_detection_enabled or pending_initial_tail_id is not None):
                earliest_id = self._decode(earliest_entries[0][0])
                if self._stream_id_lt(snapshot_stream_id, earliest_id):
                    latest_id = self._decode(latest_entries[0][0])
                    logger.warning(
                        "subscriber for Redis stream %s fell behind retained history at %s",
                        key,
                        snapshot_stream_id,
                    )
                    yield StreamGap(
                        requested_event_id=None if pending_initial_tail_id is not None else stream_id,
                        earliest_available_event_id=earliest_id,
                        latest_available_event_id=latest_id,
                    )
                    return

            responses_to_process = []
            if pending_initial_response is not None:
                responses_to_process.append(pending_initial_response)
                pending_initial_response = None
            if response:
                responses_to_process.append(response)

            if not responses_to_process:
                if latest_entries and self._decode(latest_entries[0][0]) == stream_id and self._is_end_entry(latest_entries[0][1]):
                    yield END_SENTINEL
                    return

                try:
                    wake_response = await self._redis.xread(
                        {key: stream_id},
                        count=_XREAD_COUNT,
                        block=block_ms,
                    )
                except ResponseError:
                    logger.warning(
                        "Redis rejected stream id %r for stream bridge subscription",
                        stream_id,
                        exc_info=True,
                    )
                    raise
                except RedisError:
                    consecutive_errors += 1
                    if consecutive_errors > _MAX_SUBSCRIBE_RETRIES:
                        raise
                    delay = min(2**consecutive_errors, heartbeat_interval)
                    logger.warning(
                        "Transient Redis error in stream bridge subscriber (retry %d/%d); backing off %.1fs",
                        consecutive_errors,
                        _MAX_SUBSCRIBE_RETRIES,
                        delay,
                        exc_info=True,
                    )
                    await asyncio.sleep(delay)
                    continue
                else:
                    consecutive_errors = 0

                if not wake_response:
                    yield HEARTBEAT_SENTINEL
                elif last_event_id is None and not gap_detection_enabled and not earliest_entries:
                    # Do not discard the first wake-up from a proven-empty
                    # stream. Holding it until the next atomic bounds check
                    # gives no-cursor subscribers the same fell-behind signal
                    # as Memory without changing malformed-cursor live tailing.
                    pending_initial_response = wake_response
                continue

            for retained_response in responses_to_process:
                for _stream_name, entries in retained_response:
                    for event_id, fields in entries:
                        event_id = self._decode(event_id)
                        stream_id = event_id
                        gap_detection_enabled = True
                        entry = self._entry_from_redis(event_id, fields)
                        if entry is END_SENTINEL:
                            yield END_SENTINEL
                            return
                        yield entry

    async def cleanup(self, run_id: str, *, delay: float = 0) -> None:
        if delay > 0:
            await asyncio.sleep(delay)
        await self._redis.delete(self._stream_key(run_id))

    async def close(self) -> None:
        if not self._owns_client:
            return
        close = getattr(self._redis, "aclose", None) or getattr(self._redis, "close", None)
        if close is None:
            return
        result = close()
        if inspect.isawaitable(result):
            await result
