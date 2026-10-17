"""Canonical, secret-free PostgreSQL catalog snapshots for tenant release plans."""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import zlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import date, datetime
from typing import Any

CATALOG_FORMAT = "matrix-law-postgres-catalog-v1"
MAX_INVENTORY_BYTES = 16 * 1024 * 1024
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
SECTIONS = (
    "database",
    "schemas",
    "extensions",
    "relations",
    "inheritance",
    "columns",
    "sequences",
    "indexes",
    "constraints",
    "domain_constraints",
    "functions",
    "types",
    "triggers",
    "policies",
    "grants",
    "roles",
    "role_memberships",
)
_ORDER_KEYS = {
    "database": ("name",),
    "schemas": ("name",),
    "extensions": ("name",),
    "relations": ("schema", "name"),
    "inheritance": ("child_schema", "child_name", "sequence"),
    "columns": ("schema", "table_name", "ordinal"),
    "sequences": ("schema", "name"),
    "indexes": ("schema", "table_name", "name"),
    "constraints": ("schema", "table_name", "name"),
    "domain_constraints": ("schema", "domain_name", "name"),
    "functions": ("schema", "name", "arguments"),
    "types": ("schema", "name"),
    "triggers": ("schema", "table_name", "name"),
    "policies": ("schema", "table_name", "name"),
    "grants": ("object_type", "object_name", "subobject", "grantor", "grantee", "privilege_type", "is_grantable"),
    "roles": ("name",),
    "role_memberships": ("role_name", "member_name"),
}
_TEXT_FINGERPRINT_FIELDS = {
    "comment",
    "default_expr",
    "view_definition",
    "definition",
    "domain_default",
    "using_expression",
    "check_expression",
    "settings",
    "options",
    "partition_bound",
}
_ROW_FIELDS = {
    "database": {"name", "owner", "allow_connections", "connection_limit", "encoding", "collation", "character_type"},
    "schemas": {"name", "owner"},
    "extensions": {"name", "version", "schema", "owner", "relocatable"},
    "relations": {"schema", "name", "kind", "owner", "persistence", "row_security", "force_row_security", "replica_identity", "partition", "options", "partition_bound", "view_definition"},
    "inheritance": {"child_schema", "child_name", "parent_schema", "parent_name", "sequence", "detach_pending"},
    "columns": {"schema", "table_name", "ordinal", "name", "data_type", "not_null", "default_expr", "identity", "generated", "comment"},
    "sequences": {"schema", "name", "owner", "data_type", "start_value", "min_value", "max_value", "increment", "cache_size", "cycle"},
    "indexes": {"schema", "table_name", "name", "owner", "definition", "valid", "ready", "live"},
    "constraints": {"schema", "table_name", "name", "kind", "validated", "deferrable", "initially_deferred", "definition"},
    "domain_constraints": {"schema", "domain_name", "name", "owner", "kind", "validated", "deferrable", "initially_deferred", "definition"},
    "functions": {"schema", "name", "kind", "arguments", "result", "definition", "owner", "volatility", "security_definer", "settings"},
    "types": {"schema", "name", "kind", "category", "not_null", "base_type", "owner", "enum_values", "domain_default"},
    "triggers": {"schema", "table_name", "name", "definition", "enabled", "owner"},
    "policies": {"schema", "table_name", "name", "command", "permissive", "roles", "using_expression", "check_expression"},
    "grants": {"object_type", "object_name", "subobject", "grantor", "grantee", "privilege_type", "is_grantable"},
    "roles": {"name", "can_login", "superuser", "create_db", "create_role", "inherit", "replication", "bypass_rls", "connection_limit", "valid_until", "settings"},
    "role_memberships": {"role_name", "member_name", "grantor", "admin_option", "inherit_option", "set_option"},
}
_BOOLEAN_FIELDS = {
    "allow_connections",
    "relocatable",
    "row_security",
    "force_row_security",
    "partition",
    "not_null",
    "cycle",
    "valid",
    "ready",
    "live",
    "validated",
    "deferrable",
    "initially_deferred",
    "security_definer",
    "permissive",
    "can_login",
    "superuser",
    "create_db",
    "create_role",
    "inherit",
    "replication",
    "bypass_rls",
    "admin_option",
    "inherit_option",
    "set_option",
    "detach_pending",
}
_INTEGER_FIELDS = {
    "connection_limit",
    "sequence",
    "ordinal",
    "start_value",
    "min_value",
    "max_value",
    "increment",
    "cache_size",
}
_STRING_FIELDS = {
    "name",
    "owner",
    "encoding",
    "collation",
    "character_type",
    "version",
    "schema",
    "kind",
    "persistence",
    "replica_identity",
    "child_schema",
    "child_name",
    "parent_schema",
    "parent_name",
    "table_name",
    "data_type",
    "identity",
    "generated",
    "domain_name",
    "volatility",
    "arguments",
    "result",
    "base_type",
    "object_type",
    "object_name",
    "grantor",
    "grantee",
    "privilege_type",
    "is_grantable",
    "valid_until",
    "role_name",
    "member_name",
    "command",
    "category",
    "enabled",
    "subobject",
}
_NULLABLE_STRING_FIELDS = {"base_type", "subobject", "valid_until"}
_STRING_ARRAY_FIELDS = {"roles", "enum_values"}
_NULLABLE_STRING_ARRAY_FIELDS = {"enum_values", "roles"}


