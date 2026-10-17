"""Operator migrations must retain the caller's connection and transaction."""

from __future__ import annotations

import asyncio
import runpy
from contextlib import nullcontext
from pathlib import Path

from alembic.config import Config


def test_injected_connection_runs_inside_the_existing_event_loop(monkeypatch):
    from alembic import context
    from sqlalchemy.ext import asyncio as sqlalchemy_asyncio

    from deerflow.persistence.migrations import _env_filters

    connection = object()
    config = Config()
    config.attributes["connection"] = connection
    events = []
    monkeypatch.setattr(context, "config", config, raising=False)
    monkeypatch.setattr(context, "is_offline_mode", lambda: False)
    monkeypatch.setattr(context, "configure", lambda **kwargs: events.append(("configure", kwargs)))
    monkeypatch.setattr(context, "begin_transaction", nullcontext)
    monkeypatch.setattr(context, "run_migrations", lambda: events.append(("upgrade", None)))
    monkeypatch.setattr(_env_filters, "register_configured_extension_table_prefixes", lambda: set())

    def unexpected_engine(*args, **kwargs):
        raise AssertionError("An injected migration must not open another engine")

    monkeypatch.setattr(sqlalchemy_asyncio, "create_async_engine", unexpected_engine)
    path = Path(__file__).resolve().parents[1] / "packages/harness/deerflow/persistence/migrations/env.py"

    async def invoke():
        runpy.run_path(str(path), run_name="injected_connection_migration_test")

    asyncio.run(invoke())
    assert events[0][0] == "configure"
    assert events[0][1]["connection"] is connection
    assert events[0][1]["render_as_batch"] is True
    assert events[-1] == ("upgrade", None)
