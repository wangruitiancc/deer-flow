import { createHash } from "node:crypto";

import { describe, expect, it, rs } from "@rstest/core";

import { CUSTOM_TEMPLATE_DRAFT_PROMPT } from "@/core/law/custom-template-draft";
import { previewTemplateImport } from "@/core/law/custom-template-import";

describe("legacy Markdown template import preview", () => {
  it("retains exact UTF-8/BOM/CRLF/paths and diagnoses variables without evaluating", async () => {
    const content =
      "\ufeff# {{title}}\r\n{{date:YYYY年MM月DD日}} {{case}} {{title}} {{unknown}}\r\n<script>alert(1)</script> /private/case\r\n";
    const result = await previewTemplateImport(
      new File([content], "旧模板.MARKDOWN"),
    );
    expect(result.content).toBe(content);
    expect(result.suggestedName).toBe("旧模板");
    expect(result.bom).toBe(true);
    expect(result.byteSize).toBe(Buffer.byteLength(content));
    expect(result.sha256).toBe(
      createHash("sha256").update(content).digest("hex"),
    );
    expect(result.diagnostics).toEqual([
      { placeholder: "{{title}}", kind: "variable", count: 2 },
      { placeholder: "{{date:YYYY年MM月DD日}}", kind: "date-format", count: 1 },
      { placeholder: "{{case}}", kind: "variable", count: 1 },
      { placeholder: "{{unknown}}", kind: "preserved", count: 1 },
    ]);
  });
  it("accepts empty templates and exact byte limit, never trims", async () => {
    expect(
      (await previewTemplateImport(new File([], "blank.md"))).content,
    ).toBe("");
    expect(
      (await previewTemplateImport(new File(["x".repeat(65536)], "full.md")))
        .byteSize,
    ).toBe(65536);
  });
  it.each([
    ".hidden.md",
    "x.txt",
    "x.md.exe",
    "../x.md",
    "dir\\x.md",
    "x\n.md",
  ])("rejects unsafe or non-template name %s", async (name) => {
    await expect(
      previewTemplateImport(new File(["safe"], name)),
    ).rejects.toThrow();
  });
  it("rejects oversize before reading or guessing encodings", async () => {
    const file = new File(["中".repeat(22000)], "large.md");
    const read = rs.spyOn(file, "arrayBuffer");
    await expect(previewTemplateImport(file)).rejects.toThrow("64 KiB");
    expect(read).not.toHaveBeenCalled();
    for (const bytes of [
      new Uint8Array([0xff, 0xfe, 1, 0]),
      new Uint8Array([0xc0, 0xaf]),
      new Uint8Array([0]),
    ])
      await expect(
        previewTemplateImport(new File([bytes], "invalid.md")),
      ).rejects.toThrow();
  });
  it("bounds displayed diagnostics without losing original text or silently hiding the count", async () => {
    const content = Array.from(
      { length: 25 },
      (_, i) => `{{unknown${i}}}`,
    ).join("\n");
    const result = await previewTemplateImport(new File([content], "many.md"));
    expect(result.diagnostics).toHaveLength(20);
    expect(result.omittedDiagnostics).toBe(5);
    expect(result.content).toBe(content);
  });
  it("handles cancellation before and after the asynchronous read", async () => {
    const active = new AbortController();
    active.abort();
    await expect(
      previewTemplateImport(new File([], "empty.md"), active.signal),
    ).rejects.toThrow();
    const late = new AbortController();
    const file = new File([], "empty.md");
    rs.spyOn(file, "arrayBuffer").mockImplementation(async () => {
      late.abort();
      return new ArrayBuffer(0);
    });
    await expect(previewTemplateImport(file, late.signal)).rejects.toThrow();
  });
  it("explicitly explains the nonrecursive renderer and generated unknown-time text", () => {
    expect(CUSTOM_TEMPLATE_DRAFT_PROMPT).toContain(
      "变量值内的花括号不会递归展开",
    );
    expect(CUSTOM_TEMPLATE_DRAFT_PROMPT).toContain("不表示输出没有花括号");
    expect(CUSTOM_TEMPLATE_DRAFT_PROMPT).toContain(
      "不能推断该文字原本就在模板中",
    );
    expect(CUSTOM_TEMPLATE_DRAFT_PROMPT).toContain("无法核实的原因不要猜测");
  });
});
