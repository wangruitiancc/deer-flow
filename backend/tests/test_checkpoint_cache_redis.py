"""Redis backend and provider factory for the checkpoint history cache."""

import hashlib
from typing import Any

import pytest
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

from deerflow.config.app_config import AppConfig
from deerflow.runtime.checkpoint_cache.provider import (
    checkpoint_cache_db_hash,
    checkpoint_cache_key_prefix,
    inventory_checkpoint_cache_namespace,
    make_checkpoint_cache,
)


class _FakeRedis:
    """Minimal async redis stand-in: mget / set / pipeline / scan / unlink."""

    def __init__(self) -> None:
        self.store: dict[str, bytes] = {}
        self.ttls: dict[str, int | None] = {}
        self.unlinked: list[tuple[str, ...]] = []
        self.types: dict[str, str] = {}

    async def mget(self, keys: list[str]) -> list[bytes | None]:
        return [self.store.get(k) for k in keys]

    def set(self, key: str, value: bytes, ex: int | None = None) -> None:
        self.store[key] = value
        self.ttls[key] = ex

    async def scan(self, cursor: int = 0, match: str | None = None, count: int = 500) -> tuple[int, list[str]]:
        import fnmatch

        keys = sorted(self.store)
        batch = keys[cursor : cursor + count]
        if match is not None:
            batch = [k for k in batch if fnmatch.fnmatchcase(k, match)]
        next_cursor = cursor + count
        return (0 if next_cursor >= len(keys) else next_cursor), batch

    async def unlink(self, *keys: str) -> int:
        self.unlinked.append(tuple(keys))
        removed = 0
        for key in keys:
            removed += self.store.pop(key, None) is not None
        return removed

    async def scan_iter(self, *, match: str = "*", count: int = 500):
        cursor = 0
        while True:
            cursor, keys = await self.scan(cursor=cursor, match=match, count=count)
            for key in keys:
                yield key
            if cursor == 0:
                break

    async def type(self, key: str) -> str:
        return self.types.get(key, "string" if key in self.store else "none")

    async def strlen(self, key: str) -> int:
        return len(self.store[key]) if key in self.store else 0

    async def get(self, key: str) -> bytes | None:
        return self.store.get(key)

    async def pttl(self, key: str) -> int:
        if key not in self.store:
            return -2
        ttl = self.ttls.get(key)
        return -1 if ttl is None else ttl * 1000

    def pipeline(self, transaction: bool = False) -> "_FakePipeline":
        return _FakePipeline(self)

    async def aclose(self) -> None:
        pass


class _FakePipeline:
    def __init__(self, client: _FakeRedis) -> None:
        self._client = client

    def set(self, key: str, value: bytes, ex: int | None = None) -> "_FakePipeline":
        self._client.set(key, value, ex=ex)
        return self

    async def execute(self) -> None:
        pass


class _FailingRedis(_FakeRedis):
    """Simulates a redis outage: every operation raises RedisError."""

    async def mget(self, keys: list[str]) -> list[bytes | None]:
        from redis.exceptions import RedisError

        raise RedisError("connection refused")

    async def scan(self, cursor: int = 0, match: str | None = None, count: int = 500) -> tuple[int, list[str]]:
        from redis.exceptions import RedisError

        raise RedisError("connection refused")

    def pipeline(self, transaction: bool = False) -> "_FakePipeline":
        from redis.exceptions import RedisError

        raise RedisError("connection refused")


def _make_cache(monkeypatch: pytest.MonkeyPatch, fake: _FakeRedis, ttl_seconds: int = 60, **kwargs: Any):
    import deerflow.runtime.checkpoint_cache.redis as redis_mod

    monkeypatch.setattr(redis_mod, "_create_client", lambda *a, **k: fake)
    return redis_mod.RedisCheckpointHistoryCache("redis://unused", serde=JsonPlusSerializer(), ttl_seconds=ttl_seconds, **kwargs)


def _entry(i: int) -> dict:
    # Real message-like payloads to prove serde fidelity beyond plain dicts.
    from langchain_core.messages import AIMessage

    return {"writes": [("task-1", "messages", AIMessage(content=f"m{i}", id=f"ai-{i}"))], "seed": [AIMessage(content="s", id="ai-s")]}


# AppConfig requires the sandbox section (no default); the rest of the config
# is optional. Mirrors test_checkpoint_mode.py's construction pattern.
def _app_config(database: dict) -> AppConfig:
    return AppConfig.model_validate(
        {
            "sandbox": {"use": "deerflow.sandbox.local.provider:LocalSandboxProvider"},
            "database": database,
        }
    )


