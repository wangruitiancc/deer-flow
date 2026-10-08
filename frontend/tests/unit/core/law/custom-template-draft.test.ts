import { describe, expect, it } from "@rstest/core";

import {
  CUSTOM_TEMPLATE_DRAFT_PROMPT,
  customTemplateDraftSelectionFile,
  customTemplateVariablesSchema,
} from "@/core/law/custom-template-draft";

const id = "00000000-0000-4000-8000-000000000091";
const values = {
  title: " 私密标题 {{case}} ",
  project_label: "私密咨询",
  creation_date: "2024-02-29",
  creation_time: "03:04",
};

describe("custom template draft selection", () => {
  it("preserves a valid leading BOM in explicit display text", () => {
    expect(
      customTemplateVariablesSchema.parse({ ...values, title: "\ufeff标题" })
        .title,
    ).toBe("\ufeff标题");
  });
  it("keeps explicit values and selected history in the native File, not the static prompt", async () => {
    const file = customTemplateDraftSelectionFile(id, 1, values);
    expect(file.name).toBe("模板选择.json");
    expect(JSON.parse(await file.text())).toEqual({
      template_id: id,
      version_number: 1,
      variables: values,
    });
    for (const secret of [
      id,
      values.title,
      values.project_label,
      values.creation_date,
    ])
      expect(CUSTOM_TEMPLATE_DRAFT_PROMPT).not.toContain(secret);
    expect(CUSTOM_TEMPLATE_DRAFT_PROMPT).toContain(
      "law_create_custom_template_draft",
    );
    expect(CUSTOM_TEMPLATE_DRAFT_PROMPT).toContain("不得改用原样复制工具");
  });
  it("maps only missing time data to unknown without consulting the clock or inventing seconds", () => {
    expect(
      customTemplateVariablesSchema.parse({
        ...values,
        creation_date: "",
        creation_time: "",
      }),
    ).toEqual({
      ...values,
      creation_date: "待填写",
      creation_time: "待填写",
    });
    expect(customTemplateVariablesSchema.parse(values).creation_time).toBe(
      "03:04",
    );
    expect(
      customTemplateVariablesSchema.parse({
        ...values,
        creation_time: "03:04:05",
      }).creation_time,
    ).toBe("03:04:05");
    expect(
      customTemplateVariablesSchema.parse({
        ...values,
        creation_date: "0004-02-29",
      }).creation_date,
    ).toBe("0004-02-29");
    expect(
      customTemplateVariablesSchema.parse({
        ...values,
        title: "😀".repeat(200),
      }).title,
    ).toHaveLength(400);
  });
  it.each([
    { creation_date: "2023-02-29" },
    { creation_date: "1900-02-29" },
    { creation_date: "0000-01-01" },
    { creation_date: "2024-2-29" },
    { creation_date: "2024-04-31" },
    { creation_date: "2024-13-01" },
    { creation_time: "24:00" },
    { creation_time: "03:04:60" },
    { creation_time: "03:04:05Z" },
    { creation_time: null },
    { title: " " },
    { title: "x\nheading" },
    { title: "\ud800" },
    { title: "😀".repeat(201) },
    { project_label: "" },
    { tenant_id: id },
    { timezone: "server" },
  ])(
    "rejects invalid or identity-bearing values before staging: %j",
    (override) => {
      expect(() =>
        customTemplateDraftSelectionFile(id, 1, { ...values, ...override }),
      ).toThrow();
    },
  );
});
