from __future__ import annotations

from pathlib import Path

from langchain_core.messages import HumanMessage

from deerflow.agents.legal_workflow import (
    LEGAL_RUNTIME_PROMPT_SECTION,
    LEGAL_WORKFLOW_CONTEXT_MESSAGE_NAME,
    classify_legal_matter,
    derive_legal_workflow_context,
)
from deerflow.skills.types import Skill, SkillCategory


def test_legal_runtime_prompt_is_product_native():
    assert "Matrix Law 法律工作台中的律师助手" in LEGAL_RUNTIME_PROMPT_SECTION
    assert "你不是通用 AI Agent" in LEGAL_RUNTIME_PROMPT_SECTION
    assert "先确认事项类型、适用法域、材料范围和输出目的" in LEGAL_RUNTIME_PROMPT_SECTION
    assert "当前请求中实际暴露的工具才是权威工具集" in LEGAL_RUNTIME_PROMPT_SECTION
    assert "Matrix-Law" not in LEGAL_RUNTIME_PROMPT_SECTION


def test_classify_legal_matter_prefers_specific_workflows():
    assert classify_legal_matter("帮我审一下这个合同的付款和违约责任")[:2] == ("contract_review", "合同审查")
    assert classify_legal_matter("起草一份律师函")[:2] == ("legal_drafting", "法律文书起草")
    assert classify_legal_matter("检索一下合同解除相关案例")[:2] == ("legal_research", "法律检索")


def test_derive_legal_workflow_context_renders_hidden_work_method():
    context = derive_legal_workflow_context([HumanMessage(content="帮我审一下这个合同")])

    assert context is not None
    rendered = context.render()
    assert LEGAL_WORKFLOW_CONTEXT_MESSAGE_NAME == "legal_workflow_context"
    assert "事项类型：合同审查" in rendered
    assert "合同文本或关键条款" in rendered
    assert "commercial-contracts" in rendered
    assert "先核验材料和法域" in rendered


def test_derive_legal_workflow_context_skips_nonlegal_chitchat():
    assert derive_legal_workflow_context([HumanMessage(content="hello")]) is None


def test_derive_legal_workflow_context_filters_recommended_skills_to_authorized_set():
    context = derive_legal_workflow_context(
        [HumanMessage(content="帮我审一下这个合同")],
        available_skill_names={"general-legal-method"},
    )

    assert context is not None
    assert [skill.name for skill in context.recommended_skills] == ["general-legal-method"]


def test_derive_legal_workflow_context_includes_enabled_skill_descriptions():
    skill = Skill(
        name="commercial-contracts",
        description="用于 NDA、SaaS、供应商及一般商业协议审查和谈判交接草案；不签署或发送合同。",
        license=None,
        skill_dir=Path("/tmp/commercial-contracts"),
        skill_file=Path("/tmp/commercial-contracts/SKILL.md"),
        relative_path=Path("commercial-contracts"),
        category=SkillCategory.PUBLIC,
        enabled=True,
    )

    context = derive_legal_workflow_context(
        [HumanMessage(content="帮我审一下这个合同")],
        enabled_skills=[skill],
    )

    assert context is not None
    rendered = context.render()
    assert "commercial-contracts" in rendered
    assert "NDA、SaaS、供应商" in rendered
    assert "china-law-analysis" not in rendered
