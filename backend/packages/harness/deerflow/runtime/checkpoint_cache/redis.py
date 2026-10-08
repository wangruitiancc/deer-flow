"""Shared Redis backend. Entries are immutable, so a multi-worker shared
cache needs no invalidation; the TTL is a leak safety net only.

Thread-scoped purge (``adelete_thread``) exists for data lifecycle: when a
thread's checkpoints are deleted, its cached history payloads are removed
immediately instead of lingering until TTL expiry.

The redis import is lazy (module is importable without the optional
``redis`` extra), mirroring runtime/stream_bridge/redis.py.
"""

from __future__ import annotations

import hashlib
import logging
import re
from typing import Any

from deerflow.runtime.checkpoint_cache.base import CheckpointCacheStats, thread_key_stem

logger = logging.getLogger(__name__)

REDIS_INSTALL = "redis is required for the redis checkpoint cache backend. Install it with: uv sync --extra redis"

_TAG_SEPARATOR = b"\x00"


def _create_client(redis_url: str, *, max_connections: int | None) -> Any:
    try:
        import redis.asyncio as redis_async
    except ImportError as exc:
        raise ImportError(REDIS_INSTALL) from exc
    kwargs: dict[str, Any] = {"decode_responses": False}
    if max_connections is not None:
        kwargs["max_connections"] = max_connections
    return redis_async.from_url(redis_url, **kwargs)


def _redis_error() -> type[Exception]:
    """Lazy RedisError import, mirroring the lazy client creation above."""
    try:
        from redis.exceptions import RedisError
    except ImportError as exc:
        raise ImportError(REDIS_INSTALL) from exc
    return RedisError


class RedisCheckpointHistoryCache:
    def __init__(
        self,
        redis_url: str,
        *,
        serde: Any,
        ttl_seconds: int,
        max_connections: int | None = None,
    ) -> None:
        self._client = _create_client(redis_url, max_connections=max_connections)
        self._serde = serde
        # ttl_seconds=0 is an explicit opt-out of expiry (no SETEX) — not the
        # default, and leaked/orphaned keys then rely on redis maxmemory only.
        self._ttl = ttl_seconds if ttl_seconds > 0 else None
        self._hits = 0
        self._misses = 0

    async def aget_many(self, keys: list[str]) -> dict[str, dict[str, Any]]:
        if not keys:
            return {}
        try:
            raws = await self._client.mget(keys)
        except _redis_error() as exc:
            # Performance-only bypass: a redis outage costs hits, never availability.
            logger.warning("checkpoint history cache mget failed; treating as all-miss: %s", exc)
            self._misses += len(keys)
            return {}
        found: dict[str, dict[str, Any]] = {}
        for key, raw in zip(keys, raws, strict=True):
            if raw is None:
                self._misses += 1
                continue
            self._hits += 1
            tag, payload = raw.split(_TAG_SEPARATOR, 1)
            found[key] = self._serde.loads_typed((tag.decode(), payload))
        return found

    async def aset_many(self, entries: dict[str, dict[str, Any]]) -> None:
        if not entries:
            return
        try:
            pipe = self._client.pipeline(transaction=False)
            for key, entry in entries.items():
                tag, data = self._serde.dumps_typed(entry)
                pipe.set(key, tag.encode() + _TAG_SEPARATOR + data, ex=self._ttl)
            await pipe.execute()
        except _redis_error() as exc:
            # Writes are optional; the next read simply recomputes the history.
            logger.warning("checkpoint history cache write failed; skipping: %s", exc)

    async def adelete_thread(self, key_prefix: str, thread_id: str) -> None:
        """SCAN+UNLINK every entry of one thread. Failure degrades to
        TTL-bounded residual retention; the source-of-truth delete already
        happened, so this never raises."""
        stem = thread_key_stem(key_prefix, thread_id)
        try:
            cursor = 0
            while True:
                cursor, keys = await self._client.scan(cursor=cursor, match=stem + "*", count=500)
                if keys:
                    await self._client.unlink(*keys)
                if cursor == 0:
                    break
        except _redis_error() as exc:
            logger.warning("checkpoint history cache thread purge failed; residual entries expire via TTL: %s", exc)

    async def inventory_namespace(
        self,
        key_prefix: str,
        *,
        max_keys: int,
        max_bytes: int,
        max_scan_batches: int = 2048,
    ) -> list[dict[str, Any]]:
        """Return a value-free, bounded compare-before-purge inventory.

        Cache payloads are derived from durable checkpoints and are not copied
        into exports. Keys are represented by digests so thread identifiers do
        not appear in the manifest. No key is deleted by this method.
        """
        if max_keys < 0 or max_bytes < 0:
            raise ValueError("inventory limits must be non-negative")
        if max_scan_batches < 1 or max_scan_batches > 2048:
            raise ValueError("checkpoint cache scan batch limit is invalid")
        if not key_prefix or re.fullmatch(r"[A-Za-z0-9:._-]+", key_prefix) is None:
            raise ValueError("checkpoint cache prefix is not a reviewed Redis glob")

        pattern = f"{key_prefix}:*"
        records: list[dict[str, Any]] = []
        byte_count = 0
        cursor = 0
        scan_batches = 0
        while True:
            cursor, raw_keys = await self._client.scan(cursor=cursor, match=pattern, count=500)
            for raw_key in raw_keys:
                key = raw_key if isinstance(raw_key, bytes) else str(raw_key).encode("utf-8")
                expected_prefix = key_prefix.encode("utf-8") + b":"
                if not key.startswith(expected_prefix):
                    raise ValueError("Redis SCAN returned a key outside the reviewed cache namespace")
                if len(records) >= max_keys:
                    raise ValueError("checkpoint cache inventory exceeds key limit")

                raw_type = await self._client.type(raw_key)
                key_type = raw_type.decode("utf-8") if isinstance(raw_type, bytes) else str(raw_type)
                if key_type.lower() != "string":
                    raise ValueError("checkpoint cache namespace contains an unreviewed key type")
                size = int(await self._client.strlen(raw_key))
                if size < 0 or byte_count + size > max_bytes:
                    raise ValueError("checkpoint cache inventory exceeds byte limit")
                value = await self._client.get(raw_key)
                if value is None:
                    raise ValueError("checkpoint cache key changed during inventory")
                if isinstance(value, str):
                    value = value.encode("utf-8")
                if not isinstance(value, bytes) or len(value) != size:
                    raise ValueError("checkpoint cache value changed during inventory")
                ttl_ms = int(await self._client.pttl(raw_key))
                if ttl_ms == -2 or ttl_ms < -2:
                    raise ValueError("checkpoint cache key changed during inventory")
                byte_count += size
                records.append(
                    {
                        "key_sha256": hashlib.sha256(key).hexdigest(),
                        "value_sha256": hashlib.sha256(value).hexdigest(),
                        "byte_size": size,
                        "ttl_ms": ttl_ms,
                        "purge_status": "planned_not_executed",
                    }
                )
            scan_batches += 1
            if cursor == 0:
                break
            if scan_batches >= max_scan_batches:
                raise ValueError("checkpoint cache inventory exceeds scan work limit")
        return records

    def stats(self) -> CheckpointCacheStats:
        return CheckpointCacheStats(hits=self._hits, misses=self._misses)

    async def aclose(self) -> None:
        await self._client.aclose()
