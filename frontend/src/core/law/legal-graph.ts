import { z } from "zod";

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
    for (const item of graph.edges) {
      if (!nodeIds.has(item.source) || !nodeIds.has(item.target))
        issue("关系端点不存在");
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
