import asyncio
import hashlib
from types import SimpleNamespace

import pytest
from deerflow_extension_api import ExtensionData, ManagedSkillDescriptor, ManagedSkillFile, ManagedSkillPackage, ManagedSkillRuntimeBinding

from deerflow.agents.lead_agent import prompt as prompt_module
from deerflow.skills.managed import hydrate_managed_skill_instructions, load_managed_skill_catalog, load_managed_skills, managed_skill_runtime_scope, read_managed_skill_reference
from deerflow.sandbox.tools import _read_managed_skill_virtual_file


def _digest(files):
    hash_ = hashlib.sha256()
    for name, content in sorted(files, key=lambda item: (item[0].casefold(), item[0].encode("utf-8"))):
        encoded = name.encode()
        hash_.update(len(encoded).to_bytes(8, "big"))
        hash_.update(encoded)
        hash_.update(len(content).to_bytes(8, "big"))
        hash_.update(content)
    return hash_.hexdigest()


class _Runtime:
    def __init__(self, package):
        self.package_projection = package
        self.calls = 0
        self.catalog_calls = 0
        self.package_calls = 0

    async def catalog(self):
        self.catalog_calls += 1
        return [ManagedSkillDescriptor(self.package_projection.skill_id, self.package_projection.version, self.package_projection.package_sha256, "managed")]

    async def package(self, *, skill_id, version, package_sha256):
        self.package_calls += 1
        assert skill_id == self.package_projection.skill_id
        assert version == self.package_projection.version
        assert package_sha256 == self.package_projection.package_sha256
        return self.package_projection

    async def packages(self):
        self.calls += 1
        return [self.package_projection]


def _package(content=b"---\nname: managed-law\ndescription: managed\n---\n", references=None):
    files = [("SKILL.md", content), *(references or {}).items()]
    return ManagedSkillPackage(
        "managed-law",
        "v1",
        _digest(files),
        [ManagedSkillFile(name, hashlib.sha256(value).hexdigest(), value) for name, value in files],
    )


def test_package_digest_uses_gateway_case_folded_path_order():
    files = [("SKILL.md", b"skill"), ("references/guide.md", b"guide")]
    assert _digest(files) == "c2bd69a7a0265c9e9f91197c25cd956f4443945cf567d293ce5340843c8ac1b3"


def test_managed_binding_uses_fixed_bytes_and_never_local_fallback(tmp_path, monkeypatch):
    runtime = _Runtime(_package())
    store = ExtensionData("managed-skill-test")
    store.set(ManagedSkillRuntimeBinding(runtime))
    monkeypatch.setattr("deerflow.skills.storage.get_or_new_skill_storage", lambda: (_ for _ in ()).throw(AssertionError("local storage read")))

    async def load_twice():
        return await load_managed_skills(), await load_managed_skills()

    with managed_skill_runtime_scope(store):
        first, second = asyncio.run(load_twice())
    assert [item.name for item in first] == ["managed-law"] and [item.name for item in second] == ["managed-law"] and runtime.calls == 1


def test_managed_catalog_does_not_fetch_package_until_hydration():
    runtime = _Runtime(_package())
    store = ExtensionData("managed-skill-test")
    store.set(ManagedSkillRuntimeBinding(runtime))

    async def load_catalog_then_hydrate():
        catalog = await load_managed_skill_catalog()
        package_calls_after_catalog = runtime.package_calls
        instructions = await hydrate_managed_skill_instructions(catalog[0])
        return catalog, package_calls_after_catalog, instructions

    with managed_skill_runtime_scope(store):
        catalog, package_calls_after_catalog, instructions = asyncio.run(load_catalog_then_hydrate())
    assert [item.name for item in catalog] == ["managed-law"]
    assert runtime.catalog_calls == 1
    assert package_calls_after_catalog == 0
    assert runtime.package_calls == 1
    assert "managed-law" in instructions


def test_managed_reference_reads_only_verified_task_package_files():
    reference = b"# NDA workflow\nCompare term, cap, and governing law.\n"
    runtime = _Runtime(_package(references={"references/workflows/nda.md": reference}))
    store = ExtensionData("managed-skill-test")
    store.set(ManagedSkillRuntimeBinding(runtime))

    async def read_reference():
        catalog = await load_managed_skill_catalog()
        return await read_managed_skill_reference(catalog[0], "references/workflows/nda.md")

    with managed_skill_runtime_scope(store):
        actual = asyncio.run(read_reference())
    assert actual == reference.decode()
    assert runtime.package_calls == 1


