import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "@rstest/core";

import {
  legalGraphSchema,
  parseLegalGraph,
  MAX_LEGAL_GRAPH_BYTES,
  type LegalGraph,
} from "@/core/law/legal-graph";

const contract = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../backend/extensions/sources/matrix-law-extension/matrix_law_extension/contracts/legal_graph_v1.examples.json",
    ),
    "utf-8",
  ),
) as {
  base: LegalGraph;
  invalid: { name: string; path: (string | number)[]; value: unknown }[];
  valid_dates: string[];
};
const graph = () => structuredClone(contract.base);

describe("legal graph v1 shared contract", () => {
  it("preserves date precision and does not upgrade unverified sources", () => {
    const parsed = parseLegalGraph(JSON.stringify(graph()));
    expect(parsed.nodes[1]?.date?.value).toBe("2024-02");
    expect(parsed.sources[0]?.kind).toBe("unverified");
    expect(parsed.edges[0]?.confidence).toBe("EXTRACTED");
  });
  for (const test of contract.invalid) {
    it(`rejects ${test.name}`, () => {
      const payload = graph();
      let cursor = payload as unknown as Record<string | number, unknown>;
      for (const key of test.path.slice(0, -1))
        cursor = cursor[key] as Record<string | number, unknown>;
      cursor[test.path.at(-1)!] = test.value;
      expect(() => parseLegalGraph(JSON.stringify(payload))).toThrow();
    });
  }
  for (const value of contract.valid_dates) {
    it(`preserves ${value}`, () => {
      const payload = graph();
      payload.nodes[1]!.date!.value = value;
      expect(legalGraphSchema.parse(payload).nodes[1]?.date?.value).toBe(value);
    });
  }
  for (const content of [
    "{",
    "[",
    "null",
    " ".repeat(MAX_LEGAL_GRAPH_BYTES + 1),
  ]) {
    it(`rejects malformed/large input (${content.length} chars)`, () => {
      expect(() => parseLegalGraph(content)).toThrow();
    });
  }
  for (const [field, limit] of [
    ["nodes", 500],
    ["edges", 2000],
    ["sources", 500],
  ] as const) {
    it(`bounds ${field}`, () => {
      const payload = graph();
      const oversized = {
        ...payload,
        [field]: Array.from({ length: limit + 1 }, (_, index) => ({
          ...payload[field][0],
          id: `id-${index}`,
        })),
      };
      expect(legalGraphSchema.safeParse(oversized).success).toBe(false);
    });
  }
  for (const value of [Infinity, -Infinity, NaN]) {
    it(`rejects non-finite coordinate ${value}`, () => {
      const payload = graph();
      payload.nodes[1]!.position!.x = value;
      expect(legalGraphSchema.safeParse(payload).success).toBe(false);
    });
  }
  it("uses code-point limits and keeps legacy references as unverified plain text", () => {
    const payload = graph();
    payload.nodes[0]!.label = "😀".repeat(200);
    payload.sources[0] = {
      id: "source-1",
      kind: "legacy_unmapped",
      reference: "../../old/file.md",
      quote: "<script>not executable</script>\nUnverified source",
    };
    expect(legalGraphSchema.safeParse(payload).success).toBe(true);
    payload.nodes[0]!.label += "😀";
    expect(legalGraphSchema.safeParse(payload).success).toBe(false);
  });
});
