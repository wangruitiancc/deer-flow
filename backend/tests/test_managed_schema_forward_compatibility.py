"""A known forward head alone must never bypass managed schema validation."""

from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_exact_reviewed_catalog_accepts_only_declared_head(monkeypatch):
    from deerflow.persistence import managed_schema_compatibility as compatibility

    connection = object()
    read = AsyncMock(return_value={"synthetic": "catalog"})
    monkeypatch.setattr(compatibility, "read_catalog_inventory", read)
    monkeypatch.setattr(compatibility, "inventory_sha256", lambda value: "a" * 64)
    monkeypatch.setattr(compatibility, "_REVIEWED_CATALOGS", {("0020_admin_mfa", "0022_password_reset_rate_limits"): frozenset({"a" * 64})})
    assert await compatibility.accepts_reviewed_forward_schema(connection, expected="0020_admin_mfa", applied={"0022_password_reset_rate_limits"}, dialect="postgresql")
    read.assert_awaited_once_with(connection, "deerflow")


@pytest.mark.asyncio
@pytest.mark.parametrize("heads,dialect", [({"unknown"}, "postgresql"), ({"0022_password_reset_rate_limits", "unknown"}, "postgresql"), ({"0022_password_reset_rate_limits"}, "sqlite"), (set(), "postgresql")])
async def test_unknown_head_multiple_heads_or_backend_never_read_catalog(monkeypatch, heads, dialect):
    from deerflow.persistence import managed_schema_compatibility as compatibility

    read = AsyncMock()
    monkeypatch.setattr(compatibility, "read_catalog_inventory", read)
    assert not await compatibility.accepts_reviewed_forward_schema(object(), expected="0020_admin_mfa", applied=heads, dialect=dialect)
    read.assert_not_awaited()


@pytest.mark.asyncio
async def test_known_head_with_unreviewed_catalog_rejected(monkeypatch):
    from deerflow.persistence import managed_schema_compatibility as compatibility

    monkeypatch.setattr(compatibility, "read_catalog_inventory", AsyncMock(return_value={}))
    monkeypatch.setattr(compatibility, "inventory_sha256", lambda value: "f" * 64)
    assert not await compatibility.accepts_reviewed_forward_schema(object(), expected="0020_admin_mfa", applied={"0022_password_reset_rate_limits"}, dialect="postgresql")


@pytest.mark.asyncio
async def test_unreadable_catalog_is_not_accepted(monkeypatch):
    from deerflow.persistence import managed_schema_compatibility as compatibility

    monkeypatch.setattr(compatibility, "read_catalog_inventory", AsyncMock(side_effect=RuntimeError("synthetic catalog failure")))
    with pytest.raises(RuntimeError, match="synthetic catalog failure"):
        await compatibility.accepts_reviewed_forward_schema(object(), expected="0020_admin_mfa", applied={"0022_password_reset_rate_limits"}, dialect="postgresql")


def test_compiled_contract_bound_to_exact_existing_signed_candidate():
    from deerflow.persistence import managed_schema_compatibility as compatibility

    assert compatibility._REVIEWED_CATALOGS == {
        ("0020_admin_mfa", "0021_password_reset_outbox"): frozenset({"ae8f3fe51182f3ebe6a0bd7982290c56ca48a4d42b5797bef1b0628dc4d19beb"}),
        ("0020_admin_mfa", "0022_password_reset_rate_limits"): frozenset(
            {
                "9ff7aa962400982eed2b0eaa2fe5d9defc56290265938d130b86c6e49cdd00ec",
                "98cadb6eea8ea061a7c99756d201c5fd5892d58601c0754ba6e91b7d71864c4e",
                "2af14b161c381b54f647977367838e0d720c0cae1a9d9ec4346c1821dfb041d5",
            }
        ),
    }