def test_read_file_virtual_path_resolves_only_current_task_managed_package():
    reference = b"# NDA workflow\nUse only the supplied agreement.\n"
    runtime = _Runtime(_package(references={"references/workflows/nda.md": reference}))
    store = ExtensionData("managed-skill-test")
    store.set(ManagedSkillRuntimeBinding(runtime))

    async def read_paths():
        await load_managed_skill_catalog()
        matched = await _read_managed_skill_virtual_file(
            "/mnt/skills/public/managed-law/v1/references/workflows/nda.md"
        )
        unrelated = await _read_managed_skill_virtual_file(
            "/mnt/skills/custom/local-skill/references/guide.md"
        )
        wrong_version = None
        try:
            await _read_managed_skill_virtual_file(
                "/mnt/skills/public/managed-law/v0/references/workflows/nda.md"
            )
        except FileNotFoundError:
            wrong_version = True
        return matched, unrelated, wrong_version

    with managed_skill_runtime_scope(store):
        matched, unrelated, wrong_version = asyncio.run(read_paths())
    assert matched == reference.decode()
    assert unrelated is None
    assert wrong_version is True


@pytest.mark.parametrize(
    "path",
    ["../SKILL.md", "SKILL.md", "/etc/passwd", "references/../../SKILL.md"],
)
def test_managed_reference_rejects_paths_outside_references(path):
    runtime = _Runtime(_package(references={"references/workflows/nda.md": b"safe"}))
    store = ExtensionData("managed-skill-test")
    store.set(ManagedSkillRuntimeBinding(runtime))

    async def read_reference():
        catalog = await load_managed_skill_catalog()
        return await read_managed_skill_reference(catalog[0], path)

    with managed_skill_runtime_scope(store), pytest.raises(PermissionError):
        asyncio.run(read_reference())


def test_managed_prompt_uses_preloaded_bytes_inside_running_loop(monkeypatch):
    runtime = _Runtime(_package())
    store = ExtensionData("managed-skill-test")
    store.set(ManagedSkillRuntimeBinding(runtime))
    monkeypatch.setattr(prompt_module, "get_or_new_skill_storage", lambda *_, **__: (_ for _ in ()).throw(AssertionError("local storage read")))
    app_config = SimpleNamespace(
        skills=SimpleNamespace(container_path="/mnt/skills"),
        skill_evolution=SimpleNamespace(enabled=False),
    )

    async def render_prompt_section():
        await load_managed_skills()
        listed = prompt_module.get_enabled_skills_for_config(app_config=app_config)
        section = prompt_module.get_skills_prompt_section(app_config=app_config)
        return listed, section

    with managed_skill_runtime_scope(store):
        skills, prompt_section = asyncio.run(render_prompt_section())
    assert [item.name for item in skills] == ["managed-law"]
    assert "managed-law" in prompt_section
    assert runtime.calls == 1


def test_managed_prompt_fails_closed_inside_running_loop_when_not_preloaded():
    runtime = _Runtime(_package())
    store = ExtensionData("managed-skill-test")
    store.set(ManagedSkillRuntimeBinding(runtime))

    async def load_from_sync_prompt_path():
        prompt_module.get_enabled_skills_for_config(app_config=None)

    with managed_skill_runtime_scope(store), pytest.raises(PermissionError, match="preloaded"):
        asyncio.run(load_from_sync_prompt_path())


def test_managed_binding_rejects_digest_or_path_tampering():
    bad = _package()
    bad = ManagedSkillPackage(bad.skill_id, bad.version, "0" * 64, bad.files)
    store = ExtensionData("managed-skill-test")
    store.set(ManagedSkillRuntimeBinding(_Runtime(bad)))
    with managed_skill_runtime_scope(store), pytest.raises(PermissionError, match="package digest"):
        asyncio.run(load_managed_skills())
    traversal = ManagedSkillPackage("managed-law", "v1", "0" * 64, [ManagedSkillFile("../SKILL.md", "0" * 64, b"x")])
    store = ExtensionData("managed-skill-test")
    store.set(ManagedSkillRuntimeBinding(_Runtime(traversal)))
    with managed_skill_runtime_scope(store), pytest.raises(PermissionError, match="unsafe"):
        asyncio.run(load_managed_skills())
    empty_segment = ManagedSkillPackage("managed-law", "v1", "0" * 64, [ManagedSkillFile("nested//SKILL.md", "0" * 64, b"x")])
    store = ExtensionData("managed-skill-test")
    store.set(ManagedSkillRuntimeBinding(_Runtime(empty_segment)))
    with managed_skill_runtime_scope(store), pytest.raises(PermissionError, match="unsafe"):
        asyncio.run(load_managed_skills())
