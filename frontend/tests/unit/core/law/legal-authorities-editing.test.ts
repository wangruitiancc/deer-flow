import { describe, expect, it } from "@rstest/core";

import {
  parseLegalAuthorities,
  type LegalAuthorities,
} from "@/core/law/legal-authorities";
import {
  authorityValues,
  editLegalAuthorities,
  serializeLegalAuthorities,
  type AuthorityEdit,
  type AuthorityValues,
} from "@/core/law/legal-authorities-editing";

import fixture from "../../../fixtures/legal-authorities.json";

const content = JSON.stringify(fixture);
const baseline = fixture as LegalAuthorities;
const value: AuthorityValues = {
  law_name: "手工示例法",
  text: "只作合成测试。\r\n",
  text_kind: "summary",
  inclusion_reason: "明确收录理由",
};
describe("legal authority local draft transactions", () => {
  it("adds an unreviewed manual source with an actual SHA, preserving existing data and original whitespace", async () => {
    const result = await editLegalAuthorities(baseline, {
      kind: "manual",
      id: "new",
      sourceId: "new-source",
      reference: "手工说明",
      value,
    });
    expect(result.entries.at(-1)).toMatchObject({
      ...value,
      origin: "manual",
      state: "active",
      review_status: "unreviewed",
      current_validity: "unverified",
      source_ids: ["new-source"],
    });
    expect(result.sources.at(-1)).toMatchObject({
      kind: "manual",
      text: value.text,
      reference: "手工说明",
    });
    expect(result.entries.slice(0, 2)).toEqual(baseline.entries);
    expect(result.sources.slice(0, 4)).toEqual(baseline.sources);
    expect(
      await parseLegalAuthorities(serializeLegalAuthorities(result)),
    ).toEqual(result);
    expect(JSON.stringify(baseline)).toBe(content);
  });
  it.each(["web-1", "manual-1", "legacy-1", "citation-1"])(
    "collects an explicit existing source without changing its bytes or provenance: %s",
    async (sourceId) => {
      const result = await editLegalAuthorities(baseline, {
        kind: "collect",
        id: "collected",
        sourceId,
        value,
      });
      expect(result.sources).toEqual(baseline.sources);
      expect(result.entries.at(-1)).toMatchObject({
        origin: "favorite",
        source_ids: [sourceId],
      });
      expect(result.entries[0]!.origin).toBe("research");
    },
  );
  it("retains same-name different-version authorities instead of silently deduplicating", async () => {
    const result = await editLegalAuthorities(baseline, {
      kind: "collect",
      id: "new-version",
      sourceId: "web-1",
      value: {
        ...authorityValues(baseline.entries[0]!),
        law_version: "另一待核验版本",
      },
    });
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]!.law_version).toBe("示例版本，未核验");
  });
  it("edits only allowed entry fields; keeps original source, identity, state, origin and legacy record", async () => {
    const original = baseline.entries[1]!;
    const result = await editLegalAuthorities(baseline, {
      kind: "entry",
      id: original.id,
      value: {
        ...authorityValues(original),
        text: "编辑后的说明",
        uncertainty: "待核实",
        relevant_date: { value: "2024", basis: "只有年份" },
      },
    });
    expect(result.entries[1]).toMatchObject({
      id: original.id,
      origin: original.origin,
      legacy_origin: original.legacy_origin,
      state: "removed",
      removal_reason: original.removal_reason,
      source_ids: original.source_ids,
    });
    expect(result.sources).toEqual(baseline.sources);
    expect(JSON.stringify(baseline)).toBe(content);
  });
  it("removes without deleting and restores without altering the removed snapshot", async () => {
    const removed = await editLegalAuthorities(baseline, {
      kind: "remove",
      id: "entry-1",
      reason: "不适用于此时点",
    });
    expect(removed.entries).toHaveLength(2);
    expect(removed.sources).toEqual(baseline.sources);
    const restored = await editLegalAuthorities(removed, {
      kind: "restore",
      id: "entry-1",
    });
    expect(restored.entries[0]).toMatchObject({
      state: "active",
      removal_reason: null,
    });
    expect(removed.entries[0]).toMatchObject({
      state: "removed",
      removal_reason: "不适用于此时点",
    });
    expect(JSON.stringify(baseline)).toBe(content);
  });
  it("edits the research question and title without changing evidence", async () => {
    const next = await editLegalAuthorities(baseline, {
      kind: "document",
      title: "新名称",
      question: "新问题",
    });
    expect(next.entries).toEqual(baseline.entries);
    expect(next.sources).toEqual(baseline.sources);
  });
  it.each([
    { kind: "manual", id: "entry-1", sourceId: "new", reference: null, value },
    { kind: "manual", id: "new", sourceId: "manual-1", reference: null, value },
    { kind: "collect", id: "new", sourceId: "missing", value },
    { kind: "entry", id: "missing", value },
    { kind: "remove", id: "entry-2", reason: "再次移除" },
    { kind: "restore", id: "entry-1" },
    { kind: "remove", id: "entry-1", reason: "" },
    {
      kind: "entry",
      id: "entry-1",
      value: { ...value, review_status: "approved" },
    },
    { kind: "entry", id: "entry-1", value: { ...value, source_ids: [] } },
    { kind: "entry", id: "entry-1", value: { ...value, id: "new" } },
    {
      kind: "entry",
      id: "entry-1",
      value: {
        ...value,
        effective_date: { value: "2023-02-29", basis: "不合法日期" },
      },
    },
    {
      kind: "manual",
      id: "new",
      sourceId: "new",
      reference: null,
      value: { ...value, text: "x".repeat(100001) },
    },
  ] as AuthorityEdit[])(
    "rejects invalid mutation %# and leaves the input unchanged",
    async (edit) => {
      await expect(editLegalAuthorities(baseline, edit)).rejects.toThrow();
      expect(JSON.stringify(baseline)).toBe(content);
    },
  );
});
