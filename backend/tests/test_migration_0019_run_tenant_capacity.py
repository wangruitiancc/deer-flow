"""Migration tests for Matrix Law run tenant capacity admission."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from sqlalchemy.ext.asyncio import create_async_engine

from deerflow.persistence.bootstrap import _MIGRATIONS_DIR

pytestmark = pytest.mark.asyncio

_REVISION = "0019_run_tenant_capacity"
_PREVIOUS = "0018_oauth_identity_pg_partial"
_COLUMN = "tenant_capacity_key"
_INDEX = "ix_runs_tenant_capacity_status"


def _alembic_config(db_url: str) -> AlembicConfig:
    config = AlembicConfig()
    config.set_main_option("script_location", str(_MIGRATIONS_DIR))
    config.set_main_option("sqlalchemy.url", db_url.replace("%", "%%"))
    return config


async def _shape(engine) -> tuple[set[str], set[str], str]:
    async with engine.connect() as connection:

        def inspect(sync_connection):
            inspector = sa.inspect(sync_connection)
            columns = {column["name"] for column in inspector.get_columns("runs")}
            indexes = {index["name"] for index in inspector.get_indexes("runs")}
            version = sync_connection.execute(sa.text("SELECT version_num FROM alembic_version")).scalar_one()
            return columns, indexes, version

        return await connection.run_sync(inspect)


async def test_tenant_capacity_migration_upgrade_downgrade_cycle(tmp_path: Path) -> None:
    db_path = tmp_path / "tenant-capacity.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    engine = create_async_engine(url)
    config = _alembic_config(url)
    try:
        await asyncio.to_thread(alembic_command.upgrade, config, _PREVIOUS)
        columns, indexes, version = await _shape(engine)
        assert _COLUMN not in columns
        assert _INDEX not in indexes
        assert version == _PREVIOUS

        await asyncio.to_thread(alembic_command.upgrade, config, _REVISION)
        columns, indexes, version = await _shape(engine)
        assert _COLUMN in columns
        assert _INDEX in indexes
        assert version == _REVISION

        await asyncio.to_thread(alembic_command.downgrade, config, _PREVIOUS)
        columns, indexes, version = await _shape(engine)
        assert _COLUMN not in columns
        assert _INDEX not in indexes
        assert version == _PREVIOUS

        await asyncio.to_thread(alembic_command.upgrade, config, _REVISION)
        columns, indexes, version = await _shape(engine)
        assert _COLUMN in columns
        assert _INDEX in indexes
        assert version == _REVISION
    finally:
        await engine.dispose()
