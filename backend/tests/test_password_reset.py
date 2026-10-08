"""Password reset API, token-purpose, delivery, and replay tests."""

import asyncio
import secrets
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from urllib.parse import urlsplit

import jwt
import pytest
from fastapi.testclient import TestClient

from app.gateway.auth.config import AuthConfig, set_auth_config
from app.gateway.auth.jwt import create_access_token, create_password_reset_token, decode_password_reset_token, decode_token
from app.gateway.auth.password_reset import allow_password_reset_request, send_password_reset_email

_TEST_SECRET = "password-reset-tests-secret-with-enough-entropy"


@pytest.fixture()
def auth_runtime(tmp_path, monkeypatch):
    from app.gateway import deps
    from app.gateway.auth import config as auth_config
    from app.gateway.auth.password_reset import _attempts
    from deerflow.persistence.engine import close_engine, init_engine

    asyncio.run(init_engine("sqlite", url=f"sqlite+aiosqlite:///{tmp_path}/auth-reset.db", sqlite_dir=str(tmp_path)))
    deps._cached_local_provider = None
    deps._cached_repo = None
    monkeypatch.setattr(auth_config, "_auth_config", AuthConfig(jwt_secret=_TEST_SECRET))
    _attempts.clear()
    try:
        yield
    finally:
        deps._cached_local_provider = None
        deps._cached_repo = None
        _attempts.clear()
        asyncio.run(close_engine())


def _client() -> TestClient:
    from app.gateway.app import create_app

    return TestClient(create_app(), base_url="https://law.example")


def _email(prefix: str = "reset") -> str:
    return f"{prefix}-{secrets.token_hex(6)}@example.com"


def _enabled_config() -> AuthConfig:
    return AuthConfig(
        jwt_secret=_TEST_SECRET,
        password_reset_smtp_host="smtp.example.com",
        password_reset_from_email="no-reply@example.com",
        password_reset_public_base_url="https://law.example/base",
    )


def test_password_reset_configuration_requires_complete_https_mail_settings():
    with pytest.raises(ValueError):
        AuthConfig(jwt_secret=_TEST_SECRET, password_reset_smtp_host="smtp.example.com")
    with pytest.raises(ValueError):
        AuthConfig(
            jwt_secret=_TEST_SECRET,
            password_reset_smtp_host="smtp.example.com",
            password_reset_from_email="no-reply@example.com",
            password_reset_public_base_url="http://evil.example",
        )
    with pytest.raises(ValueError):
        AuthConfig(
            jwt_secret=_TEST_SECRET,
            password_reset_smtp_host="smtp.example.com",
            password_reset_from_email="no-reply@example.com",
            password_reset_public_base_url="https://law.example",
            password_reset_smtp_username="mailer",
        )


def test_blank_environment_placeholders_leave_reset_mail_disabled(auth_runtime, monkeypatch):
    from app.gateway.auth import config as auth_config

    monkeypatch.setenv("AUTH_JWT_SECRET", _TEST_SECRET)
    for name in (
        "AUTH_PASSWORD_RESET_SMTP_HOST",
        "AUTH_PASSWORD_RESET_SMTP_PORT",
        "AUTH_PASSWORD_RESET_SMTP_USERNAME",
        "AUTH_PASSWORD_RESET_SMTP_PASSWORD",
        "AUTH_PASSWORD_RESET_FROM_EMAIL",
        "AUTH_PASSWORD_RESET_PUBLIC_BASE_URL",
        "AUTH_PASSWORD_RESET_SMTP_SECURITY",
    ):
        monkeypatch.setenv(name, "")
    monkeypatch.setattr(auth_config, "_auth_config", None)

    config = auth_config.get_auth_config()

    assert config.password_reset_enabled is False
    assert config.password_reset_smtp_port is None
    assert config.password_reset_smtp_security == "starttls"


def test_reset_token_is_audience_bound_and_access_decoder_rejects_it(auth_runtime):
    set_auth_config(AuthConfig(jwt_secret=_TEST_SECRET))
    reset_token = create_password_reset_token("account-id", 7)
    assert decode_password_reset_token(reset_token) is not None
    assert decode_token(reset_token).value == "malformed"
    assert decode_password_reset_token(create_access_token("account-id", token_version=7)) is None

    wrong_audience = jwt.encode(
        {"sub": "account-id", "ver": 7, "aud": "deerflow-access", "purpose": "password_reset", "jti": "x", "exp": 4_000_000_000, "iat": 1_700_000_000},
        _TEST_SECRET,
        algorithm="HS256",
    )
    assert decode_password_reset_token(wrong_audience) is None

    expired = jwt.encode(
        {"sub": "account-id", "ver": 7, "aud": "deerflow-password-reset", "purpose": "password_reset", "jti": "x", "exp": datetime.now(UTC) - timedelta(seconds=1), "iat": datetime.now(UTC) - timedelta(minutes=21)},
        _TEST_SECRET,
        algorithm="HS256",
    )
    assert decode_password_reset_token(expired) is None


def test_reset_request_response_is_generic_and_disabled_configuration_sends_nothing(auth_runtime):
    client = _client()
    email = _email("disabled")
    assert client.post("/api/v1/auth/register", json={"email": email, "password": "OldStr0ngPwd!"}).status_code == 201

    known = client.post("/api/v1/auth/password-reset/request", json={"email": email})
    unknown = client.post("/api/v1/auth/password-reset/request", json={"email": _email("missing")})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert known.headers["cache-control"] == "no-store"
    assert client.get("/api/v1/auth/password-reset/status").json() == {"enabled": False}


