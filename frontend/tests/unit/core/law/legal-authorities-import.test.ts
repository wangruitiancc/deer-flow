import { createHash } from "node:crypto";

import { describe, expect, it } from "@rstest/core";

import { parseLegalAuthorities } from "@/core/law/legal-authorities";
import { editLegalAuthorities } from "@/core/law/legal-authorities-editing";
import {
  convertLegacyLawRefs,
  LEGACY_AUTHORITIES_HANDOFF_PROMPT,
} from "@/core/law/legal-authorities-import";

const metadata = {
  title: "旧法条收藏转换",
  question: "合成咨询，待核实法律依据",
};
const original = {
  code: "合成示例法",
  article: "第六十七条",
  origin: "mining",
  addedAt: "旧时间不是法律日期",
};
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

describe("lossless legacy law-reference conversion", () => {
  it("hands complete upload paths to the deterministic tool without model transcription or automatic saving", () => {
    const prompt = LEGACY_AUTHORITIES_HANDOFF_PROMPT;
    expect(prompt).toContain("law_import_authorities");
    expect(prompt).toContain("files.authorities_path");
    expect(prompt).toContain("files.report_path");
    expect(prompt).toContain("/mnt/user-data/uploads/");
    expect(prompt).toContain("不要用 read_file/write_file");
    expect(prompt).toContain("不要自动重试");
    expect(prompt).toContain("不自动保存到项目");
    expect(prompt).not.toContain("law_validate_authorities");
    expect(prompt).not.toContain(original.code);
    expect(prompt).not.toContain(original.addedAt);
  });
  it("keeps every record, duplicate, raw byte and optional empty field without inventing a body", async () => {
    const records = [
      original,
      { ...original, text: null, source: null, articleId: null },
      { ...original, text: "", source: "", articleId: "" },
      { ...original, text: " \t\r\n", source: "/private/old/path" },
      {
        ...original,
        text: "旧摘录\r\n<script>只是原文</script>",
        articleId: "minshisusong-64",
        origin: "favorite",
      },
    ] as const;
    const raw =
      "\ufeff" + JSON.stringify(records, null, 2).replaceAll("\n", "\r\n");
    const bytes = new TextEncoder().encode(raw);
    const result = await convertLegacyLawRefs(bytes, metadata);
    expect(result.report.original_file_text).toBe(raw);
    expect(
      digest(new TextEncoder().encode(result.report.original_file_text)),
    ).toBe(digest(bytes));
    expect(result.report.source_file_sha256).toBe(digest(bytes));
    expect(result.report.output_sha256).toBe(digest(result.content));
    expect(result.report.missing_body_count).toBe(4);
    expect(result.report.duplicate_name_article_count).toBe(4);
    expect(result.report.mapping.map((item) => item.body_status)).toEqual([
      "absent",
      "null",
      "empty",
      "blank",
      "present",
    ]);
    expect(
      result.report.mapping.map((item) => item.same_name_article_as),
    ).toEqual([null, 0, 0, 0, 0]);
    expect(
      new Set(result.authorities.entries.map((item) => item.id)).size,
    ).toBe(5);
    expect(
      result.authorities.entries.map((item) => item.legacy_origin!.original),
    ).toEqual(records);
    for (const [index, entry] of result.authorities.entries.entries()) {
      expect(entry).toMatchObject({
        origin: "legacy_import",
        current_validity: "unverified",
        review_status: "unreviewed",
      });
      expect(entry.effective_date).toBeUndefined();
      expect(entry.legacy_origin!.source_index).toBe(index);
      expect(entry.text).toBe(index === 4 ? records[4].text : null);
    }
    expect(await parseLegalAuthorities(result.content)).toEqual(
      result.authorities,
    );
    expect(await convertLegacyLawRefs(bytes, metadata)).toEqual(result);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toBe(
      raw,
    );
  });
  it("allows an empty collection without synthesizing entries", async () => {
    const result = await convertLegacyLawRefs(encode([]), metadata);
    expect(result.authorities.entries).toEqual([]);
    expect(result.report.entries_total).toBe(0);
  });
  it("retains missing bodies through remove/restore and explicit summary editing", async () => {
    const result = await convertLegacyLawRefs(encode([original]), metadata);
    const id = result.authorities.entries[0]!.id;
    const removed = await editLegalAuthorities(result.authorities, {
      kind: "remove",
      id,
      reason: "待查正文",
    });
    const restored = await editLegalAuthorities(removed, {
      kind: "restore",
      id,
    });
    const next = await editLegalAuthorities(restored, {
      kind: "entry",
      id,
      value: {
        law_name: original.code,
        text: "人工补充摘要",
        text_kind: "summary",
      },
    });
    expect(next.entries[0]!.text).toBe("人工补充摘要");
    expect(next.sources).toEqual(result.authorities.sources);
    expect(next.entries[0]!.legacy_origin!.original).toEqual(original);
    expect(removed.entries[0]!.removal_reason).toBe("待查正文");
  });
  it.each([
    undefined,
    null,
    false,
    {},
    [null],
    [{ ...original, extra: true }],
    [{ ...original, code: "" }],
    [{ ...original, addedAt: "" }],
    [{ ...original, origin: "approved" }],
    [{ ...original, text: 1 }],
    [{ ...original, text: "x\u0000" }],
    [{ ...original, source: "\ud800" }],
    [{ ...original, text: "x".repeat(100001) }],
    Array.from({ length: 501 }, () => original),
  ])(
    "rejects malformed records as a whole without dropping them (%#)",
    async (records) => {
      await expect(
        convertLegacyLawRefs(encode(records), metadata),
      ).rejects.toThrow();
    },
  );
  it.each([
    new Uint8Array(),
    new Uint8Array([255]),
    new Uint8Array(2 * 1024 * 1024 + 1),
    new TextEncoder().encode('[{"code":"first","code":"last"}]'),
    new TextEncoder().encode('[{"code":"first","co\\u0064e":"last"}]'),
  ])("rejects invalid bytes or duplicate JSON keys (%#)", async (bytes) => {
    await expect(convertLegacyLawRefs(bytes, metadata)).rejects.toThrow();
  });
  it("checks output size after preserving duplicated provenance, never truncates", async () => {
    const records = Array.from({ length: 12 }, () => ({
      ...original,
      text: "x".repeat(90000),
    }));
    expect(encode(records).byteLength).toBeLessThan(2 * 1024 * 1024);
    await expect(
      convertLegacyLawRefs(encode(records), metadata),
    ).rejects.toThrow(/2 MiB/);
  });
  it.each([
    "invented-text",
    "wrong-kind",
    "nonlegacy",
    "source-index",
    "empty-not-null",
  ])("refuses to misrepresent a missing body (%s)", async (change) => {
    const { authorities } = await convertLegacyLawRefs(
      encode([original]),
      metadata,
    );
    const entry = authorities.entries[0]!;
    if (change === "invented-text") entry.text = "待补充";
    if (change === "wrong-kind") entry.text_kind = "quotation";
    if (change === "nonlegacy") entry.origin = "manual";
    if (change === "empty-not-null") entry.text = "";
    if (change === "source-index") {
      const source = authorities.sources[0]!;
      if (source.kind === "legacy_reference")
        source.legacy_origin.source_index = 99;
    }
    await expect(
      parseLegalAuthorities(JSON.stringify(authorities)),
    ).rejects.toThrow();
  });
});
