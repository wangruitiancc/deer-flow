"""Password reset API, token-purpose, delivery, and replay tests."""

import asyncio
import secrets
from datetime import UTC, datetime, timedelta
from unittest.mock import Mock
from urllib.parse import urlsplit

import jwt
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.gateway.auth.config import AuthConfig, set_auth_config
from app.gateway.auth.jwt import create_access_token, create_password_reset_token, decode_password_reset_token, decode_token
from app.gateway.auth.password_reset import PasswordResetMailService, allow_password_reset_request, password_reset_request_buckets, send_password_reset_email

_TEST_SECRET = "password-reset-tests-secret-with-enough-entropy"


@pytest.fixture()
def auth_runtime(tmp_path, monkeypatch):
    from app.gateway import deps
    from app.gateway.auth import config as auth_config
    from deerflow.persistence.engine import close_engine, init_engine

    asyncio.run(init_engine("sqlite", url=f"sqlite+aiosqlite:///{tmp_path}/auth-reset.db", sqlite_dir=str(tmp_path)))
    deps._cached_local_provider = None
    deps._cached_repo = None
    monkeypatch.setattr(auth_config, "_auth_config", AuthConfig(jwt_secret=_TEST_SECRET))
    try:
        yield tmp_path
    finally:
        deps._cached_local_provider = None
        deps._cached_repo = None
        asyncio.run(close_engine())


def _client(*, client: tuple[str, int] = ("testclient", 50000)) -> TestClient:
    from app.gateway.app import create_app

    return TestClient(create_app(), base_url="https://law.example", client=client)


def _email(prefix: str = "reset") -> str:
    return f"{prefix}-{secrets.token_hex(6)}@example.com"


