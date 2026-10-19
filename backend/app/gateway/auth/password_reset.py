"""Bounded password-reset request throttling and SMTP delivery."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import smtplib
import ssl
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

from cryptography.fernet import Fernet, InvalidToken

from app.gateway.auth.config import AuthConfig, get_auth_config
from app.gateway.auth.jwt import decode_password_reset_token
from app.gateway.auth.repositories.base import UserRepository

logger = logging.getLogger(__name__)

_WINDOW_SECONDS = 15 * 60
_IP_LIMIT = 5
_EMAIL_LIMIT = 3


def _opaque_key(kind: str, value: str) -> str:
    secret = get_auth_config().jwt_secret.encode("utf-8")
    digest = hmac.new(secret, value.strip().lower().encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{kind}:{digest}"


def password_reset_request_buckets(client_ip: str, email: str) -> dict[str, int]:
    """Return only keyed digests for the two shared request buckets."""
    return {
        _opaque_key("ip", client_ip): _IP_LIMIT,
        _opaque_key("email", email): _EMAIL_LIMIT,
    }


async def allow_password_reset_request(repository: UserRepository, client_ip: str, email: str, *, now: datetime | None = None) -> bool:
    """Atomically enforce shared IP and normalized-account windows.

    Only HMAC digests cross the repository boundary; failure to reach the
    durable store propagates so the public route can fail closed.
    """
    current = now or datetime.now(UTC)
    buckets = password_reset_request_buckets(client_ip, email)
    return await repository.consume_password_reset_rate_limits(
        buckets=buckets,
        now=current,
        window_start=current - timedelta(seconds=_WINDOW_SECONDS),
        expires_at=current + timedelta(seconds=_WINDOW_SECONDS),
    )


def encrypt_password_reset_token(config: AuthConfig, token: str) -> str:
    """Encrypt a reset token before it enters durable storage."""
    if not config.password_reset_encryption_key:
        raise ValueError("Password reset encryption is not configured")
    return Fernet(config.password_reset_encryption_key.encode("ascii")).encrypt(token.encode("utf-8")).decode("ascii")


def send_password_reset_email(config: AuthConfig, email: str, token: str) -> None:
    """Deliver one reset link over operator-configured, verified-TLS SMTP.

    Delivery failures propagate so the outbox worker can retry only
    explicit 4xx responses. Transport errors can happen after DATA and are
    terminal to avoid resending a message the server may already have accepted.
    QUIT is cleanup: its failure must not replace the known delivery outcome.
    """
    if not config.password_reset_enabled:
        return

    base_url = (config.password_reset_public_base_url or "").rstrip("/")
    reset_url = f"{base_url}/reset-password#token={token}"
    message = EmailMessage()
    message["Subject"] = "Reset your Matrix-Law password"
    message["From"] = str(config.password_reset_from_email)
    message["To"] = email
    message.set_content(f"A password reset was requested for this account.\n\nOpen this link within 20 minutes to choose a new password:\n{reset_url}\n\nIf you did not request this, you can ignore this message.")

    context = ssl.create_default_context()
    server: smtplib.SMTP | None = None
    try:
        if config.password_reset_smtp_security == "ssl":
            server = smtplib.SMTP_SSL(
                config.password_reset_smtp_host,
                config.password_reset_smtp_effective_port,
                timeout=10,
                context=context,
            )
        else:
            server = smtplib.SMTP(
                config.password_reset_smtp_host,
                config.password_reset_smtp_effective_port,
                timeout=10,
            )
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
        _authenticate_if_configured(server, config)
        server.send_message(message)
    finally:
        if server is not None:
            with suppress(OSError, smtplib.SMTPException):
                server.quit()
            with suppress(OSError, smtplib.SMTPException):
                server.close()


def _authenticate_if_configured(server: smtplib.SMTP, config: AuthConfig) -> None:
    if config.password_reset_smtp_username and config.password_reset_smtp_password:
        server.login(config.password_reset_smtp_username, config.password_reset_smtp_password)


class PasswordResetMailService:
    """Durable outbox poller; a claimed ambiguous SMTP attempt is never resent."""

    MAX_ATTEMPTS = 3
    POLL_SECONDS = 1.0
    STALE_SECONDS = 90

    def __init__(self, repository: UserRepository, config: AuthConfig):
        self.repository = repository
        self.config = config
        self._task: asyncio.Task[None] | None = None
        self._stopping = asyncio.Event()

    async def start(self) -> None:
        if not self.config.password_reset_enabled:
            await self.repository.purge_password_reset_mail()
            return
        # A row left in "sending" after process death is erased by claim; it
        # must never be interpreted as permission to replay SMTP DATA.
        self._task = asyncio.create_task(self._run(), name="password-reset-mail-outbox")

    async def stop(self) -> None:
        self._stopping.set()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def run_once(self, *, now: datetime | None = None) -> bool:
        """Deliver at most one due message; exposed for deterministic tests."""
        if not self.config.password_reset_enabled:
            await self.repository.purge_password_reset_mail()
            return False
        current = now or datetime.now(UTC)
        row = await self.repository.claim_password_reset_mail(
            now=current,
            stale_after=current - timedelta(seconds=self.STALE_SECONDS),
        )
        if row is None:
            return False
        try:
            if row["purpose"] != "password_reset" or row["expires_at"].replace(tzinfo=row["expires_at"].tzinfo or UTC) <= current:
                await self.repository.finish_password_reset_mail(row["id"])
                return True
            if not row["recipient"] or not row["token_ciphertext"]:
                await self.repository.finish_password_reset_mail(row["id"])
                return True
            token = Fernet(self.config.password_reset_encryption_key.encode("ascii")).decrypt(row["token_ciphertext"].encode("ascii")).decode("utf-8")
            payload = decode_password_reset_token(token)
            if payload is None or payload.sub != row["user_id"] or payload.ver != row["token_version"]:
                await self.repository.finish_password_reset_mail(row["id"])
                return True
            user = await self.repository.get_user_by_id(row["user_id"])
            if user is None or user.password_hash is None or user.token_version != row["token_version"]:
                await self.repository.finish_password_reset_mail(row["id"])
                return True
            await asyncio.to_thread(send_password_reset_email, self.config, row["recipient"], token)
        except smtplib.SMTPResponseException as exc:
            if 400 <= int(exc.smtp_code) < 500:
                delay = min(60, 2 ** max(0, int(row["attempt_count"]) - 1))
                await self.repository.retry_password_reset_mail(row["id"], next_attempt_at=current + timedelta(seconds=delay), max_attempts=self.MAX_ATTEMPTS)
            else:
                await self.repository.finish_password_reset_mail(row["id"])
            logger.warning("Password reset email was rejected by SMTP; response omitted")
        except (OSError, smtplib.SMTPException, InvalidToken, UnicodeError, ValueError):
            # Includes disconnects after DATA, where delivery is ambiguous.
            await self.repository.finish_password_reset_mail(row["id"])
            logger.warning("Password reset email delivery ended without a definite retryable rejection")
        except Exception:
            await self.repository.finish_password_reset_mail(row["id"])
            logger.exception("Password reset outbox processing failed")
        else:
            await self.repository.finish_password_reset_mail(row["id"])
        return True

    async def _run(self) -> None:
        while not self._stopping.is_set():
            try:
                processed = await self.run_once()
            except Exception:
                logger.exception("Password reset outbox poll failed")
                processed = False
            if not processed:
                try:
                    await asyncio.wait_for(self._stopping.wait(), timeout=self.POLL_SECONDS)
                except TimeoutError:
                    pass
