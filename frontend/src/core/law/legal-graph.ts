import { z } from "zod";

import {
  legalNodeRoles,
  legalRelationFamilies,
  legalRelationKinds,
  legalStatements,
} from "./legal-graph-semantics";

export const MAX_LEGAL_GRAPH_BYTES = 2 * 1024 * 1024;
export function isLegalGraphFile(filepath: string): boolean {
  return filepath.toLowerCase().endsWith(".law-graph.json");
}
export const legalGraphCategories = [
  "person",
  "timeline",
  "evidence",
  "legal",
  "custom",
] as const;
export const legalGraphNodeTypes = [
  "party",
  "person",
  "org",
  "event",
  "evidence",
  "money",
  "law",
  "claim",
  "other",
] as const;

// Limits use Unicode code points, matching the Python contract. Content is plain text.
const text = (max: number) =>
  z
    .string()
    .refine(
      (value) =>
        value.trim().length > 0 &&
        [...value].length <= max &&
        !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value) &&
        ![...value].some(
          (char) => char.length === 1 && /[\ud800-\udfff]/u.test(char),
        ),
      "文本为空、过长或含非法字符",
    );
const id = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
  .refine((value) => value === value.trim());
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
  .refine((value) => value === value.trim());
const category = z.enum(legalGraphCategories);
const sources = z.array(id).max(32);

export function isLegalGraphDate(value: string): boolean {
  if (value !== value.trim()) return false;
  if (!/^[0-9]{4}(-[0-9]{2}){0,2}$/.test(value)) return false;
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1]!;
}

const graphDate = z
  .object({
    value: z.string().refine(isLegalGraphDate, "日期无效或精度不受支持"),
    origin: z.enum(["material", "user", "legacy_inferred"]),
  })
  .strict();

const node = z
  .object({
    id,
    label: text(200),
    type: z.enum(legalGraphNodeTypes),
    role: z.enum(legalNodeRoles).nullable().optional(),
    category,
    date: graphDate.nullable().optional(),
    position: z
      .object({
        x: z.number().finite().min(-100_000).max(100_000),
        y: z.number().finite().min(-100_000).max(100_000),
      })
      .strict()
      .nullable()
      .optional(),
    source_ids: sources,
  })
  .strict()
  .refine(
    (value) => !value.date || value.type === "event",
    "仅事件节点可设置日期",
  );