def _validate_row_value_types(section: str, row: dict[str, Any]) -> None:
    """Validate the exact JSON representation emitted by the catalog reader."""
    for key, value in row.items():
        if key in _BOOLEAN_FIELDS and type(value) is not bool:
            raise CatalogContractError("tenant_catalog_inventory_type_invalid")
        if key in _BOOLEAN_FIELDS:
            continue
        if key in _INTEGER_FIELDS and type(value) is not int:
            raise CatalogContractError("tenant_catalog_inventory_type_invalid")
        if key in _INTEGER_FIELDS:
            continue
        if key in _TEXT_FINGERPRINT_FIELDS:
            if value is not None and (
                not isinstance(value, dict) or set(value) != {"sha256", "length"} or not isinstance(value.get("sha256"), str) or _SHA256.fullmatch(value["sha256"]) is None or type(value.get("length")) is not int or value["length"] < 0
            ):
                raise CatalogContractError("tenant_catalog_inventory_fingerprint_invalid")
            continue
        if key in _STRING_ARRAY_FIELDS:
            if value is None and key in _NULLABLE_STRING_ARRAY_FIELDS:
                continue
            if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                raise CatalogContractError("tenant_catalog_inventory_type_invalid")
            continue
        if key in _STRING_FIELDS:
            if value is None and key in _NULLABLE_STRING_FIELDS:
                continue
            if not isinstance(value, str):
                raise CatalogContractError("tenant_catalog_inventory_type_invalid")
            continue
        raise CatalogContractError("tenant_catalog_inventory_type_invalid")


class CatalogContractError(ValueError):
    """A database catalog is outside the signed closed-world contract."""


def canonical_json(value: Any) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        raise CatalogContractError("tenant_catalog_json_invalid") from exc


def inventory_sha256(inventory: dict[str, Any]) -> str:
    validate_inventory_shape(inventory)
    return hashlib.sha256(canonical_json(inventory)).hexdigest()


def encode_inventory(inventory: dict[str, Any]) -> str:
    validate_inventory_shape(inventory)
    return gzip.compress(canonical_json(inventory), compresslevel=9, mtime=0).hex()


def decode_inventory(encoded_hex: Any, expected_sha256: Any) -> dict[str, Any]:
    if (
        not isinstance(encoded_hex, str)
        or len(encoded_hex) > MAX_INVENTORY_BYTES * 2
        or len(encoded_hex) % 2
        or re.fullmatch(r"[0-9a-f]+", encoded_hex) is None
        or not isinstance(expected_sha256, str)
        or _SHA256.fullmatch(expected_sha256) is None
    ):
        raise CatalogContractError("tenant_catalog_snapshot_invalid")
    try:
        decoder = zlib.decompressobj(wbits=16 + zlib.MAX_WBITS)
        raw = decoder.decompress(bytes.fromhex(encoded_hex), MAX_INVENTORY_BYTES + 1)
        if len(raw) > MAX_INVENTORY_BYTES or decoder.unconsumed_tail:
            raise CatalogContractError("tenant_catalog_snapshot_too_large")
        if not decoder.eof or decoder.unused_data:
            raise CatalogContractError("tenant_catalog_snapshot_encoding_noncanonical")
        inventory = json.loads(raw)
    except CatalogContractError:
        raise
    except (OSError, ValueError, zlib.error, json.JSONDecodeError) as exc:
        raise CatalogContractError("tenant_catalog_snapshot_invalid") from exc
    if not isinstance(inventory, dict) or inventory.get("format") != CATALOG_FORMAT or inventory_sha256(inventory) != expected_sha256:
        raise CatalogContractError("tenant_catalog_snapshot_digest_mismatch")
    validate_inventory_shape(inventory)
    if canonical_json(inventory) != raw:
        raise CatalogContractError("tenant_catalog_snapshot_encoding_noncanonical")
    return inventory


