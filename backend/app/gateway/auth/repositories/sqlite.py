"""SQLAlchemy-backed UserRepository implementation.

Uses the shared async session factory from
``deerflow.persistence.engine`` — the ``users`` table lives in the
same database as ``threads_meta``, ``runs``, ``run_events``, and
``feedback``.

Constructor takes the session factory directly (same pattern as the
other four repositories in ``deerflow.persistence.*``). Callers
construct this after ``init_engine_from_config()`` has run.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import and_, case, delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.gateway.auth.models import User
from app.gateway.auth.repositories.base import UserNotFoundError, UserRepository
from deerflow.persistence.user.model import (
    OAUTH_IDENTITY_INDEX_NAME,
    PasswordResetOutboxRow,
    PasswordResetRateLimitRow,
    UserMFARecoveryCodeRow,
    UserRow,
)

# ``email`` is ``mapped_column(unique=True, index=True)``, which SQLAlchemy
# (and 0001_baseline) realise as a single UNIQUE INDEX -- not a named UNIQUE
# constraint -- so a Postgres duplicate reports the index name here.
_EMAIL_UNIQUE_INDEX_NAME = "ix_users_email"


class _MFAChallengeChanged(RuntimeError):
    """Internal sentinel used to roll back a recovery-code consume race."""


def _driver_constraint_name(exc: IntegrityError) -> str | None:
    """The violated constraint's name from the driver exception, or ``None``
    when the driver does not expose one.

    ``exc.orig`` is NOT the raw driver error. SQLAlchemy's asyncpg dialect
    re-raises a plain ``AsyncAdapt_asyncpg_dbapi.IntegrityError`` built from a
    rendered string and carrying only ``pgcode``/``sqlstate``
    (``sqlalchemy/dialects/postgresql/asyncpg.py::_handle_exception``); the
    real ``asyncpg.UniqueViolationError`` — the one with ``constraint_name`` —
    survives as ``exc.orig.__cause__`` (``raise translated_error from error``).
    aiosqlite exposes no constraint name at all. Check the wrapper, then its
    cause.
    """
    for obj in (exc.orig, getattr(exc.orig, "__cause__", None)):
        name = getattr(obj, "constraint_name", None)
        if name:
            return str(name)
    return None


def _is_oauth_identity_violation(exc: IntegrityError) -> bool:
    """Distinguish the ``idx_users_oauth_identity`` (oauth_provider, oauth_id)
    unique-index violation from any OTHER ``IntegrityError`` reaching this
    commit (a duplicate primary key, or a duplicate-email race that slipped
    past the pre-check above).

    Never uses the SQLAlchemy wrapper's ``str(exc)``: it embeds the full
    failed INSERT statement, whose column list names
    ``oauth_provider``/``oauth_id`` on every call regardless of which
    constraint fired, so a substring check on it misclassifies every
    commit-time ``IntegrityError`` on this table as an OAuth conflict
    (reproduced on SQLite: a duplicate ``id`` raised "OAuth account already
    linked: None/None").

    Postgres: match :data:`OAUTH_IDENTITY_INDEX_NAME` against the driver
    constraint name (see :func:`_driver_constraint_name`). SQLite: no
    structured name, only a message naming the columns (``"UNIQUE constraint
    failed: users.oauth_provider, users.oauth_id"``) — require BOTH oauth
    column names, not a bare "oauth" substring.
    """
    name = _driver_constraint_name(exc)
    if name is not None:
        return name == OAUTH_IDENTITY_INDEX_NAME
    message = str(exc.orig).lower()
    return "oauth_provider" in message and "oauth_id" in message


def _is_email_violation(exc: IntegrityError) -> bool:
    """True when ``exc`` is the ``ix_users_email`` uniqueness violation, using
    the same driver-exception inspection as
    :func:`_is_oauth_identity_violation` (never ``str(exc)``, whose INSERT text
    names every column)."""
    name = _driver_constraint_name(exc)
    if name is not None:
        return name == _EMAIL_UNIQUE_INDEX_NAME
    return "users.email" in str(exc.orig).lower()


def _is_uniqueness_violation(exc: IntegrityError) -> bool:
    """True for a unique-index / primary-key violation specifically, as
    opposed to a NOT NULL / CHECK / foreign-key ``IntegrityError`` on the same
    INSERT -- only the former means "a user like this already exists"."""
    sqlstate = getattr(exc.orig, "sqlstate", None) or getattr(exc.orig, "pgcode", None)
    if sqlstate is not None:
        return sqlstate == "23505"  # unique_violation
    message = str(exc.orig).lower()
    return "unique constraint failed" in message or "primary key constraint failed" in message


def _violated_constraint(exc: IntegrityError) -> str | None:
    """Best-effort name of the constraint behind ``exc``, for a diagnostic that
    does not pin an unattributed violation on a specific column. Uses the
    driver constraint name where available, else the column(s) SQLite names in
    its message (``"UNIQUE constraint failed: users.id"``)."""
    name = _driver_constraint_name(exc)
    if name:
        return name
    marker = "constraint failed: "
    message = str(exc.orig)
    if marker in message:
        return message.split(marker, 1)[1].splitlines()[0].strip() or None
    return None


def _normalize_email(email: str) -> str:
    """Canonicalise an email address for storage and lookup.

    An email identifies exactly one account regardless of the case the client
    sends. The two write paths would otherwise disagree: local registration
    normalises through ``EmailStr``, which lowercases only the *domain* and
    keeps the local-part case (``Victim@X.COM`` -> ``Victim@x.com``), while OIDC
    provisioning lowercases the whole address (``-> victim@x.com``). Combined
    with the previous case-sensitive lookup, ``Victim@x.com`` and
    ``victim@x.com`` resolved to two separate rows, defeating the invariant
    that a local account blocks an SSO login on the same email.

    Canonicalising to lowercase at every write site and matching
    case-insensitively on read closes that gap for new accounts while letting
    existing mixed-case rows keep resolving, without a destructive bulk rewrite.
    """
    return email.lower()


class SQLiteUserRepository(UserRepository):
    """Async user repository backed by the shared SQLAlchemy engine."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._sf = session_factory

    # ── Converters ────────────────────────────────────────────────────

    @staticmethod
    def _row_to_user(row: UserRow) -> User:
        return User(
            id=UUID(row.id),
            email=row.email,
            password_hash=row.password_hash,
            system_role=row.system_role,  # type: ignore[arg-type]
            # SQLite loses tzinfo on read; reattach UTC so downstream
            # code can compare timestamps reliably.
            created_at=row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=UTC),
            oauth_provider=row.oauth_provider,
            oauth_id=row.oauth_id,
            needs_setup=row.needs_setup,
            token_version=row.token_version,
            mfa_enabled=row.mfa_enabled,
            mfa_secret_ciphertext=row.mfa_secret_ciphertext,
            mfa_last_counter=row.mfa_last_counter,
            mfa_challenge_id=row.mfa_challenge_id,
        )

    @staticmethod
    def _user_to_row(user: User) -> UserRow:
        return UserRow(
            id=str(user.id),
            email=user.email,
            password_hash=user.password_hash,
            system_role=user.system_role,
            created_at=user.created_at,
            oauth_provider=user.oauth_provider,
            oauth_id=user.oauth_id,
            needs_setup=user.needs_setup,
            token_version=user.token_version,
            mfa_enabled=user.mfa_enabled,
            mfa_secret_ciphertext=user.mfa_secret_ciphertext,
            mfa_last_counter=user.mfa_last_counter,
            mfa_challenge_id=user.mfa_challenge_id,
        )

    # ── CRUD ──────────────────────────────────────────────────────────

    async def create_user(self, user: User) -> User:
        """Insert a new user. Raises ``ValueError`` on any uniqueness
        violation -- duplicate email, a duplicate (provider, oauth_id) pair
        for an OAuth-linked account, or a duplicate id -- with a message
        naming the specific conflict. Other ``IntegrityError``\\ s (NOT NULL,
        CHECK, foreign key) propagate unchanged.

        The email is canonicalised to lowercase before insert so the existing
        unique constraint enforces case-insensitive uniqueness for new rows and
        the returned ``User`` reflects the stored form.
        """
        user.email = _normalize_email(user.email)
        row = self._user_to_row(user)
        async with self._sf() as session:
            # The unique constraint is case-sensitive, so it cannot catch a
            # canonical address colliding with a mixed-case legacy row.
            existing = select(UserRow.id).where(func.lower(UserRow.email) == user.email).limit(1)
            if await session.scalar(existing) is not None:
                raise ValueError(f"Email already registered: {user.email}")
            session.add(row)
            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                # The email pre-check above already ruled out an email
                # collision under normal (non-racing) conditions, so
                # IntegrityErrors reaching here are usually
                # idx_users_oauth_identity -- but not always (a duplicate
                # primary key, or an email collision that raced past the
                # pre-check). Attribute the failure to the constraint that
                # actually fired instead of assuming any one of them.
                if _is_oauth_identity_violation(exc):
                    raise ValueError(f"OAuth account already linked: {user.oauth_provider}/{user.oauth_id}") from exc
                if _is_email_violation(exc):
                    # A duplicate address that got past the pre-check: a
                    # concurrent insert of the same email.
                    raise ValueError(f"Email already registered: {user.email}") from exc
                if _is_uniqueness_violation(exc):
                    # Some other unique index / primary key (in practice a
                    # duplicate id). "Already exists" fits, but don't dress it
                    # up as an email conflict for an address that isn't
                    # registered.
                    constraint = _violated_constraint(exc)
                    raise ValueError(f"User already exists (constraint: {constraint})" if constraint else "User already exists") from exc
                # A NOT NULL / CHECK / foreign-key IntegrityError is not a
                # "user already exists" condition and not part of this
                # method's ValueError contract -- let it propagate.
                raise
        return user

    async def get_user_by_id(self, user_id: str) -> User | None:
        async with self._sf() as session:
            row = await session.get(UserRow, user_id)
            return self._row_to_user(row) if row is not None else None

    async def get_user_by_email(self, email: str) -> User | None:
        # Case-insensitive match: an account is keyed by its email regardless of
        # the case the caller supplies (see ``_normalize_email``). ``.first()``
        # with a deterministic ``created_at`` ordering resolves to the oldest
        # account instead of raising if a pre-fix database already holds two
        # rows differing only in case, so the fix never turns a legacy duplicate
        # pair into a 500. ``id`` is a secondary tiebreaker so the choice stays
        # deterministic even if two legacy rows share the same ``created_at``.
        stmt = select(UserRow).where(func.lower(UserRow.email) == _normalize_email(email)).order_by(UserRow.created_at, UserRow.id).limit(1)
        async with self._sf() as session:
            result = await session.execute(stmt)
            row = result.scalars().first()
            return self._row_to_user(row) if row is not None else None

    async def update_user(self, user: User) -> User:
        async with self._sf() as session:
            row = await session.get(UserRow, str(user.id))
            if row is None:
                # Hard fail on concurrent delete: callers (reset_admin,
                # password change handlers, _ensure_admin_user) all
                # fetched the user just before this call, so a missing
                # row here means the row vanished underneath us. Silent
                # success would let the caller log "password reset" for
                # a row that no longer exists.
                raise UserNotFoundError(f"User {user.id} no longer exists")
            # Canonicalise the email only when it actually changes, comparing
            # case-insensitively against the stored value, then mirror the
            # persisted value back onto the returned object. Re-lowercasing an
            # *unchanged* legacy mixed-case email — e.g. a password-only update
            # on a pre-fix ``Victim@x.com`` row while a canonical ``victim@x.com``
            # row also exists — would rewrite it onto the other row's unique
            # email and raise IntegrityError, surfacing as a 500 on the
            # change-password / reset-admin paths that do not catch it. Guarding
            # against the *raw* stored value (``canonical != row.email``) is not
            # enough: the mixed-case row's canonical form still differs from its
            # own stored casing, so it would rewrite and collide anyway. A genuine
            # change still normalises, so the unique constraint keeps enforcing
            # case-insensitive uniqueness for updated rows; get_user_by_email
            # already resolves legacy mixed-case rows case-insensitively on read.
            canonical_email = _normalize_email(user.email)
            if canonical_email != _normalize_email(row.email):
                row.email = canonical_email
            user.email = row.email
            row.password_hash = user.password_hash
            row.system_role = user.system_role
            row.oauth_provider = user.oauth_provider
            row.oauth_id = user.oauth_id
            row.needs_setup = user.needs_setup
            row.token_version = user.token_version
            row.mfa_enabled = user.mfa_enabled
            row.mfa_secret_ciphertext = user.mfa_secret_ciphertext
            row.mfa_last_counter = user.mfa_last_counter
            row.mfa_challenge_id = user.mfa_challenge_id
            await session.commit()
        return user

    async def transition_bootstrap_owner(self, user: User) -> User | None:
        admin_count = select(func.count()).select_from(UserRow).where(UserRow.system_role == "admin").correlate(None).scalar_subquery()
        stmt = (
            update(UserRow)
            .where(UserRow.id == str(user.id), UserRow.system_role == "admin", UserRow.token_version == user.token_version, UserRow.password_hash == user.password_hash, admin_count > 1)
            .values(system_role="user", token_version=UserRow.token_version + 1, mfa_challenge_id=None)
            .returning(UserRow)
            .execution_options(synchronize_session=False)
        )
        async with self._sf() as session:
            row = (await session.execute(stmt)).scalar_one_or_none()
            result = self._row_to_user(row) if row is not None else None
            await session.commit()
            return result

    async def set_password_if_token_version(self, user_id: str, expected_version: int, password_hash: str) -> bool:
        """Atomically consume a reset token by advancing the session version."""
        stmt = (
            update(UserRow)
            .where(
                UserRow.id == user_id,
                UserRow.token_version == expected_version,
                UserRow.password_hash.is_not(None),
            )
            .values(password_hash=password_hash, token_version=UserRow.token_version + 1)
            .execution_options(synchronize_session=False)
        )
        async with self._sf() as session:
            result = await session.execute(stmt)
            await session.commit()
            return result.rowcount == 1

    async def enqueue_password_reset_mail(self, *, user_id: str, token_version: int, recipient: str, token_ciphertext: str, expires_at: datetime) -> bool:
        async with self._sf() as session:
            current = select(UserRow.id).where(
                UserRow.id == user_id,
                UserRow.token_version == token_version,
                UserRow.password_hash.is_not(None),
            )
            if await session.scalar(current) is None:
                return False
            session.add(
                PasswordResetOutboxRow(
                    id=str(uuid4()),
                    user_id=user_id,
                    token_version=token_version,
                    purpose="password_reset",
                    expires_at=expires_at,
                    recipient=recipient,
                    token_ciphertext=token_ciphertext,
                    status="queued",
                    attempt_count=0,
                    next_attempt_at=datetime.now(UTC),
                )
            )
            await session.commit()
            return True

    async def claim_password_reset_mail(self, *, now: datetime, stale_after: datetime) -> dict | None:
        async with self._sf() as session:
            # A worker that died while SMTP was in progress may have reached
            # DATA. Erase that row instead of risking a duplicate delivery.
            valid_user = exists(
                select(UserRow.id).where(
                    UserRow.id == PasswordResetOutboxRow.user_id,
                    UserRow.token_version == PasswordResetOutboxRow.token_version,
                    UserRow.password_hash.is_not(None),
                )
            )
            await session.execute(
                delete(PasswordResetOutboxRow).where(
                    or_(
                        PasswordResetOutboxRow.expires_at <= now,
                        and_(PasswordResetOutboxRow.status == "sending", PasswordResetOutboxRow.claimed_at <= stale_after),
                        ~valid_user,
                        PasswordResetOutboxRow.purpose != "password_reset",
                    )
                )
            )
            candidate = (
                select(PasswordResetOutboxRow.id)
                .where(
                    PasswordResetOutboxRow.status == "queued",
                    PasswordResetOutboxRow.next_attempt_at <= now,
                    PasswordResetOutboxRow.expires_at > now,
                    PasswordResetOutboxRow.recipient.is_not(None),
                    PasswordResetOutboxRow.token_ciphertext.is_not(None),
                    valid_user,
                    PasswordResetOutboxRow.purpose == "password_reset",
                )
                .order_by(PasswordResetOutboxRow.next_attempt_at, PasswordResetOutboxRow.id)
                .limit(1)
                .scalar_subquery()
            )
            claimed = await session.execute(
                update(PasswordResetOutboxRow)
                .where(PasswordResetOutboxRow.id == candidate, PasswordResetOutboxRow.status == "queued")
                .values(status="sending", attempt_count=PasswordResetOutboxRow.attempt_count + 1, claimed_at=now)
                .returning(
                    PasswordResetOutboxRow.id,
                    PasswordResetOutboxRow.user_id,
                    PasswordResetOutboxRow.token_version,
                    PasswordResetOutboxRow.purpose,
                    PasswordResetOutboxRow.expires_at,
                    PasswordResetOutboxRow.recipient,
                    PasswordResetOutboxRow.token_ciphertext,
                    PasswordResetOutboxRow.attempt_count,
                )
            )
            row = claimed.mappings().first()
            await session.commit()
            return dict(row) if row is not None else None

    async def finish_password_reset_mail(self, mail_id: str) -> None:
        async with self._sf() as session:
            await session.execute(delete(PasswordResetOutboxRow).where(PasswordResetOutboxRow.id == mail_id))
            await session.commit()

    async def retry_password_reset_mail(self, mail_id: str, *, next_attempt_at: datetime, max_attempts: int) -> None:
        async with self._sf() as session:
            result = await session.execute(
                update(PasswordResetOutboxRow)
                .where(PasswordResetOutboxRow.id == mail_id, PasswordResetOutboxRow.status == "sending")
                .values(status="queued", claimed_at=None, next_attempt_at=next_attempt_at)
                .returning(PasswordResetOutboxRow.attempt_count, PasswordResetOutboxRow.expires_at)
            )
            row = result.first()
            expires_at = row.expires_at.replace(tzinfo=row.expires_at.tzinfo or UTC) if row is not None else None
            if row is not None and (row.attempt_count >= max_attempts or expires_at <= next_attempt_at):
                await session.execute(delete(PasswordResetOutboxRow).where(PasswordResetOutboxRow.id == mail_id))
            await session.commit()

    async def purge_password_reset_mail(self) -> None:
        async with self._sf() as session:
            await session.execute(delete(PasswordResetOutboxRow))
            await session.commit()

    async def consume_password_reset_rate_limits(
        self,
        *,
        buckets: dict[str, int],
        now: datetime,
        window_start: datetime,
        expires_at: datetime,
    ) -> bool:
        """Atomically increment each keyed bucket in the shared auth store."""
        async with self._sf() as session:
            dialect = session.get_bind().dialect.name
            if dialect == "sqlite":
                insert = sqlite_insert
            elif dialect == "postgresql":
                insert = pg_insert
            else:
                raise RuntimeError("Shared password-reset rate limits require SQLite or PostgreSQL")

            await session.execute(delete(PasswordResetRateLimitRow).where(PasswordResetRateLimitRow.expires_at <= now))
            counts: dict[str, int] = {}
            for bucket_key, limit in sorted(buckets.items()):
                expired = PasswordResetRateLimitRow.window_started_at <= window_start
                statement = (
                    insert(PasswordResetRateLimitRow)
                    .values(
                        bucket_key=bucket_key,
                        window_started_at=now,
                        request_count=1,
                        expires_at=expires_at,
                    )
                    .on_conflict_do_update(
                        index_elements=[PasswordResetRateLimitRow.bucket_key],
                        set_={
                            "window_started_at": case((expired, now), else_=PasswordResetRateLimitRow.window_started_at),
                            "request_count": case((expired, 1), else_=PasswordResetRateLimitRow.request_count + 1),
                            "expires_at": expires_at,
                        },
                    )
                    .returning(PasswordResetRateLimitRow.request_count)
                )
                count = await session.scalar(statement)
                if count is None:
                    raise RuntimeError("Shared password-reset rate limit counter was not returned")
                counts[bucket_key] = int(count)
            await session.commit()
            return all(counts[key] <= limit for key, limit in buckets.items())

    async def set_mfa_challenge(self, user_id: str, expected_version: int, challenge_id: str) -> bool:
        stmt = (
            update(UserRow)
            .where(UserRow.id == user_id, UserRow.token_version == expected_version, or_(UserRow.system_role == "admin", UserRow.mfa_enabled.is_(True)))
            .values(mfa_challenge_id=challenge_id)
            .execution_options(synchronize_session=False)
        )
        async with self._sf() as session:
            result = await session.execute(stmt)
            await session.commit()
            return result.rowcount == 1

    async def save_mfa_setup(
        self,
        user_id: str,
        expected_version: int,
        challenge_id: str,
        secret_ciphertext: str,
        recovery_hashes: list[str],
    ) -> bool:
        stmt = (
            update(UserRow)
            .where(
                UserRow.id == user_id,
                UserRow.token_version == expected_version,
                UserRow.system_role == "admin",
                UserRow.mfa_challenge_id == challenge_id,
                UserRow.mfa_enabled.is_(False),
            )
            .values(mfa_secret_ciphertext=secret_ciphertext, mfa_last_counter=-1)
            .execution_options(synchronize_session=False)
        )
        async with self._sf() as session:
            async with session.begin():
                result = await session.execute(stmt)
                if result.rowcount != 1:
                    return False
                await session.execute(delete(UserMFARecoveryCodeRow).where(UserMFARecoveryCodeRow.user_id == user_id))
                session.add_all(UserMFARecoveryCodeRow(user_id=user_id, code_hash=value) for value in recovery_hashes)
            return True

    async def confirm_mfa_setup(self, user_id: str, expected_version: int, challenge_id: str, counter: int) -> bool:
        stmt = (
            update(UserRow)
            .where(
                UserRow.id == user_id,
                UserRow.token_version == expected_version,
                UserRow.system_role == "admin",
                UserRow.mfa_challenge_id == challenge_id,
                UserRow.mfa_enabled.is_(False),
                UserRow.mfa_secret_ciphertext.is_not(None),
            )
            .values(mfa_enabled=True, mfa_last_counter=counter, mfa_challenge_id=None)
            .execution_options(synchronize_session=False)
        )
        async with self._sf() as session:
            async with session.begin():
                code_count = await session.scalar(select(func.count()).select_from(UserMFARecoveryCodeRow).where(UserMFARecoveryCodeRow.user_id == user_id))
                if not code_count or code_count < 5:
                    return False
                result = await session.execute(stmt)
                return result.rowcount == 1

    async def consume_mfa_totp(self, user_id: str, expected_version: int, challenge_id: str, counter: int) -> bool:
        stmt = (
            update(UserRow)
            .where(
                UserRow.id == user_id,
                UserRow.token_version == expected_version,
                UserRow.mfa_enabled.is_(True),
                UserRow.mfa_challenge_id == challenge_id,
                UserRow.mfa_last_counter < counter,
            )
            .values(mfa_last_counter=counter, mfa_challenge_id=None)
            .execution_options(synchronize_session=False)
        )
        async with self._sf() as session:
            result = await session.execute(stmt)
            await session.commit()
            return result.rowcount == 1

    async def consume_mfa_recovery_code(self, user_id: str, expected_version: int, challenge_id: str, code_hash: str) -> bool:
        try:
            async with self._sf() as session:
                async with session.begin():
                    user_stmt = (
                        select(UserRow.id)
                        .where(
                            UserRow.id == user_id,
                            UserRow.token_version == expected_version,
                            UserRow.mfa_enabled.is_(True),
                            UserRow.mfa_challenge_id == challenge_id,
                        )
                        .with_for_update()
                    )
                    if await session.scalar(user_stmt) is None:
                        return False
                    consumed = await session.execute(delete(UserMFARecoveryCodeRow).where(UserMFARecoveryCodeRow.user_id == user_id, UserMFARecoveryCodeRow.code_hash == code_hash))
                    if consumed.rowcount != 1:
                        return False
                    updated = await session.execute(
                        update(UserRow)
                        .where(
                            UserRow.id == user_id,
                            UserRow.token_version == expected_version,
                            UserRow.mfa_challenge_id == challenge_id,
                        )
                        .values(mfa_challenge_id=None)
                        .execution_options(synchronize_session=False)
                    )
                    if updated.rowcount != 1:
                        raise _MFAChallengeChanged
            return True
        except _MFAChallengeChanged:
            return False

    async def count_users(self) -> int:
        stmt = select(func.count()).select_from(UserRow)
        async with self._sf() as session:
            return await session.scalar(stmt) or 0

    async def count_admin_users(self) -> int:
        stmt = select(func.count()).select_from(UserRow).where(UserRow.system_role == "admin")
        async with self._sf() as session:
            return await session.scalar(stmt) or 0

    async def get_user_by_oauth(self, provider: str, oauth_id: str) -> User | None:
        stmt = select(UserRow).where(UserRow.oauth_provider == provider, UserRow.oauth_id == oauth_id)
        async with self._sf() as session:
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            return self._row_to_user(row) if row is not None else None
