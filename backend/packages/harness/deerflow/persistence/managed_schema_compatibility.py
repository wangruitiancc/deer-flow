"""Exact, reviewed Matrix Law forward catalogs for the W12 rollback bridge.

This is deliberately not a version range or a configurable bypass. The hashes
come from the independently verified W13 c1 tenant migration plan: after ORM
0021, ORM 0022, extension 0077, and atomic role provisioning, respectively.
Unknown schemas, policies, grants, indexes, roles, or functions refuse startup.
No DDL, version-table writes, runtime configuration, or credentials are used.
"""

from __future__ import annotations

from typing import Any

from deerflow_extension_api.managed_schema_catalog import inventory_sha256, read_catalog_inventory

_REVIEWED_CATALOGS = {
    ("0020_admin_mfa", "0021_password_reset_outbox"): frozenset({"ae8f3fe51182f3ebe6a0bd7982290c56ca48a4d42b5797bef1b0628dc4d19beb"}),
    ("0020_admin_mfa", "0022_password_reset_rate_limits"): frozenset(
        {
            "9ff7aa962400982eed2b0eaa2fe5d9defc56290265938d130b86c6e49cdd00ec",
            "98cadb6eea8ea061a7c99756d201c5fd5892d58601c0754ba6e91b7d71864c4e",
            "2af14b161c381b54f647977367838e0d720c0cae1a9d9ec4346c1821dfb041d5",
        }
    ),
}


async def accepts_reviewed_forward_schema(connection: Any, *, expected: str, applied: set[str], dialect: str) -> bool:
    """Accept only an exact declared head and its complete catalog fingerprint.

    The caller owns a repeatable-read transaction for a consistent PostgreSQL
    catalog snapshot. This function never relaxes checks on another backend.
    Catalog read failures propagate so startup remains closed.
    """
    if dialect != "postgresql" or len(applied) != 1:
        return False
    catalogs = _REVIEWED_CATALOGS.get((expected, next(iter(applied))))
    if catalogs is None:
        return False
    actual = await read_catalog_inventory(connection, "deerflow")
    return inventory_sha256(actual) in catalogs
