"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { type LegalGraph, type LegalGraphEdge } from "@/core/law/legal-graph";
import {
  defaultGraphExplorerOptions,
  graphNodeColors,
  type GraphExplorerOptions,
} from "@/core/law/legal-graph-explorer";
import {
  createGraphSimulation,
  createLegalAnalysisLayout,
  fitGraph,
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  graphEdgePath,
  zoomGraph,
  type GraphLayoutNode,
  type GraphView,
} from "@/core/law/legal-graph-layout";
import { type GraphLayoutResult } from "@/core/law/legal-graph-layout.worker";
import {
  legalNodeRole,
  legalRoleLabels,
} from "@/core/law/legal-graph-semantics";

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
  options = defaultGraphExplorerOptions,
  onFocusNode,
}: {
  graph: LegalGraph;
  selected: string | null;
  onSelect: (kind: "node" | "edge", id: string) => void;
  onMoveNode?: (id: string, position: { x: number; y: number }) => void;
  options?: GraphExplorerOptions;
  onFocusNode?: (id: string) => void;
}) {
  const [nodes, setNodes] = useState<GraphLayoutNode[]>([]);
  const [view, setView] = useState<GraphView>({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [renderedWidth, setRenderedWidth] = useState(GRAPH_WIDTH);
  const svg = useRef<SVGSVGElement>(null);
  const arrowId = useId().replaceAll(":", "");
  const positions = useRef(new Map<string, GraphLayoutNode>());
  const fitted = useRef(false);
  const lastLayout = useRef(options.layout);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [contextNode, setContextNode] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    distance: number;
    center: { x: number; y: number };
    view: GraphView;
  } | null>(null);
  const inertia = useRef(0);
  const curveOffsets = useMemo(() => {
    const groups = new Map<string, LegalGraphEdge[]>();
    for (const edge of graph.edges) {
      const key = JSON.stringify([edge.source, edge.target].sort());
      const group = groups.get(key) ?? [];
      group.push(edge);
      groups.set(key, group);
    }
    const result = new Map<string, number>();
    for (const group of groups.values())
      group.forEach((edge, index) =>
        result.set(
          edge.id,
          (index - (group.length - 1) / 2) *
            40 *
            (edge.source > edge.target ? -1 : 1),
        ),
      );
    return result;
  }, [graph.edges]);
  const colors = useMemo(
    () =>
      graphNodeColors(graph.nodes, options.groups, graph.presentation?.groups),
    [graph.nodes, options.groups, graph.presentation?.groups],
  );
  // Strip legal content from the worker payload, and keep geometry identity stable
  // across selection, colors, label changes and display-only controls.
  const geometry = JSON.stringify({
    format: graph.format,
    schema_version: graph.schema_version,
    title: "layout",
    sources: [],
    nodes: graph.nodes.map(({ id, type, role, position }) => ({
      id,
      type,
      role,
      position,
      category: "custom",
      label: id,
      source_ids: [],
    })),
    edges: graph.edges.map(({ id, source, target }) => ({
      id,
      source,
      target,
      category: "custom",
      label: id,
      confidence: "AMBIGUOUS",
      source_ids: [],
    })),
  });
  const layoutGraph = useMemo(
    () => JSON.parse(geometry) as LegalGraph,
    [geometry],
  );
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
    last?: { x: number; y: number; at: number };
    velocity?: { x: number; y: number };
  } | null>(null);
  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let frame = 0,
      ticks = 0,
      worker: Worker | undefined,
      stopped = false;
    const forces = {
      centerForce: options.centerForce,
      repelForce: options.repelForce,
      linkForce: options.linkForce,
      linkDistance: options.linkDistance,
    };
    const previous = [...positions.current.values()];
    setBusy(true);
    let fallback: ReturnType<typeof createGraphSimulation> | undefined;
    const accept = ({ nodes: next, done }: GraphLayoutResult) => {
      if (stopped) return;
      const active = gesture.current;
      for (const node of next) positions.current.set(node.id, node);
      setNodes(
        next.map((node) =>
          active?.node?.id === node.id
            ? { ...node, ...(active.position ?? active.node) }
            : node,
        ),
      );
      if (done) {
        if (!fitted.current) {
          setView(fitGraph(next));
          fitted.current = true;
        }
        setBusy(false);
      }
    };
    if (lastLayout.current !== options.layout) {
      fitted.current = false;
      lastLayout.current = options.layout;
    }
    if (options.layout === "analysis") {
      accept({ nodes: createLegalAnalysisLayout(layoutGraph), done: true });
      return () => {
        stopped = true;
        gesture.current = null;
      };
    }
    const runFallback = () => {
      if (stopped) return;
      worker?.terminate();
      fallback = createGraphSimulation(layoutGraph, forces, previous);
      const advance = () => {
        if (stopped || !fallback) return;
        fallback.tick(6);
        ticks += 6;
        const done = ticks >= 180;
        if (!reduced || done)
          accept({
            nodes: fallback.nodes().map((node) => ({ ...node })),
            done,
          });
        if (!done) frame = requestAnimationFrame(advance);
      };
      frame = requestAnimationFrame(advance);
    };
    try {
      worker = new Worker(
        new URL(
          "../../../core/law/legal-graph-layout.worker.ts",
          import.meta.url,
        ),
        { name: "legal-graph-layout" },
      );
      worker.onmessage = (event: MessageEvent<GraphLayoutResult>) =>
        accept(event.data);
      worker.onerror = (event) => {
        event.preventDefault();
        // Termination during filtering can abort bootstrap script requests.
        if (stopped) return;
        setNotice("布局线程不可用，已切换为分帧布局。");
        runFallback();
      };
      worker.postMessage({ graph: layoutGraph, forces, previous, reduced });
    } catch {
      runFallback();
    }
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      fallback?.stop();
      worker?.terminate();
      gesture.current = null;
      pointers.current.clear();
      pinch.current = null;
    };
  }, [
    layoutGraph,
    layoutRevision,
    options.centerForce,
    options.repelForce,
    options.linkForce,
    options.linkDistance,
    options.layout,
  ]);
  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const originals = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  const focusCandidate =
    hover ?? (selected?.startsWith("node:") ? selected.slice(5) : null);
  const focus =
    focusCandidate && byId.has(focusCandidate) ? focusCandidate : null;
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
    pointers.current.clear();
    pinch.current = null;
  }
  function registerPointer(pointerId: number, start: { x: number; y: number }) {
    cancelAnimationFrame(inertia.current);
    pointers.current.set(pointerId, start);
    svg.current?.setPointerCapture(pointerId);
    if (pointers.current.size !== 2) return false;
    const active = [...pointers.current];
    cancelGesture();
    pointers.current = new Map(active);
    return true;
  }
  useEffect(() => () => cancelAnimationFrame(inertia.current), []);
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (busy) return;
      event.preventDefault();
      cancelAnimationFrame(inertia.current);
      const anchor = point(event.clientX, event.clientY);
      setView((current) =>
        zoomGraph(
          current,
          Math.exp(
            -Math.max(
              -100,
              Math.min(
                100,
                event.deltaY *
                  (event.deltaMode === 1
                    ? 16
                    : event.deltaMode === 2
                      ? 500
                      : 1),
              ),
            ) * 0.003,
          ),
          anchor,
        ),
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [busy]);
  useEffect(() => {
    const root = options.root && positions.current.get(options.root);
    if (root)
      setView((value) => ({
        k: value.k,
        x: GRAPH_WIDTH / 2 - root.x * value.k,
        y: GRAPH_HEIGHT / 2 - root.y * value.k,
      }));
  }, [options.root]);
  const labelOpacity = Math.max(
    0,
    Math.min(1, view.k * Math.pow(2, -options.textFade)),
  );
  async function screenshot(copy = false) {
    const element = svg.current;
    if (!element) return;
    const clone = element.cloneNode(true) as SVGSVGElement;
    const originals = [element, ...element.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    originals.forEach((original, index) => {
      const computed = getComputedStyle(original);
      for (const key of [
        "fill",
        "stroke",
        "color",
        "background-color",
        "font-family",
      ])
        (copies[index] as SVGElement).style.setProperty(
          key,
          computed.getPropertyValue(key),
        );
    });
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", "1600");
    clone.setAttribute("height", "1000");
    clone.style.backgroundColor = "transparent";
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(clone)], {
        type: "image/svg+xml",
      }),
    );
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1000;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("无法生成截图");
      context.drawImage(image, 0, 0, 1600, 1000);
      if (copy) {
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) =>
              value ? resolve(value) : reject(new Error("Screenshot failed")),
            "image/png",
          ),
        );
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        setNotice("图谱图片已复制；仅包含当前可见关系。");
      } else {
        const link = document.createElement("a");
        link.download = "legal-graph.png";
        link.href = canvas.toDataURL("image/png");
        link.click();
        setNotice("图谱截图已生成；仅包含当前可见关系。");
      }
    } catch {
      setNotice("截图生成失败，请重试。");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return (
    <div className="flex flex-1 shrink-0 flex-col">
      <div
        className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2"
        onPointerDown={() => cancelAnimationFrame(inertia.current)}
        onKeyDownCapture={() => cancelAnimationFrame(inertia.current)}
      >
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
          variant="ghost"
          disabled={busy}
          onClick={() => void screenshot(true)}
        >
          复制图片
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            positions.current.clear();
            fitted.current = false;
            setLayoutRevision((value) => value + 1);
          }}
        >
          重新布局
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void screenshot()}
        >
          导出图片
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
            : `${Math.round(view.k * 100)}% · 拖动平移，滚轮／双指缩放，双击节点查看局部`}
        </span>
      </div>
      {notice && (
        <p role="status" className="text-muted-foreground px-3 text-xs">
          {notice}
        </p>
      )}
      {contextNode && (
        <div
          role="group"
          aria-label="节点操作"
          className="flex flex-wrap gap-2 border-y px-3 py-2"
        >
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onSelect("node", contextNode);
              setContextNode(null);
            }}
          >
            查看节点与来源
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onFocusNode?.(contextNode);
              setContextNode(null);
            }}
          >
            以此为中心查看
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setContextNode(null)}
          >
            关闭节点操作
          </Button>
        </div>
      )}
      {hover && originals.get(hover) && (
        <div
          aria-hidden="true"
          className="text-muted-foreground pointer-events-none truncate px-3 text-xs"
        >
          {originals.get(hover)!.label} ·{" "}
          {legalRoleLabels[legalNodeRole(originals.get(hover)!)]} ·{" "}
          {originals.get(hover)!.source_ids.length} 项来源（点击后核验）
        </div>
      )}
      <svg
        ref={svg}
        role="img"
        tabIndex={0}
        aria-label="法律关系画布；完整内容可在列表中使用键盘浏览"
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        className="bg-background focus-visible:ring-ring min-h-64 w-full flex-1 touch-none select-none focus-visible:ring-2"
        onKeyDown={(event) => {
          cancelAnimationFrame(inertia.current);
          if (["+", "=", "-"].includes(event.key)) {
            event.preventDefault();
            if (!busy)
              setView((value) =>
                zoomGraph(value, event.key === "-" ? 1 / 1.2 : 1.2),
              );
            return;
          }
          if (event.key === "Escape") {
            cancelGesture();
            setContextNode(null);
            return;
          }
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
            x: current.x + delta[0]! * (event.shiftKey ? 3 : 1),
            y: current.y + delta[1]! * (event.shiftKey ? 3 : 1),
          }));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || busy) return;
          const start = point(event.clientX, event.clientY);
          if (registerPointer(event.pointerId, start)) return;
          gesture.current = {
            pointer: event.pointerId,
            ...start,
            view,
            last: { ...start, at: performance.now() },
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (pointers.current.has(event.pointerId))
            pointers.current.set(
              event.pointerId,
              point(event.clientX, event.clientY),
            );
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()] as [
              { x: number; y: number },
              { x: number; y: number },
            ];
            const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
            pinch.current ??= { distance, center, view };
            const snapshot = pinch.current;
            const next = zoomGraph(
              snapshot.view,
              distance / snapshot.distance,
              snapshot.center,
            );
            setView({
              ...next,
              x: next.x + center.x - snapshot.center.x,
              y: next.y + center.y - snapshot.center.y,
            });
            return;
          }
          const active = gesture.current;
          if (active?.pointer !== event.pointerId) return;
          const next = point(event.clientX, event.clientY);
          if (active.node) {
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
          const time = performance.now();
          if (active.last) {
            const elapsed = Math.max(16, time - active.last.at);
            active.velocity = {
              x: (next.x - active.last.x) / elapsed,
              y: (next.y - active.last.y) / elapsed,
            };
          }
          active.last = { ...next, at: time };
          setView({
            ...active.view,
            x: active.view.x + next.x - active.x,
            y: active.view.y + next.y - active.y,
          });
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          if (pinch.current) {
            pinch.current = null;
            gesture.current = null;
            pointers.current.clear();
            return;
          }
          const active = gesture.current;
          if (active?.pointer !== event.pointerId) return;
          gesture.current = null;
          if (active?.node) {
            if (
              active.moved &&
              active.position &&
              onMoveNode &&
              originals.get(active.node.id)?.type !== "event"
            )
              onMoveNode(active.node.id, active.position);
            if (active.position)
              positions.current.set(active.node.id, {
                ...active.node,
                ...active.position,
              });
            onSelect("node", active.node.id);
          } else if (
            active?.velocity &&
            !window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ) {
            const velocity = {
              x: Math.max(-30, Math.min(30, active.velocity.x * 16)),
              y: Math.max(-30, Math.min(30, active.velocity.y * 16)),
            };
            const glide = () => {
              velocity.x *= 0.88;
              velocity.y *= 0.88;
              setView((value) => ({
                ...value,
                x: value.x + velocity.x,
                y: value.y + velocity.y,
              }));
              if (Math.hypot(velocity.x, velocity.y) > 0.2)
                inertia.current = requestAnimationFrame(glide);
            };
            inertia.current = requestAnimationFrame(glide);
          }
        }}
        onPointerCancel={(event) => {
          if (gesture.current?.pointer === event.pointerId) cancelGesture();
        }}
        onLostPointerCapture={cancelGesture}
      >
        <defs>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="17"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
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
            const path = graphEdgePath(a, b, curveOffsets.get(edge.id));
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
                <path
                  d={path}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={18}
                />
                <path
                  d={path}
                  fill="none"
                  stroke={
                    active
                      ? "var(--foreground)"
                      : edge.legal?.kind === "contradicts" ||
                          edge.legal?.kind === "rebuts"
                        ? "var(--destructive)"
                        : edge.legal?.kind === "supports"
                          ? "var(--chart-2)"
                          : COLORS[edge.category]
                  }
                  strokeWidth={
                    ((active ? 3 : 1.5) * options.lineSize) / Math.sqrt(view.k)
                  }
                  markerEnd={
                    options.arrows && view.k > 0.08
                      ? `url(#${arrowId})`
                      : undefined
                  }
                  strokeDasharray={
                    edge.confidence === "EXTRACTED"
                      ? undefined
                      : edge.confidence === "INFERRED"
                        ? "7 4"
                        : "2 5"
                  }
                />
                {(Boolean(focus) ||
                  active ||
                  (options.layout !== "analysis" && labelOpacity > 0.6)) && (
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
            const original = originals.get(node.id);
            // Filtered data changes before the asynchronous layout finishes.
            if (!original) return null;
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                transform={`translate(${node.x},${node.y})`}
                opacity={focus && !neighbors.has(node.id) ? 0.18 : 1}
                className="cursor-pointer"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextNode(node.id);
                }}
                onDoubleClick={() => onFocusNode?.(node.id)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (event.button !== 0 || busy) return;
                  const start = point(event.clientX, event.clientY);
                  if (registerPointer(event.pointerId, start)) return;
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
                <circle
                  r={node.radius * options.nodeSize + 9}
                  fill="transparent"
                />
                <circle
                  r={node.radius * options.nodeSize}
                  fill={colors.get(node.id) ?? COLORS[original.category]}
                  stroke="var(--foreground)"
                  strokeWidth={selected === `node:${node.id}` ? 3 : 1}
                />
                {original.role && (
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={Math.max(7, node.radius * options.nodeSize)}
                    fill="var(--background)"
                    pointerEvents="none"
                  >
                    {legalRoleLabels[original.role].slice(0, 1)}
                  </text>
                )}
                <text
                  x={
                    options.layout === "analysis"
                      ? 0
                      : node.x > 450
                        ? -node.radius - 8
                        : node.radius + 8
                  }
                  textAnchor={
                    options.layout === "analysis"
                      ? "middle"
                      : node.x > 450
                        ? "end"
                        : "start"
                  }
                  y={
                    options.layout === "analysis"
                      ? node.radius + 22 * labelScale
                      : 5
                  }
                  fontSize={18 * labelScale}
                  fill="var(--foreground)"
                  stroke="var(--background)"
                  strokeWidth={4}
                  paintOrder="stroke"
                  opacity={focus === node.id ? 1 : labelOpacity}
                >
                  {options.layout === "analysis" ? (
                    <>
                      <tspan x={0}>
                        {[...original.label].slice(0, 8).join("")}
                      </tspan>
                      {[...original.label].length > 8 && (
                        <tspan x={0} dy={22 * labelScale}>
                          {[...original.label].slice(8, 16).join("")}
                          {[...original.label].length > 16 ? "…" : ""}
                        </tspan>
                      )}
                    </>
                  ) : (
                    <>
                      {[...original.label].slice(0, 18).join("")}
                      {[...original.label].length > 18 ? "…" : ""}
                    </>
                  )}
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
      <p className="text-muted-foreground px-3 py-2 text-[11px]">
        实线：材料明示 · 虚线：模型推断 ·
        点线：存疑；支持与相反关系保留具体名称。所有状态均不表示司法认定。
      </p>
    </div>
  );
}
