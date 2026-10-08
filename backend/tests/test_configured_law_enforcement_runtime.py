"""Exercise the real configured loader and ToolNode, not only a direct wrapper call."""

import asyncio
from types import SimpleNamespace
from typing import Annotated
from unittest.mock import AsyncMock

import pytest
from deerflow_extension_api import EXTENSION_TASK_STORE_KEY, ExtensionData, ExtensionRuntimeDeps
from langchain.agents import create_agent
from langchain.tools import InjectedToolCallId, tool
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.types import Command
from matrix_law_extension.config import MatrixLawConfig
from matrix_law_extension.runtime.context import TrustedMatterContext
from matrix_law_extension.services.readiness import ReadinessService
from pydantic import Field

from deerflow.agents.middlewares.configured_extensions import load_configured_extension_middlewares


class Model(FakeMessagesListChatModel):
    prompts: list[str] = Field(default_factory=list)

    def bind_tools(self, tools, **kwargs):
        return self

    async def _agenerate(self, messages, **kwargs):
        self.prompts.append(str(messages[0].content))
        return await super()._agenerate(messages, **kwargs)


@pytest.mark.parametrize("valid", [True, False])
def test_configured_middleware_enforces_tool_result_and_actual_model_policy(valid):
    async def exercise():
        configured = load_configured_extension_middlewares(SimpleNamespace(extensions=SimpleNamespace(middlewares=["matrix_law_extension.runtime.enforcement:LawEnforcementMiddleware"])))
        assert len(configured) == 1
        store = ExtensionData("native-configured-law")
        store.set(
            TrustedMatterContext(
                user_id="u",
                tenant_id="t",
                membership_id="m",
                tenant_role="owner",
                matter_id="matter",
                work_kind="consultation",
                matter_member_id="mm",
                matter_role="owner",
                thread_id="thread",
                mapping_id="map",
                policy_version="v1",
                context_version=1,
            )
        )
        service = ReadinessService(MatrixLawConfig())
        await service.start(ExtensionRuntimeDeps(read_output_text=AsyncMock()))
        store.set(service)
        context = {EXTENSION_TASK_STORE_KEY: store}
        delegate = configured[0]._delegate(SimpleNamespace(context=context))
        delegate._read_graph_output = AsyncMock(return_value="synthetic graph bytes")
        delegate._source_reader.validate_graph = AsyncMock(return_value={"status": "ok", "data": {"valid": valid}})
        calls = []

        @tool("present_files")
        def publish(filepaths: list[str], tool_call_id: Annotated[str, InjectedToolCallId]) -> Command:
            """Synthetic publisher with the native Command contract."""
            calls.append(filepaths)
            return Command(update={"artifacts": filepaths, "messages": [ToolMessage("presented", tool_call_id=tool_call_id)]})

        model = Model(responses=[AIMessage(content="", tool_calls=[{"id": "publish", "name": "present_files", "args": {"filepaths": ["/mnt/user-data/outputs/g.law-graph.json"]}}]), AIMessage(content="done")])
        graph = create_agent(model, tools=[publish], middleware=configured, context_schema=dict)
        result = await graph.ainvoke({"messages": [HumanMessage(content="Review this synthetic legal graph.")]}, context=context)
        outputs = [m for m in result["messages"] if isinstance(m, ToolMessage)]
        assert len(outputs) == 1
        assert "dedicated legal work agent" in model.prompts[0]
        assert len(calls) == int(valid)
        assert outputs[0].status == ("success" if valid else "error")
        assert bool(outputs[0].additional_kwargs.get("matrix_law_graph_validation")) is valid
        await service.stop()

    asyncio.run(exercise())
