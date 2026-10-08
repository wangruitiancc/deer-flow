import { describe, expect, it } from "@rstest/core";

import { parseLegalGraph } from "@/core/law/legal-graph";
import { convertLegacyGraph } from "@/core/law/legal-graph-import";

function fixture() {
  return {
    caseId: "old-case-not-an-authority",
    updatedAt: "2026-09-06T00:00:00Z",
    lastAngle: "人物关系",
    nodes: [
      {
        id: "甲方",
        label: "合成甲方",
        type: "party",
        category: "person",
        x: 12,
        y: 34,
      },
      { id: "签约:2026", label: "合成签约", type: "event", date: "2026-08" },
    ],
    edges: [
      {
        id: "person:0:甲方-签约",
        source: "甲方",
        target: "签约:2026",
        type: "签订",
        category: "person",
        confidence: "EXTRACTED",
        angleId: "custom:合成角度",
        sourceRef: "01-证据材料/合成合同.pdf",
        sourceQuote: "合成原文\n签订合同",
      },
    ],
  };
}
const convert = (value: unknown) =>
  convertLegacyGraph(JSON.stringify(value), "旧图谱转换（合成）");

describe("legacy graph conversion", () => {
  it("remaps arbitrary persisted IDs, preserves evidence uncertainty and leaves the input unchanged", () => {
    const raw = fixture();
    const original = JSON.stringify(raw);
    const { graph, report } = convert(raw);
    expect(JSON.stringify(raw)).toBe(original);
    expect(parseLegalGraph(JSON.stringify(graph))).toEqual(graph);
    expect(graph.nodes[0]).toMatchObject({
      id: "n1",
      position: { x: 12, y: 34 },
      source_ids: [],
    });
    expect(graph.nodes[1]).toMatchObject({
      id: "n2",
      category: "custom",
      date: { value: "2026-08", origin: "legacy_inferred" },
    });
    expect(graph.edges[0]).toMatchObject({
      id: "e1",
      source: "n1",
      target: "n2",
      confidence: "EXTRACTED",
      source_ids: ["s1"],
    });
    expect(graph.edges[0]).not.toHaveProperty("angle");
    expect(graph.sources).toEqual([
      {
        id: "s1",
        kind: "legacy_unmapped",
        reference: raw.edges[0]!.sourceRef,
        quote: raw.edges[0]!.sourceQuote,
      },
    ]);
    expect(report.nodeIds[0]).toEqual({ oldId: "甲方", newId: "n1" });
    expect(report.edgeIds[0]?.angleId).toBe("custom:合成角度");
    expect(report.legacy.caseId).toBe(raw.caseId);
    expect(graph).not.toHaveProperty("caseId");
    expect(report.unmappedSources).toBe(1);
  });
  it.each(["2024", "2024-02", "2024-02-29"])(
    "preserves date precision %s without upgrading trust",
    (date) => {
      const raw = fixture();
      raw.nodes[1]!.date = date;
      expect(convert(raw).graph.nodes[1]?.date).toEqual({
        value: date,
        origin: "legacy_inferred",
      });
    },
  );
  it.each(["2023-02-29", "2026-13", "2026年", " 2026", "0000"])(
    "reports invalid date %s rather than fabricating a date",
    (date) => {
      const raw = fixture();
      raw.nodes[1]!.date = date;
      const { graph, report } = convert(raw);
      expect(graph.nodes[1]).not.toHaveProperty("date");
      expect(report.notices.some((notice) => notice.original === date)).toBe(
        true,
      );
    },
  );
  it("does not infer dates from labels or move dates onto non-events", () => {
    const raw = fixture();
    raw.nodes[1]!.type = "other";
    const result = convert(raw);
    expect(result.graph.nodes[1]).not.toHaveProperty("date");
    expect(
      result.report.notices.some((notice) => notice.original === "2026-08"),
    ).toBe(true);
  });
  it("preserves detached quotes, deduplicates exact source pairs and does not interpret source paths", () => {
    const raw = fixture();
    raw.edges[0]!.sourceRef = "javascript:alert(1)";
    raw.edges.push({ ...raw.edges[0]!, id: "another" });
    const first = convert(raw);
    expect(first.graph.sources).toHaveLength(1);
    expect(first.graph.sources[0]).toMatchObject({
      kind: "legacy_unmapped",
      reference: "javascript:alert(1)",
    });
    raw.edges[1]!.sourceRef = "";
    const result = convert(raw);
    expect(result.graph.sources[1]).toMatchObject({
      kind: "unverified",
      quote: "合成原文\n签订合同",
    });
    expect(result.report.unverifiedQuotes).toBe(1);
    expect(
      result.graph.sources.some((source) => source.kind === "citation"),
    ).toBe(false);
  });
  it("reports missing sources and partial/out-of-range positions", () => {
    const raw = fixture();
    raw.nodes[0]!.x = 100001;
    raw.edges[0]!.sourceRef = " ";
    raw.edges[0]!.sourceQuote = "\n";
    const result = convert(raw);
    expect(result.graph.nodes[0]).not.toHaveProperty("position");
    expect(result.graph.edges[0]?.source_ids).toEqual([]);
    expect(result.report.edgesWithoutSources).toBe(1);
    expect(
      result.report.notices.some(
        (notice) =>
          typeof notice.original === "object" && notice.original.x === 100001,
      ),
    ).toBe(true);
  });
  it("rejects duplicate nodes, duplicate edges and dangling endpoints instead of merging or inventing", () => {
    const raw = fixture();
    raw.nodes.push({ ...raw.nodes[0]! });
    expect(() => convert(raw)).toThrow("重复 ID");
    const edges = fixture();
    edges.edges.push({ ...edges.edges[0]! });
    expect(() => convert(edges)).toThrow("重复 ID");
    const dangling = fixture();
    dangling.edges[0]!.target = "missing";
    expect(() => convert(dangling)).toThrow("不存在的节点");
  });
  it("rejects unknown fields and a fake citation instead of promoting it", () => {
    expect(() => convert({ ...fixture(), tenant_id: "forged" })).toThrow(
      "未知字段",
    );
    const raw = fixture();
    expect(() =>
      convert({ ...raw, edges: [{ ...raw.edges[0], citation_id: "forged" }] }),
    ).toThrow("未知字段");
    expect(() => convert({ nodes: raw.nodes, edges: raw.edges })).toThrow(
      "CaseGraph",
    );
  });
  it("does not silently truncate long labels, references, quotes or too many sources", () => {
    const raw = fixture();
    raw.nodes[0]!.label = "😀".repeat(201);
    expect(() => convert(raw)).toThrow("未截断");
    raw.nodes[0]!.label = "甲方";
    raw.edges[0]!.sourceRef = "x".repeat(513);
    expect(() => convert(raw)).toThrow("未截断");
    raw.edges[0]!.sourceRef = "source";
    raw.edges[0]!.sourceQuote = "x".repeat(2001);
    expect(() => convert(raw)).toThrow("未截断");
    raw.edges = Array.from({ length: 501 }, (_, index) => ({
      ...fixture().edges[0]!,
      id: `e${index}`,
      sourceRef: `s${index}`,
    }));
    expect(() => convert(raw)).toThrow("未截断");
  });
  it("enforces byte limits and handles hostile property names without prototype lookup", () => {
    expect(() =>
      convertLegacyGraph(" ".repeat(2 * 1024 * 1024 + 1), "图谱"),
    ).toThrow("2 MiB");
    const raw = fixture();
    raw.nodes[0]!.id = "__proto__";
    raw.edges[0]!.source = "__proto__";
    expect(convert(raw).graph.edges[0]?.source).toBe("n1");
    expect(() => convertLegacyGraph('{"caseId":', "图谱")).toThrow("CaseGraph");
  });
});
