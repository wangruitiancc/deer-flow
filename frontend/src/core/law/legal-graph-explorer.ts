import { type LegalGraph, type LegalGraphNode } from "./legal-graph";
import {
  legalGraphCategoryLabels,
  legalGraphNodeTypeLabels,
} from "./legal-graph-editing";
import {
  legalFamilyLabels,
  legalKindLabels,
  legalRoleLabels,
  legalStatementLabels,
} from "./legal-graph-semantics";

export interface GraphExplorerOptions {
  root: string | null;
  depth: number;
  incoming: boolean;
  outgoing: boolean;
  interlinks: boolean;
  showEvidence: boolean;
  showOrphans: boolean;
  showUnverified: boolean;
  arrows: boolean;
  textFade: number;
  nodeSize: number;
  lineSize: number;
  centerForce: number;
  repelForce: number;
  linkForce: number;
  linkDistance: number;
  groups: GraphColorGroup[];
  family: string;
  confidence: string;
  statement: string;
  framework: string;
  layout: "force" | "analysis";
}
export interface GraphColorGroup {
  id: string;
  query: string;
  color: string;
}
export const defaultGraphExplorerOptions: GraphExplorerOptions = {
  root: null,
  depth: 1,
  incoming: true,
  outgoing: true,
  interlinks: false,
  showEvidence: true,
  showOrphans: true,
  showUnverified: true,
  arrows: false,
  textFade: 0,
  nodeSize: 1,
  lineSize: 1,
  centerForce: 0.1,
  repelForce: 1000,
  linkForce: 0.4,
  linkDistance: 105,
  groups: [],
  family: "all",
  confidence: "all",
  statement: "all",
  framework: "all",
  layout: "force",
};

type Subject = {
  id: string;
  label: string;
  type?: string;
  role?: LegalGraphNode["role"];
  legal?: LegalGraph["edges"][number]["legal"];
  category: string;
  confidence?: string;
  source_ids: string[];
  date?: { value: string } | null;
};
type Matcher = (value: Subject) => boolean;

