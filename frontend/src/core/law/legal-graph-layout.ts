import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";

import { type LegalGraph, type LegalGraphNode } from "./legal-graph";
import { type GraphExplorerOptions } from "./legal-graph-explorer";
import { legalNodeRole } from "./legal-graph-semantics";

export const GRAPH_WIDTH = 800;
export const GRAPH_HEIGHT = 500;

export function timelineEntries(nodes: LegalGraphNode[]) {
  return nodes
    .filter((node) => node.type === "event")
    .map((node, index) => ({
      node,
      index,
      label: node.date?.value ?? "时间待确认",
      // Coarse dates sort after precise dates within the same period; never invent a day.
      sortKey:
        node.date?.value.replaceAll("-", "").padEnd(8, "9") ?? "99999999",
    }))
    .sort((a, b) => {
      if (Boolean(a.node.date) !== Boolean(b.node.date))
        return a.node.date ? -1 : 1;
      return a.sortKey.localeCompare(b.sortKey) || a.index - b.index;
    });
}

export interface GraphLayoutNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
  timeline: boolean;
  radius: number;
}
export function createLegalAnalysisLayout(
  graph: LegalGraph,
): GraphLayoutNode[] {
  const columns = {
    subject: 0,
    claim: 1,
    defense: 1,
    issue: 2,
    element: 3,
    act: 4,
    fact: 4,
    asset: 4,
    evidence: 5,
    rule: 6,
    procedure: 7,
    other: 4,
  } as const;
  const rows = new Map<number, number>();
  return graph.nodes.map((node) => {
    const column = columns[legalNodeRole(node)];
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return {
      id: node.id,
      x: 100 + column * 220,
      y: 100 + row * 150,
      radius: 11,
      timeline: false,
    };
  });
}

export function createGraphSimulation(
  graph: LegalGraph,
  explorer?: Pick<
    GraphExplorerOptions,
    "centerForce" | "repelForce" | "linkForce" | "linkDistance"
  >,
  previous: { id: string; x: number; y: number }[] = [],
) {
  const timeline = explorer ? [] : timelineEntries(graph.nodes);
  const positions = new Map(previous.map((node) => [node.id, node]));
  const order = new Map(timeline.map((entry, index) => [entry.node.id, index]));
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const height = Math.max(GRAPH_HEIGHT, timeline.length * 65 + 60);
  const center = timeline.length ? 550 : 400;
  const nodes: GraphLayoutNode[] = graph.nodes.map((node, index) => {
    const eventIndex = order.get(node.id);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const spread = 45 + Math.sqrt(index) * 20;
    const x =
      eventIndex !== undefined
        ? 100
        : (node.position?.x ??
          positions.get(node.id)?.x ??
          center + Math.cos(angle) * spread);
    const y =
      eventIndex !== undefined
        ? 60 + eventIndex * 65
        : (node.position?.y ??
          positions.get(node.id)?.y ??
          height / 2 + Math.sin(angle) * spread);
    return {
      id: node.id,
      x,
      y,
      radius: 6 + Math.min(12, Math.sqrt(degree.get(node.id) ?? 0) * 3),
      timeline: eventIndex !== undefined,
      fx: eventIndex !== undefined || node.position ? x : null,
      fy: eventIndex !== undefined || node.position ? y : null,
    };
  });
  // D3 mutates its own simulation copies, never the immutable artifact payload.
  return forceSimulation(nodes)
    .stop()
    .force("charge", forceManyBody().strength(-(explorer?.repelForce ?? 300)))
    .force(
      "link",
      forceLink<GraphLayoutNode, { source: string; target: string }>(
        graph.edges.map((edge) => ({
          source: edge.source,
          target: edge.target,
        })),
      )
        .id((node) => node.id)
        .distance(explorer?.linkDistance ?? 105)
        .strength(explorer?.linkForce ?? 0.4),
    )
    .force(
      "x",
      forceX<GraphLayoutNode>(center).strength((node) =>
        node.timeline ? 0 : (explorer?.centerForce ?? 0.08),
      ),
    )
    .force(
      "y",
      forceY<GraphLayoutNode>(height / 2).strength((node) =>
        node.timeline ? 0 : (explorer?.centerForce ?? 0.06),
      ),
    )
    .force(
      "collision",
      forceCollide<GraphLayoutNode>((node) => node.radius + 26),
    );
}

export interface GraphView {
  k: number;
  x: number;
  y: number;
}
export function graphEdgePath(
  a: GraphLayoutNode,
  b: GraphLayoutNode,
  offset = 0,
): string {
  if (a.id === b.id)
    return `M ${a.x + a.radius} ${a.y} C ${a.x + 65 + offset} ${a.y - 85 - offset}, ${a.x - 65 - offset} ${a.y - 85 - offset}, ${a.x - a.radius} ${a.y}`;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const x = (a.x + b.x) / 2 - ((b.y - a.y) / length) * offset;
  const y = (a.y + b.y) / 2 + ((b.x - a.x) / length) * offset;
  return `M ${a.x} ${a.y} Q ${x} ${y} ${b.x} ${b.y}`;
}
export function fitGraph(nodes: GraphLayoutNode[]): GraphView {
  if (!nodes.length) return { k: 1, x: 0, y: 0 };
  const minX = Math.min(...nodes.map((node) => node.x)) - 55;
  const maxX = Math.max(...nodes.map((node) => node.x)) + 180;
  const minY = Math.min(...nodes.map((node) => node.y)) - 45;
  const maxY = Math.max(...nodes.map((node) => node.y)) + 50;
  const k = Math.min(
    1.3,
    GRAPH_WIDTH / (maxX - minX),
    GRAPH_HEIGHT / (maxY - minY),
  );
  return {
    k,
    x: GRAPH_WIDTH / 2 - ((minX + maxX) / 2) * k,
    y: GRAPH_HEIGHT / 2 - ((minY + maxY) / 2) * k,
  };
}

export function zoomGraph(
  view: GraphView,
  factor: number,
  anchor = { x: 400, y: 250 },
): GraphView {
  const k = Math.max(1 / 128, Math.min(8, view.k * factor));
  return {
    k,
    x: anchor.x - ((anchor.x - view.x) / view.k) * k,
    y: anchor.y - ((anchor.y - view.y) / view.k) * k,
  };
}
