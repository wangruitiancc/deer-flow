"""Matrix Law native workflow policy for the lead LangChain agent.

This module is the legal-product runtime contract. The lead-agent prompt and
after-model verification both read from here so legal identity, work method, and
tool-truth rules do not drift into ad hoc prompt patches.
"""

from __future__ import annotations

import html
from dataclasses import dataclass
from typing import Any, Literal

from langchain_core.messages import HumanMessage, ToolMessage

from deerflow.skills.types import Skill

LegalMatterType = Literal[
    "contract_review",
    "legal_drafting",
    "legal_research",
    "litigation",
    "compliance",
    "evidence_processing",
    "general_legal",
]

LEGAL_ASSISTANT_RESPONSE = "我是法律工作台中的律师助手，可以协助律师处理法律检索、案件材料、合同审查、文书起草和合规分析等工作"

LEGAL_RUNTIME_PROMPT_SECTION = f"""
<role>
你是 Matrix Law 法律工作台中的律师助手，只面向律师和律所成员提供专业、审慎、可核查的法律工作支持。你的工作范围是法律检索、案件材料整理、事实与证据梳理、争议焦点归纳、文书起草、合同审查、合规分析、律所工作台文件处理，以及工作台已授权法律能力的调用。

你不是通用 AI Agent、开源框架展示、编程助手、脚本自动化助手或平台运维机器人。用户询问你的身份时，只说明“{LEGAL_ASSISTANT_RESPONSE}”；不要提及底层框架、运行时实现、来源背景、模型供应商、内部能力编排、开源项目或通用能力菜单。
</role>

<legal_work_rules>
法律工作硬约束，适用于所有回答、分析和生成的文书：
- 默认按法律工作台方法处理任务：先确认事项类型、适用法域、材料范围和输出目的；再整理事实基础和证据来源；再归纳法律关系、请求权/抗辩路径或合规义务；最后输出分析、建议或文书草稿。
- 事实结论必须有依据。关于案件、合同、证据、当事人、日期、金额、程序状态、法条或裁判观点的结论，应绑定到用户材料、已上传文件、工具返回结果、法条编号、案例来源或明确的公开来源。
- 区分事实、推断和建议。材料直接支持的内容标为事实；基于事实链条得出的内容标为推断；策略、措辞和下一步行动标为建议。不要把推断写成确定事实。
- 不编造当事人、日期、金额、证据、条款、法规、案例、法院观点或工具执行结果。材料不足时，说明缺口和需要补充的材料。
- 给出法律分析或文书草稿时，默认在结尾提供“依据清单”和“置信度”。依据清单列出每个关键结论所依赖的材料、文件名、工具返回标识、法条编号或公开来源；置信度用高/中/低说明材料支撑程度。
- 法律检索或联网检索结果必须标明来源。若来源不是权威法源、裁判文书、监管机关或用户材料，应提示需律师复核。
- 不替代执业律师的最终判断、签署、提交、承诺或诉讼策略决定；涉及重大权利义务、期限、费用、诉讼提交或对外发送时，提醒由律师复核。
- 非法律问题、通用编程、脚本编写、系统运维、平台功能介绍不是本产品的主动能力。只有当这些操作是为处理法律材料、证据文件、文书交付或律所工作台任务所必需时，才作为后台手段使用；不要把它们包装成面向用户的通用能力。
</legal_work_rules>

<tool_truth_rules>
工具执行真实性规则：
- 不要声称已经调用工具、创建/保存/导入文件、完成 OCR、检索法条、读取案件材料或执行 Skill，除非本轮有成功的工具观察结果或明确回执证明。
- 计划中的路径、猜测的文件名、历史助手说法、按钮文案或失败/未完成状态，不是已执行证明。
- 当前请求中实际暴露的工具才是权威工具集。不要引用历史回答里的工具可用性判断，也不要用手工说明、终端命令或猜测替代当前可调用的法律工作台工具。
- 后续文件、OCR、导入、转换或分析操作，应复用最近一次成功工具结果返回的精确路径、ID、大小、哈希、版本号或材料标识；不要自行重写、补空格、规范化或发明。
- 如果工具失败、权限不足、结果为空或证据不够，直接说明当前未验证成功，并给出可执行的下一步，不要把失败包装成完成。
</tool_truth_rules>
""".strip()

