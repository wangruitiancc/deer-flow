"""Native Skill activation/tool registration, without model or customer-data access."""

import asyncio
import json
from pathlib import Path
from uuid import uuid4

from deerflow_extension_api import EXTENSION_TASK_STORE_KEY, ExtensionData
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from matrix_law_extension.config import MatrixLawConfig
from matrix_law_extension.runtime.context import TrustedMatterContext
from matrix_law_extension.runtime.middleware import MatterContextMiddleware
from matrix_law_extension.services.readiness import ReadinessService
from pydantic import Field

from deerflow.agents.middlewares.skill_activation_middleware import SkillActivationMiddleware
from deerflow.agents.middlewares.skill_tool_policy_middleware import SkillToolPolicyMiddleware
from deerflow.skills.storage.local_skill_storage import LocalSkillStorage

ROOT = Path(__file__).resolve().parents[2]
LEGAL_TOOLS = {"law_get_current_matter_summary", "law_list_citations", "law_read_citation", "law_validate_graph", "law_list_evidence_versions", "law_list_ocr_jobs", "law_list_proofreading_publications", "law_pin_evidence_manifest", "law_get_evidence_manifest", "law_list_published_material_pages", "law_read_published_material_page", "law_create_published_material_citation", "law_search_saved_authorities", "law_read_saved_authority_version"}


class RecordingModel(FakeMessagesListChatModel):
    bound_names: list[list[str]] = Field(default_factory=list)
    request_texts: list[str] = Field(default_factory=list)

    def bind_tools(self, tools, **kwargs):
        self.bound_names.append([item.name for item in tools])
        return self

    async def _agenerate(self, messages, **kwargs):
        self.request_texts.append("\n".join(str(item.content) for item in messages))
        return await super()._agenerate(messages, **kwargs)


def test_packaged_graph_skill_uses_native_activation_and_middleware_tools():
    async def exercise():
        storage = LocalSkillStorage(host_path=str(ROOT / "skills"))
        graph_skill = next(item for item in storage.load_skills(enabled_only=True) if item.name == "matrix-law-graph")
        assert LEGAL_TOOLS <= set(graph_skill.allowed_tools)
        assert {"read_file", "write_file", "str_replace", "present_files"} <= set(graph_skill.allowed_tools)
        assert "bash" not in graph_skill.allowed_tools
        token = str(uuid4())
        activation = SkillActivationMiddleware(slash_source_owner_token=token)
        policy = SkillToolPolicyMiddleware(slash_source_owner_token=token)
        # Real registry/parser/body loader; only the storage factory is test-scoped.
        activation._storage = lambda: storage
        policy._storage = lambda: storage
        legal = MatterContextMiddleware(ReadinessService(MatrixLawConfig()))

        @tool
        def unrelated_test_tool() -> str:
            """An unrelated capability that an activated legal Skill must not expose."""
            raise AssertionError("not allowed by the Skill")

        model = RecordingModel(responses=[AIMessage(content="", tool_calls=[{"id": "catalog", "name": "law_list_citations", "args": {}}]), AIMessage(content="Synthetic activation check complete.")])
        graph = create_agent(model, tools=[unrelated_test_tool], middleware=[activation, policy, legal], context_schema=dict)
        store = ExtensionData("synthetic-skill-runtime")
        store.set(
            TrustedMatterContext(
                user_id="synthetic",
                tenant_id=str(uuid4()),
                membership_id=str(uuid4()),
                tenant_role="owner",
                matter_id=str(uuid4()),
                work_kind="consultation",
                matter_member_id=str(uuid4()),
                matter_role="owner",
                thread_id="synthetic-thread",
                mapping_id=str(uuid4()),
                policy_version="phase4-v1",
                context_version=1,
            )
        )
        result = await graph.ainvoke({"messages": [HumanMessage(content="/matrix-law-graph 生成这次零散法律咨询的人物关系图")]}, context={EXTENSION_TASK_STORE_KEY: store})
        # The registry intentionally withholds raw OCR reads/citation writes:
        # Agent material reads must use immutable proofreading publications.
        readable = LEGAL_TOOLS
        assert model.bound_names and all(readable <= set(names) for names in model.bound_names)
        assert all(not {"law_read_ocr_block", "law_create_citation"} & set(names) for names in model.bound_names)
        assert all("unrelated_test_tool" not in names for names in model.bound_names)
        assert "law_validate_graph" in model.request_texts[0]
        assert "dedicated legal work agent" in model.request_texts[0]
        outputs = [item for item in result["messages"] if isinstance(item, ToolMessage)]
        assert len(outputs) == 1
        # The service is intentionally stopped: prove ToolNode reached the actual
        # authorized extension boundary, not a mocked tool or "not a valid tool".
        assert json.loads(outputs[0].content) == {"status": "error", "code": "LEGAL_SERVICE_UNAVAILABLE"}
        assert outputs[0].status == "error"

    asyncio.run(exercise())


def test_runtime_image_packages_only_operator_owned_legal_skill():
    dockerfile = (ROOT / "backend/Dockerfile").read_text(encoding="utf-8")
    assert "COPY skills/public/matrix-law-graph ./skills/public/matrix-law-graph" in dockerfile
    assert "COPY --from=builder /app/skills ./skills" in dockerfile
    ignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")
    assert "!skills/public/matrix-law-graph/**" in ignore
