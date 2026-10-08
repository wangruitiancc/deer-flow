"""Fail-closed task-scoped loader for Gateway-projected managed Skills.

This intentionally has no HTTP client, artifact resolver, archive installer or
local-root fallback.  The vertical extension owns mTLS and signature checking;
the harness only validates the fixed bytes it was given before parsing them.
"""

from __future__ import annotations

import hashlib
import tempfile
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

from deerflow_extension_api import ExtensionData, ManagedSkillDescriptor, ManagedSkillPackage, ManagedSkillRuntime, ManagedSkillRuntimeBinding

from deerflow.skills.parser import parse_skill_file
from deerflow.skills.types import Skill, SkillCategory

_runtime: ContextVar[ManagedSkillRuntime | None] = ContextVar("deerflow_managed_skill_runtime", default=None)
_root: ContextVar[Path | None] = ContextVar("deerflow_managed_skill_root", default=None)
_loaded: ContextVar[tuple[Skill, ...] | None] = ContextVar("deerflow_managed_skills", default=None)
_catalog: ContextVar[tuple[ManagedSkillDescriptor, ...] | None] = ContextVar("deerflow_managed_skill_catalog", default=None)
_MAX_MANAGED_SKILL_REFERENCE_BYTES = 256 * 1024


def get_managed_skill_runtime() -> ManagedSkillRuntime | None:
    return _runtime.get()


def get_loaded_managed_skills() -> list[Skill] | None:
    cached = _loaded.get()
    return list(cached) if cached is not None else None


def get_loaded_managed_skill_catalog() -> list[Skill] | None:
    cached = _catalog.get()
    root = _root.get()
    if root is None:
        return None
    if cached is None:
        loaded = _loaded.get()
        return list(loaded) if loaded is not None else None
    return [_descriptor_to_skill(item, root) for item in cached]


def _safe_path(value: str) -> Path:
    path = Path(value)
    if (
        not value
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in value.split("/"))
        or ".." in path.parts
        or "." in path.parts
    ):
        raise PermissionError("managed Skill projection contains an unsafe file path")
    return path


def _package_digest(files: Sequence[tuple[str, bytes]]) -> str:
    digest = hashlib.sha256()
    for name, content in sorted(files, key=lambda item: (item[0].casefold(), item[0].encode("utf-8"))):
        encoded = name.encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    return digest.hexdigest()


def _descriptor_to_skill(item: ManagedSkillDescriptor, root: Path) -> Skill:
    description = item.description or "Platform-managed legal Skill. Call describe_skill only when the task needs this Skill."
    return Skill(
        name=item.skill_id,
        description=description,
        license=None,
        skill_dir=root / item.skill_id / item.version,
        skill_file=root / item.skill_id / item.version / "SKILL.md",
        relative_path=Path(item.skill_id) / item.version,
        category=SkillCategory.PUBLIC,
        allowed_tools=tuple(item.allowed_tools) if item.allowed_tools is not None else None,
        enabled=True,
    )


def _validate_descriptor(item: object) -> ManagedSkillDescriptor:
    if not isinstance(item, ManagedSkillDescriptor):
        raise PermissionError("managed Skill catalog item is invalid")
    if not item.skill_id or not item.version or not isinstance(item.package_sha256, str) or len(item.package_sha256) != 64:
        raise PermissionError("managed Skill catalog item is invalid")
    return item


async def load_managed_skill_catalog() -> list[Skill]:
    """Load only platform Skill catalog metadata for this task.

    This does not fetch package bytes. Package projection is delayed until
    describe_skill selects a Skill for the current task.
    """
    runtime = get_managed_skill_runtime()
    if runtime is None:
        return []
    cached = get_loaded_managed_skill_catalog()
    if cached is not None:
        return cached
    catalog_fn = getattr(runtime, "catalog", None)
    if not callable(catalog_fn):
        raise PermissionError("managed Skill runtime does not expose catalog metadata")
    descriptors = tuple(_validate_descriptor(item) for item in await catalog_fn())
    _catalog.set(tuple(sorted(descriptors, key=lambda item: item.skill_id)))
    return get_loaded_managed_skill_catalog() or []


def _set_loaded_skill(skill: Skill) -> None:
    loaded = [item for item in (_loaded.get() or ()) if item.name != skill.name]
    loaded.append(skill)
    _loaded.set(tuple(sorted(loaded, key=lambda item: item.name)))


def _find_descriptor(skill_name: str) -> ManagedSkillDescriptor | None:
    for item in _catalog.get() or ():
        if item.skill_id == skill_name:
            return item
    return None


def _materialize_package(package: ManagedSkillPackage, root: Path) -> Skill:
    if not isinstance(package, ManagedSkillPackage) or not package.skill_id or not package.version or not isinstance(package.files, Sequence):
        raise PermissionError("managed Skill package projection is invalid")
    package_root = root / package.skill_id / package.version
    package_root.mkdir(parents=True, exist_ok=True)
    files: list[tuple[str, bytes]] = []
    for item in package.files:
        file_path = _safe_path(item.path)
        if not isinstance(item.content, bytes) or not isinstance(item.sha256, str) or hashlib.sha256(item.content).hexdigest() != item.sha256:
            raise PermissionError("managed Skill file digest mismatch")
        target = package_root / file_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(item.content)
        files.append((item.path, item.content))
    if _package_digest(files) != package.package_sha256:
        raise PermissionError("managed Skill package digest mismatch")
    skill_file = package_root / "SKILL.md"
    skill = parse_skill_file(skill_file, category=SkillCategory.PUBLIC, relative_path=Path(package.skill_id) / package.version)
    if skill is None or skill.name != package.skill_id:
        raise PermissionError("managed Skill package identity or manifest is invalid")
    return skill