def validate_inventory_shape(inventory: Any) -> None:
    """Reject partial or self-asserted inventories outside this exact ABI."""
    if (
        not isinstance(inventory, dict)
        or set(inventory) != {"format", "schema", *SECTIONS}
        or inventory.get("format") != CATALOG_FORMAT
        or not isinstance(inventory.get("schema"), str)
        or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", inventory["schema"]) is None
        or any(not isinstance(inventory.get(section), list) for section in SECTIONS)
    ):
        raise CatalogContractError("tenant_catalog_inventory_shape_invalid")
    for section in SECTIONS:
        rows = inventory[section]
        if any(not isinstance(row, dict) for row in rows):
            raise CatalogContractError("tenant_catalog_inventory_shape_invalid")
        if any(set(row) != _ROW_FIELDS[section] for row in rows):
            raise CatalogContractError("tenant_catalog_inventory_shape_invalid")
        for row in rows:
            _validate_row_value_types(section, row)
        order = _ORDER_KEYS[section]
        if any(not set(order).issubset(row) for row in rows):
            raise CatalogContractError("tenant_catalog_inventory_shape_invalid")
        keys = [tuple((row[key] is not None, row[key] or "") for key in order) for row in rows]
        if keys != sorted(keys):
            raise CatalogContractError("tenant_catalog_inventory_order_invalid")
        if any("password" in key.lower() for row in rows for key in row):
            raise CatalogContractError("tenant_catalog_secret_field_forbidden")


def match_inventory_state(actual: dict[str, Any], expected: dict[str, dict[str, Any]]) -> str:
    """Match an actual catalog against complete named snapshots only.

    Callers pass the already signature-verified snapshot map. No subset or
    per-section matching is permitted: one unknown policy, schema, sequence,
    grant, or role attribute makes the state ambiguous.
    """
    validate_inventory_shape(actual)
    if not isinstance(expected, dict) or not expected:
        raise CatalogContractError("tenant_catalog_expected_states_invalid")
    digest = inventory_sha256(actual)
    matches = [name for name, inventory in expected.items() if isinstance(name, str) and isinstance(inventory, dict) and inventory_sha256(inventory) == digest]
    if len(matches) != 1:
        raise CatalogContractError("tenant_catalog_state_ambiguous")
    return matches[0]


def _plain(value: Any) -> Any:
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise CatalogContractError("tenant_catalog_value_unrepresentable") from exc
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


