"""Time-based one-time passwords and recovery support for local admins."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import struct
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

import jwt
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import BaseModel

from app.gateway.auth.config import get_auth_config

MFA_CHALLENGE_COOKIE_NAME = "mfa_challenge"
MFA_CHALLENGE_COOKIE_PATH = "/api/v1/auth/mfa"
MFA_CHALLENGE_TTL_SECONDS = 600
TOTP_PERIOD_SECONDS = 30
TOTP_DIGITS = 6
_ENCRYPTION_KEY_ENV = "AUTH_MFA_ENCRYPTION_KEY"
_CIPHER_PREFIX = "v1."
_RECOVERY_CODE_COUNT = 10


class MFAConfigurationError(RuntimeError):
    """Raised when required MFA cryptographic configuration is unavailable."""


class MFAChallenge(BaseModel):
    """Short-lived password-verified challenge, never an access token."""

    sub: str
    ver: int
    exp: datetime
    iat: datetime
    aud: str
    purpose: str
    mode: str
    remember_me: bool
    jti: str


def _encryption_key() -> bytes:
    value = os.environ.get(_ENCRYPTION_KEY_ENV, "").strip()
    try:
        key = bytes.fromhex(value)
    except ValueError as exc:
        raise MFAConfigurationError(f"{_ENCRYPTION_KEY_ENV} must be a 32-byte hexadecimal key") from exc
    if len(key) != 32:
        raise MFAConfigurationError(f"{_ENCRYPTION_KEY_ENV} must be a 32-byte hexadecimal key")
    return key


def validate_mfa_encryption_key() -> None:
    """Fail before issuing an enrollment challenge if its storage key is absent."""
    _encryption_key()


def encrypt_totp_secret(secret: str) -> str:
    """Encrypt the authenticator secret with AES-256-GCM using a fresh nonce."""
    nonce = secrets.token_bytes(12)
    payload = AESGCM(_encryption_key()).encrypt(nonce, secret.encode("ascii"), b"deerflow-admin-totp-v1")
    token = base64.urlsafe_b64encode(nonce + payload).decode("ascii").rstrip("=")
    return _CIPHER_PREFIX + token


def decrypt_totp_secret(ciphertext: str) -> str:
    """Decrypt an enrolled secret; malformed or wrong-key values fail closed."""
    if not ciphertext.startswith(_CIPHER_PREFIX):
        raise MFAConfigurationError("Stored MFA secret uses an unsupported format")
    raw = ciphertext[len(_CIPHER_PREFIX) :]
    try:
        padded = raw + "=" * (-len(raw) % 4)
        payload = base64.urlsafe_b64decode(padded.encode("ascii"))
        clear = AESGCM(_encryption_key()).decrypt(payload[:12], payload[12:], b"deerflow-admin-totp-v1")
        return clear.decode("ascii")
    except (ValueError, UnicodeDecodeError, InvalidTag) as exc:
        raise MFAConfigurationError("Stored MFA secret cannot be decrypted") from exc


def generate_totp_secret() -> str:
    """Create a 160-bit base32 secret suitable for common authenticator apps."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _totp_at_counter(secret: str, counter: int) -> str:
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    number = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{number % (10**TOTP_DIGITS):0{TOTP_DIGITS}d}"


def matching_totp_counter(secret: str, code: str, *, now: float | None = None, last_counter: int = -1) -> int | None:
    """Return the newest matching unused TOTP counter in the ±1 step window."""
    normalized = code.strip()
    if len(normalized) != TOTP_DIGITS or not normalized.isascii() or not normalized.isdigit():
        return None
    current = int((time.time() if now is None else now) // TOTP_PERIOD_SECONDS)
    matches = [
        counter
        for counter in range(max(0, current - 1), current + 2)
        if counter > last_counter and hmac.compare_digest(_totp_at_counter(secret, counter), normalized)
    ]
    return max(matches, default=None)


def generate_recovery_codes() -> list[str]:
    """Create ten one-use recovery codes with 96 bits of random entropy each."""
    return [secrets.token_hex(12).upper() for _ in range(_RECOVERY_CODE_COUNT)]


def hash_recovery_code(code: str) -> str:
    """Hash a high-entropy recovery code for storage or lookup."""
    normalized = "".join(character for character in code.upper() if character.isalnum())
    return hashlib.sha256(normalized.encode("ascii", errors="ignore")).hexdigest()


def create_mfa_challenge(user_id: str, token_version: int, *, mode: str, remember_me: bool) -> tuple[str, str]:
    """Create a signed, purpose-bound challenge cookie value and its jti."""
    if mode not in {"setup", "verify"}:
        raise ValueError("unsupported MFA challenge mode")
    now = datetime.now(UTC)
    jti = secrets.token_urlsafe(24)
    payload = {
        "sub": user_id,
        "ver": token_version,
        "exp": now + timedelta(seconds=MFA_CHALLENGE_TTL_SECONDS),
        "iat": now,
        "aud": "deerflow-admin-mfa",
        "purpose": "admin_mfa_challenge",
        "mode": mode,
        "remember_me": remember_me,
        "jti": jti,
    }
    return jwt.encode(payload, get_auth_config().jwt_secret, algorithm="HS256"), jti


def decode_mfa_challenge(token: str | None) -> MFAChallenge | None:
    """Validate the short-lived challenge claims without accepting access JWTs."""
    if not token:
        return None
    try:
        payload = jwt.decode(
            token,
            get_auth_config().jwt_secret,
            algorithms=["HS256"],
            audience="deerflow-admin-mfa",
            options={"require": ["sub", "ver", "exp", "iat", "aud", "purpose", "mode", "remember_me", "jti"]},
        )
        challenge = MFAChallenge(**payload)
        if challenge.purpose != "admin_mfa_challenge" or challenge.mode not in {"setup", "verify"} or not challenge.jti:
            return None
        return challenge
    except (jwt.PyJWTError, ValueError):
        return None


def otpauth_uri(secret: str, account: str) -> str:
    """Build a standards-compatible authenticator URI without logging it."""
    issuer = "Matrix-Law Admin"
    label = quote(f"{issuer}:{account}", safe="")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits={TOTP_DIGITS}&period={TOTP_PERIOD_SECONDS}"