/** A bounded, inert query language. No regex or expression evaluation. */
export function compileGraphQuery(query: string): {
  match: Matcher;
  error?: string;
} {
  if (query.length > 2000)
    return { match: () => false, error: "查询最多 2000 个字符。" };
  const tokens: string[] = [];
  const expression = /\s+|[()]|(?:[^\s()"\\]|"(?:[^"\\]|\\.)*"|\\.)+/gy;
  let offset = 0;
  while (offset < query.length) {
    expression.lastIndex = offset;
    const found = expression.exec(query);
    if (!found)
      return { match: () => false, error: "引号或查询表达式不完整。" };
    offset = expression.lastIndex;
    if (found[0].trim()) tokens.push(found[0]);
    if (tokens.length > 128)
      return { match: () => false, error: "查询条件过多。" };
  }
  if (!tokens.length) return { match: () => true };
  let cursor = 0;
  function atom(level: number): Matcher {
    if (level > 12) throw new Error("查询括号层数过多。");
    const token = tokens[cursor++];
    if (!token || token === ")" || token === "OR" || token === "AND")
      throw new Error("查询缺少条件。");
    if (token === "-") {
      const child = atom(level + 1);
      return (value) => !child(value);
    }
    if (token === "(") {
      const child = either(level + 1);
      if (tokens[cursor++] !== ")") throw new Error("查询括号不匹配。");
      return child;
    }
    const negative = token.startsWith("-");
    const raw = negative ? token.slice(1) : token;
    const colon = raw.indexOf(":");
    const field = colon >= 0 ? raw.slice(0, colon) : "";
    const text = (colon >= 0 ? raw.slice(colon + 1) : raw)
      .replace(/^"|"$/g, "")
      .replace(/\\(.)/g, "$1")
      .toLocaleLowerCase();
    if (!text) throw new Error("查询条件不能为空。");
    const fields = [
      "",
      "id",
      "type",
      "role",
      "family",
      "kind",
      "statement",
      "category",
      "label",
      "confidence",
      "source",
      "date",
    ];
    if (!fields.includes(field))
      throw new Error(`不支持字段 ${field}，请使用查询说明中的字段。`);
    return (value) => {
      const type = value.type ?? "relation";
      const values: Record<string, string> = {
        id: value.id,
        label: value.label,
        type: `${type} ${legalGraphNodeTypeLabels[type as LegalGraphNode["type"]] ?? "关系"}`,
        category: `${value.category} ${legalGraphCategoryLabels[value.category as LegalGraphNode["category"]] ?? ""}`,
        confidence: `${value.confidence ?? ""} ${value.confidence === "EXTRACTED" ? "材料明示" : value.confidence === "INFERRED" ? "模型推断" : value.confidence === "AMBIGUOUS" ? "存疑" : ""}`,
        source: value.source_ids.join(" "),
        date: value.date?.value ?? "",
        role: value.role ? `${value.role} ${legalRoleLabels[value.role]}` : "",
        family: value.legal
          ? `${value.legal.family} ${legalFamilyLabels[value.legal.family]}`
          : "",
        kind: value.legal
          ? `${value.legal.kind} ${legalKindLabels[value.legal.kind]}`
          : "",
        statement: value.legal
          ? `${value.legal.statement} ${legalStatementLabels[value.legal.statement]}`
          : "",
      };
      const haystack = field ? values[field]! : Object.values(values).join(" ");
      const matches = haystack.toLocaleLowerCase().includes(text);
      return negative ? !matches : matches;
    };
  }
  function both(level: number): Matcher {
    const children = [atom(level)];
    while (
      cursor < tokens.length &&
      tokens[cursor] !== ")" &&
      tokens[cursor] !== "OR"
    ) {
      if (tokens[cursor] === "AND") cursor++;
      children.push(atom(level));
    }
    return (value) => children.every((match) => match(value));
  }
  function either(level: number): Matcher {
    const children = [both(level)];
    while (tokens[cursor] === "OR") {
      cursor++;
      children.push(both(level));
    }
    return (value) => children.some((match) => match(value));
  }
  try {
    const match = either(0);
    if (cursor !== tokens.length) throw new Error("查询括号不匹配。");
    return { match };
  } catch (error) {
    return {
      match: () => false,
      error: error instanceof Error ? error.message : "查询无效。",
    };
  }
}

export function exploreLegalGraph(
  graph: LegalGraph,
  query: string,
  category: string,
  options: GraphExplorerOptions,
) {
  const compiled = compileGraphQuery(query);
  const verified = new Set(
    graph.sources
      .filter((source) => source.kind === "citation")
      .map((source) => source.id),
  );
  const allowed = (node: LegalGraphNode) =>
    options.showEvidence || node.type !== "evidence";
  const eligible = new Set(graph.nodes.filter(allowed).map((node) => node.id));
  const matching = new Set(
    graph.nodes
      .filter(
        (node) =>
          eligible.has(node.id) &&
          (options.showUnverified ||
            node.source_ids.some((id) => verified.has(id))) &&
          (category === "all" || node.category === category) &&
          compiled.match(node),
      )
      .map((node) => node.id),
  );
  let edges = graph.edges.filter(
    (edge) =>
      eligible.has(edge.source) &&
      eligible.has(edge.target) &&
      (options.framework === "all" ||
        edge.legal?.framework_ids?.includes(options.framework)) &&
      (options.family === "all" ||
        (options.family === "unclassified"
          ? !edge.legal
          : edge.legal?.family === options.family)) &&
      (options.confidence === "all" ||
        edge.confidence === options.confidence) &&
      (options.statement === "all" ||
        edge.legal?.statement === options.statement) &&
      (category === "all" || edge.category === category) &&
      (options.showUnverified ||
        edge.source_ids.some((id) => verified.has(id))) &&
      (compiled.match(edge) ||
        matching.has(edge.source) ||
        matching.has(edge.target)),
  );
  for (const edge of edges) {
    matching.add(edge.source);
    matching.add(edge.target);
  }
  if (
    options.family !== "all" ||
    options.statement !== "all" ||
    options.confidence !== "all" ||
    options.framework !== "all"
  ) {
    const connected = new Set(
      edges.flatMap((edge) => [edge.source, edge.target]),
    );
    if (options.framework !== "all") {
      const frame = graph.analysis?.frameworks?.find(
        (frame) => frame.id === options.framework,
      );
      if (options.family === "all")
        for (const id of [
          ...(frame?.element_node_ids ?? []),
          ...(frame?.issue_node_ids ?? []),
        ])
          if (matching.has(id)) connected.add(id);
    }
    for (const id of matching) if (!connected.has(id)) matching.delete(id);
  }
  let depths = new Map<string, number>();
  if (options.root && graph.nodes.some((node) => node.id === options.root)) {
    const root = options.root;
    // The explicitly selected root remains visible even when filters exclude it.
    matching.add(root);
    depths.set(root, 0);
    const traversal = new Set<string>();
    for (let hop = 0; hop < Math.min(5, Math.max(1, options.depth)); hop++) {
      for (const edge of edges) {
        const forward = options.outgoing && depths.get(edge.source) === hop;
        const backward = options.incoming && depths.get(edge.target) === hop;
        if (forward || backward) {
          const next = forward ? edge.target : edge.source;
          if (!depths.has(next)) {
            depths.set(next, hop + 1);
            traversal.add(edge.id);
          } else if (depths.get(next) === hop + 1) traversal.add(edge.id);
        }
      }
    }
    edges = edges.filter(
      (edge) =>
        depths.has(edge.source) &&
        depths.has(edge.target) &&
        (options.interlinks || traversal.has(edge.id)),
    );
    for (const id of matching) if (!depths.has(id)) matching.delete(id);
  } else {
    depths = new Map();
  }
  if (!options.showOrphans) {
    const connected = new Set(
      edges
        .filter((edge) => edge.source !== edge.target)
        .flatMap((edge) => [edge.source, edge.target]),
    );
    for (const id of matching)
      if (!connected.has(id) && id !== options.root) matching.delete(id);
  }
  edges = edges.filter(
    (edge) => matching.has(edge.source) && matching.has(edge.target),
  );
  return {
    graph: {
      ...graph,
      nodes: graph.nodes.filter((node) => matching.has(node.id)),
      edges,
    },
    depths,
    error: compiled.error,
  };
}

export function graphNodeColors(
  nodes: LegalGraphNode[],
  groups: GraphColorGroup[],
  automaticGroups: NonNullable<LegalGraph["presentation"]>["groups"] = [],
) {
  const valid = groups
    .filter(
      (group) => group.query.trim() && /^#[0-9a-f]{6}$/i.test(group.color),
    )
    .map((group) => ({ ...group, compiled: compileGraphQuery(group.query) }));
  return new Map(
    nodes.flatMap((node) => {
      const group = valid.find(
        (group) => !group.compiled.error && group.compiled.match(node),
      );
      const automatic = automaticGroups.find((group) =>
        group.node_ids.includes(node.id),
      );
      const color = group?.color ?? automatic?.color;
      return color ? [[node.id, color] as const] : [];
    }),
  );
}

/** AI-authored selections are inert stable IDs; they never remove artifact data. */
export function graphPresentationView(
  graph: LegalGraph,
  viewId: string | null,
) {
  const view = graph.presentation?.views.find((view) => view.id === viewId);
  if (!view) return graph;
  const nodes = new Set(view.node_ids);
  const edges = new Set(view.edge_ids);
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => nodes.has(node.id)),
    edges: graph.edges.filter((edge) => edges.has(edge.id)),
  };
}

/** Date-based reveal uses declared event dates, never guessed file creation dates. */
export function graphRevealOrder(graph: LegalGraph) {
  const dated = graph.nodes
    .filter((node) => node.date)
    .sort((a, b) => a.date!.value.localeCompare(b.date!.value));
  const ids = new Set(dated.map((node) => node.id));
  return [...dated, ...graph.nodes.filter((node) => !ids.has(node.id))].map(
    (node) => node.id,
  );
}
