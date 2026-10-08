import {
  parseLegalGraph,
  type LegalGraph,
  type LegalGraphEdge,
  type LegalGraphNode,
  type LegalGraphSource,
} from "./legal-graph";

export type LegalGraphEdit =
  | { kind: "title"; title: string }
  | { kind: "node"; value: LegalGraphNode; create?: boolean }
  | { kind: "edge"; value: LegalGraphEdge; create?: boolean }
  | { kind: "delete-node"; id: string }
  | { kind: "delete-edge"; id: string }
  | {
      kind: "map-source";
      id: string;
      citation: Pick<
        Extract<LegalGraphSource, { kind: "citation" }>,
        "citation_id" | "evidence_item_id" | "evidence_version_id"
      >;
    }
  | { kind: "position"; id: string; position: { x: number; y: number } | null };

// A local draft transaction, not a storage or approval operation. Validate the whole
// graph after every edit so deletion cannot leave dangling relationships or sources.
export function editLegalGraph(
  graph: LegalGraph,
  edit: LegalGraphEdit,
): LegalGraph {
  let next: LegalGraph;
  switch (edit.kind) {
    case "map-source": {
      const current = graph.sources.find((source) => source.id === edit.id);
      const original =
        current?.kind === "citation" ? current.legacy_origin : current;
      if (!original) throw new Error("旧来源已变化，请重新选择。");
      next = {
        ...graph,
        sources: graph.sources.map((source) =>
          source.id === edit.id
            ? {
                id: source.id,
                kind: "citation",
                citation_id: edit.citation.citation_id,
                evidence_item_id: edit.citation.evidence_item_id,
                evidence_version_id: edit.citation.evidence_version_id,
                legacy_origin: original,
              }
            : source,
        ),
      };
      break;
    }
    case "title":
      next = { ...graph, title: edit.title };
      break;
    case "node": {
      const exists = graph.nodes.some((node) => node.id === edit.value.id);
      if (exists === Boolean(edit.create))
        throw new Error("节点已变化，请重新打开编辑。");
      next = {
        ...graph,
        nodes: edit.create
          ? [...graph.nodes, edit.value]
          : graph.nodes.map((node) =>
              node.id === edit.value.id ? edit.value : node,
            ),
      };
      break;
    }
    case "edge": {
      const exists = graph.edges.some((edge) => edge.id === edit.value.id);
      if (exists === Boolean(edit.create))
        throw new Error("关系已变化，请重新打开编辑。");
      next = {
        ...graph,
        edges: edit.create
          ? [...graph.edges, edit.value]
          : graph.edges.map((edge) =>
              edge.id === edit.value.id ? edit.value : edge,
            ),
      };
      break;
    }
    case "delete-node":
      if (!graph.nodes.some((node) => node.id === edit.id))
        throw new Error("节点不存在。");
      next = {
        ...graph,
        nodes: graph.nodes.filter((node) => node.id !== edit.id),
        edges: graph.edges.filter(
          (edge) => edge.source !== edit.id && edge.target !== edit.id,
        ),
      };
      break;
    case "delete-edge":
      if (!graph.edges.some((edge) => edge.id === edit.id))
        throw new Error("关系不存在。");
      next = {
        ...graph,
        edges: graph.edges.filter((edge) => edge.id !== edit.id),
      };
      break;
    case "position": {
      const node = graph.nodes.find((node) => node.id === edit.id);
      if (!node) throw new Error("节点不存在。");
      if (node.type === "event")
        throw new Error("事件节点按时间线排列，不能手动固定位置。");
      next = {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === edit.id ? { ...node, position: edit.position } : node,
        ),
      };
      break;
    }
  }
  return parseLegalGraph(serializeLegalGraph(next));
}

export function serializeLegalGraph(graph: LegalGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

export function editedEventDate(
  node: LegalGraphNode,
  value: string,
): LegalGraphNode["date"] {
  if (!value) return null;
  // An unchanged material/legacy date retains its provenance; a manual change
  // must never inherit a machine claim that the new date came from evidence.
  return node.date?.value === value ? node.date : { value, origin: "user" };
}

export const legalGraphCategoryLabels = {
  person: "人物关系",
  timeline: "时间线",
  evidence: "资金/证据",
  legal: "法律依据",
  custom: "自定义",
} as const;
export const legalGraphNodeTypeLabels = {
  party: "当事人",
  person: "自然人",
  org: "组织",
  event: "事件",
  evidence: "证据",
  money: "资金",
  law: "法条",
  claim: "主张",
  other: "其他",
} as const;
