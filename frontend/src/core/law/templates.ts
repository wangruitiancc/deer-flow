import { z } from "zod";

import { fetch as fetchWithAuth } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

export const legalTemplateCatalogSchema = z
  .object({
    schema_version: z.literal(1),
    available: z.boolean(),
    skill_name: z.literal("matrix-law-templates"),
    templates: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
          title: z.string().min(1).max(100),
          artifact_kind: z.enum(["document", "note"]),
          source_sha256: z.string().regex(/^[0-9a-f]{64}$/),
        }),
      )
      .max(30),
  })
  .refine(
    (value) =>
      new Set(value.templates.map((item) => item.id)).size ===
      value.templates.length,
  );

export type LegalTemplateCatalog = z.infer<typeof legalTemplateCatalogSchema>;
export type LegalTemplateEntry = LegalTemplateCatalog["templates"][number];

export async function loadLegalTemplateCatalog(
  signal?: AbortSignal,
): Promise<LegalTemplateCatalog> {
  const response = await fetchWithAuth(
    `${getBackendBaseURL()}/api/law/template-catalog`,
    { signal },
  );
  signal?.throwIfAborted();
  if (!response.ok) throw new Error("无法读取当前部署的法律模板目录。");
  const catalog = legalTemplateCatalogSchema.parse(await response.json());
  if (!catalog.available) throw new Error("当前部署未提供模板创建能力。");
  return catalog;
}

export function buildLegalTemplatePrompt(
  entry: LegalTemplateEntry,
  title: string,
): string {
  if (
    !title.trim() ||
    title.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(title)
  )
    throw new Error("请输入 1–200 字的单行草稿标题。");
  return `请为当前法律项目创建一份空白工作草稿，使用 law_create_template_draft。\n参数：${JSON.stringify({ template_id: entry.id, title: title.trim(), project_label: "当前法律项目" })}\n创建时间未知时保留待填写；不补造事实日期，不填写案情或法律分析。沿用原生右侧成果区，不自动保存项目版本。`;
}
