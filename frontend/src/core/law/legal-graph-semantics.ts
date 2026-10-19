import { type LegalGraph, type LegalGraphNode } from "./legal-graph";

export const legalNodeRoles = [
  "subject",
  "act",
  "fact",
  "asset",
  "claim",
  "defense",
  "issue",
  "element",
  "rule",
  "procedure",
  "evidence",
  "other",
] as const;
export const legalRelationFamilies = [
  "identity",
  "rights",
  "conduct",
  "assets",
  "proof",
  "issues",
  "procedure",
  "reasoning",
] as const;
export const legalRelationKinds = [
  "represents",
  "controls",
  "owes",
  "performs",
  "violates",
  "transfers",
  "holds",
  "secures",
  "supports",
  "contradicts",
  "raises",
  "satisfies",
  "rebuts",
  "applies",
  "precedes",
  "causes",
  "requires",
  "limits",
  "other",
] as const;
export const legalStatements = [
  "material_record",
  "party_assertion",
  "analysis_hypothesis",
] as const;
export const legalRoleLabels: Record<(typeof legalNodeRoles)[number], string> =
  {
    subject: "主体",
    act: "法律行为",
    fact: "待核对事实",
    asset: "资金或标的",
    claim: "请求／指控／处置主张",
    defense: "抗辩／反对意见",
    issue: "争议焦点",
    element: "待审查要件",
    rule: "法律规范",
    procedure: "程序事项",
    evidence: "证据材料",
    other: "其他／待分类",
  };
export const legalFamilyLabels: Record<
  (typeof legalRelationFamilies)[number],
  string
> = {
  identity: "主体与身份",
  rights: "权利与义务",
  conduct: "行为与事实",
  assets: "资金与标的",
  proof: "证据与证明",
  issues: "争点与要件",
  procedure: "程序与期限",
  reasoning: "因果与推理",
};
export const legalKindLabels: Record<
  (typeof legalRelationKinds)[number],
  string
> = {
  represents: "代表／代理",
  controls: "控制／隶属",
  owes: "负有义务",
  performs: "履行",
  violates: "违反",
  transfers: "转移／流向",
  holds: "持有／占有",
  secures: "担保／保障",
  supports: "支持／证明",
  contradicts: "相反／矛盾",
  raises: "提出",
  satisfies: "满足要件",
  rebuts: "反驳／抗辩",
  applies: "适用分析",
  precedes: "时间先后",
  causes: "因果分析",
  requires: "依赖／前提",
  limits: "限制／排除",
  other: "其他专业关系",
};
export const legalStatementLabels: Record<
  (typeof legalStatements)[number],
  string
> = {
  material_record: "材料记载",
  party_assertion: "当事人主张",
  analysis_hypothesis: "分析假设",
};
export function legalNodeRole(
  node: LegalGraphNode,
): (typeof legalNodeRoles)[number] {
  if (node.role) return node.role;
  if (["party", "person", "org"].includes(node.type)) return "subject";
  const defaults: Partial<
    Record<LegalGraphNode["type"], (typeof legalNodeRoles)[number]>
  > = {
    event: "fact",
    evidence: "evidence",
    money: "asset",
    law: "rule",
    claim: "claim",
  };
  return defaults[node.type] ?? "other";
}

export function legalGraphQuestions(graph: LegalGraph) {
  const questions: {
    id: string;
    nodeId?: string;
    edgeId?: string;
    text: string;
  }[] = [];
  const citations = new Set(
    graph.sources
      .filter((source) => source.kind === "citation")
      .map((source) => source.id),
  );
  for (const node of graph.nodes) {
    const role = legalNodeRole(node);
    const related = graph.edges.filter(
      (edge) => edge.source === node.id || edge.target === node.id,
    );
    if (["claim", "defense", "issue", "element"].includes(role)) {
      if (!related.some((edge) => edge.legal?.family === "issues"))
        questions.push({
          id: `issue:${node.id}`,
          nodeId: node.id,
          text: `“${node.label}”尚未建立争点／要件关系，需要核对分析链条。`,
        });
      if (!related.some((edge) => edge.legal?.family === "proof"))
        questions.push({
          id: `proof:${node.id}`,
          nodeId: node.id,
          text: `“${node.label}”尚未关联支持或反驳的证明关系。`,
        });
    }
    if (
      node.source_ids.length &&
      !node.source_ids.some((id) => citations.has(id))
    )
      questions.push({
        id: `source:${node.id}`,
        nodeId: node.id,
        text: `“${node.label}”仅有关联的未核验来源，尚未绑定正式引用。`,
      });
  }
  for (const edge of graph.edges) {
    for (const [index, text] of (edge.legal?.questions ?? []).entries())
      questions.push({
        id: `question:${edge.id}:${index}`,
        edgeId: edge.id,
        text,
      });
  }
  return questions;
}
