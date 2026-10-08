import { describe, expect, it } from "@rstest/core";

import {
  parseLegalGraph,
  type LegalGraph,
  type LegalGraphNode,
} from "@/core/law/legal-graph";
import {
  editedEventDate,
  editLegalGraph,
  serializeLegalGraph,
} from "@/core/law/legal-graph-editing";

const person: LegalGraphNode = {
  id: "p",
  label: "甲方",
  type: "party",
  category: "person",
  source_ids: ["s"],
};
const event: LegalGraphNode = {
  id: "e",
  label: "签约",
  type: "event",
  category: "timeline",
  source_ids: ["s"],
  date: { value: "2024-02", origin: "material" },
};
const graph: LegalGraph = {
  format: "matrix-law.legal-graph",
  schema_version: 1,
  title: "合成图谱",
  nodes: [person, event],
  edges: [
    {
      id: "r",
      source: "p",
      target: "e",
      label: "参与",
      category: "timeline",
      confidence: "EXTRACTED",
      source_ids: ["s"],
    },
  ],
  sources: [{ id: "s", kind: "unverified", quote: "合成材料" }],
};
describe("legal graph draft transactions", () => {
  it.each([
    { id: "other" },
    { kind: "citation" },
    { approved: true },
    { quote: "x".repeat(2001) },
  ])("rejects forged or invalid retained provenance %j", (change) => {
    const mapped = {
      id: "s",
      kind: "citation",
      citation_id: "00000000-0000-4000-8000-000000000001",
      evidence_item_id: "00000000-0000-4000-8000-000000000002",
      evidence_version_id: "00000000-0000-4000-8000-000000000003",
      legacy_origin: { ...graph.sources[0], ...change },
    };
    expect(() =>
      parseLegalGraph(JSON.stringify({ ...graph, sources: [mapped] })),
    ).toThrow();
  });
  it("maps shared old sources without changing assertions and preserves original provenance on remap", () => {
    const ids = {
      citation_id: "00000000-0000-4000-8000-000000000001",
      evidence_item_id: "00000000-0000-4000-8000-000000000002",
      evidence_version_id: "00000000-0000-4000-8000-000000000003",
    };
    const mapped = editLegalGraph(graph, {
      kind: "map-source",
      id: "s",
      citation: ids,
    });
    expect(mapped.nodes).toEqual(graph.nodes);
    expect(mapped.edges).toEqual(graph.edges);
    expect(mapped.sources[0]).toEqual({
      id: "s",
      kind: "citation",
      ...ids,
      legacy_origin: graph.sources[0],
    });
    expect(graph.sources[0]?.kind).toBe("unverified");
    const remapped = editLegalGraph(mapped, {
      kind: "map-source",
      id: "s",
      citation: { ...ids, citation_id: "00000000-0000-4000-8000-000000000004" },
    });
    expect(
      remapped.sources[0]?.kind === "citation" &&
        remapped.sources[0].legacy_origin,
    ).toEqual(graph.sources[0]);
    expect(() =>
      editLegalGraph(graph, {
        kind: "map-source",
        id: "missing",
        citation: ids,
      }),
    ).toThrow();
    expect(() =>
      editLegalGraph(graph, {
        kind: "map-source",
        id: "s",
        citation: { ...ids, citation_id: "not-a-uuid" },
      }),
    ).toThrow();
  });
  it("adds, edits and deletes nodes without altering the source or losing provenance", () => {
    const original = serializeLegalGraph(graph);
    const added = editLegalGraph(graph, {
      kind: "node",
      create: true,
      value: { ...person, id: "p2", label: "乙方" },
    });
    expect(added.nodes.length).toBe(3);
    const renamed = editLegalGraph(added, {
      kind: "node",
      value: { ...person, label: "甲方公司" },
    });
    expect(renamed.nodes[0]?.source_ids).toEqual(["s"]);
    const removed = editLegalGraph(renamed, { kind: "delete-node", id: "p" });
    expect(removed.nodes.map((node) => node.id)).toEqual(["e", "p2"]);
    expect(removed.edges).toEqual([]);
    expect(removed.sources).toEqual(graph.sources);
    expect(serializeLegalGraph(graph)).toBe(original);
  });
  it("adds/edits/deletes relationships and preserves existing edge identity", () => {
    const added = editLegalGraph(graph, {
      kind: "edge",
      create: true,
      value: { ...graph.edges[0]!, id: "r2", confidence: "AMBIGUOUS" },
    });
    const updated = editLegalGraph(added, {
      kind: "edge",
      value: { ...added.edges[1]!, confidence: "INFERRED", label: "待确认" },
    });
    expect(updated.edges[1]?.confidence).toBe("INFERRED");
    expect(
      editLegalGraph(updated, { kind: "delete-edge", id: "r2" }).edges,
    ).toEqual(graph.edges);
  });
  it("preserves unchanged date origins and marks manually changed dates as user supplied", () => {
    for (const origin of ["material", "legacy_inferred", "user"] as const) {
      const node = { ...event, date: { value: "2024-02", origin } };
      expect(editedEventDate(node, "2024-02")).toEqual(node.date);
      expect(editedEventDate(node, "2024")).toEqual({
        value: "2024",
        origin: "user",
      });
      expect(editedEventDate(node, "")).toBeNull();
    }
  });
  it("pins/unpins only non-event nodes and validates finite bounded coordinates", () => {
    const pinned = editLegalGraph(graph, {
      kind: "position",
      id: "p",
      position: { x: 12.5, y: -28 },
    });
    expect(pinned.nodes[0]?.position).toEqual({ x: 12.5, y: -28 });
    expect(
      editLegalGraph(pinned, { kind: "position", id: "p", position: null })
        .nodes[0]?.position,
    ).toBeNull();
    for (const x of [NaN, Infinity, 100001])
      expect(() =>
        editLegalGraph(graph, {
          kind: "position",
          id: "p",
          position: { x, y: 0 },
        }),
      ).toThrow();
    expect(() =>
      editLegalGraph(graph, {
        kind: "position",
        id: "e",
        position: { x: 0, y: 0 },
      }),
    ).toThrow();
  });
  it("rejects stale identities, duplicate IDs, dangling endpoints and invented source IDs", () => {
    expect(() =>
      editLegalGraph(graph, { kind: "node", create: true, value: person }),
    ).toThrow();
    expect(() =>
      editLegalGraph(graph, {
        kind: "node",
        value: { ...person, id: "missing" },
      }),
    ).toThrow();
    expect(() =>
      editLegalGraph(graph, {
        kind: "node",
        value: { ...person, source_ids: ["invented"] },
      }),
    ).toThrow();
    expect(() =>
      editLegalGraph(graph, {
        kind: "edge",
        value: { ...graph.edges[0]!, target: "missing" },
      }),
    ).toThrow();
    expect(() =>
      editLegalGraph(graph, {
        kind: "edge",
        create: true,
        value: graph.edges[0]!,
      }),
    ).toThrow();
  });
  it("rejects empty labels, invalid dates, oversized graphs and forged review metadata", () => {
    expect(() =>
      editLegalGraph(graph, { kind: "title", title: " " }),
    ).toThrow();
    expect(() =>
      editLegalGraph(graph, {
        kind: "node",
        value: { ...event, date: { value: "2023-02-29", origin: "user" } },
      }),
    ).toThrow();
    expect(() =>
      editLegalGraph(graph, {
        kind: "node",
        value: { ...person, review_status: "approved" } as LegalGraphNode,
      }),
    ).toThrow();
    const full = {
      ...graph,
      nodes: Array.from({ length: 500 }, (_, i) => ({
        ...person,
        id: `p${i}`,
      })),
      edges: [],
    };
    expect(() =>
      editLegalGraph(full, { kind: "node", create: true, value: person }),
    ).toThrow();
  });
});
