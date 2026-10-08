import { describe, expect, it } from "@rstest/core";

import {
  isLegalAuthoritiesFile,
  LEGAL_AUTHORITIES_ERROR,
  MAX_LEGAL_AUTHORITIES_BYTES,
  parseLegalAuthorities,
} from "@/core/law/legal-authorities";

import fixture from "../../../fixtures/legal-authorities.json";

const content = JSON.stringify(fixture);
function changed(path: string, value: unknown) {
  const result = JSON.parse(content) as Record<string, unknown>;
  const parts = path.split(".");
  let target = result;
  for (const key of parts.slice(0, -1))
    target = target[key] as Record<string, unknown>;
  target[parts.at(-1)!] = value;
  return JSON.stringify(result);
}

describe("legal authorities draft contract", () => {
  it("preserves all fields, source kinds, removal provenance and date precision", async () => {
    expect(await parseLegalAuthorities(content)).toEqual(fixture);
    expect(
      isLegalAuthoritiesFile("/mnt/user-data/outputs/A.LAW-AUTHORITIES.JSON"),
    ).toBe(true);
    expect(isLegalAuthoritiesFile("a.json")).toBe(false);
  });
  it("allows an explicit empty document, not invented laws", async () => {
    expect(
      (
        await parseLegalAuthorities(
          JSON.stringify({ ...fixture, entries: [], sources: [] }),
        )
      ).entries,
    ).toEqual([]);
  });
  it.each([
    ["schema_version", true],
    ["schema_version", "1"],
    ["tenant_id", "foreign"],
    ["review_status", "approved"],
    ["title", "\u0085"],
    ["title", "\ud800"],
    ["title", "x\u0000"],
    ["title", "🙂".repeat(241)],
    ["entries.0.current_validity", "valid"],
    ["entries.0.review_status", "approved"],
    ["entries.0.extra", "secret"],
    ["entries.0.text", ""],
    ["entries.0.source_ids", []],
    ["entries.0.source_ids", ["missing"]],
    ["entries.0.source_ids", ["web-1", "web-1"]],
    ["entries.1.id", "entry-1"],
    ["entries.1.removal_reason", null],
    ["entries.0.removal_reason", "cannot remove active"],
    ["entries.1.legacy_origin", null],
    ["entries.1.legacy_origin.source_index", -1],
    ["entries.0.published_date.value", "0000"],
    ["entries.0.published_date.value", "2024\n"],
    ["sources.0.retrieved_at", "2026-09-06T10:20:30Z\n"],
    ["entries.0.effective_date.value", "2024-13"],
    ["entries.0.relevant_date.value", "2023-02-29"],
    ["entries.0.published_date.basis", ""],
    ["sources.0.url", "javascript:alert(1)"],
    ["sources.0.url", "https://user:password@example.com"],
    ["sources.0.url", "https://example.com:99999"],
    ["sources.0.url", "https://example.com\\evil"],
    ["sources.0.url", "https://example.com/ a"],
    ["sources.0.text_sha256", "a".repeat(64)],
    ["sources.0.text", "changed"],
    ["sources.0.completeness", "verified"],
    ["sources.0.retrieved_at", "2026-02-30T10:20:30Z"],
    ["sources.0.retrieved_at", "2026-09-06T24:20:30Z"],
    ["sources.0.retrieved_at", "2026-09-06T10:20:30"],
    ["sources.0.retrieved_at", "2026-09-06T10:20:30+24:00"],
    ["sources.1.evidence_item_id", "wrong"],
    ["sources.2.legacy_id", "not-manual"],
    ["sources.2.catalog_sha256", "b".repeat(64)],
    ["sources.3.id", "web-1"],
    [
      "entries",
      Array.from({ length: 501 }, (_, index) => ({
        ...fixture.entries[0],
        id: `id-${index}`,
      })),
    ],
    [
      "sources",
      Array.from({ length: 1001 }, (_, index) => ({
        ...fixture.sources[1],
        id: `id-${index}`,
      })),
    ],
  ])(
    "rejects invalid %s = %s without echoing private payloads",
    async (path, value) => {
      await expect(parseLegalAuthorities(changed(path, value))).rejects.toThrow(
        LEGAL_AUTHORITIES_ERROR,
      );
    },
  );
  it.each([
    "",
    "{",
    "\ufeff" + content,
    content.replace('"schema_version":1', '"schema_version":1.0'),
    content.replace('"schema_version":1', '"schema_version":1e0'),
    content.replace('"source_index":0', '"source_index":0.0'),
    content.replace('"title":', '"ti\\u0074le":"duplicated", "title":'),
    content.replace('"law_name":', '"law_name":"duplicated", "law_name":'),
    content.replace('"source_index":0', '"source_index":NaN'),
    " ".repeat(MAX_LEGAL_AUTHORITIES_BYTES) + content,
  ])("rejects lossy or invalid JSON %#", async (invalid) => {
    await expect(parseLegalAuthorities(invalid)).rejects.toThrow(
      LEGAL_AUTHORITIES_ERROR,
    );
  });
  it("does not scan JSON-looking prose as duplicate fields and accepts 240 Unicode code points", async () => {
    const result = await parseLegalAuthorities(
      changed("title", "🙂".repeat(240)),
    );
    expect([...result.title]).toHaveLength(240);
    expect(
      (
        await parseLegalAuthorities(
          changed("question", 'Quoted {"a":1,"a":2} and escaped \\"text"'),
        )
      ).question,
    ).toContain('"a":2');
  });
});