def _enabled_config() -> AuthConfig:
    return AuthConfig(
        jwt_secret=_TEST_SECRET,
        password_reset_smtp_host="smtp.example.com",
        password_reset_from_email="no-reply@example.com",
        password_reset_public_base_url="https://law.example/base",
        password_reset_encryption_key=Fernet.generate_key().decode("ascii"),
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
    with pytest.raises(ValueError, match="ENCRYPTION_KEY"):
        AuthConfig(
            jwt_secret=_TEST_SECRET,
            password_reset_smtp_host="smtp.example.com",
            password_reset_from_email="no-reply@example.com",
            password_reset_public_base_url="https://law.example",
        )


def test_blank_environment_placeholders_leave_reset_mail_disabled(auth_runtime, monkeypatch):
    from app.gateway.auth import config as auth_config

    monkeypatch.setenv("AUTH_JWT_SECRET", _TEST_SECRET)
    for name in (
        "AUTH_PASSWORD_RESET_SMTP_HOST",
        "AUTH_PASSWORD_RESET_SMTP_PORT",
        "AUTH_PASSWORD_RESET_SMTP_USERNAME",
        "AUTH_PASSWORD_RESET_SMTP_PASSWORD",
        "AUTH_PASSWORD_RESET_ENCRYPTION_KEY",
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
    config = _enabled_config()
    set_auth_config(config)
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
    from app.gateway.auth import password_reset

    config = _enabled_config()
    set_auth_config(config)
    client = _client()
    email = _email("mail")
    assert client.post("/api/v1/auth/register", json={"email": email, "password": "OldStr0ngPwd!"}).status_code == 201
    send = Mock()
    monkeypatch.setattr(password_reset, "send_password_reset_email", send)

    response = client.post("/api/v1/auth/password-reset/request", json={"email": email})
    unknown = client.post("/api/v1/auth/password-reset/request", json={"email": _email("unknown")})
    assert response.status_code == 202
    assert unknown.status_code == 202
    assert response.json() == unknown.json()
    assert client.get("/api/v1/auth/password-reset/status").json() == {"enabled": True}
    send.assert_not_called()
    from app.gateway.deps import get_local_provider

    provider = get_local_provider()
    mailer = PasswordResetMailService(provider.repository, config)
    assert asyncio.run(mailer.run_once())
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


def test_durable_outbox_survives_restart_and_multiworker_claim_is_exclusive(auth_runtime, monkeypatch):
    from app.gateway import deps
    from app.gateway.auth import password_reset
    from app.gateway.auth.repositories.sqlite import SQLiteUserRepository
    from deerflow.persistence.engine import close_engine, get_session_factory, init_engine

    config = _enabled_config()
    set_auth_config(config)
    client = _client()
    email = _email("restart")
    assert client.post("/api/v1/auth/register", json={"email": email, "password": "OldStr0ngPwd!"}).status_code == 201
    assert client.post("/api/v1/auth/password-reset/request", json={"email": email}).status_code == 202

    asyncio.run(close_engine())
    deps._cached_local_provider = None
    deps._cached_repo = None
    asyncio.run(init_engine("sqlite", url=f"sqlite+aiosqlite:///{auth_runtime}/auth-reset.db", sqlite_dir=str(auth_runtime)))
    repo = SQLiteUserRepository(get_session_factory())
    now = datetime.now(UTC)

    async def claims():
        return await asyncio.gather(
            repo.claim_password_reset_mail(now=now, stale_after=now - timedelta(seconds=90)),
            repo.claim_password_reset_mail(now=now, stale_after=now - timedelta(seconds=90)),
        )

    claimed = asyncio.run(claims())
    assert sum(row is not None for row in claimed) == 1
    # A restart leaves a sending row ambiguous; a later worker erases it and
    # never retries the SMTP transaction.
    stale = now + timedelta(seconds=91)
    assert asyncio.run(repo.claim_password_reset_mail(now=stale, stale_after=stale - timedelta(seconds=90))) is None
    send = Mock()
    monkeypatch.setattr(password_reset, "send_password_reset_email", send)
    mailer = PasswordResetMailService(repo, config)
    assert asyncio.run(mailer.run_once(now=stale)) is False
    send.assert_not_called()


def test_outbox_retries_definite_4xx_and_erases_ambiguous_smtp_failure(auth_runtime, monkeypatch):
    import smtplib

    from sqlalchemy import select

    from app.gateway import deps
    from app.gateway.auth import password_reset
    from deerflow.persistence.engine import get_session_factory
    from deerflow.persistence.user.model import PasswordResetOutboxRow

    config = _enabled_config()
    set_auth_config(config)
    client = _client()
    email = _email("retry")
    assert client.post("/api/v1/auth/register", json={"email": email, "password": "OldStr0ngPwd!"}).status_code == 201
    assert client.post("/api/v1/auth/password-reset/request", json={"email": email}).status_code == 202
    repo = deps.get_local_provider().repository
    mailer = PasswordResetMailService(repo, config)
    monkeypatch.setattr(password_reset, "send_password_reset_email", Mock(side_effect=smtplib.SMTPDataError(421, b"temporary")))
    assert asyncio.run(mailer.run_once())

    sf = get_session_factory()

    async def inspect_and_make_due():
        async with sf() as session:
            row = await session.scalar(select(PasswordResetOutboxRow))
            assert row is not None and row.status == "queued" and row.attempt_count == 1
            row.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
            await session.commit()

    asyncio.run(inspect_and_make_due())
    monkeypatch.setattr(password_reset, "send_password_reset_email", Mock(side_effect=smtplib.SMTPServerDisconnected("connection lost")))
    assert asyncio.run(mailer.run_once())

    async def remaining_rows():
        async with sf() as session:
            return await session.scalar(select(PasswordResetOutboxRow.id))

    assert asyncio.run(remaining_rows()) is None
    assert asyncio.run(mailer.run_once()) is False


def test_stale_reset_outbox_is_erased_without_sending(auth_runtime, monkeypatch):
    from app.gateway import deps
    from app.gateway.auth import password_reset

    config = _enabled_config()
    set_auth_config(config)
    client = _client()
    email = _email("stale")
    assert client.post("/api/v1/auth/register", json={"email": email, "password": "OldStr0ngPwd!"}).status_code == 201
    assert client.post("/api/v1/auth/password-reset/request", json={"email": email}).status_code == 202
    provider = deps.get_local_provider()
    user = asyncio.run(provider.get_user_by_email(email))
    assert user is not None
    assert asyncio.run(provider.reset_password_if_token_version(str(user.id), user.token_version, "NewStr0ngPwd!"))
    send = Mock()
    monkeypatch.setattr(password_reset, "send_password_reset_email", send)
    mailer = PasswordResetMailService(provider.repository, config)

    assert asyncio.run(mailer.run_once()) is False
    send.assert_not_called()


def test_shared_reset_throttle_limits_ip_and_email_buckets(auth_runtime):
    from app.gateway.deps import get_local_provider

    repo = get_local_provider().repository

    async def requests():
        first = [await allow_password_reset_request(repo, "192.0.2.10", "one@example.com") for _ in range(3)]
        fourth = await allow_password_reset_request(repo, "192.0.2.10", "one@example.com")
        other_ip = [await allow_password_reset_request(repo, "192.0.2.11", "two@example.com") for _ in range(3)]
        same_email = await allow_password_reset_request(repo, "192.0.2.11", "one@example.com")
        return first, fourth, other_ip, same_email

    first, fourth, other_ip, same_email = asyncio.run(requests())
    assert first == [True, True, True]
    assert fourth is False
    assert other_ip == [True, True, True]
    assert same_email is False


def test_shared_reset_throttle_is_atomic_across_concurrent_workers(auth_runtime):
    from app.gateway.auth.repositories.sqlite import SQLiteUserRepository
    from app.gateway.deps import get_local_provider
    from deerflow.persistence.engine import get_session_factory

    repo_a = get_local_provider().repository
    repo_b = SQLiteUserRepository(get_session_factory())

    async def requests():
        return await asyncio.gather(*(allow_password_reset_request(repo_a if index % 2 else repo_b, "192.0.2.30", "parallel@example.com") for index in range(12)))

    assert sum(asyncio.run(requests())) == 3


def test_reset_email_bucket_is_shared_across_multiple_ips(auth_runtime):
    from app.gateway.deps import get_local_provider

    repo = get_local_provider().repository

    async def requests():
        return [await allow_password_reset_request(repo, ip, "shared@example.com") for ip in ("192.0.2.40", "192.0.2.41", "192.0.2.42", "192.0.2.43")]

    assert asyncio.run(requests()) == [True, True, True, False]


def test_reset_ip_bucket_allows_five_addresses_then_blocks(auth_runtime):
    from app.gateway.deps import get_local_provider

    repo = get_local_provider().repository

    async def requests():
        return [await allow_password_reset_request(repo, "192.0.2.44", f"ip-limit-{index}@example.com") for index in range(7)]

    assert asyncio.run(requests()) == [True, True, True, True, True, False, False]


def test_reset_rate_limit_window_expires(auth_runtime):
    from app.gateway.deps import get_local_provider

    repo = get_local_provider().repository
    start = datetime(2026, 10, 12, 0, 0, tzinfo=UTC)

    async def requests():
        before_expiry = [await allow_password_reset_request(repo, "192.0.2.60", "expiry@example.com", now=start + timedelta(seconds=n)) for n in range(4)]
        after_expiry = await allow_password_reset_request(repo, "192.0.2.60", "expiry@example.com", now=start + timedelta(minutes=16))
        return before_expiry, after_expiry

    before_expiry, after_expiry = asyncio.run(requests())
    assert before_expiry == [True, True, True, False]
    assert after_expiry is True


def test_reset_request_rate_limit_survives_auth_store_restart(auth_runtime):
    from app.gateway.deps import get_local_provider
    from deerflow.persistence.engine import close_engine, init_engine

    repo = get_local_provider().repository

    async def consume(count: int):
        return [await allow_password_reset_request(repo, "192.0.2.50", "restart@example.com") for _ in range(count)]

    assert asyncio.run(consume(2)) == [True, True]
    asyncio.run(close_engine())
    from app.gateway import deps

    deps._cached_local_provider = None
    deps._cached_repo = None
    asyncio.run(init_engine("sqlite", url=f"sqlite+aiosqlite:///{auth_runtime}/auth-reset.db", sqlite_dir=str(auth_runtime)))
    restarted_repo = deps.get_local_provider().repository

    async def consume_after_restart():
        return [
            await allow_password_reset_request(restarted_repo, "192.0.2.50", "restart@example.com"),
            await allow_password_reset_request(restarted_repo, "192.0.2.50", "restart@example.com"),
        ]

    assert asyncio.run(consume_after_restart()) == [True, False]


def test_trusted_x_real_ip_keys_shared_limiter_and_xff_is_ignored(auth_runtime, monkeypatch):
    from sqlalchemy import select

    from deerflow.persistence.engine import get_session_factory
    from deerflow.persistence.user.model import PasswordResetRateLimitRow

    config = _enabled_config()
    set_auth_config(config)
    monkeypatch.setenv("AUTH_TRUSTED_PROXIES", "10.0.0.0/8")
    client = _client(client=("10.1.2.3", 4321))
    response = client.post(
        "/api/v1/auth/password-reset/request",
        json={"email": _email("forwarded")},
        headers={"X-Real-IP": "203.0.113.42", "X-Forwarded-For": "198.51.100.19"},
    )
    assert response.status_code == 202
    expected_ip_key = next(key for key in password_reset_request_buckets("203.0.113.42", "probe@example.com") if key.startswith("ip:"))
    spoofed_ip_key = next(key for key in password_reset_request_buckets("198.51.100.19", "probe@example.com") if key.startswith("ip:"))

    async def keys():
        async with get_session_factory()() as session:
            return set((await session.scalars(select(PasswordResetRateLimitRow.bucket_key))).all())

    stored = asyncio.run(keys())
    assert expected_ip_key in stored
    assert spoofed_ip_key not in stored
    assert all("203.0.113.42" not in key and "198.51.100.19" not in key for key in stored)


def test_reset_request_fails_closed_when_shared_rate_limit_store_fails(auth_runtime, monkeypatch):
    from app.gateway.routers import auth as auth_router

    config = _enabled_config()
    set_auth_config(config)

    class BrokenProvider:
        repository = object()

        async def get_user_by_email(self, email):
            raise AssertionError("fail-closed limiter must not look up accounts")

    async def unavailable(*args, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(auth_router, "get_local_provider", lambda: BrokenProvider())
    monkeypatch.setattr(auth_router, "allow_password_reset_request", unavailable)
    response = _client().post("/api/v1/auth/password-reset/request", json={"email": "known@example.com"})
    assert response.status_code == 202
    assert response.json() == {"message": "If this account can receive password reset email, a link will arrive shortly."}


def test_revoke_all_sessions_invalidates_parallel_browser_sessions(auth_runtime):
    set_auth_config(AuthConfig(jwt_secret=_TEST_SECRET))
    email = _email("revoke-all")
    first = _client()
    second = _client()
    registered = first.post("/api/v1/auth/register", json={"email": email, "password": "OldStr0ngPwd!"})
    assert registered.status_code == 201
    assert second.post("/api/v1/auth/login/local", data={"username": email, "password": "OldStr0ngPwd!"}).status_code == 200
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
    assert first.post("/api/v1/auth/login/local", data={"username": email, "password": "OldStr0ngPwd!"}).status_code == 200


class _LoopbackStartTlsServer:
    """A protocol-level SMTP peer bound only to a local ephemeral port."""

    def __init__(self, behavior: str, cert_path, key_path):
        import socket
        import ssl
        import threading

        self.behavior = behavior
        self.data_received = False
        self.accept_count = 0
        self.server_error = None
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(1)
        self.listener.settimeout(8)
        self.port = self.listener.getsockname()[1]
        self.tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.tls_context.load_cert_chain(str(cert_path), str(key_path))
        self.thread = threading.Thread(target=self._serve, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_exc):
        self.listener.close()
        self.thread.join(timeout=8)
        if self.thread.is_alive():
            raise AssertionError("loopback SMTP test server did not stop")
        if self.server_error is not None:
            raise AssertionError("loopback SMTP test server failed") from self.server_error

    def _serve(self):
        import ssl

        connection = None
        stream = None
        try:
            connection, _peer = self.listener.accept()
            self.accept_count += 1
            connection.settimeout(8)
            connection.sendall(b"220 loopback test SMTP\r\n")
            stream = connection.makefile("rb")
            encrypted = False
            while True:
                line = stream.readline()
                if not line:
                    return
                command = line.split(None, 1)[0].upper()
                if command in {b"EHLO", b"HELO"}:
                    connection.sendall(b"250-loopback.test\r\n250-STARTTLS\r\n250 SIZE 1000000\r\n")
                    if encrypted and self.behavior == "disconnect-before-data":
                        return
                elif command == b"STARTTLS":
                    connection.sendall(b"220 begin TLS\r\n")
                    stream.close()
                    stream = None
                    connection = self.tls_context.wrap_socket(connection, server_side=True)
                    connection.settimeout(8)
                    stream = connection.makefile("rb")
                    encrypted = True
                elif command in {b"MAIL", b"RCPT", b"RSET", b"NOOP"}:
                    connection.sendall(b"250 accepted\r\n")
                elif command == b"DATA":
                    connection.sendall(b"354 send message\r\n")
                    while True:
                        body_line = stream.readline()
                        if not body_line:
                            return
                        if body_line in {b".\r\n", b".\n"}:
                            self.data_received = True
                            break
                    if self.behavior == "disconnect-after-data":
                        return
                    if self.behavior == "temporary-reject":
                        connection.sendall(b"451 temporary rejection\r\n")
                    elif self.behavior == "permanent-reject":
                        connection.sendall(b"550 permanent rejection\r\n")
                    else:
                        connection.sendall(b"250 message accepted\r\n")
                elif command == b"QUIT":
                    connection.sendall(b"221 closing\r\n")
                    return
                else:
                    connection.sendall(b"250 accepted\r\n")
        except (ssl.SSLError, OSError):
            # TLS verification and deliberate disconnect cases are expected.
            return
        except Exception as exc:  # pragma: no cover - diagnostic guard
            self.server_error = exc
        finally:
            if stream is not None:
                try:
                    stream.close()
                except OSError:
                    pass
            if connection is not None:
                try:
                    connection.close()
                except OSError:
                    pass


def _make_loopback_smtp_certificate(tmp_path_factory):
    import ipaddress
    from datetime import timedelta

    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

    directory = tmp_path_factory.mktemp("w13-loopback-smtp-tls", numbered=True)
    now = datetime.now(UTC)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "W13 loopback SMTP test")])
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(minutes=10))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(key, hashes.SHA256())
    )
    cert_path = directory / "smtp-test-cert.pem"
    key_path = directory / "smtp-test-key.pem"
    cert_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
    cert_path.chmod(0o600)
    key_path.chmod(0o600)
    return cert_path, key_path


