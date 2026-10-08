"""Regression tests for concurrent PostgreSQL checkpointer startup."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from deerflow.runtime.checkpointer import async_provider


class _FakeConnection:
    def __init__(self) -> None:
        self.executed: list[tuple[str, object | None]] = []
        self.try_lock_results = iter([False, True])

    async def execute(self, statement: str, params: object | None = None):
        self.executed.append((statement, params))
        if "pg_try_advisory_lock" in statement:
            acquired = next(self.try_lock_results)

            class _Result:
                async def fetchone(self) -> tuple[bool]:
                    return (acquired,)

            return _Result()
        return None


class _ConnectionContext:
    def __init__(self, connection: _FakeConnection) -> None:
        self.connection = connection

    async def __aenter__(self) -> _FakeConnection:
        return self.connection

    async def __aexit__(self, *_exc_info: object) -> None:
        return None


class _FakePool:
    def __init__(self) -> None:
        self.connection_instance = _FakeConnection()

    def connection(self) -> _ConnectionContext:
        return _ConnectionContext(self.connection_instance)


@pytest.mark.asyncio
async def test_postgres_saver_setup_is_guarded_by_session_advisory_lock() -> None:
    pool = _FakePool()
    saver = AsyncMock()

    await async_provider._setup_postgres_saver(pool, saver, "deerflow")

    statements = [statement for statement, _ in pool.connection_instance.executed]
    assert statements[0] == 'CREATE SCHEMA IF NOT EXISTS "deerflow"'
    assert "pg_try_advisory_lock" in statements[1]
    assert "pg_try_advisory_lock" in statements[2]
    assert "pg_advisory_unlock" in statements[-1]
    saver.setup.assert_awaited_once()


@pytest.mark.asyncio
async def test_postgres_saver_setup_unlocks_after_failure() -> None:
    pool = _FakePool()
    saver = AsyncMock()
    saver.setup.side_effect = RuntimeError("setup failed")

    with pytest.raises(RuntimeError, match="setup failed"):
        await async_provider._setup_postgres_saver(pool, saver, "deerflow")

    statements = [statement for statement, _ in pool.connection_instance.executed]
    assert "pg_try_advisory_lock" in statements[-2]
    assert "pg_advisory_unlock" in statements[-1]


@pytest.mark.asyncio
async def test_postgres_saver_read_only_mode_checks_head_without_ddl() -> None:
    class _ReadinessConnection(_FakeConnection):
        async def execute(self, statement: str, params: object | None = None):
            self.executed.append((statement, params))

            class _Result:
                async def fetchone(self):
                    if "to_regclass" in statement:
                        return {"migrations": True, "checkpoints": True, "blobs": True, "writes": True}
                    return {"version": 9}

            return _Result()

    pool = _FakePool()
    connection = _ReadinessConnection()
    pool.connection_instance = connection
    saver = AsyncMock()
    saver.MIGRATIONS = list(range(10))

    await async_provider._setup_postgres_saver(pool, saver, "deerflow", auto_migrate=False)

    assert len(connection.executed) == 2
    assert all("SELECT" in statement for statement, _ in connection.executed)
    saver.setup.assert_not_awaited()
