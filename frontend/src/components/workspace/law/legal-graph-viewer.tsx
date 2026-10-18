"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

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
import {
  defaultGraphExplorerOptions,
  exploreLegalGraph,
  graphPresentationView,
  graphRevealOrder,
  type GraphExplorerOptions,
} from "@/core/law/legal-graph-explorer";
import { timelineEntries } from "@/core/law/legal-graph-layout";
import {
  legalFamilyLabels,
  legalGraphQuestions,
  legalNodeRole,
  legalRoleLabels,
  legalStatementLabels,
  legalKindLabels,
} from "@/core/law/legal-graph-semantics";

import { LegalGraphAnalysisEditor } from "./legal-graph-analysis-editor";
import { LegalGraphCanvas } from "./legal-graph-canvas";
import { LegalGraphControls } from "./legal-graph-controls";
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
  const [presentationView, setPresentationView] = useState<string | null>(
    graph.presentation?.default_view_id ?? null,
  );
  const [options, setOptions] = useState<GraphExplorerOptions>(() => ({
    ...defaultGraphExplorerOptions,
    layout:
      graph.presentation?.views.find(
        (view) => view.id === graph.presentation?.default_view_id,
      )?.layout ?? "force",
    arrows: Boolean(graph.presentation),
    groups: [],
  }));
  const presentationSignature = JSON.stringify(graph.presentation);
  const appliedPresentation = useRef(presentationSignature);
  useEffect(() => {
    if (appliedPresentation.current === presentationSignature) return;
    appliedPresentation.current = presentationSignature;
    setPresentationView(graph.presentation?.default_view_id ?? null);
    setQuery("");
    setCategory("all");
    setOptions({
      ...defaultGraphExplorerOptions,
      groups: [],
      arrows: Boolean(graph.presentation),
      layout:
        graph.presentation?.views.find(
          (view) => view.id === graph.presentation?.default_view_id,
        )?.layout ?? "force",
    });
  }, [presentationSignature, graph.presentation]);
  const selectedPresentation = graph.presentation?.views.find(
    (view) => view.id === presentationView,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [frameworksOpen, setFrameworksOpen] = useState(false);
  const [analysisEditing, setAnalysisEditing] = useState(false);
  const [questionLimit, setQuestionLimit] = useState(50);
  const queryFieldsId = useId();
  const [reveal, setReveal] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const container = useRef<HTMLElement>(null);
  const questions = useMemo(() => legalGraphQuestions(graph), [graph]);
  const revealOrder = useMemo(() => graphRevealOrder(graph), [graph]);
  const [displayError, setDisplayError] = useState("");
  useEffect(() => {
    setOptions((current) => {
      const root =
        current.root && !graph.nodes.some((node) => node.id === current.root)
          ? null
          : current.root;
      const framework =
        current.framework !== "all" &&
        !graph.analysis?.frameworks?.some(
          (frame) => frame.id === current.framework,
        )
          ? "all"
          : current.framework;
      return root === current.root && framework === current.framework
        ? current
        : { ...current, root, framework };
    });
  }, [graph]);
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
  const composed = useMemo(
    () => graphPresentationView(graph, presentationView),
    [graph, presentationView],
  );
  const explored = useMemo(
    () => exploreLegalGraph(composed, query, category, options),
    [composed, query, category, options],
  );
  const visible = useMemo(() => {
    if (reveal === null || options.root) return explored.graph;
    const ids = new Set(revealOrder.slice(0, reveal));
    return {
      ...explored.graph,
      nodes: explored.graph.nodes.filter((node) => ids.has(node.id)),
      edges: explored.graph.edges.filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
    };
  }, [explored.graph, reveal, revealOrder, options.root]);
  useEffect(() => {
    if (!playing || options.root) return;
    const timer = window.setInterval(
      () =>
        setReveal((current) => {
          const next = Math.min(
            graph.nodes.length,
            (current ?? 0) + Math.max(1, Math.ceil(graph.nodes.length / 40)),
          );
          if (next >= graph.nodes.length) setPlaying(false);
          return next;
        }),
      150,
    );
    return () => window.clearInterval(timer);
  }, [playing, options.root, graph.nodes.length]);
  function focusNode(id: string) {
    setPresentationView(null);
    setOptions((value) => ({ ...value, root: id }));
    setSelection(`node:${id}`);
    setMode("canvas");
    setReveal(null);
    setPlaying(false);
  }
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
      ref={container}
      aria-label="案情图谱"
      className="bg-background relative flex size-full min-h-0 min-w-0 flex-col overflow-y-auto"
    >
      <header className="shrink-0 space-y-2 border-b p-3">
        <h2 className="font-medium break-words">{graph.title}</h2>
        <p className="text-muted-foreground text-xs">
          {graph.nodes.length} 个节点 · {graph.edges.length} 条关系 ·
          材料明示不等于事实认定，模型结果须人工复核。
        </p>
        {graph.presentation && (
          <div
            aria-label="AI 图谱编排"
            className="space-y-2 rounded-md border p-2 text-xs"
          >
            <p className="font-medium">AI 已按本案编排关系、主题视图和配色</p>
            <p className="whitespace-pre-wrap">{graph.presentation.summary}</p>
            <label className="grid gap-1">
              查看本案重点
              <select
                aria-label="AI 编排主题"
                className="bg-background rounded-md border p-2"
                value={presentationView ?? ""}
                onChange={(event) => {
                  const id = event.target.value || null;
                  const view = graph.presentation!.views.find(
                    (view) => view.id === id,
                  );
                  setPresentationView(id);
                  setQuery("");
                  setCategory("all");
                  setReveal(null);
                  setPlaying(false);
                  setOptions({
                    ...defaultGraphExplorerOptions,
                    groups: [],
                    arrows: true,
                    layout: view?.layout ?? "force",
                  });
                }}
              >
                <option value="">完整图谱（全部节点与关系）</option>
                {graph.presentation.views.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.label}
                  </option>
                ))}
              </select>
            </label>
            {selectedPresentation && (
              <p className="whitespace-pre-wrap">
                {selectedPresentation.description}
              </p>
            )}
            <p className="text-muted-foreground">
              主题筛选只调整显示；下方可继续手动微调。分组不代表事实认定或法律结论。
            </p>
            <ul
              aria-label="AI 配色图例"
              className="flex flex-wrap gap-x-3 gap-y-1"
            >
              {graph.presentation.groups.map((group) => (
                <li key={group.id} className="flex items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="size-3 rounded-full border"
                    style={{ backgroundColor: group.color }}
                  />
                  {group.label}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPresentationView(graph.presentation!.default_view_id);
                  setQuery("");
                  setCategory("all");
                  setReveal(null);
                  setPlaying(false);
                  setOptions({
                    ...defaultGraphExplorerOptions,
                    groups: [],
                    arrows: true,
                    layout:
                      graph.presentation!.views.find(
                        (view) =>
                          view.id === graph.presentation!.default_view_id,
                      )?.layout ?? "force",
                  });
                }}
              >
                恢复 AI 编排
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setPresentationView(null);
                  setQuery("");
                  setCategory("all");
                  setReveal(null);
                  setPlaying(false);
                  setOptions({
                    ...defaultGraphExplorerOptions,
                    groups: [],
                    arrows: true,
                  });
                }}
              >
                查看完整图谱
              </Button>
            </div>
          </div>
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
        {graph.presentation && (
          <p className="text-muted-foreground text-xs" aria-live="polite">
            当前 {visible.nodes.length} 个节点 / {visible.edges.length} 条关系
            {options.root
              ? " · 局部图"
              : selectedPresentation
                ? " · AI 主题视图"
                : " · 全图"}
            {` · 总计 ${graph.nodes.length} 个节点 / ${graph.edges.length} 条关系`}
          </p>
        )}
        <details
          open={!graph.presentation || Boolean(onChange)}
          className="space-y-2"
          onToggle={(event) => {
            if (!event.currentTarget.open) {
              setFrameworksOpen(false);
              setQuestionsOpen(false);
              setSettingsOpen(false);
            }
          }}
        >
          <summary className="text-muted-foreground cursor-pointer text-xs">
            手动调整与专业筛选
          </summary>
          {graph.analysis && (
            <details className="rounded-md border p-2 text-xs">
              <summary className="cursor-pointer font-medium">
                本案分析基线：{graph.analysis.case_labels.join(" / ")}
              </summary>
              <p className="text-muted-foreground mt-2">
                当前图谱声明的案由／罪名框架 ·{" "}
                {graph.analysis.element_node_ids.length} 个待审查要件 ·{" "}
                {graph.analysis.framework_source_ids.length}{" "}
                个框架来源。来源绑定和框架适用性仍须律师复核。
              </p>
              <p className="text-muted-foreground mt-1">
                登记案由／罪名：{graph.analysis.registered_cause ?? "未登记"} ·
                案件版本 {graph.analysis.matter_version}
              </p>
              {graph.analysis.notes.map((note, index) => (
                <p key={index} className="mt-1 whitespace-pre-wrap">
                  {note}
                </p>
              ))}
            </details>
          )}
          {Boolean(graph.analysis?.frameworks?.length) && (
            <label className="grid gap-1 text-xs">
              本案案由／罪名框架
              <select
                aria-label="本案案由或罪名框架"
                className="bg-background w-full rounded-md border p-2"
                value={options.framework}
                onChange={(event) => {
                  setPresentationView(null);
                  setOptions((value) => ({
                    ...value,
                    root: null,
                    framework: event.target.value,
                  }));
                }}
              >
                <option value="all">对照全部候选框架</option>
                {graph.analysis!.frameworks!.map((frame) => (
                  <option key={frame.id} value={frame.id}>
                    {frame.case_label} · {frame.label}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">
                各框架分别对应本案争点、要件与关系；选择框架不会认定案由或罪名成立。
              </span>
            </label>
          )}
          {onChange && (
            <div className="space-y-2">
              <p className="text-muted-foreground text-xs">
                正在编辑草稿 ·
                文件保存后再保存到项目；时间线保留日期顺序，关系画布可自由探索，非事件节点可保存固定位置。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!scope}
                  onClick={() => setAnalysisEditing(true)}
                >
                  管理分析框架
                </Button>
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
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="图谱布局方式"
              className="bg-background max-w-full rounded-md border p-2 text-sm"
              value={options.layout}
              onChange={(event) =>
                setOptions((value) => ({
                  ...value,
                  layout: event.target.value as GraphExplorerOptions["layout"],
                }))
              }
            >
              <option value="force">自由关系图</option>
              <option value="analysis">法律分析链</option>
            </select>
            <Input
              aria-label="搜索图谱节点或关系"
              placeholder="搜索节点或关系…"
              list={queryFieldsId}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-32 flex-1"
            />
            <datalist id={queryFieldsId}>
              {[
                "role:issue",
                "role:element",
                "role:claim",
                "role:defense",
                "family:proof",
                "kind:contradicts",
                "statement:party_assertion",
                "confidence:AMBIGUOUS",
                "type:evidence",
              ].map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
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
          <div
            role="group"
            aria-label="法律分析视角"
            className="flex flex-wrap gap-1"
          >
            {[
              ["all", "全部关系"],
              ...Object.entries(legalFamilyLabels),
              ["unclassified", "待细分关系"],
            ].map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant={options.family === key ? "secondary" : "ghost"}
                aria-pressed={options.family === key}
                onClick={() => {
                  setPresentationView(null);
                  setOptions((value) => ({
                    ...value,
                    root: null,
                    family: key!,
                  }));
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!graph.presentation && (
              <span className="text-muted-foreground mr-auto text-xs">
                当前 {visible.nodes.length} 个节点 / {visible.edges.length}{" "}
                条关系
                {options.root
                  ? " · 局部图"
                  : selectedPresentation
                    ? " · AI 主题视图"
                    : " · 全图"}
              </span>
            )}
            {options.root && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setOptions((value) => ({ ...value, root: null }))
                }
              >
                返回全图
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen((value) => !value)}
            >
              图谱设置
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={questionsOpen}
              onClick={() => setQuestionsOpen((value) => !value)}
            >
              待核查切入点（{questions.length}）
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const element = container.current;
                if (!element) return;
                const action = document.fullscreenElement
                  ? document.exitFullscreen()
                  : element.requestFullscreen?.();
                void action?.catch(() =>
                  setDisplayError("当前浏览器未能进入全屏，请使用工作区展开。"),
                );
              }}
            >
              图谱全屏
            </Button>
            {!options.root && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!graph.nodes.length}
                onClick={() => {
                  setReveal((value) =>
                    value === null || value >= graph.nodes.length ? 1 : value,
                  );
                  setPlaying((value) => !value);
                }}
              >
                {playing ? "暂停展开" : "逐步展开"}
              </Button>
            )}
            {reveal !== null && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPlaying(false);
                  setReveal(null);
                }}
              >
                显示完整图谱
              </Button>
            )}
          </div>
          {reveal !== null && (
            <label className="grid gap-1 text-xs">
              展开进度（按已声明事件日期，再展示无日期节点）
              <input
                aria-label="图谱展开进度"
                type="range"
                min={1}
                max={Math.max(1, graph.nodes.length)}
                value={Math.min(reveal, graph.nodes.length)}
                onChange={(event) => {
                  setPlaying(false);
                  setReveal(Number(event.target.value));
                }}
              />
            </label>
          )}
          {(explored.error ?? displayError) && (
            <p role="alert" className="text-destructive text-xs">
              {explored.error ?? displayError}
            </p>
          )}
          {!graph.analysis && (
            <p className="text-muted-foreground text-xs">
              旧图谱尚无案由／罪名分析基线；专业关系按已有结构显示，未标注内容保留为待细分。
            </p>
          )}
          {settingsOpen && (
            <div className="bg-background absolute top-2 right-2 z-20 w-80 max-w-[calc(100%-1rem)] rounded-lg border p-1 shadow-lg">
              <Button
                size="sm"
                variant="ghost"
                className="mb-1 w-full"
                onClick={() => setSettingsOpen(false)}
              >
                关闭图谱设置
              </Button>
              <LegalGraphControls
                graph={graph}
                options={options}
                onChange={setOptions}
              />
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={frameworksOpen}
            onClick={() => setFrameworksOpen((value) => !value)}
          >
            框架与依据
          </Button>
          {frameworksOpen && (
            <aside
              aria-label="法律分析框架"
              className="max-h-80 space-y-3 overflow-y-auto rounded-md border p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium">本案法律分析框架</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setFrameworksOpen(false)}
                >
                  关闭框架详情
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                以下为本图谱记录的候选分析，来源需重新核验；选择或修改框架不构成律师审核。
              </p>
              {!graph.analysis && (
                <p>尚未建立专业分析框架，可在编辑草稿中结合本案详情补充。</p>
              )}
              {graph.analysis && (
                <>
                  <p>本轮候选：{graph.analysis.case_labels.join(" / ")}</p>
                  {graph.analysis.framework_source_ids
                    .map((id) =>
                      graph.sources.find((source) => source.id === id),
                    )
                    .map(
                      (source) =>
                        source && (
                          <GraphSource
                            key={`${scope?.tenant_id}:${scope?.matter_id}:basis:${JSON.stringify(source)}`}
                            source={source}
                            scope={scope}
                          />
                        ),
                    )}
                  {(graph.analysis.frameworks ?? [])
                    .filter(
                      (frame) =>
                        options.framework === "all" ||
                        frame.id === options.framework,
                    )
                    .map((frame) => (
                      <section
                        key={frame.id}
                        aria-label={frame.label}
                        className="space-y-2 rounded-md border p-3"
                      >
                        <h4 className="font-medium">
                          {frame.case_label} · {frame.label}
                        </h4>
                        <p className="text-muted-foreground text-xs">
                          {
                            graph.edges.filter((edge) =>
                              edge.legal?.framework_ids?.includes(frame.id),
                            ).length
                          }{" "}
                          条专业关系 · {frame.source_ids.length} 个来源
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {[
                            ...frame.issue_node_ids,
                            ...frame.element_node_ids,
                          ].map((id) => (
                            <Button
                              key={id}
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setQuery("");
                                setCategory("all");
                                setOptions((current) => ({
                                  ...defaultGraphExplorerOptions,
                                  groups: current.groups,
                                  layout: current.layout,
                                }));
                                focusNode(id);
                                setFrameworksOpen(false);
                              }}
                            >
                              {names.get(id)}
                            </Button>
                          ))}
                        </div>
                        {!frame.source_ids.length && (
                          <p className="text-xs text-amber-700 dark:text-amber-400">
                            此框架尚未关联依据，需核对适用规范。
                          </p>
                        )}
                        {frame.source_ids
                          .map((id) =>
                            graph.sources.find((source) => source.id === id),
                          )
                          .map(
                            (source) =>
                              source && (
                                <GraphSource
                                  key={`${scope?.tenant_id}:${scope?.matter_id}:${frame.id}:${JSON.stringify(source)}`}
                                  source={source}
                                  scope={scope}
                                />
                              ),
                          )}
                      </section>
                    ))}
                </>
              )}
            </aside>
          )}
          {questionsOpen && (
            <aside
              aria-label="待核查切入点"
              className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3"
            >
              <p className="text-muted-foreground text-xs">
                以下是图谱结构缺口和已记录的问题，不代表材料不存在、举证责任结论或法律意见。
              </p>
              {!questions.length && (
                <p className="text-xs">
                  当前未记录结构性问题；不等于案情或证据已经完整。
                </p>
              )}
              {questions.slice(0, questionLimit).map((question) => (
                <button
                  key={question.id}
                  className="hover:bg-muted focus-visible:ring-ring block w-full cursor-pointer rounded p-2 text-left text-xs focus-visible:ring-2"
                  onClick={() => {
                    setPresentationView(null);
                    setQuery("");
                    setCategory("all");
                    setReveal(null);
                    setPlaying(false);
                    setOptions((current) => ({
                      ...defaultGraphExplorerOptions,
                      groups: current.groups,
                      layout: current.layout,
                    }));
                    if (question.nodeId) focusNode(question.nodeId);
                    else if (question.edgeId) {
                      setSelection(`edge:${question.edgeId}`);
                      setMode("list");
                    }
                  }}
                >
                  {question.text}
                </button>
              ))}
              {questions.length > questionLimit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setQuestionLimit((current) => current + 50)}
                >
                  再显示 50 项（共 {questions.length} 项）
                </Button>
              )}
            </aside>
          )}
        </details>
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
          options={options}
          onFocusNode={focusNode}
          onSelect={select}
          onMoveNode={
            onChange && options.layout === "force"
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
          {node && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground text-xs">
                法律角色：{legalRoleLabels[legalNodeRole(node)]}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => focusNode(node.id)}
              >
                以此为中心查看
              </Button>
            </div>
          )}
          {edge?.legal && (
            <div className="space-y-1 rounded-md border p-2 text-xs">
              <p>
                {legalFamilyLabels[edge.legal.family]} ·{" "}
                {legalKindLabels[edge.legal.kind]} ·{" "}
                {legalStatementLabels[edge.legal.statement]}
              </p>
              {edge.legal.asserted_by && (
                <p>主张主体：{names.get(edge.legal.asserted_by)}</p>
              )}
              {edge.legal.issue_ids.length > 0 && (
                <p>
                  关联争点：
                  {edge.legal.issue_ids.map((id) => names.get(id)).join("、")}
                </p>
              )}
              {edge.legal.questions.map((question, index) => (
                <p key={index}>待核查：{question}</p>
              ))}
            </div>
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
              key={`${scope?.tenant_id ?? ""}:${scope?.matter_id ?? ""}:${selection}:${JSON.stringify(source)}`}
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
      {analysisEditing && scope && (
        <LegalGraphAnalysisEditor
          key={`${scope.tenant_id}:${scope.matter_id}`}
          graph={graph}
          scope={scope}
          onChange={onChange}
          onClose={() => setAnalysisEditing(false)}
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
