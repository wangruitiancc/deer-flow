"""Bounded password-reset request throttling and SMTP delivery."""

from __future__ import annotations

import hashlib
import hmac
import logging
import smtplib
import ssl
import threading
import time
from collections import deque
from email.message import EmailMessage

from app.gateway.auth.config import AuthConfig, get_auth_config

logger = logging.getLogger(__name__)

_WINDOW_SECONDS = 15 * 60
_IP_LIMIT = 5
_EMAIL_LIMIT = 3
_MAX_KEYS = 20_000
_attempts: dict[str, deque[float]] = {}
_attempts_lock = threading.Lock()


def _opaque_key(kind: str, value: str) -> str:
    secret = get_auth_config().jwt_secret.encode("utf-8")
    digest = hmac.new(secret, value.strip().lower().encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{kind}:{digest}"


def allow_password_reset_request(client_ip: str, email: str) -> bool:
    """Limit reset requests by source IP and normalized account address.

    The in-process throttle is a baseline defense. Multi-worker production
    deployments must also apply a shared edge rate limit to these endpoints.
    Only HMAC digests are retained in memory; addresses and tokens are not
    written to logs or persistent storage.
    """
    now = time.monotonic()
    keys = (
        (_opaque_key("ip", client_ip), _IP_LIMIT),
        (_opaque_key("email", email), _EMAIL_LIMIT),
    )
    with _attempts_lock:
        if len(_attempts) > _MAX_KEYS:
            cutoff = now - _WINDOW_SECONDS
            for key in [key for key, values in _attempts.items() if not values or values[-1] <= cutoff]:
                _attempts.pop(key, None)

        for key, limit in keys:
            attempts = _attempts.setdefault(key, deque())
            while attempts and attempts[0] <= now - _WINDOW_SECONDS:
                attempts.popleft()
            if len(attempts) >= limit:
                return False

        for key, _ in keys:
            _attempts[key].append(now)
        return True


def send_password_reset_email(config: AuthConfig, email: str, token: str) -> None:
    """Deliver one reset link over operator-configured, verified-TLS SMTP."""
    if not config.password_reset_enabled:
        return

    base_url = (config.password_reset_public_base_url or "").rstrip("/")
    reset_url = f"{base_url}/reset-password#token={token}"
    message = EmailMessage()
    message["Subject"] = "Reset your Matrix-Law password"
    message["From"] = str(config.password_reset_from_email)
    message["To"] = email
    message.set_content(
        "A password reset was requested for this account.\n\n"
        f"Open this link within 20 minutes to choose a new password:\n{reset_url}\n\n"
        "If you did not request this, you can ignore this message."
    )

    context = ssl.create_default_context()
    try:
        if config.password_reset_smtp_security == "ssl":
            with smtplib.SMTP_SSL(
                config.password_reset_smtp_host,
                config.password_reset_smtp_effective_port,
                timeout=10,
                context=context,
            ) as server:
                _authenticate_if_configured(server, config)
                server.send_message(message)
        else:
            with smtplib.SMTP(
                config.password_reset_smtp_host,
                config.password_reset_smtp_effective_port,
                timeout=10,
            ) as server:
                server.ehlo()
                server.starttls(context=context)
                server.ehlo()
                _authenticate_if_configured(server, config)
                server.send_message(message)
    except (OSError, smtplib.SMTPException):
        # SMTP exceptions may include recipient/server data. Keep logs free of
        # user addresses, tokens, server responses, and credential details.
        logger.warning("Password reset email delivery failed")


def _authenticate_if_configured(server: smtplib.SMTP, config: AuthConfig) -> None:
    if config.password_reset_smtp_username and config.password_reset_smtp_password:
        server.login(config.password_reset_smtp_username, config.password_reset_smtp_password)
