"""Local email/password authentication provider."""

import logging
from datetime import datetime

from app.gateway.auth.models import User
from app.gateway.auth.password import hash_password_async, needs_rehash, verify_password_async
from app.gateway.auth.providers import AuthProvider
from app.gateway.auth.repositories.base import UserRepository

logger = logging.getLogger(__name__)


class LocalAuthProvider(AuthProvider):
    """Email/password authentication provider using local database."""

    def __init__(self, repository: UserRepository):
        """Initialize with a UserRepository.

        Args:
            repository: UserRepository implementation (SQLite)
        """
        self._repo = repository

    @property
    def repository(self) -> UserRepository:
        """Expose the same durable auth repository to auth-owned services."""
        return self._repo

    async def authenticate(self, credentials: dict) -> User | None:
        """Authenticate with email and password.

        Args:
            credentials: dict with 'email' and 'password' keys

        Returns:
            User if authentication succeeds, None otherwise
        """
        email = credentials.get("email")
        password = credentials.get("password")

        if not email or not password:
            return None

        user = await self._repo.get_user_by_email(email)
        if user is None:
            return None

        if user.password_hash is None:
            # OAuth user without local password
            return None

        if not await verify_password_async(password, user.password_hash):
            return None

        if needs_rehash(user.password_hash):
            try:
                user.password_hash = await hash_password_async(password)
                await self._repo.update_user(user)
            except Exception:
                # Rehash is an opportunistic upgrade; a transient DB error must not
                # prevent an otherwise-valid login from succeeding.
                logger.warning("Failed to rehash password for user %s; login will still succeed", user.email, exc_info=True)

        return user

    async def get_user(self, user_id: str) -> User | None:
        """Get user by ID."""
        return await self._repo.get_user_by_id(user_id)

    async def create_user(self, email: str, password: str | None = None, system_role: str = "user", needs_setup: bool = False) -> User:
        """Create a new local user.

        Args:
            email: User email address
            password: Plain text password (will be hashed)
            system_role: Role to assign ("admin" or "user")
            needs_setup: If True, user must complete setup on first login

        Returns:
            Created User instance
        """
        password_hash = await hash_password_async(password) if password else None
        user = User(
            email=email,
            password_hash=password_hash,
            system_role=system_role,
            needs_setup=needs_setup,
        )
        return await self._repo.create_user(user)

    async def get_user_by_oauth(self, provider: str, oauth_id: str) -> User | None:
        """Get user by OAuth provider and ID."""
        return await self._repo.get_user_by_oauth(provider, oauth_id)

    async def count_users(self) -> int:
        """Return total number of registered users."""
        return await self._repo.count_users()

    async def count_admin_users(self) -> int:
        """Return number of admin users."""
        return await self._repo.count_admin_users()

    async def update_user(self, user: User) -> User:
        """Update an existing user."""
        return await self._repo.update_user(user)

    async def transition_bootstrap_owner(self, user: User) -> User | None:
        return await self._repo.transition_bootstrap_owner(user)

    async def reset_password_if_token_version(self, user_id: str, expected_version: int, new_password: str) -> bool:
        """Hash and atomically apply a password reset once."""
        password_hash = await hash_password_async(new_password)
        return await self._repo.set_password_if_token_version(user_id, expected_version, password_hash)

    async def enqueue_password_reset_mail(self, *, user_id: str, token_version: int, recipient: str, token_ciphertext: str, expires_at: datetime) -> bool:
        return await self._repo.enqueue_password_reset_mail(
            user_id=user_id,
            token_version=token_version,
            recipient=recipient,
            token_ciphertext=token_ciphertext,
            expires_at=expires_at,
        )

    async def consume_password_reset_rate_limits(self, *, buckets: dict[str, int], now: datetime, window_start: datetime, expires_at: datetime) -> bool:
        return await self._repo.consume_password_reset_rate_limits(
            buckets=buckets,
            now=now,
            window_start=window_start,
            expires_at=expires_at,
        )

    async def set_mfa_challenge(self, user_id: str, expected_version: int, challenge_id: str) -> bool:
        return await self._repo.set_mfa_challenge(user_id, expected_version, challenge_id)

    async def save_mfa_setup(self, user_id: str, expected_version: int, challenge_id: str, secret_ciphertext: str, recovery_hashes: list[str]) -> bool:
        return await self._repo.save_mfa_setup(user_id, expected_version, challenge_id, secret_ciphertext, recovery_hashes)

    async def confirm_mfa_setup(self, user_id: str, expected_version: int, challenge_id: str, counter: int) -> bool:
        return await self._repo.confirm_mfa_setup(user_id, expected_version, challenge_id, counter)

    async def consume_mfa_totp(self, user_id: str, expected_version: int, challenge_id: str, counter: int) -> bool:
        return await self._repo.consume_mfa_totp(user_id, expected_version, challenge_id, counter)

    async def consume_mfa_recovery_code(self, user_id: str, expected_version: int, challenge_id: str, code_hash: str) -> bool:
        return await self._repo.consume_mfa_recovery_code(user_id, expected_version, challenge_id, code_hash)

    async def get_user_by_email(self, email: str) -> User | None:
        """Get user by email."""
        return await self._repo.get_user_by_email(email)

    async def create_oauth_user(
        self,
        email: str,
        oauth_provider: str,
        oauth_id: str,
        system_role: str = "user",
    ) -> User:
        """Create a new user from an OAuth/OIDC login.

        Args:
            email: Verified email from the OIDC provider
            oauth_provider: Provider ID (e.g. 'keycloak', 'google')
            oauth_id: User's subject claim from the ID token
            system_role: Role to assign ("admin" or "user")

        Returns:
            Created User instance
        """
        user = User(
            email=email,
            password_hash=None,
            system_role=system_role,
            needs_setup=False,
            oauth_provider=oauth_provider,
            oauth_id=oauth_id,
        )
        return await self._repo.create_user(user)