@pytest.mark.anyio
async def test_redis_roundtrip_preserves_types(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeRedis()
    cache = _make_cache(monkeypatch, fake)
    await cache.aset_many({"k1": _entry(1), "k2": {"writes": []}})
    hit = await cache.aget_many(["k1", "k2", "k3"])
    assert set(hit) == {"k1", "k2"}
    msg = hit["k1"]["writes"][0][2]
    assert msg.content == "m1" and msg.id == "ai-1" and msg.type == "ai"
    assert "seed" not in hit["k2"]
    assert cache.stats().hits == 2 and cache.stats().misses == 1


@pytest.mark.anyio
async def test_redis_keys_land_verbatim_and_ttl_set(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeRedis()
    cache = _make_cache(monkeypatch, fake)
    await cache.aset_many({"k1": _entry(1)})
    assert list(fake.store) == ["k1"]
    assert fake.ttls["k1"] == 60


@pytest.mark.anyio
async def test_redis_outage_degrades_to_all_miss(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    fake = _FailingRedis()
    cache = _make_cache(monkeypatch, fake)
    with caplog.at_level("WARNING"):
        assert await cache.aget_many(["k1", "k2"]) == {}
    assert cache.stats().misses == 2 and cache.stats().hits == 0
    assert "mget failed" in caplog.text


@pytest.mark.anyio
async def test_redis_outage_skips_write(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    fake = _FailingRedis()
    cache = _make_cache(monkeypatch, fake)
    with caplog.at_level("WARNING"):
        await cache.aset_many({"k1": _entry(1)})  # must not raise
    assert fake.store == {}
    assert "write failed" in caplog.text


@pytest.mark.anyio
async def test_zero_ttl_disables_expiry_explicitly(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeRedis()
    cache = _make_cache(monkeypatch, fake, ttl_seconds=0)
    await cache.aset_many({"k1": _entry(1)})
    assert cache._ttl is None
    assert fake.ttls["k1"] is None  # SET without EX: redis maxmemory policy only


@pytest.mark.anyio
async def test_adelete_thread_purges_matching_keys_only(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeRedis()
    cache = _make_cache(monkeypatch, fake)
    prefix = "ckpt-hist:v1:db0"
    await cache.aset_many(
        {
            f"{prefix}:t1:aaa": _entry(1),
            f"{prefix}:t1:bbb": _entry(2),
            f"{prefix}:t10:ccc": _entry(3),  # 't1' stem must not over-match 't10'
            f"{prefix}:t2:ddd": _entry(4),
        }
    )

    await cache.adelete_thread(prefix, "t1")

    assert sorted(fake.store) == [f"{prefix}:t10:ccc", f"{prefix}:t2:ddd"]
    assert fake.unlinked  # UNLINK, not DEL: non-blocking on big histories


@pytest.mark.anyio
async def test_inventory_namespace_returns_bounded_value_free_hashes(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeRedis()
    cache = _make_cache(monkeypatch, fake)
    prefix = "ckpt-hist:v1:db0"
    payload = b"synthetic checkpoint history"
    fake.store[f"{prefix}:thread-1:digest"] = payload
    fake.ttls[f"{prefix}:thread-1:digest"] = 60
    fake.store["other:thread-1:digest"] = b"unrelated"

    rows = await cache.inventory_namespace(prefix, max_keys=5, max_bytes=1024)
    assert rows == [
        {
            "key_sha256": hashlib.sha256(f"{prefix}:thread-1:digest".encode()).hexdigest(),
            "value_sha256": hashlib.sha256(payload).hexdigest(),
            "byte_size": len(payload),
            "ttl_ms": 60_000,
            "purge_status": "planned_not_executed",
        }
    ]
    assert "thread-1" not in str(rows)
    assert payload.decode() not in str(rows)
    with pytest.raises(ValueError, match="key limit"):
        await cache.inventory_namespace(prefix, max_keys=0, max_bytes=1024)
    with pytest.raises(ValueError, match="byte limit"):
        await cache.inventory_namespace(prefix, max_keys=5, max_bytes=1)


@pytest.mark.anyio
async def test_inventory_namespace_rejects_unreviewed_key_types(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeRedis()
    cache = _make_cache(monkeypatch, fake)
    key = "ckpt-hist:v1:db0:thread-1:digest"
    fake.store[key] = b"synthetic"
    fake.types[key] = "hash"

    with pytest.raises(ValueError, match="unreviewed key type"):
        await cache.inventory_namespace("ckpt-hist:v1:db0", max_keys=5, max_bytes=1024)


@pytest.mark.anyio
async def test_inventory_namespace_bounds_full_keyspace_scan_work(monkeypatch: pytest.MonkeyPatch):
    fake = _FakeRedis()
    cache = _make_cache(monkeypatch, fake)
    prefix = "ckpt-hist:v1:db0"
    fake.store.update({f"{prefix}:thread-{index}": b"x" for index in range(501)})

    with pytest.raises(ValueError, match="scan work limit"):
        await cache.inventory_namespace(
            prefix,
            max_keys=501,
            max_bytes=4096,
            max_scan_batches=1,
        )


@pytest.mark.anyio
async def test_provider_inventory_uses_same_redis_endpoint_as_cache_writer(
    monkeypatch: pytest.MonkeyPatch,
):
    import deerflow.runtime.checkpoint_cache.redis as redis_mod

    fake = _FakeRedis()
    seen_urls: list[str] = []
    monkeypatch.setattr(redis_mod, "_create_client", lambda url, **kwargs: (seen_urls.append(url), fake)[1])
    stream_url = "redis://private-user:private-password@tenant-redis:6379/0"
    monkeypatch.setenv("DEER_FLOW_STREAM_BRIDGE_REDIS_URL", stream_url)
    monkeypatch.delenv("DEER_FLOW_CHECKPOINT_CACHE_REDIS_URL", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    prefix = "ckpt-hist:v1:db0"
    fake.store[f"{prefix}:thread-1:digest"] = b"synthetic private history"
    app_config = AppConfig.model_validate(
        {
            "sandbox": {"use": "deerflow.sandbox.local.provider:LocalSandboxProvider"},
            "database": {
                "backend": "sqlite",
                "checkpoint_cache": {"type": "redis", "key_prefix": prefix},
            },
            "stream_bridge": {"type": "redis", "redis_url": stream_url},
        }
    )

    async with make_checkpoint_cache(app_config, serde=JsonPlusSerializer()):
        pass
    rows = await inventory_checkpoint_cache_namespace(app_config, max_keys=5, max_bytes=1024)

    assert seen_urls == ["redis://localhost:6379/0", "redis://localhost:6379/0"]
    assert len(rows) == 1
    assert "private-password" not in str(seen_urls)
    assert "thread-1" not in str(rows)


@pytest.mark.anyio
async def test_adelete_thread_outage_degrades_without_raising(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):
    fake = _FailingRedis()
    cache = _make_cache(monkeypatch, fake)
    with caplog.at_level("WARNING"):
        await cache.adelete_thread("p", "t1")  # must not raise
    assert "thread purge failed" in caplog.text


@pytest.mark.anyio
async def test_provider_memory_default():
    from deerflow.runtime.checkpoint_cache.memory import MemoryCheckpointHistoryCache

    async with make_checkpoint_cache(_app_config({"backend": "sqlite"}), serde=JsonPlusSerializer()) as cache:
        assert isinstance(cache, MemoryCheckpointHistoryCache)
        assert cache.enabled is True


@pytest.mark.anyio
async def test_provider_zero_max_entries_disables_any_type():
    app_config = _app_config({"backend": "sqlite", "checkpoint_cache": {"type": "redis", "max_entries": 0}})
    from deerflow.runtime.checkpoint_cache.memory import MemoryCheckpointHistoryCache

    async with make_checkpoint_cache(app_config, serde=JsonPlusSerializer()) as cache:
        assert isinstance(cache, MemoryCheckpointHistoryCache)
        assert cache.enabled is False


def test_db_hash_distinguishes_backends_and_targets():
    from deerflow.config.database_config import DatabaseConfig

    sqlite_cfg = DatabaseConfig.model_validate({"backend": "sqlite", "sqlite_dir": "/tmp/a"})
    pg_cfg = DatabaseConfig.model_validate({"backend": "postgres", "postgres_url": "postgresql://u:p@h/db"})
    pg_cfg2 = DatabaseConfig.model_validate({"backend": "postgres", "postgres_url": "postgresql://u:p@h/other"})
    assert checkpoint_cache_db_hash(sqlite_cfg) != checkpoint_cache_db_hash(pg_cfg)
    assert checkpoint_cache_db_hash(pg_cfg) != checkpoint_cache_db_hash(pg_cfg2)
    assert len(checkpoint_cache_db_hash(pg_cfg)) == 12


def test_db_hash_stable_across_credential_rotation():
    """Same database, rotated user/password -> same cache namespace."""
    from deerflow.config.database_config import DatabaseConfig

    before = DatabaseConfig.model_validate({"backend": "postgres", "postgres_url": "postgresql://alice:secret1@pg.internal:5432/deerflow"})
    rotated = DatabaseConfig.model_validate({"backend": "postgres", "postgres_url": "postgresql://bob:secret2@pg.internal:5432/deerflow"})
    driver_suffix = DatabaseConfig.model_validate({"backend": "postgres", "postgres_url": "postgresql+asyncpg://alice:secret1@pg.internal:5432/deerflow"})
    other_db = DatabaseConfig.model_validate({"backend": "postgres", "postgres_url": "postgresql://alice:secret1@pg.internal:5432/other"})
    assert checkpoint_cache_db_hash(before) == checkpoint_cache_db_hash(rotated)
    assert checkpoint_cache_db_hash(before) == checkpoint_cache_db_hash(driver_suffix)
    assert checkpoint_cache_db_hash(before) != checkpoint_cache_db_hash(other_db)


def test_db_hash_unparseable_url_falls_back_to_raw():
    from deerflow.config.database_config import DatabaseConfig

    cfg = DatabaseConfig.model_validate({"backend": "postgres", "postgres_url": "not-a-url"})
    assert len(checkpoint_cache_db_hash(cfg)) == 12  # stable, never raises


def test_key_prefix_override_wins():
    app_config = _app_config({"backend": "sqlite", "checkpoint_cache": {"key_prefix": "custom:"}})
    assert checkpoint_cache_key_prefix(app_config) == "custom:"
    default = checkpoint_cache_key_prefix(_app_config({"backend": "sqlite"}))
    assert default.startswith("ckpt-hist:v1:")