async def load_managed_skill(skill_name: str) -> Skill:
    runtime = get_managed_skill_runtime()
    if runtime is None:
        raise PermissionError("managed Skill runtime is unavailable")
    root = _root.get()
    if root is None:
        raise PermissionError("managed Skill runtime escaped its task scope")
    for skill in _loaded.get() or ():
        if skill.name == skill_name:
            return skill
    descriptor = _find_descriptor(skill_name)
    if descriptor is None:
        await load_managed_skill_catalog()
        descriptor = _find_descriptor(skill_name)
    if descriptor is None:
        raise PermissionError("managed Skill is not visible in the current catalog")
    package_fn = getattr(runtime, "package", None)
    if callable(package_fn):
        package = await package_fn(
            skill_id=descriptor.skill_id,
            version=descriptor.version,
            package_sha256=descriptor.package_sha256,
        )
    else:
        packages = await runtime.packages()
        matches = [item for item in packages if item.skill_id == descriptor.skill_id and item.version == descriptor.version]
        if not matches:
            raise PermissionError("managed Skill package is unavailable")
        package = matches[0]
    skill = _materialize_package(package, root)
    _set_loaded_skill(skill)
    return skill


async def hydrate_managed_skill_instructions(skill: Skill) -> str:
    loaded = await load_managed_skill(skill.name)
    return loaded.skill_file.read_text(encoding="utf-8")


async def read_managed_skill_file(skill_name: str, version: str, relative_path: str) -> str:
    """Read one bounded instruction/reference file from this task's package.

    Managed package bytes live in a task-scoped temporary directory and are
    intentionally absent from the general-purpose sandbox projection. This
    narrow reader keeps that boundary while preserving the standard
    ``read_file`` interface for task-authorized managed Skills.
    """
    loaded = await load_managed_skill(skill_name)
    if loaded.skill_dir.name != version:
        raise FileNotFoundError("managed Skill version is not in the current task catalog")
    relative = _safe_path(relative_path)
    if relative.as_posix() != "SKILL.md" and relative.parts[0] != "references":
        raise PermissionError("managed Skill reads are limited to SKILL.md and references/")
    package_root = loaded.skill_dir.resolve(strict=True)
    target = loaded.skill_dir / relative
    if target.is_symlink():
        raise PermissionError("managed Skill reference is not a regular package file")
    resolved = target.resolve(strict=True)
    if package_root not in resolved.parents or not resolved.is_file():
        raise PermissionError("managed Skill reference is outside the verified package")
    if resolved.stat().st_size > _MAX_MANAGED_SKILL_REFERENCE_BYTES:
        raise PermissionError("managed Skill file exceeds the read limit")
    return resolved.read_text(encoding="utf-8")


async def read_managed_skill_reference(skill: Skill, relative_path: str) -> str:
    """Compatibility wrapper for explicitly reading one managed reference."""
    relative = _safe_path(relative_path)
    if relative.parts[0] != "references":
        raise PermissionError("managed Skill reference must be under references/")
    return await read_managed_skill_file(skill.name, skill.skill_dir.name, relative_path)


async def load_managed_skills() -> list[Skill]:
    """Materialize only current-task fixed package bytes and parse their SKILL.md.

    A bad signature should be rejected by the extension before this protocol is
    called. Digest/path/schema failures here never degrade to local discovery.
    """
    runtime = get_managed_skill_runtime()
    if runtime is None:
        return []
    cached = _loaded.get()
    if cached is not None:
        return list(cached)
    root = _root.get()
    if root is None:
        raise PermissionError("managed Skill runtime escaped its task scope")
    parsed: list[Skill] = []
    names: set[str] = set()
    for package in await runtime.packages():
        skill = _materialize_package(package, root)
        if skill.name in names:
            raise PermissionError("managed Skill package identity or manifest is invalid")
        names.add(skill.name)
        parsed.append(skill)
    _loaded.set(tuple(sorted(parsed, key=lambda item: item.name)))
    return list(_loaded.get() or ())


@contextmanager
def managed_skill_runtime_scope(task_store: ExtensionData | None) -> Iterator[None]:
    binding = task_store.get(ManagedSkillRuntimeBinding) if task_store is not None else None
    runtime_token = _runtime.set(binding.runtime if binding is not None else None)
    loaded_token = _loaded.set(None)
    catalog_token = _catalog.set(None)
    with tempfile.TemporaryDirectory(prefix="deerflow-managed-skills-") as temp:
        root_token = _root.set(Path(temp))
        try:
            yield
        finally:
            _root.reset(root_token)
            _catalog.reset(catalog_token)
            _loaded.reset(loaded_token)
            _runtime.reset(runtime_token)
