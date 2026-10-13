"""Authentication configuration for DeerFlow."""

import logging
import os
import secrets
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, EmailStr, Field, model_validator

logger = logging.getLogger(__name__)

_SECRET_FILE = ".jwt_secret"


def _optional_env(name: str) -> str | None:
    """Treat unset and explicitly empty deployment placeholders as absent."""
    value = os.environ.get(name, "").strip()
    return value or None


class AuthConfig(BaseModel):
    """JWT and auth-related configuration. Parsed once at startup.

    Note: the ``users`` table now lives in the shared persistence
    database managed by ``deerflow.persistence.engine``. The old
    ``users_db_path`` config key has been removed — user storage is
    configured through ``config.database`` like every other table.
    """

    jwt_secret: str = Field(
        ...,
        description="Secret key for JWT signing. MUST be set via AUTH_JWT_SECRET.",
    )
    token_expiry_days: int = Field(default=7, ge=1, le=30)
    oauth_github_client_id: str | None = Field(default=None)
    oauth_github_client_secret: str | None = Field(default=None)
    password_reset_smtp_host: str | None = Field(default=None, min_length=1)
    password_reset_smtp_port: int | None = Field(default=None, ge=1, le=65535)
    password_reset_smtp_username: str | None = Field(default=None)
    password_reset_smtp_password: str | None = Field(default=None)
    password_reset_encryption_key: str | None = Field(default=None, min_length=1)
    password_reset_from_email: EmailStr | None = Field(default=None)
    password_reset_public_base_url: str | None = Field(default=None)
    password_reset_smtp_security: Literal["starttls", "ssl"] = "starttls"
    mfa_required_for_admins: bool = False

    @model_validator(mode="after")
    def validate_password_reset_configuration(self) -> "AuthConfig":
        """Reject partial or unsafe public reset-mail configuration."""
        configured = any(
            (
                self.password_reset_smtp_host,
                self.password_reset_smtp_port,
                self.password_reset_smtp_username,
                self.password_reset_smtp_password,
                self.password_reset_encryption_key,
                self.password_reset_from_email,
                self.password_reset_public_base_url,
            )
        )
        if not configured:
            return self

        required = (
            self.password_reset_smtp_host,
            self.password_reset_from_email,
            self.password_reset_public_base_url,
        )
        if any(value is None or (isinstance(value, str) and not value.strip()) for value in required):
            raise ValueError("Password reset mail requires SMTP host, sender, and public base URL")
        if bool(self.password_reset_smtp_username) != bool(self.password_reset_smtp_password):
            raise ValueError("Password reset SMTP username and password must be configured together")
        if not self.password_reset_encryption_key:
            raise ValueError("Password reset mail requires AUTH_PASSWORD_RESET_ENCRYPTION_KEY")
        try:
            from cryptography.fernet import Fernet

            Fernet(self.password_reset_encryption_key.encode("ascii"))
        except (ImportError, UnicodeEncodeError, ValueError) as exc:
            raise ValueError("AUTH_PASSWORD_RESET_ENCRYPTION_KEY must be a valid Fernet key") from exc

        parsed = urlsplit(self.password_reset_public_base_url or "")
        local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if parsed.scheme != "https" and not local_http:
            raise ValueError("Password reset public base URL must use HTTPS")
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("Password reset public base URL must be an origin or path without credentials, query, or fragment")
        return self

    @property
    def password_reset_enabled(self) -> bool:
        """Whether all required mail and public-link settings are present."""
        return bool(self.password_reset_smtp_host and self.password_reset_from_email and self.password_reset_public_base_url and self.password_reset_encryption_key)

    @property
    def password_reset_smtp_effective_port(self) -> int:
        """Use the standard port for the configured SMTP transport when omitted."""
        if self.password_reset_smtp_port is not None:
            return self.password_reset_smtp_port
        return 465 if self.password_reset_smtp_security == "ssl" else 587


_auth_config: AuthConfig | None = None


def _load_or_create_secret() -> str:
    """Load persisted JWT secret from ``{base_dir}/.jwt_secret``, or generate and persist a new one."""
    from deerflow.config.paths import get_paths

    paths = get_paths()
    secret_file = paths.base_dir / _SECRET_FILE

    try:
        if secret_file.exists():
            secret = secret_file.read_text(encoding="utf-8").strip()
            if secret:
                return secret
    except OSError as exc:
        raise RuntimeError(f"Failed to read JWT secret from {secret_file}. Set AUTH_JWT_SECRET explicitly or fix DEER_FLOW_HOME/base directory permissions so Matrix-Law can read its persisted auth secret.") from exc

    secret = secrets.token_urlsafe(32)
    try:
        secret_file.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(secret_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(secret)
    except OSError as exc:
        raise RuntimeError(f"Failed to persist JWT secret to {secret_file}. Set AUTH_JWT_SECRET explicitly or fix DEER_FLOW_HOME/base directory permissions so Matrix-Law can store a stable auth secret.") from exc
    return secret


def get_auth_config() -> AuthConfig:
    """Get the global AuthConfig instance. Parses from env on first call."""
    global _auth_config
    if _auth_config is None:
        from dotenv import load_dotenv

        load_dotenv()
        jwt_secret = os.environ.get("AUTH_JWT_SECRET")
        if not jwt_secret:
            jwt_secret = _load_or_create_secret()
            os.environ["AUTH_JWT_SECRET"] = jwt_secret
            logger.warning(
                "⚠ AUTH_JWT_SECRET is not set — using an auto-generated secret "
                "persisted to .jwt_secret. Sessions will survive restarts. "
                "For production, add AUTH_JWT_SECRET to your .env file: "
                'python -c "import secrets; print(secrets.token_urlsafe(32))"'
            )
        _auth_config = AuthConfig(
            jwt_secret=jwt_secret,
            mfa_required_for_admins=os.environ.get("AUTH_MFA_REQUIRED_FOR_ADMINS", "").strip().lower() in {"1", "true", "yes", "on"},
            password_reset_smtp_host=_optional_env("AUTH_PASSWORD_RESET_SMTP_HOST"),
            password_reset_smtp_port=_optional_env("AUTH_PASSWORD_RESET_SMTP_PORT"),
            password_reset_smtp_username=_optional_env("AUTH_PASSWORD_RESET_SMTP_USERNAME"),
            password_reset_smtp_password=_optional_env("AUTH_PASSWORD_RESET_SMTP_PASSWORD"),
            password_reset_encryption_key=_optional_env("AUTH_PASSWORD_RESET_ENCRYPTION_KEY"),
            password_reset_from_email=_optional_env("AUTH_PASSWORD_RESET_FROM_EMAIL"),
            password_reset_public_base_url=_optional_env("AUTH_PASSWORD_RESET_PUBLIC_BASE_URL"),
            password_reset_smtp_security=(_optional_env("AUTH_PASSWORD_RESET_SMTP_SECURITY") or "starttls").lower(),
        )
    return _auth_config


def set_auth_config(config: AuthConfig) -> None:
    """Set the global AuthConfig instance (for testing)."""
    global _auth_config
    _auth_config = config