@pytest.fixture(scope="module")
def loopback_smtp_certificate(tmp_path_factory):
    return _make_loopback_smtp_certificate(tmp_path_factory)


@pytest.mark.parametrize(
    ("behavior", "trust_test_certificate", "expected_state", "expected_data"),
    [
        ("accept", True, "erased", True),
        ("temporary-reject", True, "queued", True),
        ("permanent-reject", True, "erased", True),
        ("accept", False, "erased", False),
        ("disconnect-before-data", True, "erased", False),
        ("disconnect-after-data", True, "erased", True),
    ],
)
def test_password_reset_smtp_tls_outbox_protocol_matrix(
    auth_runtime,
    loopback_smtp_certificate,
    monkeypatch,
    behavior,
    trust_test_certificate,
    expected_state,
    expected_data,
):
    import ssl

    from sqlalchemy import select

    from app.gateway import deps
    from app.gateway.auth import password_reset
    from deerflow.persistence.engine import get_session_factory
    from deerflow.persistence.user.model import PasswordResetOutboxRow

    cert_path, key_path = loopback_smtp_certificate
    with _LoopbackStartTlsServer(behavior, cert_path, key_path) as smtp:
        config = AuthConfig(
            jwt_secret=_TEST_SECRET,
            password_reset_smtp_host="127.0.0.1",
            password_reset_smtp_port=smtp.port,
            password_reset_encryption_key=Fernet.generate_key().decode("ascii"),
            password_reset_from_email="no-reply@example.com",
            password_reset_public_base_url="https://law.example",
        )
        set_auth_config(config)
        if trust_test_certificate:
            default_context = ssl.create_default_context
            monkeypatch.setattr(
                password_reset.ssl,
                "create_default_context",
                lambda: default_context(cafile=str(cert_path)),
            )

        client = _client()
        email = _email("loopback-smtp")
        assert client.post("/api/v1/auth/register", json={"email": email, "password": "OldStr0ngPwd!"}).status_code == 201
        assert client.post("/api/v1/auth/password-reset/request", json={"email": email}).status_code == 202
        mailer = PasswordResetMailService(deps.get_local_provider().repository, config)
        attempted_at = datetime.now(UTC)
        assert asyncio.run(mailer.run_once(now=attempted_at)) is True

        async def outbox_state():
            async with get_session_factory()() as session:
                row = await session.scalar(select(PasswordResetOutboxRow))
                if row is None:
                    return "erased", None
                return row.status, row.attempt_count

        state, attempt_count = asyncio.run(outbox_state())
        if expected_state == "queued":
            assert state == "queued"
            assert attempt_count == 1
            assert asyncio.run(mailer.run_once(now=attempted_at)) is False
        else:
            assert state == "erased"
            assert attempt_count is None
        assert smtp.data_received is expected_data
        assert smtp.accept_count == 1
