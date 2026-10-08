"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCitation, type OcrCitation } from "@/core/law";
import {
  legalGraphCategories,
  legalGraphConfidenceLabels,
  type LegalGraph,
  type LegalGraphSource,
} from "@/core/law/legal-graph";
import {
  editLegalGraph,
  legalGraphCategoryLabels as categories,
  legalGraphNodeTypeLabels as nodeTypes,
} from "@/core/law/legal-graph-editing";
import { timelineEntries } from "@/core/law/legal-graph-layout";

import { LegalGraphCanvas } from "./legal-graph-canvas";
import { LegalGraphEditor, type GraphEditorTarget } from "./legal-graph-editor";
import { LegalGraphSourceMapping } from "./legal-graph-source-mapping";

type Scope = { tenant_id: string; matter_id: string };
const sourceStateLabels: Record<OcrCitation["source_state"], string> = {
  available: "来源可用",
  archived: "原材料已归档",
  legal_hold: "原材料保全中",
  purge_pending: "原材料待清除",
  purge_failed: "原材料清除失败",
  purged: "原材料已清除",
};

export function LegalGraphViewer({
  graph,
  scope,
  onChange,
}: {
  graph: LegalGraph;
  scope?: Scope;
  onChange?: (graph: LegalGraph) => void;
}) {
  const [mode, setMode] = useState<"canvas" | "timeline" | "list">("list");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selection, setSelection] = useState<string | null>(null);
  const [editor, setEditor] = useState<GraphEditorTarget | null>(null);
  const [mappingId, setMappingId] = useState<string | null>(null);
  const mappingSource = graph.sources.find((source) => source.id === mappingId);
  const oldMappingSource =
    mappingSource?.kind === "citation"
      ? mappingSource.legacy_origin
      : mappingSource;
  const [editError, setEditError] = useState("");
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setMode("canvas");
  }, []);
  const visible = useMemo(() => {
    const matching = new Set(
      graph.nodes
        .filter(
          (node) =>
            (category === "all" || node.category === category) &&
            node.label.toLowerCase().includes(query.toLowerCase()),
        )
        .map((node) => node.id),
    );
    const matchingEdges = graph.edges.filter(
      (edge) =>
        (category === "all" || edge.category === category) &&
        (edge.label.toLowerCase().includes(query.toLowerCase()) ||
          matching.has(edge.source) ||
          matching.has(edge.target)),
    );
    for (const edge of matchingEdges) {
      matching.add(edge.source);
      matching.add(edge.target);
    }
    return {
      ...graph,
      nodes: graph.nodes.filter((node) => matching.has(node.id)),
      edges: matchingEdges,
    };
  }, [graph, query, category]);
  const node = visible.nodes.find((item) => selection === `node:${item.id}`);
  const edge = visible.edges.find((item) => selection === `edge:${item.id}`);
  const selected = node ?? edge;
  const sources = graph.sources.filter((source) =>
    selected?.source_ids.includes(source.id),
  );
  const names = new Map(graph.nodes.map((item) => [item.id, item.label]));
  const timeline = timelineEntries(visible.nodes);
  function select(kind: "node" | "edge", id: string) {
    setSelection(`${kind}:${id}`);
  }
  return (
    <section
      aria-label="案情图谱"
      className="flex size-full min-h-0 min-w-0 flex-col overflow-y-auto"
    >
      <header className="shrink-0 space-y-2 border-b p-3">
        <h2 className="font-medium break-words">{graph.title}</h2>
        <p className="text-muted-foreground text-xs">
          {graph.nodes.length} 个节点 · {graph.edges.length} 条关系 ·
          材料明示不等于事实认定，模型结果须人工复核。
        </p>
        {onChange && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">
              正在编辑草稿 ·
              文件保存后再保存到项目；事件按日期排列，其他节点可拖动固定。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditor({ kind: "title" })}
              >
                修改图谱名称
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={graph.nodes.length >= 500}
                onClick={() =>
                  setEditor({
                    kind: "node",
                    create: true,
                    value: {
                      id: `node_${crypto.randomUUID()}`,
                      label: "",
                      type: "other",
                      category: "custom",
                      source_ids: [],
                    },
                  })
                }
              >
                新增节点
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!graph.nodes.length || graph.edges.length >= 2000}
                onClick={() =>
                  setEditor({
                    kind: "edge",
                    create: true,
                    value: {
                      id: `edge_${crypto.randomUUID()}`,
                      label: "",
                      source: graph.nodes[0]!.id,
                      target: graph.nodes[1]?.id ?? graph.nodes[0]!.id,
                      category: "custom",
                      confidence: "AMBIGUOUS",
                      source_ids: [],
                    },
                  })
                }
              >
                新增关系
              </Button>
            </div>
          </div>
        )}
        {editError && (
          <p role="alert" className="text-destructive text-sm">
            {editError}
          </p>
        )}
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="图谱视图"
        >
          {(
            [
              ["canvas", "关系画布"],
              ["timeline", "时间线"],
              ["list", "节点与关系"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={mode === key ? "secondary" : "ghost"}
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            aria-label="搜索图谱节点或关系"
            placeholder="搜索节点或关系…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-32 flex-1"
          />
          <select
            aria-label="图谱关系分层"
            className="bg-background max-w-full rounded-md border p-2 text-sm"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">全部图层</option>
            {legalGraphCategories.map((key) => (
              <option key={key} value={key}>
                {categories[key]}
              </option>
            ))}
          </select>
        </div>
      </header>
      {!visible.nodes.length ? (
        <p role="status" className="p-4 text-sm">
          {graph.nodes.length
            ? "没有匹配的节点或关系。"
            : "图谱为空。可由法律任务抽取材料后生成节点与关系。"}
        </p>
      ) : mode === "canvas" ? (
        <LegalGraphCanvas
          graph={visible}
          selected={selection}
          onSelect={select}
          onMoveNode={
            onChange
              ? (id, position) => {
                  try {
                    onChange(
                      editLegalGraph(graph, { kind: "position", id, position }),
                    );
                    setEditError("");
                  } catch (error) {
                    setEditError(
                      error instanceof Error ? error.message : "无法固定位置。",
                    );
                  }
                }
              : undefined
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {mode === "timeline" ? (
            timeline.length ? (
              <ol aria-label="事件时间线" className="space-y-3 border-l pl-4">
                {timeline.map(({ node: entry, label }) => (
                  <li key={entry.id}>
                    <button
                      className="hover:bg-muted focus-visible:ring-ring w-full cursor-pointer rounded-md border p-3 text-left focus-visible:ring-2"
                      onClick={() => select("node", entry.id)}
                    >
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block break-words">{entry.label}</span>
                      <span className="text-muted-foreground text-xs">
                        {entry.date?.origin === "legacy_inferred"
                          ? "旧版日期（依据待核验）"
                          : entry.date?.origin === "user"
                            ? "用户提供日期"
                            : entry.date
                              ? "材料日期，保留原精度"
                              : "材料未提供日期"}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p>当前图层没有事件节点。</p>
            )
          ) : (
            <>
              <h3 className="mb-2 text-sm font-medium">
                节点（{visible.nodes.length}）
              </h3>
              <ul className="space-y-2">
                {visible.nodes.map((item) => (
                  <li key={item.id}>
                    <button
                      className="hover:bg-muted focus-visible:ring-ring w-full cursor-pointer rounded-md border p-3 text-left focus-visible:ring-2"
                      onClick={() => select("node", item.id)}
                    >
                      <span className="block break-words">{item.label}</span>
                      <span className="text-muted-foreground text-xs">
                        {nodeTypes[item.type]} · {categories[item.category]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <h3 className="my-3 text-sm font-medium">
                关系（{visible.edges.length}）
              </h3>
              <ul className="space-y-2">
                {visible.edges.map((item) => (
                  <li key={item.id}>
                    <button
                      className="hover:bg-muted focus-visible:ring-ring w-full cursor-pointer rounded-md border p-3 text-left focus-visible:ring-2"
                      onClick={() => select("edge", item.id)}
                    >
                      <span className="block break-words">
                        {names.get(item.source)} → {item.label} →{" "}
                        {names.get(item.target)}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {legalGraphConfidenceLabels[item.confidence]}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {selected && (
        <aside
          aria-label="图谱详情"
          className="max-h-[40%] shrink-0 space-y-2 overflow-y-auto border-t p-3"
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-medium break-words">{selected.label}</h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelection(null)}
            >
              关闭详情
            </Button>
          </div>
          {edge && (
            <p className="text-sm">
              {legalGraphConfidenceLabels[edge.confidence]}
            </p>
          )}
          {onChange && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setEditor(
                    node
                      ? { kind: "node", value: node }
                      : { kind: "edge", value: edge! },
                  )
                }
              >
                {node ? "编辑节点" : "编辑关系"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const count = node
                    ? graph.edges.filter(
                        (edge) =>
                          edge.source === node.id || edge.target === node.id,
                      ).length
                    : 0;
                  if (
                    !window.confirm(
                      node
                        ? `从草稿删除此节点及其 ${count} 条关联关系？已保存历史版本不变。`
                        : "从草稿删除此关系？已保存历史版本不变。",
                    )
                  )
                    return;
                  onChange(
                    editLegalGraph(
                      graph,
                      node
                        ? { kind: "delete-node", id: node.id }
                        : { kind: "delete-edge", id: edge!.id },
                    ),
                  );
                  setSelection(null);
                }}
              >
                {node ? "删除节点" : "删除关系"}
              </Button>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            来源（{sources.length}）：
            {!sources.length && "未提供依据，不能据此认定事实。"}
          </p>
          {sources.map((source) => (
            <GraphSource
              key={`${selection}:${source.id}`}
              source={source}
              scope={scope}
              onMap={
                onChange && scope ? () => setMappingId(source.id) : undefined
              }
            />
          ))}
        </aside>
      )}
      {editor && (
        <LegalGraphEditor
          graph={graph}
          target={editor}
          onChange={onChange}
          onClose={() => setEditor(null)}
        />
      )}
      {oldMappingSource && scope && (
        <LegalGraphSourceMapping
          key={`${scope.tenant_id}:${scope.matter_id}:${oldMappingSource.id}`}
          graph={graph}
          source={oldMappingSource}
          scope={scope}
          onChange={onChange}
          onClose={() => setMappingId(null)}
        />
      )}
    </section>
  );
}

function GraphSource({
  source,
  scope,
  onMap,
}: {
  source: LegalGraphSource;
  scope?: Scope;
  onMap?: () => void;
}) {
  const [citation, setCitation] = useState<OcrCitation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setCitation(null);
    setError("");
  }, [source, scope?.tenant_id, scope?.matter_id]);
  // Result is scoped to this mounted source; no persistent/query cache of legal text.
  useEffect(() => {
    if (!loading || source.kind !== "citation" || !scope) return;
    let alive = true;
    const request = new AbortController();
    void getCitation(
      scope.tenant_id,
      scope.matter_id,
      source.evidence_item_id,
      source.evidence_version_id,
      source.citation_id,
      request.signal,
    )
      .then((value) => {
        if (alive) setCitation(value);
      })
      .catch(() => {
        if (alive) setError("引用已不可用或无权访问，未显示缓存正文。");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      request.abort();
    };
  }, [loading, scope?.tenant_id, scope?.matter_id, source, scope]);
  if (source.kind !== "citation")
    return (
      <div className="rounded-md border p-2 text-sm">
        <p className="text-muted-foreground">
          {source.kind === "legacy_unmapped"
            ? "旧来源待映射（未核验）"
            : "自报摘录（未核验）"}
        </p>
        {source.reference && <p className="break-all">{source.reference}</p>}
        {source.quote && (
          <blockquote className="break-words whitespace-pre-wrap">
            {source.quote}
          </blockquote>
        )}
        {onMap && (
          <Button size="sm" variant="outline" onClick={onMap}>
            关联项目引用
          </Button>
        )}
      </div>
    );
  return (
    <div className="space-y-2 rounded-md border p-2 text-sm">
      {source.legacy_origin && (
        <details className="text-sm">
          <summary className="cursor-pointer">
            关联前的旧来源记录（未核验）
          </summary>
          <p className="break-all">{source.legacy_origin.reference}</p>
          <blockquote className="break-words whitespace-pre-wrap">
            {source.legacy_origin.quote}
          </blockquote>
          {onMap && (
            <Button size="sm" variant="outline" onClick={onMap}>
              重新关联项目引用
            </Button>
          )}
        </details>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={!scope || loading}
        onClick={() => {
          setCitation(null);
          setError("");
          setLoading(true);
        }}
      >
        {loading ? "正在核验引用…" : "核验并查看引用"}
      </Button>
      {!scope && <p>项目归属尚未确认，不能读取来源。</p>}
      {error && <p role="alert">{error}</p>}
      {citation && (
        <>
          <p role="status">
            第 {citation.physical_page_number} 页 ·{" "}
            {sourceStateLabels[citation.source_state] ?? "原材料状态未知"} ·{" "}
            {citation.source_type === "proofreading_publication"
              ? citation.publication_state === "current"
                ? "当前校对发布版"
                : "历史校对发布版"
              : citation.ocr_result_state === "superseded"
                ? "历史 OCR 版本"
                : "当前 OCR 版本"}
          </p>
          {(citation.source_state !== "available" ||
            citation.ocr_result_state === "superseded" ||
            citation.publication_state === "superseded") && (
            <p className="text-muted-foreground text-xs">
              以下为创建引用时保留的原文，不会随 OCR
              重跑改写；能否读取原材料须另行核验。
            </p>
          )}
          <blockquote className="break-words whitespace-pre-wrap">
            {citation.quote_text}
          </blockquote>
        </>
      )}
    </div>
  );
}