def test_reset_auth_routes_reject_cross_site_origins(auth_runtime):
    set_auth_config(_enabled_config())
    response = _client().post(
        "/api/v1/auth/password-reset/request",
        json={"email": _email("csrf")},
        headers={"Origin": "https://attacker.example"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Cross-site auth request denied."


def test_reset_failure_responses_are_never_cached_or_referred(auth_runtime):
    set_auth_config(AuthConfig(jwt_secret=_TEST_SECRET))
    response = _client().post(
        "/api/v1/auth/password-reset/complete",
        json={"token": "invalid-reset-token-that-is-long-enough", "new_password": "NewStr0ngPwd!"},
    )

    assert response.status_code == 400
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_reset_sends_fragment_token_and_consumes_it_once_invalidating_sessions(auth_runtime, monkeypatch):
    from app.gateway.routers import auth as auth_router

    set_auth_config(_enabled_config())
    client = _client()
    email = _email("mail")
    assert client.post("/api/v1/auth/register", json={"email": email, "password": "OldStr0ngPwd!"}).status_code == 201
    send = Mock()
    monkeypatch.setattr(auth_router, "send_password_reset_email", send)

    response = client.post("/api/v1/auth/password-reset/request", json={"email": email})
    unknown = client.post("/api/v1/auth/password-reset/request", json={"email": _email("unknown")})
    assert response.status_code == 202
    assert unknown.status_code == 202
    assert response.json() == unknown.json()
    assert client.get("/api/v1/auth/password-reset/status").json() == {"enabled": True}
    send.assert_called_once()
    sent_email, token = send.call_args.args[1:]
    assert sent_email == email.lower()
    assert token not in response.text

    reset_url = f"https://law.example/base/reset-password#token={token}"
    parsed = urlsplit(reset_url)
    assert parsed.query == ""
    assert parsed.fragment == f"token={token}"

    payload = {"token": token, "new_password": "NewStr0ngPwd!"}
    completed = client.post("/api/v1/auth/password-reset/complete", json=payload)
    assert completed.status_code == 200
    assert completed.headers["cache-control"] == "no-store"
    assert client.post("/api/v1/auth/password-reset/complete", json=payload).status_code == 400
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.post("/api/v1/auth/login/local", data={"username": email, "password": "OldStr0ngPwd!"}).status_code == 401
    assert client.post("/api/v1/auth/login/local", data={"username": email, "password": "NewStr0ngPwd!"}).status_code == 200


def test_concurrent_redemption_has_exactly_one_winner(auth_runtime):
    set_auth_config(AuthConfig(jwt_secret=_TEST_SECRET))
    client = _client()
    email = _email("race")
    assert client.post("/api/v1/auth/register", json={"email": email, "password": "OldStr0ngPwd!"}).status_code == 201
    from app.gateway.deps import get_local_provider

    user = asyncio.run(get_local_provider().get_user_by_email(email))
    assert user is not None

    async def redeem_both() -> list[bool]:
        provider = get_local_provider()
        return list(
            await asyncio.gather(
                provider.reset_password_if_token_version(str(user.id), user.token_version, "RaceNewStr0ngPwd!"),
                provider.reset_password_if_token_version(str(user.id), user.token_version, "OtherNewStr0ngPwd!"),
            )
        )

    assert sorted(asyncio.run(redeem_both())) == [False, True]


def test_password_reset_delivery_uses_starttls_and_keeps_token_in_url_fragment(auth_runtime, monkeypatch):
    import smtplib

    config = _enabled_config()
    transport = Mock()
    transport.__enter__ = Mock(return_value=transport)
    transport.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(smtplib, "SMTP", Mock(return_value=transport))

    send_password_reset_email(config, "lawyer@example.com", "signed-token")

    transport.starttls.assert_called_once()
    sent = transport.send_message.call_args.args[0]
    body = sent.get_content()
    assert "https://law.example/base/reset-password#token=signed-token" in body
    assert "?token=" not in body
    assert "signed-token" not in sent["To"]


def test_reset_request_throttle_is_per_ip_and_account(auth_runtime):
    assert all(allow_password_reset_request("192.0.2.10", "one@example.com") for _ in range(3))
    assert not allow_password_reset_request("192.0.2.10", "one@example.com")
    assert all(allow_password_reset_request("192.0.2.11", "two@example.com") for _ in range(3))
    assert not allow_password_reset_request("192.0.2.11", "one@example.com")


def test_revoke_all_sessions_invalidates_parallel_browser_sessions(auth_runtime):
    set_auth_config(AuthConfig(jwt_secret=_TEST_SECRET))
    email = _email("revoke-all")
    first = _client()
    second = _client()
    registered = first.post("/api/v1/auth/register", json={"email": email, "password": "OldStr0ngPwd!"})
    assert registered.status_code == 201
    assert second.post(
        "/api/v1/auth/login/local", data={"username": email, "password": "OldStr0ngPwd!"}
    ).status_code == 200
    assert first.get("/api/v1/auth/me").status_code == 200
    assert second.get("/api/v1/auth/me").status_code == 200

    csrf = first.cookies.get("csrf_token")
    assert csrf
    response = first.post(
        "/api/v1/auth/sessions/revoke-all",
        headers={"Origin": "https://law.example", "X-CSRF-Token": csrf},
    )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"message": "All account sessions have been revoked"}
    assert first.get("/api/v1/auth/me").status_code == 401
    assert second.get("/api/v1/auth/me").status_code == 401
    assert first.post(
        "/api/v1/auth/login/local", data={"username": email, "password": "OldStr0ngPwd!"}
    ).status_code == 200
