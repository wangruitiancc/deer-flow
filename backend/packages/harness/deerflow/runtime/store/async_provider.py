"""Async Store factory — backend mirrors runtime persistence configuration.

The deprecated ``checkpointer`` section takes precedence when present;
otherwise Store follows the unified ``database`` section in *config.yaml*:

- ``memory``   → :class:`langgraph.store.memory.InMemoryStore`
- ``sqlite``   → :class:`langgraph.store.sqlite.aio.AsyncSqliteStore`
- ``postgres`` → :class:`langgraph.store.postgres.aio.AsyncPostgresStore`

Usage (e.g. FastAPI lifespan)::

    from deerflow.runtime.store import make_store

    async with make_store() as store:
        app.state.store = store
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from langgraph.store.base import BaseStore

from deerflow.config.app_config import AppConfig, get_app_config
from deerflow.persistence.postgres_schema import dsn_with_search_path, ensure_postgres_schema_async, normalize_libpq_dsn
from deerflow.runtime.store.provider import (
    POSTGRES_CONN_REQUIRED,
    POSTGRES_STORE_INSTALL,
    SQLITE_STORE_INSTALL,
    _resolve_store_config,
    ensure_sqlite_parent_dir,
    resolve_sqlite_conn_str,
)

logger = logging.getLogger(__name__)

# Distinct from the checkpointer migration lock. LangGraph's Store setup also
# uses a read-then-DDL migration sequence and is not safe when multiple Gateway
# processes perform a cold start against the same empty database.
_POSTGRES_STORE_SETUP_LOCK_KEY = 0x3D33F10C5A17E002


async def _ensure_postgres_schema(conn_string: str, schema: str) -> None:
    """Create the configured schema before LangGraph creates its store tables."""
    await ensure_postgres_schema_async(conn_string, schema, install_hint=POSTGRES_STORE_INSTALL)


@contextlib.asynccontextmanager
async def _postgres_setup_lock_connection(conn_string: str) -> AsyncIterator[object]:
    """Open the dedicated autocommit session that owns the setup lock."""
    from psycopg import AsyncConnection

    connection = await AsyncConnection.connect(normalize_libpq_dsn(conn_string), autocommit=True)
    async with connection:
        yield connection


async def _assert_postgres_store_ready(store: BaseStore, conn_string: str) -> None:
    """Verify LangGraph Store tables and migration head with read-only SQL."""
    async with _postgres_setup_lock_connection(conn_string) as connection:
        result = await connection.execute(
            """
            SELECT
                to_regclass('store_migrations') IS NOT NULL AS migrations,
                to_regclass('store') IS NOT NULL AS store
            """
        )
        row = await result.fetchone()
        values = dict(row) if isinstance(row, dict) else dict(zip(("migrations", "store"), row, strict=True))
        if not all(values.values()):
            raise RuntimeError(
                "LangGraph Store schema is missing; run the explicit database migration command before starting the Gateway"
            )
        result = await connection.execute("SELECT max(v) AS version FROM store_migrations")
        version_row = await result.fetchone()
        version = version_row["version"] if isinstance(version_row, dict) else version_row[0]
    expected = len(store.MIGRATIONS) - 1
    if version != expected:
        raise RuntimeError(
            f"LangGraph Store migration head mismatch (expected {expected}); run the explicit database migration command before starting the Gateway"
        )


async def _setup_postgres_store(store: BaseStore, conn_string: str, *, auto_migrate: bool = True) -> None:
    """Serialise LangGraph Store migrations without blocking a transaction.

    ``AsyncPostgresStore.setup()`` may create indexes concurrently. A blocking
    advisory-lock query in another Gateway would leave its virtual transaction
    active and can deadlock that DDL, so contenders poll
    ``pg_try_advisory_lock`` from an autocommit session instead.
    """
    if not auto_migrate:
        await _assert_postgres_store_ready(store, conn_string)
        return

    async with _postgres_setup_lock_connection(conn_string) as connection:
        while True:
            cursor = await connection.execute(
                "SELECT pg_try_advisory_lock(%s)",
                (_POSTGRES_STORE_SETUP_LOCK_KEY,),
            )
            row = await cursor.fetchone()
            acquired = bool(next(iter(row.values()))) if isinstance(row, dict) else bool(row[0])
            if acquired:
                break
            await asyncio.sleep(0.05)
        try:
            logger.info(
                "store: acquired postgres setup lock key=0x%x",
                _POSTGRES_STORE_SETUP_LOCK_KEY,
            )
            await store.setup()
        finally:
            try:
                await connection.execute(
                    "SELECT pg_advisory_unlock(%s)",
                    (_POSTGRES_STORE_SETUP_LOCK_KEY,),
                )
            except Exception:  # noqa: BLE001
                logger.warning(
                    "store: pg_advisory_unlock raised; session close will release",
                    exc_info=True,
                )


# ---------------------------------------------------------------------------
# Internal backend factory
# ---------------------------------------------------------------------------


@contextlib.asynccontextmanager
async def _async_store(config, *, auto_migrate: bool = True) -> AsyncIterator[BaseStore]:
    """Async context manager that constructs and tears down a Store.

    The ``config`` argument is a :class:`deerflow.config.checkpointer_config.CheckpointerConfig`
    instance — the same object used by the checkpointer factory.
    """
    if config.type == "memory":
        from langgraph.store.memory import InMemoryStore

        logger.info("Store: using InMemoryStore (in-process, not persistent)")
        yield InMemoryStore()
        return

    if config.type == "sqlite":
        if not auto_migrate:
            raise RuntimeError("Explicit migration mode currently requires PostgreSQL persistence")
        try:
            from langgraph.store.sqlite.aio import AsyncSqliteStore
        except ImportError as exc:
            raise ImportError(SQLITE_STORE_INSTALL) from exc

        conn_str = resolve_sqlite_conn_str(config.connection_string or "store.db")
        await asyncio.to_thread(ensure_sqlite_parent_dir, conn_str)

        async with AsyncSqliteStore.from_conn_string(conn_str) as store:
            await store.setup()
            logger.info("Store: using AsyncSqliteStore (%s)", conn_str)
            yield store
        return

    if config.type == "postgres":
        try:
            from langgraph.store.postgres.aio import AsyncPostgresStore  # type: ignore[import]
        except ImportError as exc:
            raise ImportError(POSTGRES_STORE_INSTALL) from exc

        if not config.connection_string:
            raise ValueError(POSTGRES_CONN_REQUIRED)

        if auto_migrate:
            await _ensure_postgres_schema(config.connection_string, config.postgres_schema)
        conn_string = dsn_with_search_path(config.connection_string, config.postgres_schema)
        async with AsyncPostgresStore.from_conn_string(conn_string) as store:
            await _setup_postgres_store(store, conn_string, auto_migrate=auto_migrate)
            logger.info("Store: using AsyncPostgresStore")
            yield store
        return

    raise ValueError(f"Unknown store backend type: {config.type!r}")


# ---------------------------------------------------------------------------
# Public async context manager
# ---------------------------------------------------------------------------


@contextlib.asynccontextmanager
async def make_store(app_config: AppConfig | None = None, *, auto_migrate: bool | None = None) -> AsyncIterator[BaseStore]:
    """Yield a Store selected from legacy or unified persistence config.

    The legacy ``checkpointer`` section takes precedence when configured;
    otherwise the unified ``database`` section selects the backend, matching
    :func:`deerflow.runtime.checkpointer.async_provider.make_checkpointer`::

        async with make_store(app_config) as store:
            app.state.store = store

    An :class:`~langgraph.store.memory.InMemoryStore` is returned only when the
    resolved backend is explicitly ``memory``.
    """
    if app_config is None:
        app_config = get_app_config()

    config = _resolve_store_config(app_config)
    if auto_migrate is None:
        auto_migrate = getattr(app_config.database, "auto_migrate", True)
    async with _async_store(config, auto_migrate=auto_migrate) as store:
        yield store
