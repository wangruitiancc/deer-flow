"""Regression tests for concurrent PostgreSQL Store startup."""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest

from deerflow.runtime.store import async_provider


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


@pytest.fixture
def lock_connection(monkeypatch: pytest.MonkeyPatch) -> _FakeConnection:
    connection = _FakeConnection()

    @asynccontextmanager
    async def fake_connection(_conn_string: str):
        yield connection

    monkeypatch.setattr(async_provider, "_postgres_setup_lock_connection", fake_connection)
    return connection


@pytest.mark.asyncio
async def test_postgres_store_setup_is_guarded_by_session_advisory_lock(
    lock_connection: _FakeConnection,
) -> None:
    store = AsyncMock()

    await async_provider._setup_postgres_store(store, "postgresql://example")

    statements = [statement for statement, _ in lock_connection.executed]
    assert "pg_try_advisory_lock" in statements[0]
    assert "pg_try_advisory_lock" in statements[1]
    assert "pg_advisory_unlock" in statements[-1]
    store.setup.assert_awaited_once()


@pytest.mark.asyncio
async def test_postgres_store_setup_unlocks_after_failure(
    lock_connection: _FakeConnection,
) -> None:
    store = AsyncMock()
    store.setup.side_effect = RuntimeError("setup failed")

    with pytest.raises(RuntimeError, match="setup failed"):
        await async_provider._setup_postgres_store(store, "postgresql://example")

    statements = [statement for statement, _ in lock_connection.executed]
    assert "pg_try_advisory_lock" in statements[-2]
    assert "pg_advisory_unlock" in statements[-1]


@pytest.mark.asyncio
async def test_postgres_store_read_only_mode_checks_head_without_ddl(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _ReadinessConnection:
        def __init__(self) -> None:
            self.executed: list[str] = []

        async def execute(self, statement: str, _params: object | None = None):
            self.executed.append(statement)

            class _Result:
                async def fetchone(self):
                    if "to_regclass" in statement:
                        return {"migrations": True, "store": True}
                    return {"version": 3}

            return _Result()

    connection = _ReadinessConnection()

    @asynccontextmanager
    async def fake_connection(_conn_string: str):
        yield connection

    monkeypatch.setattr(async_provider, "_postgres_setup_lock_connection", fake_connection)
    store = AsyncMock()
    store.MIGRATIONS = list(range(4))

    await async_provider._setup_postgres_store(store, "postgresql://example", auto_migrate=False)

    assert len(connection.executed) == 2
    assert all("SELECT" in statement for statement in connection.executed)
    store.setup.assert_not_awaited()
