"""User repository interface for abstracting database operations."""

from abc import ABC, abstractmethod
from datetime import datetime

from app.gateway.auth.models import User


class UserNotFoundError(LookupError):
    """Raised when a user repository operation targets a non-existent row.

    Subclass of :class:`LookupError` so callers that already catch
    ``LookupError`` for "missing entity" can keep working unchanged,
    while specific call sites can pin to this class to distinguish
    "concurrent delete during update" from other lookups.
    """


class UserRepository(ABC):
    """Abstract interface for user data storage.

    Implement this interface to support different storage backends
    (SQLite)
    """

    @abstractmethod
    async def create_user(self, user: User) -> User:
        """Create a new user.

        Args:
            user: User object to create

        Returns:
            Created User with ID assigned. ``email`` is the canonical
            (lowercase) stored form, which may differ in case from what was
            passed in -- implementations mutate the input ``user`` in place
            to reflect this rather than returning a fresh object.

        Raises:
            ValueError: If email already exists
        """
        raise NotImplementedError

    @abstractmethod
    async def get_user_by_id(self, user_id: str) -> User | None:
        """Get user by ID.

        Args:
            user_id: User UUID as string

        Returns:
            User if found, None otherwise
        """
        raise NotImplementedError

    @abstractmethod
    async def get_user_by_email(self, email: str) -> User | None:
        """Get user by email.

        Args:
            email: User email address

        Returns:
            User if found, None otherwise
        """
        raise NotImplementedError

    @abstractmethod
    async def update_user(self, user: User) -> User:
        """Update an existing user.

        Args:
            user: User object with updated fields

        Returns:
            Updated User. ``email`` is the canonical (lowercase) stored
            form -- implementations mutate the input ``user`` in place to
            reflect this rather than returning a fresh object.

        Raises:
            UserNotFoundError: If no row exists for ``user.id``. This is
                a hard failure (not a no-op) so callers cannot mistake a
                concurrent-delete race for a successful update.
        """
        raise NotImplementedError

    @abstractmethod
    async def set_password_if_token_version(self, user_id: str, expected_version: int, password_hash: str) -> bool:
        """Replace a local password once, fenced by the current session version.

        Returns ``True`` only when one local-password row matched and was
        updated. Implementations must perform the version check and increment
        atomically so two redemptions of one reset token cannot both succeed.
        """
        raise NotImplementedError

    @abstractmethod
    async def enqueue_password_reset_mail(self, *, user_id: str, token_version: int, recipient: str, token_ciphertext: str, expires_at: datetime) -> bool:
        """Persist mail only while the addressed local account/version is current."""
        raise NotImplementedError

    @abstractmethod
    async def claim_password_reset_mail(self, *, now: datetime, stale_after: datetime) -> dict | None:
        """Atomically claim one due row; stale in-flight rows are erased, never resent."""
        raise NotImplementedError

    @abstractmethod
    async def finish_password_reset_mail(self, mail_id: str) -> None:
        """Erase a delivered or terminal outbox row."""
        raise NotImplementedError

    @abstractmethod
    async def retry_password_reset_mail(self, mail_id: str, *, next_attempt_at: datetime, max_attempts: int) -> None:
        """Requeue only a definite temporary SMTP rejection; otherwise erase."""
        raise NotImplementedError

    @abstractmethod
    async def purge_password_reset_mail(self) -> None:
        """Erase pending reset mail when delivery is disabled."""
        raise NotImplementedError

    @abstractmethod
    async def consume_password_reset_rate_limits(
        self,
        *,
        buckets: dict[str, int],
        now: datetime,
        window_start: datetime,
        expires_at: datetime,
    ) -> bool:
        """Atomically increment keyed buckets and report whether every limit passes."""
        raise NotImplementedError

    @abstractmethod
    async def set_mfa_challenge(self, user_id: str, expected_version: int, challenge_id: str) -> bool:
        """Replace the user's single active password-verified MFA challenge."""
        raise NotImplementedError

    @abstractmethod
    async def save_mfa_setup(self, user_id: str, expected_version: int, challenge_id: str, secret_ciphertext: str, recovery_hashes: list[str]) -> bool:
        """Save pending MFA enrollment and its recovery-code digests atomically."""
        raise NotImplementedError

    @abstractmethod
    async def confirm_mfa_setup(self, user_id: str, expected_version: int, challenge_id: str, counter: int) -> bool:
        """Activate pending TOTP only for the matching challenge and fresh code."""
        raise NotImplementedError

    @abstractmethod
    async def consume_mfa_totp(self, user_id: str, expected_version: int, challenge_id: str, counter: int) -> bool:
        """Atomically consume the challenge and reject replayed TOTP steps."""
        raise NotImplementedError

    @abstractmethod
    async def consume_mfa_recovery_code(self, user_id: str, expected_version: int, challenge_id: str, code_hash: str) -> bool:
        """Atomically consume the challenge and one recovery-code digest."""
        raise NotImplementedError

    @abstractmethod
    async def count_users(self) -> int:
        """Return total number of registered users."""
        raise NotImplementedError

    @abstractmethod
    async def count_admin_users(self) -> int:
        """Return number of users with system_role == 'admin'."""
        raise NotImplementedError

    @abstractmethod
    async def get_user_by_oauth(self, provider: str, oauth_id: str) -> User | None:
        """Get user by OAuth provider and ID.

        Args:
            provider: OAuth provider name (e.g. 'github', 'google')
            oauth_id: User ID from the OAuth provider

        Returns:
            User if found, None otherwise
        """
        raise NotImplementedError