LEGAL_TOPIC_MARKERS = ("法律", "律师", "律所", "案件", "当事人", "合同", "条款", "法条", "裁判", "证据", "诉讼", "仲裁", "合规")
LEGAL_TOOL_PREFIXES = ("case.", "caseGraph.", "law.")
LEGAL_TOOL_SUBSTRINGS = ("legal", "law", "case", "contract", "compliance", "litigation", "court", "statute")
LEGAL_WORKFLOW_CONTEXT_MESSAGE_NAME = "legal_workflow_context"

MATTER_RULES: tuple[tuple[LegalMatterType, tuple[str, ...], str, tuple[str, ...]], ...] = (
    (
        "legal_research",
        ("检索", "查询", "法条", "法规", "案例", "裁判", "司法解释", "监管规定", "法律依据"),
        "法律检索",
        ("检索问题", "适用法域", "时间范围", "权威来源优先级", "需要输出的结论粒度"),
    ),
    (
        "contract_review",
        ("合同", "协议", "条款", "付款", "违约", "解除", "续约", "保密", "知识产权"),
        "合同审查",
        ("合同文本或关键条款", "适用法域", "交易背景", "审查重点", "期望输出格式"),
    ),
    (
        "legal_drafting",
        ("起草", "写一份", "生成", "律师函", "法律意见", "起诉状", "答辩状", "上诉状", "代理词", "仲裁申请"),
        "法律文书起草",
        ("事项类型", "适用法域", "事实材料", "证据来源", "收件人/提交对象", "语气与格式要求"),
    ),
    (
        "litigation",
        ("诉讼", "仲裁", "起诉", "答辩", "举证", "证据", "庭审", "执行", "保全", "管辖", "时效"),
        "争议解决/诉讼仲裁",
        ("当事人身份", "程序阶段", "诉求/抗辩", "关键事实", "证据目录", "期限信息"),
    ),
    (
        "compliance",
        ("合规", "监管", "隐私", "数据", "个人信息", "劳动用工", "公司治理", "风控", "审计"),
        "合规分析",
        ("业务场景", "适用地区", "主体角色", "数据/人员/流程范围", "风险接受度", "整改目标"),
    ),
    (
        "evidence_processing",
        ("OCR", "扫描", "识别", "导入", "转换", "整理材料", "证据清单", "时间线", "材料目录"),
        "材料/证据处理",
        ("文件来源", "处理目标", "输出位置", "是否需要结构化字段", "核对规则"),
    ),
    (
        "general_legal",
        LEGAL_TOPIC_MARKERS,
        "通用法律分析",
        ("事项类型", "适用法域", "事实基础", "材料范围", "输出目的"),
    ),
)


@dataclass(frozen=True)
class RecommendedSkill:
    name: str
    description: str = ""


@dataclass(frozen=True)
class LegalWorkflowContext:
    matter_type: LegalMatterType
    matter_label: str
    required_inputs: tuple[str, ...]
    recommended_skills: tuple[RecommendedSkill, ...]
    user_text: str

    def render(self) -> str:
        inputs = "、".join(self.required_inputs)
        if self.recommended_skills:
            skills = "\n".join(
                f"  - {html.escape(skill.name, quote=False)}"
                f"{(': ' + html.escape(skill.description, quote=False)) if skill.description else ''}"
                for skill in self.recommended_skills
            )
        else:
            skills = "  - 无"
        return (
            "<legal_workflow_context>\n"
            f"- 事项类型：{self.matter_label}\n"
            "- 当前阶段：输入核验与事实基础确认\n"
            f"- 必查输入：{inputs}\n"
            "- 候选法律工作流 Skill：\n"
            f"{skills}\n"
            "- Skill 使用规则：如果候选 Skill 在当前 skill_index / describe_skill 中可用，应优先调用 describe_skill 查看其适用边界；不可用时不得声称该 Skill 已启用或已执行。\n"
            "- 工作方式：先核验材料和法域，再整理事实/证据，再检索或调用授权能力，最后输出分析、建议或文书草稿。\n"
            "- 如果必查输入明显缺失，不要直接给确定法律结论；应先提出缺口、请求补充，或在低置信度前提下给出有限范围分析。\n"
            "- 所有后续结论必须能追溯到用户材料、工具回执、法条/案例来源或明确说明的假设。\n"
            "</legal_workflow_context>"
        )


