import { expect, it } from "@rstest/core";

import {
  buildLegalTemplatePrompt,
  legalTemplateCatalogSchema,
} from "@/core/law/templates";

const entry = {
  id: "meeting-notes",
  title: "会见笔录",
  artifact_kind: "note" as const,
  source_sha256: "a".repeat(64),
};
it("uses JSON display values and no invented timestamps or scope identifiers", () => {
  const prompt = buildLegalTemplatePrompt(entry, '会见"草稿');
  const line = prompt.split("\n")[1]!.slice(3);
  expect(JSON.parse(line)).toEqual({
    template_id: "meeting-notes",
    title: '会见"草稿',
    project_label: "当前法律项目",
  });
  expect(prompt).toContain("law_create_template_draft");
  expect(prompt).not.toContain("/matrix-law-templates");
});
it("rejects multiline, empty or oversized titles", () => {
  for (const value of [" ", "a\nb", "a".repeat(201)])
    expect(() => buildLegalTemplatePrompt(entry, value)).toThrow();
});
it("rejects duplicate IDs and unsupported catalog contracts", () => {
  const base = {
    schema_version: 1,
    available: true,
    skill_name: "matrix-law-templates",
    templates: [entry],
  };
  expect(legalTemplateCatalogSchema.parse(base).templates).toHaveLength(1);
  for (const input of [
    { ...base, schema_version: 2 },
    { ...base, templates: [entry, entry] },
    { ...base, templates: [{ ...entry, id: "../../secret" }] },
  ])
    expect(legalTemplateCatalogSchema.safeParse(input).success).toBe(false);
});