async def read_catalog_inventory(connection: Any, schema: str) -> dict[str, Any]:
    """Return the closed catalog surface touched or relied on by tenant setup.

    The snapshot deliberately includes every non-system schema and every
    visible role's non-secret attributes so unplanned schemas/grants fail
    closed. It never reads ``pg_authid`` or any password verifier.
    """
    if not isinstance(schema, str) or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", schema) is None:
        raise CatalogContractError("tenant_catalog_schema_invalid")

    queries: dict[str, tuple[str, bool]] = {
        "schemas": (
            """SELECT n.nspname name, pg_get_userbyid(n.nspowner) owner
                 FROM pg_namespace n
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 ORDER BY n.nspname""",
            False,
        ),
        "database": (
            """SELECT '<current-database>'::text name, pg_get_userbyid(d.datdba) owner,
                      d.datallowconn allow_connections, d.datconnlimit connection_limit,
                      pg_encoding_to_char(d.encoding) encoding, d.datcollate collation,
                      d.datctype character_type
                 FROM pg_database d WHERE d.datname=current_database()""",
            False,
        ),
        "extensions": (
            """SELECT e.extname name, e.extversion version, n.nspname schema,
                      pg_get_userbyid(e.extowner) owner,
                      e.extrelocatable relocatable
                 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
                 ORDER BY e.extname""",
            False,
        ),
        "relations": (
            """SELECT n.nspname schema, c.relname name, c.relkind kind,
                      pg_get_userbyid(c.relowner) owner, c.relpersistence persistence,
                      c.relrowsecurity row_security, c.relforcerowsecurity force_row_security,
                      c.relreplident replica_identity, c.relispartition partition,
                      c.reloptions options,
                      CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound,c.oid,true) END partition_bound,
                      CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END view_definition
                 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                   AND c.relkind IN ('r','p','v','m','f','S')
                 ORDER BY n.nspname,c.relname""",
            False,
        ),
        "inheritance": (
            """SELECT child_ns.nspname child_schema, child.relname child_name,
                      parent_ns.nspname parent_schema, parent.relname parent_name,
                      inh.inhseqno sequence, inh.inhdetachpending detach_pending
                 FROM pg_inherits inh JOIN pg_class child ON child.oid=inh.inhrelid
                 JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
                 JOIN pg_class parent ON parent.oid=inh.inhparent
                 JOIN pg_namespace parent_ns ON parent_ns.oid=parent.relnamespace
                 WHERE child_ns.nspname <> 'information_schema' AND child_ns.nspname !~ '^pg_+'
                 ORDER BY child_ns.nspname,child.relname,inh.inhseqno""",
            False,
        ),
        "columns": (
            """SELECT n.nspname schema, c.relname table_name, a.attnum ordinal,
                      a.attname name, format_type(a.atttypid,a.atttypmod) data_type,
                      a.attnotnull not_null, pg_get_expr(d.adbin,d.adrelid) default_expr,
                      a.attidentity identity, a.attgenerated generated,
                      col_description(c.oid,a.attnum) comment
                 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
                 JOIN pg_namespace n ON n.oid=c.relnamespace
                 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                   AND c.relkind IN ('r','p','v','m','f','S')
                   AND a.attnum>0 AND NOT a.attisdropped
                 ORDER BY n.nspname,c.relname,a.attnum""",
            False,
        ),
        "sequences": (
            """SELECT n.nspname schema, c.relname name, pg_get_userbyid(c.relowner) owner,
                      s.seqtypid::regtype::text data_type, s.seqstart start_value,
                      s.seqmin min_value, s.seqmax max_value, s.seqincrement increment,
                      s.seqcache cache_size, s.seqcycle cycle
                 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 JOIN pg_sequence s ON s.seqrelid=c.oid
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 ORDER BY n.nspname,c.relname""",
            False,
        ),
        "indexes": (
            """SELECT n.nspname schema, t.relname table_name, i.relname name,
                      pg_get_userbyid(i.relowner) owner, pg_get_indexdef(i.oid) definition,
                      x.indisvalid valid, x.indisready ready, x.indislive live
                 FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
                 JOIN pg_class t ON t.oid=x.indrelid
                 JOIN pg_namespace n ON n.oid=t.relnamespace
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 ORDER BY n.nspname,t.relname,i.relname""",
            False,
        ),
        "constraints": (
            """SELECT n.nspname schema, c.relname table_name, k.conname name,
                      k.contype kind, k.convalidated validated, k.condeferrable deferrable,
                      k.condeferred initially_deferred, pg_get_constraintdef(k.oid,true) definition
                 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
                 JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 ORDER BY n.nspname,c.relname,k.conname""",
            False,
        ),
        "domain_constraints": (
            """SELECT n.nspname schema, t.typname domain_name, k.conname name,
                      pg_get_userbyid(t.typowner) owner, k.contype kind,
                      k.convalidated validated, k.condeferrable deferrable,
                      k.condeferred initially_deferred, pg_get_constraintdef(k.oid,true) definition
                 FROM pg_constraint k JOIN pg_type t ON t.oid=k.contypid
                 JOIN pg_namespace n ON n.oid=t.typnamespace
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 ORDER BY n.nspname,t.typname,k.conname""",
            False,
        ),
        "functions": (
            """SELECT n.nspname schema, p.proname name, p.prokind kind,
                      pg_get_function_identity_arguments(p.oid) arguments,
                      pg_get_function_result(p.oid) result,
                      CASE WHEN p.prokind IN ('f','p','w') THEN pg_get_functiondef(p.oid) END definition,
                      pg_get_userbyid(p.proowner) owner, p.provolatile volatility,
                      p.prosecdef security_definer, p.proconfig settings
                 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 ORDER BY n.nspname,p.proname,arguments""",
            False,
        ),
        "types": (
            """SELECT n.nspname schema, t.typname name, t.typtype kind,
                      t.typcategory category, t.typnotnull not_null,
                      CASE WHEN t.typbasetype=0 THEN NULL ELSE format_type(t.typbasetype,t.typtypmod) END base_type,
                      pg_get_userbyid(t.typowner) owner,
                      CASE WHEN t.typtype='e' THEN
                         (SELECT json_agg(e.enumlabel ORDER BY e.enumsortorder)
                          FROM pg_enum e WHERE e.enumtypid=t.oid) END enum_values,
                      CASE WHEN t.typtype='d' THEN
                         (SELECT pg_get_expr(d.adbin,d.adrelid)
                          FROM pg_attrdef d WHERE d.adrelid=t.typrelid AND d.adnum=0) END domain_default
                 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 ORDER BY n.nspname,t.typname""",
            False,
        ),
        "triggers": (
            """SELECT n.nspname schema, c.relname table_name, t.tgname name,
                      pg_get_triggerdef(t.oid,true) definition, t.tgenabled enabled,
                      pg_get_userbyid(c.relowner) owner
                 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                 JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                   AND NOT t.tgisinternal
                 ORDER BY n.nspname,c.relname,t.tgname""",
            False,
        ),
        "policies": (
            """SELECT n.nspname schema, c.relname table_name, p.polname name,
                      p.polcmd command, p.polpermissive permissive,
                      (SELECT json_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY r)
                       FROM unnest(p.polroles) r) roles,
                      pg_get_expr(p.polqual,p.polrelid) using_expression,
                      pg_get_expr(p.polwithcheck,p.polrelid) check_expression
                 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
                 JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 ORDER BY n.nspname,c.relname,p.polname""",
            False,
        ),
        "grants": (
            """SELECT 'schema' object_type,s.nspname object_name,NULL::text subobject,
                          grantor_name grantor,grantee_name grantee,privilege_type,is_grantable
                 FROM (SELECT n.oid,n.nspname,pg_get_userbyid(x.grantor) grantor_name,
                              CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END grantee_name,
                              x.privilege_type,CASE WHEN x.is_grantable THEN 'YES' ELSE 'NO' END is_grantable
                 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n'::"char",n.nspowner))) x
                       WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+') s
                 UNION ALL
                 SELECT 'relation',n.nspname||'.'||c.relname,NULL,
                        pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                        x.privilege_type,CASE WHEN x.is_grantable THEN 'YES' ELSE 'NO' END
                 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END,c.relowner))) x
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 UNION ALL
                 SELECT 'column',n.nspname||'.'||c.relname,a.attname,
                        pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                        x.privilege_type,CASE WHEN x.is_grantable THEN 'YES' ELSE 'NO' END
                 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
                 JOIN pg_namespace n ON n.oid=c.relnamespace
                 CROSS JOIN LATERAL aclexplode(a.attacl) x
                 WHERE a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
                   AND n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 UNION ALL
                 SELECT 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',NULL,
                        pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                        x.privilege_type,CASE WHEN x.is_grantable THEN 'YES' ELSE 'NO' END
                 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f'::"char",p.proowner))) x
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 UNION ALL
                 SELECT 'type',n.nspname||'.'||t.typname,NULL,
                        pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                        x.privilege_type,CASE WHEN x.is_grantable THEN 'YES' ELSE 'NO' END
                 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                 CROSS JOIN LATERAL aclexplode(coalesce(t.typacl,acldefault('T'::"char",t.typowner))) x
                 WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+'
                 UNION ALL
                 SELECT 'default',coalesce(n.nspname,'<global>')||'.'||pg_get_userbyid(d.defaclrole)||'.'||d.defaclobjtype::text,NULL,
                        pg_get_userbyid(x.grantor),CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                        x.privilege_type,CASE WHEN x.is_grantable THEN 'YES' ELSE 'NO' END
                 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
                 CROSS JOIN LATERAL aclexplode(d.defaclacl) x
                 WHERE d.defaclnamespace=0 OR
                       (n.nspname <> 'information_schema' AND n.nspname !~ '^pg_+')
                 UNION ALL
                 SELECT 'database','<current-database>',NULL,pg_get_userbyid(x.grantor),
                        CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
                        x.privilege_type,CASE WHEN x.is_grantable THEN 'YES' ELSE 'NO' END
                 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d'::"char",d.datdba))) x
                 WHERE d.datname=current_database()
                 ORDER BY 1,2,3,4,5,6,7""",
            False,
        ),
        "roles": (
            """SELECT rolname name,rolcanlogin can_login,rolsuper superuser,
                      rolcreatedb create_db,rolcreaterole create_role,rolinherit inherit,
                      rolreplication replication,rolbypassrls bypass_rls,rolconnlimit connection_limit,
                      rolvaliduntil valid_until,rolconfig settings
                 FROM pg_roles ORDER BY rolname""",
            False,
        ),
        "role_memberships": (
            """SELECT parent.rolname role_name,member.rolname member_name,
                      pg_get_userbyid(m.grantor) grantor,m.admin_option,
                      m.inherit_option,m.set_option
                 FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
                 JOIN pg_roles member ON member.oid=m.member
                 ORDER BY parent.rolname,member.rolname""",
            False,
        ),
    }
    snapshot: dict[str, Any] = {"format": CATALOG_FORMAT, "schema": schema}
    try:
        async with _canonical_catalog_search_path(connection):
            for key, (query, _unused) in queries.items():
                if callable(getattr(connection, "fetch", None)):
                    rows = await connection.fetch(query)
                else:
                    # Role provisioning needs a SQLAlchemy AsyncConnection so its
                    # catalog pre/post checks share the caller-owned transaction.
                    from sqlalchemy import text

                    result = await connection.execute(text(query))
                    rows = result.mappings().all()
                canonical_rows = []
                for row in rows:
                    item = _plain(dict(row))
                    for field in _STRING_ARRAY_FIELDS.intersection(item):
                        if isinstance(item[field], str):
                            try:
                                item[field] = json.loads(item[field])
                            except json.JSONDecodeError as exc:
                                raise CatalogContractError("tenant_catalog_value_unrepresentable") from exc
                    for field in _TEXT_FINGERPRINT_FIELDS.intersection(item):
                        value = item[field]
                        if value is not None:
                            raw_value = value if isinstance(value, bytes) else str(value).encode("utf-8")
                            item[field] = {
                                "sha256": hashlib.sha256(raw_value).hexdigest(),
                                "length": len(raw_value),
                            }
                    canonical_rows.append(item)
                snapshot[key] = canonical_rows
    except Exception as exc:
        raise CatalogContractError("tenant_catalog_unreadable") from exc
    # No password verifier is selected. These assertions also make the
    # boundary fail closed if the catalog projection is extended accidentally.
    if any("password" in key.lower() for key in snapshot):
        raise CatalogContractError("tenant_catalog_secret_field_forbidden")
    validate_inventory_shape(snapshot)
    return snapshot


