import { describe, expect, it } from "@rstest/core";

import { convertLegacyLawRefs } from "../../src/core/law/legal-authorities-import";
import { createAuthoritiesLiveFixture } from "../e2e-real-backend/authorities-live-fixture";

describe("authorities live fixture", () => {
  it("preserves the original two-record regression", () => {
    const fixture = createAuthoritiesLiveFixture("small");
    const records = JSON.parse(fixture.legacy.slice(1));
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual(fixture.original);
    expect(records[1].text).toBe("合成旧摘录，仅测试迁移，不是现行法律。");
    expect(fixture.legacy.startsWith("\ufeff[\r\n")).toBe(true);
    expect(fixture.legacy.endsWith("\r\n]")).toBe(true);
  });

  it("exercises a complete 500-record collection above the old write cap", async () => {
    const fixture = createAuthoritiesLiveFixture("large");
    const bytes = new TextEncoder().encode(fixture.legacy);
    const converted = await convertLegacyLawRefs(bytes, {
      title: "合成",
      question: "验收",
    });
    expect(converted.authorities.entries).toHaveLength(500);
    expect(converted.report.missing_body_count).toBe(1);
    expect(converted.report.duplicate_name_article_count).toBe(499);
    expect(converted.report.original_file_text).toBe(fixture.legacy);
    expect(
      converted.authorities.entries[499]?.legacy_origin?.original.text,
    ).toContain("合成尾部499");
    for (const content of [
      converted.content,
      JSON.stringify(converted.report, null, 2) + "\n",
    ])
      expect(new TextEncoder().encode(content).byteLength).toBeGreaterThan(
        80 * 1024,
      );
    expect(bytes.byteLength).toBeLessThan(2 * 1024 * 1024);
  });
});
