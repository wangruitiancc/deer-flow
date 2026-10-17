"""Explicit isolated-PostgreSQL gate for operator-owned migration atomicity."""

from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine

pytestmark = pytest.mark.live


@pytest.mark.parametrize("fault_revision", ["0021_password_reset_outbox", "0022_password_reset_rate_limits"])
def test_operator_upgrade_rolls_back_ddl_and_marker_together(tmp_path, monkeypatch, fault_revision):
    raw = os.environ.get("DEERFLOW_TEST_POSTGRES_URL", "")
    assert raw, "Explicit disposable PostgreSQL URL is required"
    url = make_url(raw)
    assert url.host in {"127.0.0.1", "localhost"} and url.database == "matrix_law_test"
    assert url.drivername == "postgresql+asyncpg"
    config_file = tmp_path / "config.yaml"
    config_file.write_text("plugins: []\n")
    monkeypatch.setenv("DEER_FLOW_CONFIG_PATH", str(config_file))
    schema = "migration_atomic_" + uuid.uuid4().hex
    directory = Path(__file__).resolve().parents[1] / "packages/harness/deerflow/persistence/migrations"

    def upgrade(connection, revision):
        cfg = Config()
        cfg.set_main_option("script_location", str(directory))
        cfg.set_main_option("sqlalchemy.url", raw)
        cfg.set_main_option("deerflow_pg_schema", schema)
        cfg.attributes["connection"] = connection
        command.upgrade(cfg, revision)

    async def observe(connection):
        head = (await connection.exec_driver_sql(f'SELECT version_num FROM "{schema}".alembic_version')).scalar_one()
        tables = tuple((await connection.exec_driver_sql("SELECT tablename FROM pg_tables WHERE schemaname = '" + schema + "' ORDER BY tablename")).scalars())
        return head, tables

    async def run():
        engine = create_async_engine(raw)
        try:
            async with engine.begin() as connection:
                await connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
                await connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
                await connection.run_sync(lambda sync: upgrade(sync, "0020_admin_mfa"))
            async with engine.connect() as connection:
                before = await observe(connection)
            assert before[0] == "0020_admin_mfa"
            with pytest.raises(RuntimeError, match="synthetic migration fault"):
                async with engine.begin() as connection:
                    await connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
                    await connection.run_sync(lambda sync: upgrade(sync, fault_revision))
                    raise RuntimeError("synthetic migration fault")
            async with engine.connect() as connection:
                assert await observe(connection) == before
            async with engine.begin() as connection:
                await connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
                await connection.run_sync(lambda sync: upgrade(sync, "0022_password_reset_rate_limits"))
            async with engine.connect() as connection:
                after = await observe(connection)
            assert after[0] == "0022_password_reset_rate_limits"
            assert {"password_reset_outbox", "password_reset_rate_limits"} <= set(after[1])
            async with engine.begin() as connection:
                await connection.exec_driver_sql(f'SET LOCAL search_path TO "{schema}"')
                await connection.run_sync(lambda sync: upgrade(sync, "0022_password_reset_rate_limits"))
            async with engine.connect() as connection:
                assert await observe(connection) == after
        finally:
            async with engine.begin() as connection:
                await connection.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            await engine.dispose()

    asyncio.run(run())
