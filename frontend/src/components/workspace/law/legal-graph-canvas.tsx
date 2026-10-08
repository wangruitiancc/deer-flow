"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { type LegalGraph } from "@/core/law/legal-graph";
import {
  createGraphSimulation,
  fitGraph,
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  zoomGraph,
  type GraphLayoutNode,
  type GraphView,
} from "@/core/law/legal-graph-layout";

const COLORS = {
  person: "var(--chart-1)",
  timeline: "var(--chart-2)",
  evidence: "var(--chart-3)",
  legal: "var(--chart-4)",
  custom: "var(--chart-5)",
};

export function LegalGraphCanvas({
  graph,
  selected,
  onSelect,
  onMoveNode,
}: {
  graph: LegalGraph;
  selected: string | null;
  onSelect: (kind: "node" | "edge", id: string) => void;
  onMoveNode?: (id: string, position: { x: number; y: number }) => void;
}) {
  const [nodes, setNodes] = useState<GraphLayoutNode[]>([]);
  const [view, setView] = useState<GraphView>({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [renderedWidth, setRenderedWidth] = useState(GRAPH_WIDTH);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setRenderedWidth(Math.max(1, element.getBoundingClientRect().width)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const labelScale = Math.max(
    1,
    12 / ((18 * view.k * renderedWidth) / GRAPH_WIDTH),
  );
  const gesture = useRef<{
    pointer: number;
    x: number;
    y: number;
    view: GraphView;
    node?: GraphLayoutNode;
    moved?: boolean;
    position?: { x: number; y: number };
  } | null>(null);
  useEffect(() => {
    const simulation = createGraphSimulation(graph);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let frame = 0,
      ticks = 0;
    setBusy(true);
    const advance = () => {
      simulation.tick(6);
      ticks += 6;
      const complete = ticks >= 180;
      if (!reduced || complete)
        setNodes(simulation.nodes().map((node) => ({ ...node })));
      if (complete) {
        setView(fitGraph(simulation.nodes()));
        setBusy(false);
      } else frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => {
      cancelAnimationFrame(frame);
      simulation.stop();
      gesture.current = null;
    };
  }, [graph]);
  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const originals = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const focus =
    hover ?? (selected?.startsWith("node:") ? selected.slice(5) : null);
  const neighbors = useMemo(() => {
    const result = new Set(focus ? [focus] : []);
    for (const edge of graph.edges) {
      if (edge.source === focus) result.add(edge.target);
      if (edge.target === focus) result.add(edge.source);
    }
    return result;
  }, [focus, graph.edges]);
  function point(clientX: number, clientY: number) {
    const matrix = svg.current?.getScreenCTM();
    const transformed = matrix
      ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
      : { x: 0, y: 0 };
    // DOMPoint coordinates are prototype accessors, not enumerable own fields.
    // Gesture snapshots must copy their values, never spread a DOMPoint.
    return { x: transformed.x, y: transformed.y };
  }
  function cancelGesture() {
    const active = gesture.current;
    if (active?.node)
      setNodes((nodes) =>
        nodes.map((node) =>
          node.id === active.node!.id ? active.node! : node,
        ),
      );
    gesture.current = null;
  }
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (busy || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const anchor = point(event.clientX, event.clientY);
      setView((current) =>
        zoomGraph(current, event.deltaY < 0 ? 1.12 : 1 / 1.12, anchor),
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [busy]);
  return (
    <div className="flex flex-1 shrink-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          aria-label="放大图谱"
          disabled={busy}
          onClick={() => setView((current) => zoomGraph(current, 1.3))}
        >
          放大
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label="缩小图谱"
          disabled={busy}
          onClick={() => setView((current) => zoomGraph(current, 1 / 1.3))}
        >
          缩小
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setView(fitGraph(nodes))}
        >
          适配全图
        </Button>
        <span className="text-muted-foreground text-xs" role="status">
          {busy
            ? "正在排列节点…"
            : `${Math.round(view.k * 100)}% · 拖动空白平移，Ctrl/⌘＋滚轮缩放`}
        </span>
      </div>
      <svg
        ref={svg}
        role="img"
        tabIndex={0}
        aria-label="法律关系画布；完整内容可在列表中使用键盘浏览"
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        className="bg-background focus-visible:ring-ring min-h-64 w-full flex-1 touch-none select-none focus-visible:ring-2"
        onKeyDown={(event) => {
          const delta = {
            ArrowLeft: [30, 0],
            ArrowRight: [-30, 0],
            ArrowUp: [0, 30],
            ArrowDown: [0, -30],
          }[event.key];
          if (!delta || busy) return;
          event.preventDefault();
          setView((current) => ({
            ...current,
            x: current.x + delta[0]!,
            y: current.y + delta[1]!,
          }));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || busy) return;
          const start = point(event.clientX, event.clientY);
          gesture.current = { pointer: event.pointerId, ...start, view };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const active = gesture.current;
          if (active?.pointer !== event.pointerId) return;
          const next = point(event.clientX, event.clientY);
          if (active.node) {
            if (!onMoveNode) {
              cancelGesture();
              return;
            }
            if (
              Math.hypot(next.x - active.x, next.y - active.y) < 3 &&
              !active.moved
            )
              return;
            const position = {
              x: Math.max(
                -100000,
                Math.min(
                  100000,
                  active.node.x + (next.x - active.x) / active.view.k,
                ),
              ),
              y: Math.max(
                -100000,
                Math.min(
                  100000,
                  active.node.y + (next.y - active.y) / active.view.k,
                ),
              ),
            };
            active.moved = true;
            active.position = position;
            setNodes((nodes) =>
              nodes.map((node) =>
                node.id === active.node!.id ? { ...node, ...position } : node,
              ),
            );
            return;
          }
          setView({
            ...active.view,
            x: active.view.x + next.x - active.x,
            y: active.view.y + next.y - active.y,
          });
        }}
        onPointerUp={() => {
          const active = gesture.current;
          gesture.current = null;
          if (active?.node) {
            if (active.moved && active.position && onMoveNode)
              onMoveNode(active.node.id, active.position);
            else if (active.moved)
              setNodes((nodes) =>
                nodes.map((node) =>
                  node.id === active.node!.id ? active.node! : node,
                ),
              );
            onSelect("node", active.node.id);
          }
        }}
        onPointerCancel={cancelGesture}
        onLostPointerCapture={cancelGesture}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {nodes.filter((node) => node.timeline).length > 1 && (
            <line
              x1={100}
              y1={60}
              x2={100}
              y2={Math.max(
                ...nodes.filter((node) => node.timeline).map((node) => node.y),
              )}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 5"
            />
          )}
          {graph.edges.map((edge) => {
            const a = byId.get(edge.source),
              b = byId.get(edge.target);
            if (!a || !b) return null;
            const active = selected === `edge:${edge.id}`;
            return (
              <g
                key={edge.id}
                opacity={
                  focus && edge.source !== focus && edge.target !== focus
                    ? 0.18
                    : 1
                }
                className="cursor-pointer"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onSelect("edge", edge.id)}
              >
                <title>{`${originals.get(edge.source)?.label} → ${edge.label} → ${originals.get(edge.target)?.label}`}</title>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="transparent"
                  strokeWidth={18}
                />
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={active ? "var(--foreground)" : COLORS[edge.category]}
                  strokeWidth={active ? 3 : 1.5}
                  strokeDasharray={
                    edge.confidence === "EXTRACTED"
                      ? undefined
                      : edge.confidence === "INFERRED"
                        ? "7 4"
                        : "2 5"
                  }
                />
                {(Boolean(focus) || active || view.k > 1.1) && (
                  <text
                    x={(a.x + b.x) / 2}
                    y={(a.y + b.y) / 2 - 7}
                    fontSize={16 * labelScale}
                    fill="var(--foreground)"
                    stroke="var(--background)"
                    strokeWidth={4}
                    paintOrder="stroke"
                  >
                    {[...edge.label].slice(0, 18).join("")}
                  </text>
                )}
              </g>
            );
          })}
          {nodes.map((node) => {
            const original = originals.get(node.id)!;
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                transform={`translate(${node.x},${node.y})`}
                opacity={focus && !neighbors.has(node.id) ? 0.18 : 1}
                className="cursor-pointer"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (
                    !onMoveNode ||
                    node.timeline ||
                    event.button !== 0 ||
                    busy
                  )
                    return;
                  const start = point(event.clientX, event.clientY);
                  gesture.current = {
                    pointer: event.pointerId,
                    ...start,
                    view,
                    node,
                  };
                  svg.current?.setPointerCapture(event.pointerId);
                }}
                onPointerEnter={() => setHover(node.id)}
                onPointerLeave={() => setHover(null)}
                onClick={() => onSelect("node", node.id)}
              >
                <title>{original.label}</title>
                <circle r={node.radius + 9} fill="transparent" />
                <circle
                  r={node.radius}
                  fill={COLORS[original.category]}
                  stroke="var(--foreground)"
                  strokeWidth={selected === `node:${node.id}` ? 3 : 1}
                />
                <text
                  x={node.x > 450 ? -node.radius - 8 : node.radius + 8}
                  textAnchor={node.x > 450 ? "end" : "start"}
                  y={5}
                  fontSize={18 * labelScale}
                  fill="var(--foreground)"
                  stroke="var(--background)"
                  strokeWidth={4}
                  paintOrder="stroke"
                >
                  {[...original.label].slice(0, 18).join("")}
                  {[...original.label].length > 18 ? "…" : ""}
                </text>
                {node.timeline && (
                  <text
                    x={node.radius + 8}
                    y={-17 * labelScale}
                    fontSize={14 * labelScale}
                    fill="var(--muted-foreground)"
                  >
                    {original.date?.value ?? "时间待确认"}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
