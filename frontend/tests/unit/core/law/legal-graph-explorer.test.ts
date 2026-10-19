import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "@rstest/core";

import { parseLegalGraph, type LegalGraph } from "@/core/law/legal-graph";
import { editLegalGraph } from "@/core/law/legal-graph-editing";
import {
  compileGraphQuery,
  defaultGraphExplorerOptions,
  exploreLegalGraph,
  graphNodeColors,
  graphPresentationView,
} from "@/core/law/legal-graph-explorer";
import {
  createGraphSimulation,
  createLegalAnalysisLayout,
  graphEdgePath,
} from "@/core/law/legal-graph-layout";
import { legalGraphQuestions } from "@/core/law/legal-graph-semantics";

const graph: LegalGraph = {
  format: "matrix-law.legal-graph",
  schema_version: 1,
  title: "跨案由合成分析",
  nodes: [
    {
      id: "a",
      label: "主体甲",
      type: "party",
      role: "subject",
      category: "person",
      source_ids: [],
    },
    {
      id: "b",
      label: "待审查要件",
      type: "other",
      role: "element",
      category: "legal",
      source_ids: [],
    },
    {
      id: "c",
      label: "相反陈述",
      type: "evidence",
      role: "evidence",
      category: "evidence",
      source_ids: ["s"],
    },
    {
      id: "d",
      label: "争议事实",
      type: "event",
      role: "fact",
      category: "timeline",
      source_ids: [],
    },
    {
      id: "orphan",
      label: "孤立主张",
      type: "claim",
      category: "legal",
      source_ids: [],
    },
  ],
  edges: [
    {
      id: "ab",
      source: "a",
      target: "b",
      label: "提出",
      category: "legal",
      confidence: "INFERRED",
      source_ids: [],
    },
    {
      id: "bc",
      source: "b",
      target: "c",
      label: "待核对",
      category: "legal",
      confidence: "AMBIGUOUS",
      source_ids: [],
    },
    {
      id: "bd",
      source: "b",
      target: "d",
      label: "依赖",
      category: "legal",
      confidence: "INFERRED",
      source_ids: [],
    },
    {
      id: "cd",
      source: "c",
      target: "d",
      label: "反驳",
      category: "evidence",
      confidence: "EXTRACTED",
      source_ids: ["s"],
      legal: {
        family: "proof",
        kind: "contradicts",
        statement: "party_assertion",
        asserted_by: "a",
        issue_ids: ["b"],
        questions: ["该相反陈述是否与其他材料相符？"],
      },
    },
    {
      id: "self",
      source: "orphan",
      target: "orphan",
      label: "自环",
      category: "legal",
      confidence: "AMBIGUOUS",
      source_ids: [],
    },
  ],
  sources: [{ id: "s", kind: "unverified", quote: "合成相反陈述" }],
  analysis: {
    case_labels: ["候选案由", "候选罪名"],
    registered_cause: null,
    matter_version: 1,
    element_node_ids: ["b"],
    framework_source_ids: [],
    notes: ["规范依据待核验；这不是法律结论。"],
  },
};
describe("legal relationship exploration", () => {
  it("changes framework membership without fabricating legal classifications or dangling deleted frameworks", () => {
    const example = parseLegalGraph(
      readFileSync(
        resolve(
          __dirname,
          "../../../../../backend/extensions/sources/matrix-law-extension/matrix_law_extension/contracts/legal_graph_professional.example.json",
        ),
        "utf8",
      ),
    );
    const analysis = example.analysis!;
    const next = editLegalGraph(example, {
      kind: "analysis",
      value: {
        ...analysis,
        frameworks: analysis.frameworks!.filter(
          (frame) => frame.id === "frame-b",
        ),
      },
      memberships: [],
    });
    expect(next.nodes).toEqual(example.nodes);
    expect(next.sources).toEqual(example.sources);
    expect(next.edges).toHaveLength(example.edges.length);
    expect(
      next.edges.every(
        (edge) => !edge.legal?.framework_ids?.includes("frame-a"),
      ),
    ).toBe(true);
    const edge = example.edges.find((edge) => edge.legal)!;
    expect(() =>
      editLegalGraph(example, {
        kind: "analysis",
        value: analysis,
        memberships: [{ edgeId: edge.id, frameworkIds: ["missing"] }],
      }),
    ).toThrow();
    expect(() =>
      editLegalGraph(example, {
        kind: "analysis",
        value: analysis,
        memberships: [{ edgeId: "missing", frameworkIds: [] }],
      }),
    ).toThrow();
    const unclassified = {
      ...example,
      edges: example.edges.map((item) => ({ ...item, legal: undefined })),
    };
    expect(() =>
      editLegalGraph(unclassified, {
        kind: "analysis",
        value: analysis,
        memberships: [{ edgeId: edge.id, frameworkIds: ["frame-a"] }],
      }),
    ).toThrow();
  });
  it("keeps independent case frameworks separate in the shared contract and uses role-based analysis columns", () => {
    const example = parseLegalGraph(
      readFileSync(
        resolve(
          __dirname,
          "../../../../../backend/extensions/sources/matrix-law-extension/matrix_law_extension/contracts/legal_graph_professional.example.json",
        ),
        "utf8",
      ),
    );
    const first = exploreLegalGraph(example, "", "all", {
      ...defaultGraphExplorerOptions,
      framework: "frame-a",
    }).graph;
    expect(first.nodes.some((node) => node.id === "element-a")).toBe(true);
    expect(first.nodes.some((node) => node.id === "element-b")).toBe(false);
    const second = exploreLegalGraph(example, "", "all", {
      ...defaultGraphExplorerOptions,
      framework: "frame-b",
    }).graph;
    expect(second.nodes.some((node) => node.id === "element-b")).toBe(true);
    expect(second.nodes.some((node) => node.id === "element-a")).toBe(false);
    const positions = new Map(
      createLegalAnalysisLayout(example).map((node) => [node.id, node]),
    );
    expect(positions.get("claim")!.x).toBeLessThan(
      positions.get("element-a")!.x,
    );
    expect(positions.get("element-a")!.x).toBeLessThan(
      positions.get("support")!.x,
    );
    expect(
      graphEdgePath(positions.get("subject")!, positions.get("subject")!),
    ).toContain("C");
    expect(
      graphEdgePath(positions.get("subject")!, positions.get("claim")!, 20),
    ).not.toBe(
      graphEdgePath(positions.get("subject")!, positions.get("claim")!, -20),
    );
  });
  it("parses bounded AND/OR/negated field queries without executing expressions", () => {
    expect(
      compileGraphQuery('(role:subject OR type:evidence) -label:"无关"').match(
        graph.nodes[0]!,
      ),
    ).toBe(true);
    expect(
      compileGraphQuery('(role:subject OR type:evidence) -label:"无关"').match(
        graph.nodes[1]!,
      ),
    ).toBe(false);
    expect(
      compileGraphQuery("family:proof statement:party_assertion").match(
        graph.edges[3]!,
      ),
    ).toBe(true);
    for (const query of [
      '"unterminated',
      "(role:subject",
      "foo:bar",
      "role:",
      "x OR",
      "(".repeat(20),
    ])
      expect(compileGraphQuery(query).error).toBeDefined();
  });
  it("traverses incoming/outgoing breadth and adds interlinks only when requested", () => {
    const options = {
      ...defaultGraphExplorerOptions,
      root: "b",
      incoming: false,
      outgoing: true,
    };
    const local = exploreLegalGraph(graph, "", "all", options).graph;
    expect(local.nodes.map((node) => node.id)).toEqual(["b", "c", "d"]);
    expect(local.edges.map((edge) => edge.id)).toEqual(["bc", "bd"]);
    expect(
      exploreLegalGraph(graph, "", "all", {
        ...options,
        interlinks: true,
      }).graph.edges.map((edge) => edge.id),
    ).toEqual(["bc", "bd", "cd"]);
    expect(
      exploreLegalGraph(graph, "", "all", {
        ...options,
        incoming: true,
        outgoing: false,
      }).graph.nodes.map((node) => node.id),
    ).toEqual(["a", "b"]);
    expect(
      exploreLegalGraph(graph, "nobody", "all", options).graph.nodes.map(
        (node) => node.id,
      ),
    ).toEqual(["b"]);
  });
  it("keeps source labels distinct from proof, and does not guess classifications from edge labels", () => {
    const original = structuredClone(graph);
    expect(
      exploreLegalGraph(graph, "", "all", {
        ...defaultGraphExplorerOptions,
        family: "proof",
      }).graph.edges.map((edge) => edge.id),
    ).toEqual(["cd"]);
    expect(
      exploreLegalGraph(graph, "", "all", {
        ...defaultGraphExplorerOptions,
        family: "unclassified",
      }).graph.edges,
    ).toHaveLength(4);
    expect(
      exploreLegalGraph(graph, "", "all", {
        ...defaultGraphExplorerOptions,
        showUnverified: false,
      }).graph.nodes,
    ).toHaveLength(0);
    expect(
      exploreLegalGraph(graph, "", "all", {
        ...defaultGraphExplorerOptions,
        showOrphans: false,
      }).graph.nodes.some((node) => node.id === "orphan"),
    ).toBe(false);
    expect(graph).toEqual(original);
  });
  it("uses the first matching valid color group and does not promote excluded nodes", () => {
    const groups = [
      { id: "1", query: "type:party", color: "#aabbcc" },
      { id: "2", query: "主体", color: "#112233" },
    ];
    expect(graphNodeColors(graph.nodes, groups).get("a")).toBe("#aabbcc");
    expect(graphNodeColors(graph.nodes, [...groups].reverse()).get("a")).toBe(
      "#112233",
    );
    expect(
      graphNodeColors(graph.nodes, [{ id: "bad", query: "", color: "#ffffff" }])
        .size,
    ).toBe(0);
  });
  it("validates analysis references and rejects asserted reviews and cross-graph references", () => {
    expect(
      parseLegalGraph(JSON.stringify(graph)).analysis?.case_labels,
    ).toEqual(["候选案由", "候选罪名"]);
    expect(() =>
      parseLegalGraph(
        JSON.stringify({
          ...graph,
          analysis: { ...graph.analysis, element_node_ids: ["a"] },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseLegalGraph(
        JSON.stringify({
          ...graph,
          edges: graph.edges.map((edge) =>
            edge.legal
              ? { ...edge, legal: { ...edge.legal, asserted_by: "foreign" } }
              : edge,
          ),
        }),
      ),
    ).toThrow();
    expect(() =>
      parseLegalGraph(
        JSON.stringify({
          ...graph,
          analysis: { ...graph.analysis, reviewed: true },
        }),
      ),
    ).toThrow();
    expect(() =>
      parseLegalGraph(
        JSON.stringify({
          ...graph,
          edges: graph.edges.map((edge) =>
            edge.legal
              ? { ...edge, legal: { ...edge.legal, questions: ["\u0000"] } }
              : edge,
          ),
        }),
      ),
    ).toThrow();
    const next = editLegalGraph(graph, { kind: "delete-node", id: "a" });
    expect(
      next.edges.find((edge) => edge.id === "cd")?.legal?.asserted_by,
    ).toBeNull();
    expect(
      editLegalGraph(graph, { kind: "delete-node", id: "b" }).analysis
        ?.element_node_ids,
    ).toEqual([]);
  });
  it("reports structural questions without declaring an evidential or legal conclusion", () => {
    const questions = legalGraphQuestions(graph);
    expect(questions.some((question) => question.nodeId === "b")).toBe(true);
    expect(questions.find((question) => question.edgeId === "cd")?.text).toBe(
      "该相反陈述是否与其他材料相符？",
    );
  });
  it("separates free graph exploration from the existing precision-preserving timeline", () => {
    const before = structuredClone(graph);
    const simulation = createGraphSimulation(
      graph,
      defaultGraphExplorerOptions,
    );
    simulation.tick(180);
    simulation.stop();
    expect(
      simulation
        .nodes()
        .every(
          (node) =>
            !node.timeline &&
            Number.isFinite(node.x) &&
            Number.isFinite(node.y),
        ),
    ).toBe(true);
    expect(graph).toEqual(before);
  });
});

describe("AI case-specific presentation", () => {
  const example = () =>
    parseLegalGraph(
      readFileSync(
        resolve(
          __dirname,
          "../../../../../backend/extensions/sources/matrix-law-extension/matrix_law_extension/contracts/legal_graph_presentation.example.json",
        ),
        "utf8",
      ),
    );
  it("uses explicit AI topic selections including opposing proof without mutating the complete graph", () => {
    const graph = example();
    const before = JSON.stringify(graph);
    const selected = graphPresentationView(
      graph,
      graph.presentation!.default_view_id,
    );
    expect(selected.nodes.map((node) => node.id)).toEqual([
      "element-a",
      "fact",
      "support",
      "opposition",
    ]);
    expect(selected.edges.map((edge) => edge.id)).toEqual([
      "fact-a",
      "proof-support",
      "proof-opposition",
    ]);
    expect(graphPresentationView(graph, null)).toBe(graph);
    expect(JSON.stringify(graph)).toBe(before);
    const colors = graphNodeColors(graph.nodes, [], graph.presentation!.groups);
    expect(colors.get("fact")).toBe("#2563eb");
    expect(colors.get("support")).toBe(colors.get("opposition"));
    expect(
      graphNodeColors(
        graph.nodes,
        [{ id: "manual", query: "id:fact", color: "#123456" }],
        graph.presentation!.groups,
      ).get("fact"),
    ).toBe("#123456");
  });
  for (const mutation of [
    (g: LegalGraph) => {
      g.presentation!.default_view_id = "missing";
    },
    (g: LegalGraph) => {
      g.presentation!.groups[0]!.color = "url(https://invalid)";
    },
    (g: LegalGraph) => {
      g.presentation!.groups[0]!.node_ids.push("foreign");
    },
    (g: LegalGraph) => {
      g.presentation!.views[0]!.edge_ids.push("issue-link-b");
    },
    (g: LegalGraph) => {
      g.presentation!.views[0]!.edge_ids.push("missing");
    },
    (g: LegalGraph) => {
      g.presentation!.views.push(g.presentation!.views[0]!);
    },
    (g: LegalGraph) => {
      g.presentation!.views[0]!.node_ids.push("fact");
    },
    (g: LegalGraph) => {
      g.analysis = null;
    },
  ])
    it("rejects unsafe or unbound AI presentation", () => {
      const graph = example();
      mutation(graph);
      expect(() => parseLegalGraph(JSON.stringify(graph))).toThrow();
    });
  it("cleans only deleted references and retains opposing evidence and immutable source bytes", () => {
    const graph = example();
    const next = editLegalGraph(graph, { kind: "delete-node", id: "fact" });
    expect(next.presentation!.views[0]!.node_ids).toEqual([
      "element-a",
      "support",
      "opposition",
    ]);
    expect(next.presentation!.views[0]!.edge_ids).toEqual([]);
    expect(next.sources).toEqual(graph.sources);
    expect(graph.nodes.some((node) => node.id === "fact")).toBe(true);
  });
});
