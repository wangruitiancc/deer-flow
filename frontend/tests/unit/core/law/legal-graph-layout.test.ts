import { describe, expect, it } from "@rstest/core";

import { type LegalGraph, type LegalGraphNode } from "@/core/law/legal-graph";
import {
  createGraphSimulation,
  fitGraph,
  timelineEntries,
  zoomGraph,
} from "@/core/law/legal-graph-layout";

const node = (id: string, value?: string): LegalGraphNode => ({
  id,
  label: id,
  type: "event",
  category: "timeline",
  source_ids: [],
  date: value ? { value, origin: "material" } : undefined,
});
describe("native legal graph layout", () => {
  it("keeps precise and coarse dates distinct, with unknown dates last and stable ties", () => {
    const nodes = [
      node("unknown"),
      node("year", "2024"),
      node("month", "2024-02"),
      node("day", "2024-02-01"),
      node("tie", "2024-02-01"),
    ];
    expect(timelineEntries(nodes).map((entry) => entry.node.id)).toEqual([
      "day",
      "tie",
      "month",
      "year",
      "unknown",
    ]);
    expect(timelineEntries(nodes).map((entry) => entry.label)).toContain(
      "2024-02",
    );
    expect(timelineEntries([node("event_20240101")])[0]?.label).toBe(
      "时间待确认",
    );
  });
  it("pins timeline nodes, respects saved coordinates and never mutates the artifact", () => {
    const graph: LegalGraph = {
      format: "matrix-law.legal-graph",
      schema_version: 1,
      title: "test",
      nodes: [
        node("event", "2024"),
        {
          ...node("person"),
          type: "person",
          date: null,
          category: "person",
          position: { x: 500, y: 200 },
        },
      ],
      edges: [
        {
          id: "edge",
          source: "person",
          target: "event",
          label: "签订",
          category: "timeline",
          confidence: "INFERRED",
          source_ids: [],
        },
      ],
      sources: [],
    };
    const original = structuredClone(graph);
    const simulation = createGraphSimulation(graph);
    simulation.tick(180);
    simulation.stop();
    expect(simulation.nodes()[0]?.x).toBe(100);
    expect(simulation.nodes()[1]?.x).toBe(500);
    expect(simulation.nodes()[1]?.y).toBe(200);
    expect(graph).toEqual(original);
    expect(
      simulation
        .nodes()
        .every((item) => Number.isFinite(item.x) && Number.isFinite(item.y)),
    ).toBe(true);
  });
  it("fits empty and extreme legal layouts without invalid transforms", () => {
    expect(fitGraph([])).toEqual({ k: 1, x: 0, y: 0 });
    const fitted = fitGraph([
      { id: "a", x: -100000, y: -100000, timeline: false, radius: 7 },
      { id: "b", x: 100000, y: 100000, timeline: false, radius: 7 },
    ]);
    expect(fitted.k).toBeGreaterThan(0);
    expect(fitted.k).toBeLessThan(1);
  });
  it("zooms around the cursor and clamps the zoom factor", () => {
    const view = { k: 1, x: 10, y: 20 },
      anchor = { x: 100, y: 80 };
    const next = zoomGraph(view, 2, anchor);
    expect((anchor.x - next.x) / next.k).toBe((anchor.x - view.x) / view.k);
    expect(zoomGraph(view, 1e6).k).toBe(8);
  });
});