const edge = z
  .object({
    id,
    source: id,
    target: id,
    label: text(120),
    category,
    confidence: z.enum(["EXTRACTED", "INFERRED", "AMBIGUOUS"]),
    angle: category.nullable().optional(),
    source_ids: sources,
    legal: z
      .object({
        family: z.enum(legalRelationFamilies),
        kind: z.enum(legalRelationKinds),
        statement: z.enum(legalStatements),
        asserted_by: id.nullable().optional(),
        issue_ids: z.array(id).max(16),
        framework_ids: z.array(id).max(8).nullable().optional(),
        questions: z.array(text(240)).max(8),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

const legacyOrigin = z.discriminatedUnion("kind", [
  z
    .object({
      id,
      kind: z.literal("legacy_unmapped"),
      reference: text(512),
      quote: text(2000).nullable().optional(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("unverified"),
      quote: text(2000),
      reference: text(512).nullable().optional(),
    })
    .strict(),
]);
const source = z
  .discriminatedUnion("kind", [
    z
      .object({
        id,
        kind: z.literal("citation"),
        citation_id: uuid,
        evidence_item_id: uuid,
        evidence_version_id: uuid,
        legacy_origin: legacyOrigin.nullable().optional(),
      })
      .strict(),
    z
      .object({
        id,
        kind: z.literal("legacy_unmapped"),
        reference: text(512),
        quote: text(2000).nullable().optional(),
      })
      .strict(),
    z
      .object({
        id,
        kind: z.literal("unverified"),
        quote: text(2000),
        reference: text(512).nullable().optional(),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (
      value.kind === "citation" &&
      value.legacy_origin &&
      value.legacy_origin.id !== value.id
    )
      context.addIssue({ code: "custom", message: "旧来源标识不能改变" });
  });

export const legalGraphSchema = z
  .object({
    format: z.literal("matrix-law.legal-graph"),
    schema_version: z.literal(1),
    title: text(240),
    presentation: z
      .object({
        summary: text(1000),
        default_view_id: id.nullable(),
        groups: z
          .array(
            z
              .object({
                id,
                label: text(120),
                color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
                node_ids: z.array(id).min(1).max(500),
              })
              .strict(),
          )
          .max(16),
        views: z
          .array(
            z
              .object({
                id,
                label: text(120),
                description: text(1000),
                layout: z.enum(["force", "analysis"]),
                node_ids: z.array(id).min(1).max(500),
                edge_ids: z.array(id).max(2000),
              })
              .strict(),
          )
          .max(16),
      })
      .strict()
      .nullable()
      .optional(),
    analysis: z
      .object({
        case_labels: z.array(text(240)).min(1).max(8),
        registered_cause: text(240).nullable(),
        matter_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
        framework_source_ids: z.array(id).max(32),
        element_node_ids: z.array(id).max(64),
        notes: z.array(text(1000)).max(16),
        frameworks: z
          .array(
            z
              .object({
                id,
                label: text(240),
                case_label: text(240),
                source_ids: z.array(id).max(32),
                element_node_ids: z.array(id).max(64),
                issue_node_ids: z.array(id).max(64),
              })
              .strict(),
          )
          .max(8)
          .nullable()
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
    nodes: z.array(node).max(500),
    edges: z.array(edge).max(2000),
    sources: z.array(source).max(500),
  })
  .strict()
  .superRefine((graph, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    for (const collection of [graph.nodes, graph.edges, graph.sources]) {
      if (new Set(collection.map((item) => item.id)).size !== collection.length)
        issue("图谱 ID 重复");
    }
    const nodeIds = new Set(graph.nodes.map((item) => item.id));
    const sourceIds = new Set(graph.sources.map((item) => item.id));
    if (graph.presentation) {
      const plan = graph.presentation;
      const unique = (ids: string[]) => new Set(ids).size === ids.length;
      if (
        !graph.analysis ||
        !unique(plan.groups.map((group) => group.id)) ||
        !unique(plan.views.map((view) => view.id)) ||
        (plan.default_view_id !== null &&
          !plan.views.some((view) => view.id === plan.default_view_id))
      )
        issue("图谱编排需要案件分析基线和有效的唯一视图标识");
      for (const group of plan.groups)
        if (
          !unique(group.node_ids) ||
          group.node_ids.some((id) => !nodeIds.has(id))
        )
          issue("图谱颜色分组关联无效");
      const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
      for (const view of plan.views) {
        const nodes = new Set(view.node_ids);
        if (
          !unique(view.node_ids) ||
          !unique(view.edge_ids) ||
          view.node_ids.some((id) => !nodeIds.has(id)) ||
          view.edge_ids.some((id) => {
            const edge = edges.get(id);
            return !edge || !nodes.has(edge.source) || !nodes.has(edge.target);
          })
        )
          issue("图谱主题视图存在悬空节点或关系");
      }
    }
    const frameworks = graph.analysis?.frameworks ?? [];
    const frameworkIds = new Set(frameworks.map((framework) => framework.id));
    if (frameworkIds.size !== frameworks.length) issue("法律分析框架标识重复");
    for (const frame of frameworks) {
      if (
        !graph.analysis!.case_labels.includes(frame.case_label) ||
        new Set(frame.source_ids).size !== frame.source_ids.length ||
        new Set(frame.element_node_ids).size !==
          frame.element_node_ids.length ||
        new Set(frame.issue_node_ids).size !== frame.issue_node_ids.length ||
        frame.source_ids.some((id) => !sourceIds.has(id)) ||
        frame.element_node_ids.some(
          (id) =>
            !graph.nodes.some(
              (node) => node.id === id && node.role === "element",
            ),
        ) ||
        frame.issue_node_ids.some(
          (id) =>
            !graph.nodes.some(
              (node) => node.id === id && node.role === "issue",
            ),
        )
      )
        issue("案由／罪名框架的角色或来源关联无效");
    }
    if (graph.analysis) {
      if (
        new Set(graph.analysis.case_labels).size !==
          graph.analysis.case_labels.length ||
        new Set(graph.analysis.framework_source_ids).size !==
          graph.analysis.framework_source_ids.length ||
        new Set(graph.analysis.element_node_ids).size !==
          graph.analysis.element_node_ids.length ||
        graph.analysis.framework_source_ids.some((id) => !sourceIds.has(id)) ||
        graph.analysis.element_node_ids.some(
          (id) =>
            !graph.nodes.some(
              (node) => node.id === id && node.role === "element",
            ),
        )
      )
        issue("案由／罪名分析基线的来源或要件关联无效");
    }
    for (const item of graph.edges) {
      if (
        item.legal?.framework_ids &&
        (new Set(item.legal.framework_ids).size !==
          item.legal.framework_ids.length ||
          item.legal.framework_ids.some((id) => !frameworkIds.has(id)))
      )
        issue("关系引用了无效的法律分析框架");
      if (!nodeIds.has(item.source) || !nodeIds.has(item.target))
        issue("关系端点不存在");
      if (
        item.legal &&
        ((item.legal.asserted_by && !nodeIds.has(item.legal.asserted_by)) ||
          item.legal.issue_ids.some((id) => !nodeIds.has(id)) ||
          new Set(item.legal.issue_ids).size !== item.legal.issue_ids.length)
      )
        issue("法律关系的主张人或争点关联无效");
    }
    for (const item of [...graph.nodes, ...graph.edges]) {
      if (
        new Set(item.source_ids).size !== item.source_ids.length ||
        item.source_ids.some((key) => !sourceIds.has(key))
      ) {
        issue("来源不存在或重复");
      }
    }
  });

export type LegalGraph = z.infer<typeof legalGraphSchema>;
export type LegalGraphNode = LegalGraph["nodes"][number];
export type LegalGraphEdge = LegalGraph["edges"][number];
export type LegalGraphSource = LegalGraph["sources"][number];

export function parseLegalGraph(content: string): LegalGraph {
  if (
    !content ||
    new TextEncoder().encode(content).byteLength > MAX_LEGAL_GRAPH_BYTES
  ) {
    throw new Error("图谱文件超过 2 MiB 限制");
  }
  try {
    return legalGraphSchema.parse(JSON.parse(content) as unknown);
  } catch {
    throw new Error("图谱结构无效；请检查版本、节点、关系和来源");
  }
}

// A citation ID is not a verified fact. Open sources only via authenticated project APIs.
export const legalGraphConfidenceLabels = {
  EXTRACTED: "材料明示（非事实认定）",
  INFERRED: "模型推断（待复核）",
  AMBIGUOUS: "存在疑义（待核查）",
} as const;
