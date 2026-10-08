"""Native activation/policy/ToolNode coverage for all six packaged templates."""

import json
from pathlib import Path
from uuid import uuid4

import pytest
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from pydantic import Field

from deerflow.agents.middlewares.skill_activation_middleware import SkillActivationMiddleware
from deerflow.agents.middlewares.skill_tool_policy_middleware import SkillToolPolicyMiddleware
from deerflow.skills.storage.local_skill_storage import LocalSkillStorage

ROOT = Path(__file__).resolve().parents[2]


class RecordingModel(FakeMessagesListChatModel):
    bound_names: list[list[str]] = Field(default_factory=list)
    inputs: list[str] = Field(default_factory=list)

    def bind_tools(self, tools, **kwargs):
        self.bound_names.append([item.name for item in tools])
        return self

    async def _agenerate(self, messages, **kwargs):
        self.inputs.append("\n".join(str(item.content) for item in messages))
        return await super()._agenerate(messages, **kwargs)


@pytest.mark.asyncio
@pytest.mark.parametrize("template_id", ["meeting-notes", "hearing-notes", "legal-opinion", "evidence-list", "case-timeline", "contract-review"])
async def test_each_template_uses_native_skill_and_on_demand_resource_read(template_id):
    storage = LocalSkillStorage(host_path=str(ROOT / "skills"))
    skill = next(item for item in storage.load_skills(enabled_only=True) if item.name == "matrix-law-templates")
    root = ROOT / "skills/public/matrix-law-templates"
    entry = next(item for item in json.loads((root / "assets/catalog.json").read_text(encoding="utf-8"))["templates"] if item["id"] == template_id)
    content = (root / "assets" / entry["file"]).read_text(encoding="utf-8")
    virtual_path = skill.get_container_path() + "/assets/" + entry["file"]
    token = str(uuid4())
    activation = SkillActivationMiddleware(slash_source_owner_token=token)
    policy = SkillToolPolicyMiddleware(slash_source_owner_token=token)
    activation._storage = lambda: storage
    policy._storage = lambda: storage

    @tool
    def read_file(path: str) -> str:
        """Synthetic provider for one read-only template; live IO is verified separately."""
        assert path == virtual_path
        return content

    @tool
    def unrelated_tool() -> str:
        """An unrelated tool that must not be exposed by this explicit Skill."""
        raise AssertionError("unexpected tool")

    model = RecordingModel(responses=[AIMessage(content="", tool_calls=[{"id": "read-template", "name": "read_file", "args": {"path": virtual_path}}]), AIMessage(content="Synthetic template read complete")])
    graph = create_agent(model, tools=[read_file, unrelated_tool], middleware=[activation, policy], context_schema=dict)
    result = await graph.ainvoke({"messages": [HumanMessage(content=f"/matrix-law-templates 使用{entry['title']}生成空白草稿")]}, context={"synthetic_run": str(uuid4())})
    assert all("read_file" in names and "unrelated_tool" not in names for names in model.bound_names), model.bound_names
    assert content not in model.inputs[0]  # Metadata/Skill body, not every template body.
    assert content in model.inputs[1]
    assert [message.content for message in result["messages"] if isinstance(message, ToolMessage)] == [content]
    assert "bash" not in skill.allowed_tools and "task" not in skill.allowed_tools


def test_template_skill_is_explicitly_included_in_server_build():
    assert "COPY skills/public/matrix-law-templates ./skills/public/matrix-law-templates" in (ROOT / "backend/Dockerfile").read_text()
    assert "!skills/public/matrix-law-templates/**" in (ROOT / ".dockerignore").read_text()


@pytest.mark.asyncio
@pytest.mark.parametrize("template_id", ["meeting-notes", "hearing-notes", "legal-opinion", "evidence-list", "case-timeline", "contract-review"])
async def test_creation_tool_updates_native_artifact_reducer_without_model_publication(template_id, monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from matrix_law_extension.policy import MatterAction
    from matrix_law_extension.runtime.source_tools import LegalSourceReader
    from matrix_law_extension.runtime.template_tools import build_template_tools
    from matrix_law_extension.services.legal_templates import TemplateDraftInput, render_template

    from deerflow.agents.thread_state import ThreadState

    storage = LocalSkillStorage(host_path=str(ROOT / "skills"))
    token = str(uuid4())
    activation = SkillActivationMiddleware(slash_source_owner_token=token)
    policy = SkillToolPolicyMiddleware(slash_source_owner_token=token)
    activation._storage = lambda: storage
    policy._storage = lambda: storage
    output_path = f"/mnt/user-data/outputs/draft-{uuid4().hex}.md"
    writer = AsyncMock(return_value=output_path)

    async def authorized(self, runtime, operation, handler, *, action):
        assert action == MatterAction.GENERATE_DOCUMENT
        return {"status": "ok", "data": await handler(None, None)}

    monkeypatch.setattr(LegalSourceReader, "execute", authorized)
    from langgraph.types import Command

    publisher = AsyncMock(return_value=Command(update={"artifacts": [output_path]}))
    native_tools = build_template_tools(SimpleNamespace(create_output_text=writer, present_output_files=publisher))
    values = {"template_id": template_id, "title": "合成模板", "project_label": "合成咨询", "creation_date": "2026-09-06", "creation_time": "09:30"}
    model = RecordingModel(responses=[AIMessage(content="", tool_calls=[{"id": "create-template", "name": "law_create_template_draft", "args": {"draft": values}}]), AIMessage(content="Synthetic creation complete")])
    graph = create_agent(model, tools=native_tools, middleware=[activation, policy], context_schema=dict, state_schema=ThreadState)
    result = await graph.ainvoke({"messages": [HumanMessage(content="/matrix-law-templates 生成空白草稿")]}, context={"synthetic_run": str(uuid4())})
    assert result["artifacts"] == [output_path]
    assert all("law_create_template_draft" in names for names in model.bound_names)
    expected, _ = render_template(TemplateDraftInput.model_validate(values))
    assert writer.await_count == 1 and writer.await_args.args[1] == expected
    source = (ROOT / "skills/public/matrix-law-templates/assets" / f"{template_id}.md").read_text(encoding="utf-8")
    assert source.replace("{{title}}", values["title"]).replace("{{case}}", values["project_label"]).replace("{{date}}", values["creation_date"]).replace("{{time}}", values["creation_time"]) == expected
    message = next(item for item in result["messages"] if isinstance(item, ToolMessage))
    assert message.tool_call_id == "create-template" and message.status == "success"
    assert json.loads(message.content)["data"]["saved_to_project"] is False