MATTER_SKILL_RECOMMENDATIONS: dict[LegalMatterType, tuple[str, ...]] = {
    "contract_review": ("commercial-contracts", "china-law-analysis", "general-legal-method"),
    "legal_drafting": ("judicial-writing-reference", "china-law-analysis", "general-legal-method"),
    "legal_research": ("china-law-analysis", "general-legal-method"),
    "litigation": ("dispute-resolution", "china-law-analysis", "judicial-writing-reference", "general-legal-method"),
    "compliance": ("privacy-data-protection", "employment-law", "regulatory-policy", "ai-governance", "general-legal-method"),
    "evidence_processing": ("platform-matter-workspace", "document-conversion", "general-legal-method"),
    "general_legal": ("general-legal-method", "china-law-analysis"),
}


def flatten_message_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                text = block.get("text") or block.get("content")
                parts.append(text if isinstance(text, str) else str(block))
            else:
                parts.append(str(block))
        return "\n".join(parts)
    return str(content)


def latest_visible_user_index(messages: list[Any]) -> int:
    latest_user_index = -1
    for index, message in enumerate(messages):
        if not isinstance(message, HumanMessage):
            continue
        if (message.additional_kwargs or {}).get("hide_from_ui"):
            continue
        latest_user_index = index
    return latest_user_index


def current_turn_messages(messages: list[Any]) -> list[Any]:
    latest_user_index = latest_visible_user_index(messages)
    if latest_user_index == -1:
        return messages
    return messages[latest_user_index:]


def latest_visible_user_text(messages: list[Any]) -> str:
    index = latest_visible_user_index(messages)
    if index == -1:
        return ""
    return flatten_message_content(getattr(messages[index], "content", "")).strip()


def successful_tool_messages(messages: list[Any]) -> list[ToolMessage]:
    tools: list[ToolMessage] = []
    for message in messages:
        if not isinstance(message, ToolMessage):
            continue
        if getattr(message, "status", "success") == "error":
            continue
        tools.append(message)
    return tools


def used_legal_tool(messages: list[Any]) -> bool:
    for tool_message in successful_tool_messages(messages):
        name = str(tool_message.name or "")
        lower = name.lower()
        if any(name.startswith(prefix) for prefix in LEGAL_TOOL_PREFIXES):
            return True
        if any(token in lower for token in LEGAL_TOOL_SUBSTRINGS):
            return True
    return False


def classify_legal_matter(text: str) -> tuple[LegalMatterType, str, tuple[str, ...]] | None:
    normalized = text.strip()
    if not normalized:
        return None
    for matter_type, markers, label, required_inputs in MATTER_RULES:
        if any(marker in normalized for marker in markers):
            return matter_type, label, required_inputs
    return None


def recommend_legal_skill_names(matter_type: LegalMatterType, available_skill_names: set[str] | frozenset[str] | None = None) -> tuple[str, ...]:
    recommendations = MATTER_SKILL_RECOMMENDATIONS[matter_type]
    if available_skill_names is None:
        return recommendations
    return tuple(name for name in recommendations if name in available_skill_names)


def recommend_legal_skills(
    matter_type: LegalMatterType,
    *,
    available_skill_names: set[str] | frozenset[str] | None = None,
    enabled_skills: list[Skill] | tuple[Skill, ...] | None = None,
) -> tuple[RecommendedSkill, ...]:
    names = recommend_legal_skill_names(matter_type, available_skill_names)
    by_name = {skill.name: skill for skill in enabled_skills or ()}
    recommended: list[RecommendedSkill] = []
    for name in names:
        skill = by_name.get(name)
        if enabled_skills is not None and skill is None:
            continue
        description = " ".join((skill.description if skill is not None else "").split())[:240]
        recommended.append(RecommendedSkill(name=name, description=description))
    return tuple(recommended)


def derive_legal_workflow_context(
    messages: list[Any],
    *,
    available_skill_names: set[str] | frozenset[str] | None = None,
    enabled_skills: list[Skill] | tuple[Skill, ...] | None = None,
) -> LegalWorkflowContext | None:
    text = latest_visible_user_text(messages)
    classified = classify_legal_matter(text)
    if classified is None and not used_legal_tool(current_turn_messages(messages)):
        return None
    if classified is None:
        classified = ("general_legal", "通用法律分析", ("事项类型", "适用法域", "事实基础", "材料范围", "输出目的"))
    matter_type, label, required_inputs = classified
    return LegalWorkflowContext(
        matter_type=matter_type,
        matter_label=label,
        required_inputs=required_inputs,
        recommended_skills=recommend_legal_skills(
            matter_type,
            available_skill_names=available_skill_names,
            enabled_skills=enabled_skills,
        ),
        user_text=text,
    )

