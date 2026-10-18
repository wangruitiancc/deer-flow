from types import SimpleNamespace

import pytest

from app.gateway import deps
from app.gateway.auth.models import User


@pytest.mark.asyncio
async def test_repository_transition_fences_credentials_and_preserves_mfa(tmp_path):
    from app.gateway.auth.repositories.sqlite import SQLiteUserRepository
    from deerflow.persistence.engine import close_engine, get_session_factory, init_engine

    await init_engine("sqlite", url=f"sqlite+aiosqlite:///{tmp_path}/owner-transition.db", sqlite_dir=str(tmp_path))
    try:
        repo = SQLiteUserRepository(get_session_factory())
        owner = await repo.create_user(User(email="owner@example.com", password_hash="old-hash", system_role="admin",
                                           mfa_enabled=True, mfa_secret_ciphertext="kept", mfa_last_counter=12))
        assert await repo.transition_bootstrap_owner(owner) is None
        await repo.create_user(User(email="operator@example.com", password_hash="operator-hash", system_role="admin"))
        changed = owner.model_copy(update={"password_hash": "new-hash", "token_version": 1})
        await repo.update_user(changed)
        assert await repo.transition_bootstrap_owner(owner) is None
        result = await repo.transition_bootstrap_owner(changed)
        assert result.id == owner.id and result.email == owner.email
        assert result.system_role == "user" and result.token_version == 2
        assert result.password_hash == "new-hash" and result.mfa_secret_ciphertext == "kept"
        assert result.mfa_enabled and result.mfa_last_counter == 12
        assert await repo.count_admin_users() == 1
        assert await repo.transition_bootstrap_owner(changed) is None
    finally:
        await close_engine()


@pytest.mark.asyncio
async def test_existing_system_admin_requires_explicit_host_transition_and_password_proof(monkeypatch):
    user = User(email="owner@example.com", password_hash="preserved", system_role="admin", token_version=7,
                mfa_enabled=True, mfa_secret_ciphertext="preserved-mfa", mfa_challenge_id="old-challenge")
    updated = []

    async def create_user(**_kwargs):
        raise ValueError("already exists")

    async def authenticate(credentials):
        return user if credentials["password"] == "correct-password" else None

    async def count_admin_users():
        return 2

    async def update_user(value):
        value = value.model_copy(update={"system_role": "user", "token_version": value.token_version + 1, "mfa_challenge_id": None})
        updated.append(value.model_copy())
        return value

    provider = SimpleNamespace(create_user=create_user, authenticate=authenticate, count_admin_users=count_admin_users, transition_bootstrap_owner=update_user)
    monkeypatch.setattr(deps, "get_local_provider", lambda: provider)
    monkeypatch.delenv("MATRIX_LAW_BOOTSTRAP_OWNER_TRANSITION_EMAIL", raising=False)
    assert await deps._extension_ensure_owner_bootstrap_identity("owner@example.com", "correct-password") is None
    monkeypatch.setenv("MATRIX_LAW_BOOTSTRAP_OWNER_TRANSITION_EMAIL", "other@example.com")
    assert await deps._extension_ensure_owner_bootstrap_identity("owner@example.com", "correct-password") is None
    monkeypatch.setenv("MATRIX_LAW_BOOTSTRAP_OWNER_TRANSITION_EMAIL", "owner@example.com")
    assert await deps._extension_ensure_owner_bootstrap_identity("owner@example.com", "wrong-password") is None
    assert not updated
    owner = await deps._extension_ensure_owner_bootstrap_identity("owner@example.com", "correct-password")
    assert owner.id == user.id
    assert owner.system_role == "user"
    assert owner.password_hash == "preserved"
    assert owner.mfa_enabled and owner.mfa_secret_ciphertext == "preserved-mfa"
    assert owner.token_version == 8 and owner.mfa_challenge_id is None
    assert len(updated) == 1


@pytest.mark.asyncio
async def test_transition_keeps_a_separate_system_administrator(monkeypatch):
    user = User(email="owner@example.com", password_hash="preserved", system_role="admin")

    async def create_user(**_kwargs):
        raise ValueError("already exists")

    async def authenticate(_credentials):
        return user

    async def count_admin_users():
        return 1

    monkeypatch.setattr(deps, "get_local_provider", lambda: SimpleNamespace(create_user=create_user, authenticate=authenticate, count_admin_users=count_admin_users))
    monkeypatch.setenv("MATRIX_LAW_BOOTSTRAP_OWNER_TRANSITION_EMAIL", "owner@example.com")
    assert await deps._extension_ensure_owner_bootstrap_identity("owner@example.com", "correct-password") is None
    assert user.system_role == "admin"
