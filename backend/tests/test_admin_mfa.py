"""Tests for local administrator TOTP, challenge replay and recovery codes."""

from __future__ import annotations

import asyncio
import time

from fastapi.testclient import TestClient

from app.gateway.auth import hash_password
from app.gateway.auth.config import AuthConfig, set_auth_config
from app.gateway.auth.local_provider import LocalAuthProvider
from app.gateway.auth.mfa import (
    MFAConfigurationError,
    _totp_at_counter,
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_totp_secret,
    hash_recovery_code,
    matching_totp_counter,
)
from app.gateway.auth.models import User
from app.gateway.auth.repositories.sqlite import SQLiteUserRepository

_TEST_JWT_SECRET = "test-secret-for-admin-mfa-tests-at-least-32-chars"


def test_enrolled_owner_keeps_mfa_after_system_role_is_reduced(tmp_path, monkeypatch) -> None:
    from app.gateway import deps
    from app.gateway.app import create_app
    from deerflow.persistence.engine import close_engine, get_session_factory, init_engine

    monkeypatch.delenv("DEER_FLOW_AUTH_DISABLED", raising=False)
    monkeypatch.setenv("AUTH_JWT_SECRET", _TEST_JWT_SECRET)
    monkeypatch.setenv("AUTH_MFA_ENCRYPTION_KEY", "e5" * 32)
    # Existing enrollment remains mandatory even if mandatory *admin*
    # enrollment policy is disabled later.
    set_auth_config(AuthConfig(jwt_secret=_TEST_JWT_SECRET, mfa_required_for_admins=False))
    secret = generate_totp_secret()

    async def prepare() -> None:
        await init_engine("sqlite", url=f"sqlite+aiosqlite:///{tmp_path}/owner-mfa.db", sqlite_dir=str(tmp_path))
        await SQLiteUserRepository(get_session_factory()).create_user(
            User(
                email="owner-mfa@example.com",
                password_hash=hash_password("OwnerMfaPass!384"),
                system_role="user",
                mfa_enabled=True,
                mfa_secret_ciphertext=encrypt_totp_secret(secret),
            )
        )

    asyncio.run(prepare())
    deps._cached_local_provider = None
    deps._cached_repo = None
    try:
        client = TestClient(create_app())
        login = client.post("/api/v1/auth/login/local", data={"username": "owner-mfa@example.com", "password": "OwnerMfaPass!384"})
        assert login.status_code == 200
        assert login.json()["mfa_required"] is True
        assert "access_token" not in client.cookies
        code = _totp_at_counter(secret, int(time.time() // 30))
        verified = client.post("/api/v1/auth/mfa/verify", json={"code": code})
        assert verified.status_code == 200
        assert client.get("/api/v1/auth/me").json()["system_role"] == "user"
        client.cookies.delete("access_token")
        client.post("/api/v1/auth/login/local", data={"username": "owner-mfa@example.com", "password": "OwnerMfaPass!384"})
        assert client.post("/api/v1/auth/mfa/verify", json={"code": code}).status_code == 401
    finally:
        deps._cached_local_provider = None
        deps._cached_repo = None
        asyncio.run(close_engine())


def test_totp_uses_rfc6238_window_and_rejects_replay() -> None:
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    # RFC 6238's SHA-1 test vector at 59 seconds is 287082 with 6 digits.
    assert _totp_at_counter(secret, 1) == "287082"
    assert matching_totp_counter(secret, "287082", now=59, last_counter=-1) == 1
    assert matching_totp_counter(secret, "287082", now=59, last_counter=1) is None
    assert matching_totp_counter(secret, "28 7082", now=59) is None


def test_totp_secret_is_authenticated_encryption(monkeypatch) -> None:
    monkeypatch.setenv("AUTH_MFA_ENCRYPTION_KEY", "a1" * 32)
    secret = generate_totp_secret()
    ciphertext = encrypt_totp_secret(secret)
    assert secret not in ciphertext
    assert decrypt_totp_secret(ciphertext) == secret

    monkeypatch.setenv("AUTH_MFA_ENCRYPTION_KEY", "b2" * 32)
    try:
        decrypt_totp_secret(ciphertext)
    except MFAConfigurationError:
        pass
    else:
        raise AssertionError("ciphertext must fail closed under the wrong key")


def test_sqlite_repository_makes_mfa_challenges_and_recovery_codes_one_use(tmp_path, monkeypatch) -> None:
    from deerflow.persistence.engine import close_engine, get_session_factory, init_engine

    monkeypatch.setenv("AUTH_JWT_SECRET", _TEST_JWT_SECRET)
    monkeypatch.setenv("AUTH_MFA_ENCRYPTION_KEY", "c3" * 32)
    set_auth_config(AuthConfig(jwt_secret=_TEST_JWT_SECRET))

    async def run() -> None:
        await init_engine("sqlite", url=f"sqlite+aiosqlite:///{tmp_path}/admin-mfa.db", sqlite_dir=str(tmp_path))
        try:
            repo = SQLiteUserRepository(get_session_factory())
            admin = await repo.create_user(User(email="mfa-admin@example.com", password_hash="stored", system_role="admin"))
            provider = LocalAuthProvider(repo)
            assert await provider.set_mfa_challenge(str(admin.id), admin.token_version, "challenge-setup")

            secret = generate_totp_secret()
            recovery_code = "A1" * 12
            assert await provider.save_mfa_setup(
                str(admin.id),
                admin.token_version,
                "challenge-setup",
                encrypt_totp_secret(secret),
                [
                    hash_recovery_code(recovery_code),
                    hash_recovery_code("B2" * 12),
                    hash_recovery_code("C3" * 12),
                    hash_recovery_code("D4" * 12),
                    hash_recovery_code("E5" * 12),
                    hash_recovery_code("F6" * 12),
                    hash_recovery_code("A7" * 12),
                    hash_recovery_code("B8" * 12),
                    hash_recovery_code("C9" * 12),
                    hash_recovery_code("DA" * 12),
                ],
            )
            counter = 60_000_000
            assert await provider.confirm_mfa_setup(str(admin.id), admin.token_version, "challenge-setup", counter)

            enabled = await repo.get_user_by_id(str(admin.id))
            assert enabled is not None and enabled.mfa_enabled
            assert enabled.mfa_secret_ciphertext != secret
            assert decrypt_totp_secret(enabled.mfa_secret_ciphertext) == secret
            assert await provider.set_mfa_challenge(str(admin.id), admin.token_version, "challenge-totp")
            assert not await provider.consume_mfa_totp(str(admin.id), admin.token_version, "challenge-totp", counter)
            assert await provider.consume_mfa_totp(str(admin.id), admin.token_version, "challenge-totp", counter + 1)
            assert not await provider.consume_mfa_totp(str(admin.id), admin.token_version, "challenge-totp", counter + 1)

            assert await provider.set_mfa_challenge(str(admin.id), admin.token_version, "challenge-recovery")
            assert await provider.consume_mfa_recovery_code(str(admin.id), admin.token_version, "challenge-recovery", hash_recovery_code(recovery_code))
            assert not await provider.consume_mfa_recovery_code(str(admin.id), admin.token_version, "challenge-recovery", hash_recovery_code(recovery_code))
            assert await repo.count_users() == 1
        finally:
            await close_engine()

    asyncio.run(run())


def test_admin_login_requires_totp_or_one_use_recovery_code(tmp_path, monkeypatch) -> None:
    from app.gateway import deps
    from app.gateway.app import create_app
    from deerflow.persistence.engine import close_engine, get_session_factory, init_engine

    monkeypatch.delenv("DEER_FLOW_AUTH_DISABLED", raising=False)
    monkeypatch.setenv("AUTH_JWT_SECRET", _TEST_JWT_SECRET)
    monkeypatch.setenv("AUTH_MFA_ENCRYPTION_KEY", "d4" * 32)
    set_auth_config(AuthConfig(jwt_secret=_TEST_JWT_SECRET, mfa_required_for_admins=True))

    async def prepare() -> None:
        await init_engine("sqlite", url=f"sqlite+aiosqlite:///{tmp_path}/admin-mfa-http.db", sqlite_dir=str(tmp_path))
        repo = SQLiteUserRepository(get_session_factory())
        await repo.create_user(User(email="http-mfa-admin@example.com", password_hash=hash_password("AdminMfaPass!384"), system_role="admin"))
        await repo.create_user(User(email="http-mfa-user@example.com", password_hash=hash_password("LawyerMfaPass!384"), system_role="user"))

    asyncio.run(prepare())
    deps._cached_local_provider = None
    deps._cached_repo = None
    try:
        client = TestClient(create_app(), base_url="https://tenant.example")
        lawyer_login = client.post(
            "/api/v1/auth/login/local",
            data={"username": "http-mfa-user@example.com", "password": "LawyerMfaPass!384"},
        )
        assert lawyer_login.status_code == 200
        assert lawyer_login.json()["mfa_required"] is False
        assert "access_token" in client.cookies
        client.cookies.delete("access_token")

        login = client.post(
            "/api/v1/auth/login/local",
            data={"username": "http-mfa-admin@example.com", "password": "AdminMfaPass!384", "remember_me": "false"},
        )
        assert login.status_code == 200
        assert login.json()["mfa_required"] is True
        assert login.json()["mfa_setup_required"] is True
        assert "access_token" not in client.cookies

        setup = client.post("/api/v1/auth/mfa/setup")
        assert setup.status_code == 200
        setup_data = setup.json()
        secret = setup_data["secret"]
        recovery_code = setup_data["recovery_codes"][0]
        current_counter = int(time.time() // 30)
        otp = _totp_at_counter(secret, current_counter)
        confirmed = client.post("/api/v1/auth/mfa/setup/confirm", json={"code": otp})
        assert confirmed.status_code == 200
        assert confirmed.json()["mfa_required"] is False
        assert client.get("/api/v1/auth/me").json()["system_role"] == "admin"

        client.cookies.delete("access_token")
        next_login = client.post(
            "/api/v1/auth/login/local",
            data={"username": "http-mfa-admin@example.com", "password": "AdminMfaPass!384", "remember_me": "false"},
        )
        assert next_login.status_code == 200
        assert next_login.json()["mfa_required"] is True
        assert next_login.json()["mfa_setup_required"] is False
        assert "access_token" not in client.cookies

        replay = client.post("/api/v1/auth/mfa/verify", json={"code": otp})
        assert replay.status_code == 401
        recovered = client.post("/api/v1/auth/mfa/verify", json={"code": recovery_code})
        assert recovered.status_code == 200
        assert client.get("/api/v1/auth/me").json()["system_role"] == "admin"
    finally:
        deps._cached_local_provider = None
        deps._cached_repo = None
        asyncio.run(close_engine())
