"""Native Skill + ToolNode probe under the real API RLS role; synthetic stack only.

Pass a newly provisioned synthetic thread UUID. This is a scripted-model boundary
check, not an LLM quality test or a complete Gateway run-lifecycle acceptance.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from uuid import UUID, uuid4

from deerflow_extension_api import EXTENSION_TASK_STORE_KEY, ExtensionData, ExtensionRuntimeDeps
from langchain.agents import create_agent
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from matrix_law_extension.config import MatrixLawConfig
from matrix_law_extension.runtime.context import MatterContextAdmission
from matrix_law_extension.runtime.middleware import MatterContextMiddleware
from matrix_law_extension.services.readiness import ReadinessService
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from deerflow.agents.middlewares.skill_activation_middleware import SkillActivationMiddleware
from deerflow.agents.middlewares.skill_tool_policy_middleware import SkillToolPolicyMiddleware
from deerflow.skills.storage.local_skill_storage import LocalSkillStorage


class ScriptedModel(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kwargs):
        names = {item.name for item in tools}
        assert {"law_list_evidence_versions", "law_list_citations", "law_validate_graph"} <= names
        return self


async def main() -> None:
    if os.environ.get("AUTH_JWT_SECRET") != "synthetic-p1-jwt-secret-not-for-production":
        raise RuntimeError("Only the isolated synthetic stack is permitted")
    thread_id = str(UUID(sys.argv[1]))
    engine = create_async_engine(os.environ["DATABASE_URL"], connect_args={"server_settings": {"search_path": "deerflow"}})
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    settings = MatrixLawConfig.model_validate({"database": {"enabled": True, "schema_name": "deerflow"}})
    service = ReadinessService(settings)
    await service.start(ExtensionRuntimeDeps(session_factory=sessions))
    try:
        async with sessions() as session:
            user_id = await session.scalar(text("SELECT user_id FROM threads_meta WHERE thread_id=:thread"), {"thread": thread_id})
        assert user_id
        context = await MatterContextAdmission(service).resolve_run_context(thread_id=thread_id, user_id=user_id)
        async with service.session_factory() as session:
            row = (await session.execute(text("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user"))).one()
            assert row[0] == "matrix_law_api" and not row[1] and not row[2]
        store = ExtensionData("synthetic-native-graph-probe")
        store.set(context)
        storage = LocalSkillStorage(host_path="/app/skills")
        skills = storage.load_skills(enabled_only=True)
        assert [item.name for item in skills] == ["matrix-law-graph"]
        token = str(uuid4())
        activation = SkillActivationMiddleware(slash_source_owner_token=token)
        policy = SkillToolPolicyMiddleware(slash_source_owner_token=token)
        activation._storage = lambda: storage
        policy._storage = lambda: storage
        model = ScriptedModel(
            responses=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {"id": "evidence", "name": "law_list_evidence_versions", "args": {}},
                        {"id": "citations", "name": "law_list_citations", "args": {}},
                    ],
                ),
                AIMessage(content="Synthetic boundary probe complete; no graph generation claimed."),
            ]
        )
        graph = create_agent(model, middleware=[activation, policy, MatterContextMiddleware(service, settings=settings)], context_schema=dict)
        result = await graph.ainvoke({"messages": [HumanMessage(content="/matrix-law-graph 先列出当前合成法律咨询的材料和引用，不生成法律意见。")]}, context={EXTENSION_TASK_STORE_KEY: store})
        outputs = [item for item in result["messages"] if isinstance(item, ToolMessage)]
        assert {item.name for item in outputs} == {"law_list_evidence_versions", "law_list_citations"}
        for item in outputs:
            payload = json.loads(item.content)
            assert payload["status"] == "ok", payload.get("code")
            assert payload["data"]["items"] == [], "Use a newly provisioned empty synthetic consultation"
        print(
            json.dumps(
                {
                    "result": "passed",
                    "database_role": row[0],
                    "rls": True,
                    "skill": skills[0].name,
                    "tool_results": {item.name: "ok" for item in outputs},
                    "scope": "scripted model, native Skill/ToolNode, real authorized API-role transactions; no real LLM or OCR",
                }
            )
        )
    finally:
        await service.stop()
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
