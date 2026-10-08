"""JWT token creation and verification."""

import secrets
from datetime import UTC, datetime, timedelta

import jwt
from pydantic import BaseModel

from app.gateway.auth.config import get_auth_config
from app.gateway.auth.errors import TokenError


class TokenPayload(BaseModel):
    """JWT token payload."""

    sub: str  # user_id
    exp: datetime
    iat: datetime | None = None
    ver: int = 0  # token_version — must match User.token_version


class PasswordResetPayload(BaseModel):
    """Short-lived, purpose-bound password reset token claims."""

    sub: str
    exp: datetime
    iat: datetime
    aud: str
    purpose: str
    ver: int
    jti: str


def create_access_token(user_id: str, expires_delta: timedelta | None = None, token_version: int = 0) -> str:
    """Create a JWT access token.

    Args:
        user_id: The user's UUID as string
        expires_delta: Optional custom expiry, defaults to 7 days
        token_version: User's current token_version for invalidation

    Returns:
        Encoded JWT string
    """
    config = get_auth_config()
    expiry = expires_delta or timedelta(days=config.token_expiry_days)

    now = datetime.now(UTC)
    payload = {"sub": user_id, "exp": now + expiry, "iat": now, "ver": token_version}
    return jwt.encode(payload, config.jwt_secret, algorithm="HS256")


def create_password_reset_token(user_id: str, token_version: int) -> str:
    """Create a 20-minute reset token that access-token decoding rejects."""
    config = get_auth_config()
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "exp": now + timedelta(minutes=20),
        "iat": now,
        "aud": "deerflow-password-reset",
        "purpose": "password_reset",
        "ver": token_version,
        "jti": secrets.token_urlsafe(18),
    }
    return jwt.encode(payload, config.jwt_secret, algorithm="HS256")


def decode_password_reset_token(token: str) -> PasswordResetPayload | None:
    """Validate signature, expiry, audience, and reset-only purpose claims."""
    config = get_auth_config()
    try:
        payload = jwt.decode(
            token,
            config.jwt_secret,
            algorithms=["HS256"],
            audience="deerflow-password-reset",
            options={"require": ["sub", "exp", "iat", "aud", "purpose", "ver", "jti"]},
        )
        parsed = PasswordResetPayload(**payload)
        if parsed.purpose != "password_reset" or parsed.ver < 0 or not parsed.jti:
            return None
        return parsed
    except (jwt.PyJWTError, ValueError):
        return None


def decode_token(token: str) -> TokenPayload | TokenError:
    """Decode and validate a JWT token.

    Returns:
        TokenPayload if valid, or a specific TokenError variant.
    """
    config = get_auth_config()
    try:
        payload = jwt.decode(token, config.jwt_secret, algorithms=["HS256"])
        return TokenPayload(**payload)
    except jwt.ExpiredSignatureError:
        return TokenError.EXPIRED
    except jwt.InvalidSignatureError:
        return TokenError.INVALID_SIGNATURE
    except jwt.PyJWTError:
        return TokenError.MALFORMED