@asynccontextmanager
async def _canonical_catalog_search_path(connection: Any) -> AsyncIterator[None]:
    """Make PostgreSQL's deparser output independent of caller search_path.

    Functions such as ``pg_get_expr`` and ``pg_get_constraintdef`` omit or add
    schema qualification according to the active path. Catalog fingerprints
    therefore need one stable path even when the application connection uses
    its tenant schema. Use a nested transaction so both success and exceptions
    preserve the caller's path and transaction state. Do not include "$user":
    the framework login is named deerflow, which is also the managed schema.
    Its expansion would make the same catalog differ for operator and runtime
    roles. A literal public path preserves existing operator fingerprints.
    """
    if callable(getattr(connection, "fetch", None)):
        transaction_factory = getattr(connection, "transaction", None)
        if not callable(transaction_factory):
            # Small fetch-only fakes used by shape/fingerprint unit tests do not
            # model PostgreSQL transaction or search_path behavior.
            yield
            return
        transaction = transaction_factory()
        async with transaction:
            previous = await connection.fetchval("SELECT current_setting('search_path')")
            await connection.execute("SET LOCAL search_path TO public")
            try:
                yield
            finally:
                await connection.execute("SELECT set_config('search_path', $1, true)", previous)
        return

    from sqlalchemy import text

    async with connection.begin_nested():
        result = await connection.execute(text("SELECT current_setting('search_path')"))
        previous = result.scalar_one()
        await connection.exec_driver_sql("SET LOCAL search_path TO public")
        try:
            yield
        finally:
            await connection.execute(
                text("SELECT set_config('search_path', :search_path, true)"),
                {"search_path": previous},
            )
