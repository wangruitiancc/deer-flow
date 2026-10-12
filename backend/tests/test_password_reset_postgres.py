"""Live PostgreSQL coverage for W13 password-reset persistence primitives.

The test refuses non-loopback databases, credentials, and any database other
than the dedicated ephemeral ``deerflow_w13_auth_test`` database. The runner
creates that database in a loopback-only temporary PostgreSQL container.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from cryptography.fernet import Fernet
from sqlalchemy import select, text
from sqlalchemy.engine import make_url

from app.gateway.auth.config import AuthConfig
from app.gateway.auth.models import User
from app.gateway.auth.password_reset import allow_password_reset_request, password_reset_request_buckets
from app.gateway.auth.repositories.sqlite import SQLiteUserRepository
from deerflow.persistence.engine import close_engine, get_engine, get_session_factory, init_engine
from deerflow.persistence.user.model import PasswordResetOutboxRow, PasswordResetRateLimitRow

POSTGRES_URL = os.environ.get("DEERFLOW_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not POSTGRES_URL, reason="set DEERFLOW_TEST_POSTGRES_URL to run isolated W13 PostgreSQL auth tests")


def _async_url(url: str) -> str:
    parsed = make_url(url)
    if (
        parsed.drivername not in {"postgresql", "postgresql+asyncpg"}
        or parsed.username != "postgres"
        or parsed.password is not None
        or parsed.host not in {"127.0.0.1", "localhost", "::1"}
        or parsed.database != "deerflow_w13_auth_test"
        or parsed.query
    ):
        raise RuntimeError("Refusing W13 auth PostgreSQL test outside the dedicated loopback database")
    return parsed.set(drivername="postgresql+asyncpg").render_as_string(hide_password=False)


@pytest_asyncio.fixture
async def postgres_auth_repository():
    assert POSTGRES_URL is not None
    url = _async_url(POSTGRES_URL)
    schema = f"w13_auth_{uuid.uuid4().hex}"
    await init_engine("postgres", url=url, postgres_schema=schema, pool_size=24)
    session_factory = get_session_factory()
    assert session_factory is not None
    repository = SQLiteUserRepository(session_factory)
    try:
        yield repository, schema, url
    finally:
        await close_engine()
        from sqlalchemy.ext.asyncio import create_async_engine

        admin_engine = create_async_engine(url)
        try:
            async with admin_engine.begin() as connection:
                await connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        finally:
            await admin_engine.dispose()


@pytest.mark.asyncio
async def test_postgres_reset_outbox_survives_engine_restart_and_claim_is_single_use(postgres_auth_repository):
    repository, schema, url = postgres_auth_repository
    user = await repository.create_user(User(email=f"w13-{uuid.uuid4().hex}@example.com", password_hash="synthetic-hash"))
    token_ciphertext = Fernet(Fernet.generate_key()).encrypt(b"synthetic-reset-token").decode("ascii")
    expiry = datetime.now(UTC) + timedelta(minutes=20)
    assert await repository.enqueue_password_reset_mail(
        user_id=str(user.id),
        token_version=user.token_version,
        recipient=user.email,
        token_ciphertext=token_ciphertext,
        expires_at=expiry,
    )

    await close_engine()
    await init_engine("postgres", url=url, postgres_schema=schema, pool_size=24)
    session_factory = get_session_factory()
    assert session_factory is not None
    restarted_repository = SQLiteUserRepository(session_factory)
    engine = get_engine()
    assert engine is not None
    async with engine.connect() as connection:
        migration_head = await connection.scalar(text("SELECT version_num FROM alembic_version"))
    assert migration_head == "0022_password_reset_rate_limits"

    claim_time = datetime.now(UTC) + timedelta(seconds=1)
    claims = await asyncio.gather(
        *(
            restarted_repository.claim_password_reset_mail(
                now=claim_time,
                stale_after=claim_time - timedelta(seconds=90),
            )
            for _ in range(20)
        )
    )
    claimed = [claim for claim in claims if claim is not None]
    assert len(claimed) == 1
    assert claimed[0]["user_id"] == str(user.id)
    assert claimed[0]["token_ciphertext"] == token_ciphertext
    assert claimed[0]["attempt_count"] == 1
    assert all(
        claim is None
        for claim in await asyncio.gather(
            *(
                restarted_repository.claim_password_reset_mail(
                    now=claim_time,
                    stale_after=claim_time - timedelta(seconds=90),
                )
                for _ in range(8)
            )
        )
    )

    # A process that disappeared during SMTP may have reached DATA. A later
    # worker must erase the stale row and must not claim/resend it.
    stale_time = claim_time + timedelta(minutes=2)
    assert (
        await restarted_repository.claim_password_reset_mail(
            now=stale_time,
            stale_after=stale_time - timedelta(seconds=30),
        )
        is None
    )
    async with engine.connect() as connection:
        remaining = await connection.scalar(select(PasswordResetOutboxRow.id))
    assert remaining is None


@pytest.mark.asyncio
async def test_postgres_reset_rate_limits_are_atomic_shared_and_store_only_hmac_keys(postgres_auth_repository, monkeypatch):
    repository, _schema, _url = postgres_auth_repository
    from app.gateway.auth import config as auth_config

    monkeypatch.setattr(auth_config, "_auth_config", AuthConfig(jwt_secret="w13-postgres-rate-limit-test-secret"))
    client_ip = "192.0.2.45"
    email = f"private-{uuid.uuid4().hex}@example.com"
    now = datetime.now(UTC)
    results = await asyncio.gather(*(allow_password_reset_request(repository, client_ip, email, now=now) for _ in range(20)))
    assert sum(results) == 3
    assert await allow_password_reset_request(repository, "192.0.2.46", email, now=now + timedelta(minutes=1)) is False
    assert await allow_password_reset_request(repository, client_ip, email, now=now + timedelta(minutes=16)) is True

    engine = get_engine()
    assert engine is not None
    async with engine.connect() as connection:
        stored_keys = set((await connection.scalars(select(PasswordResetRateLimitRow.bucket_key))).all())
    expected_keys = set(password_reset_request_buckets(client_ip, email))
    assert stored_keys == expected_keys
    assert email not in " ".join(stored_keys)
    assert client_ip not in " ".join(stored_keys)
