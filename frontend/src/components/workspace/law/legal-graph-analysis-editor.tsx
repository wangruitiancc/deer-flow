"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getMatter, type Matter } from "@/core/law";
import { type LegalGraph } from "@/core/law/legal-graph";
import { editLegalGraph } from "@/core/law/legal-graph-editing";

type Scope = { tenant_id: string; matter_id: string };
type Analysis = NonNullable<LegalGraph["analysis"]>;
type Framework = NonNullable<Analysis["frameworks"]>[number];
type Choice = { id: string; label: string };
const stageLabels: Record<Matter["stage"], string> = {
  intake: "接案",
  analysis: "分析",
  drafting: "文书起草",
  litigation: "诉讼进行中",
  closed: "结案",
};

function Choices({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: string[];
  choices: Choice[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      {label}
      <select
        multiple
        aria-label={label}
        value={value}
        size={Math.min(5, Math.max(2, choices.length))}
        className="bg-background min-h-20 w-full min-w-0 rounded-md border p-2"
        onChange={(event) =>
          onChange(
            Array.from(event.target.selectedOptions, (option) => option.value),
          )
        }
      >
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
      {!choices.length && (
        <span className="text-muted-foreground text-xs">
          当前没有可关联的条目，可先补充对应节点或来源。
        </span>
      )}
    </label>
  );
}

export function LegalGraphAnalysisEditor({
  graph,
  scope,
  onChange,
  onClose,
}: {
  graph: LegalGraph;
  scope: Scope;
  onChange?: (graph: LegalGraph) => void;
  onClose: () => void;
}) {
  const [baseline] = useState(graph);
  const [initialScope] = useState(scope);
  const [labels, setLabels] = useState(graph.analysis?.case_labels ?? [""]);
  const [notes, setNotes] = useState(graph.analysis?.notes ?? []);
  const [frames, setFrames] = useState<Framework[]>(
    graph.analysis?.frameworks ?? [],
  );
  const [sources, setSources] = useState(
    graph.analysis?.framework_source_ids ?? [],
  );
  const [elements, setElements] = useState(
    graph.analysis?.element_node_ids ?? [],
  );
  const [memberships, setMemberships] = useState(() =>
    graph.edges
      .filter((edge) => edge.legal)
      .map((edge) => ({
        edgeId: edge.id,
        frameworkIds: edge.legal?.framework_ids ?? [],
      })),
  );
  const initialForm = useRef(
    JSON.stringify({ labels, notes, frames, sources, elements, memberships }),
  );
  const dirty =
    initialForm.current !==
    JSON.stringify({ labels, notes, frames, sources, elements, memberships });
  const [matter, setMatter] = useState<Matter | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const latest = useRef({ graph, scope, onChange });
  latest.current = { graph, scope, onChange };
  const stale =
    graph !== baseline ||
    scope.tenant_id !== initialScope.tenant_id ||
    scope.matter_id !== initialScope.matter_id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (stale) {
      request.current?.abort();
      setMatter(null);
      setConfirmed(false);
      setLoading(false);
      setSaving(false);
    }
  }, [stale]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const assertCurrent = useCallback(
    (controller: AbortController) => {
      controller.signal.throwIfAborted();
      const current = latest.current;
      if (
        !mounted.current ||
        current.graph !== baseline ||
        current.scope.tenant_id !== initialScope.tenant_id ||
        current.scope.matter_id !== initialScope.matter_id ||
        !current.onChange
      )
        throw new Error("图谱、项目或编辑状态已变化，请关闭后重新打开。");
      return current;
    },
    [baseline, initialScope],
  );
  const loadMatter = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setMatter(null);
    setConfirmed(false);
    setError("");
    setLoading(true);
    try {
      const value = await getMatter(
        initialScope.tenant_id,
        initialScope.matter_id,
        controller.signal,
      );
      assertCurrent(controller);
      if (
        value.id !== initialScope.matter_id ||
        value.tenant_id !== initialScope.tenant_id ||
        value.status !== "active" ||
        !Number.isSafeInteger(value.version) ||
        value.version < 1
      )
        throw new Error("当前案件不可编辑或基线信息不完整。");
      setMatter(value);
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current)
        setError(cause instanceof Error ? cause.message : "无法读取当前案件。");
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }, [assertCurrent, initialScope]);
  useEffect(() => {
    void loadMatter();
    return () => request.current?.abort();
  }, [loadMatter]);

  function close() {
    if (!dirty || window.confirm("放弃尚未应用的分析框架修改？")) {
      request.current?.abort();
      onClose();
    }
  }
  function changeFrame(id: string, patch: Partial<Framework>) {
    setFrames((values) =>
      values.map((frame) => (frame.id === id ? { ...frame, ...patch } : frame)),
    );
    setConfirmed(false);
  }
  async function apply() {
    if (!matter || !confirmed || saving || loading || stale || !onChange)
      return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setSaving(true);
    setError("");
    let metadataRead = false;
    try {
      const fresh = await getMatter(
        initialScope.tenant_id,
        initialScope.matter_id,
        controller.signal,
      );
      metadataRead = true;
      const current = assertCurrent(controller);
      if (
        fresh.id !== initialScope.matter_id ||
        fresh.tenant_id !== initialScope.tenant_id ||
        fresh.status !== "active" ||
        !Number.isSafeInteger(fresh.version) ||
        fresh.version < 1
      ) {
        setMatter(null);
        setConfirmed(false);
        throw new Error("当前案件已不可编辑，请关闭后重新核对。");
      }
      if (fresh.version !== matter.version || fresh.cause !== matter.cause) {
        setMatter(fresh);
        setConfirmed(false);
        throw new Error(
          "案件信息又发生变化，已更新对照；请重新核对框架后再应用。",
        );
      }
      const value: Analysis = {
        case_labels: labels,
        notes,
        frameworks: frames,
        framework_source_ids: sources,
        element_node_ids: elements,
        registered_cause: fresh.cause,
        matter_version: fresh.version,
      };
      current.onChange?.(
        editLegalGraph(baseline, { kind: "analysis", value, memberships }),
      );
      onClose();
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) {
        if (!metadataRead) {
          setMatter(null);
          setConfirmed(false);
        }
        setError(cause instanceof Error ? cause.message : "无法应用分析框架。");
      }
    } finally {
      if (!controller.signal.aborted && mounted.current) setSaving(false);
    }
  }
  const nodeChoices = (role: "issue" | "element") =>
    graph.nodes
      .filter((node) => node.role === role)
      .map((node) => ({ id: node.id, label: node.label }));
  const sourceChoices = graph.sources.map((source) => ({
    id: source.id,
    label: `${source.id} · ${source.kind === "citation" ? "正式引用（打开时重新核验）" : "未核验来源"}`,
  }));
  const edgeChoices = graph.edges
    .filter((edge) => edge.legal)
    .map((edge) => ({ id: edge.id, label: edge.label }));
  const changedBasis =
    !baseline.analysis ||
    baseline.analysis.matter_version !== matter?.version ||
    baseline.analysis.registered_cause !== matter?.cause;
  const disabled = stale || saving || loading || !onChange;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] min-w-0 flex-col overflow-hidden sm:max-w-3xl"
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <DialogHeader>
          <DialogTitle>管理法律分析框架</DialogTitle>
          <DialogDescription>
            结合本案详情核对候选案由、罪名和分析依据。应用只修改当前草稿，保存与律师审核沿用现有流程。
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <section
            aria-label="案件基线对照"
            className="space-y-2 rounded-md border p-3 text-sm"
          >
            <p>
              图谱原基线：
              {baseline.analysis
                ? `${baseline.analysis.registered_cause ?? "未登记"} · 案件版本 ${baseline.analysis.matter_version}`
                : "尚未建立"}
            </p>
            {matter && (
              <p>
                当前案件：{matter.title} · {matter.cause ?? "未登记案由／罪名"}{" "}
                · 案件版本 {matter.version} · 阶段{" "}
                {stageLabels[matter.stage] ?? "待核对"}
              </p>
            )}
            {changedBasis && matter && (
              <p className="text-amber-700 dark:text-amber-400">
                分析基线需要重新核对。请检查本案事实、争点、要件和适用依据，再使用当前案件基线。
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={stale || saving || loading}
              onClick={() => void loadMatter()}
            >
              {loading ? "正在读取案件…" : "重新读取案件信息"}
            </Button>
          </section>
          <fieldset disabled={disabled} className="min-w-0 space-y-4">
            <div className="space-y-2">
              <h3 className="text-sm font-medium">本轮候选案由／罪名</h3>
              {labels.map((label, index) => (
                <div key={index} className="flex items-start gap-2">
                  <label className="grid min-w-0 flex-1 gap-1 text-sm">
                    候选案由／罪名 {index + 1}
                    <textarea
                      rows={1}
                      maxLength={240}
                      value={label}
                      onChange={(event) => {
                        setLabels((values) =>
                          values.map((value, i) =>
                            i === index ? event.target.value : value,
                          ),
                        );
                        setConfirmed(false);
                      }}
                      className="bg-background w-full rounded-md border p-2"
                    />
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`移除候选案由／罪名 ${index + 1}`}
                    onClick={() => {
                      setLabels((values) =>
                        values.filter((_, i) => i !== index),
                      );
                      setConfirmed(false);
                    }}
                  >
                    移除
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                disabled={labels.length >= 8}
                onClick={() => {
                  setLabels((values) => [...values, ""]);
                  setConfirmed(false);
                }}
              >
                添加候选案由／罪名
              </Button>
            </div>
            <Choices
              label="本轮框架依据"
              value={sources}
              choices={sourceChoices}
              onChange={(ids) => {
                setSources(ids);
                setConfirmed(false);
              }}
            />
            <Choices
              label="本轮关注要件"
              value={elements}
              choices={nodeChoices("element")}
              onChange={(ids) => {
                setElements(ids);
                setConfirmed(false);
              }}
            />
            <p className="text-muted-foreground text-xs">
              可关联已有的争点、要件和专业关系。未细分专业类型的关系需先在关系编辑中补充；来源关联不代表法律适用性或事实已经核验。
            </p>
            {frames.map((frame, index) => (
              <section
                key={frame.id}
                aria-label={`候选框架 ${index + 1}`}
                className="min-w-0 space-y-3 rounded-md border p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">候选框架 {index + 1}</h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setFrames((values) =>
                        values.filter((item) => item.id !== frame.id),
                      );
                      setMemberships((values) =>
                        values.map((item) => ({
                          ...item,
                          frameworkIds: item.frameworkIds.filter(
                            (id) => id !== frame.id,
                          ),
                        })),
                      );
                      setConfirmed(false);
                    }}
                  >
                    移除此框架
                  </Button>
                </div>
                <label className="grid gap-1 text-sm">
                  框架名称 {index + 1}
                  <Input
                    value={frame.label}
                    maxLength={240}
                    onChange={(event) =>
                      changeFrame(frame.id, { label: event.target.value })
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  框架 {index + 1} 所属案由／罪名
                  <select
                    value={frame.case_label}
                    onChange={(event) =>
                      changeFrame(frame.id, { case_label: event.target.value })
                    }
                    className="bg-background w-full rounded-md border p-2"
                  >
                    <option value="">请选择本轮候选</option>
                    {!labels.includes(frame.case_label) && frame.case_label && (
                      <option value={frame.case_label}>
                        {frame.case_label}（已不在本轮候选中）
                      </option>
                    )}
                    {labels.map(
                      (label, i) =>
                        label && (
                          <option key={i} value={label}>
                            {label}
                          </option>
                        ),
                    )}
                  </select>
                </label>
                <Choices
                  label={`框架 ${index + 1} 争点`}
                  value={frame.issue_node_ids}
                  choices={nodeChoices("issue")}
                  onChange={(ids) =>
                    changeFrame(frame.id, { issue_node_ids: ids })
                  }
                />
                <Choices
                  label={`框架 ${index + 1} 要件`}
                  value={frame.element_node_ids}
                  choices={nodeChoices("element")}
                  onChange={(ids) =>
                    changeFrame(frame.id, { element_node_ids: ids })
                  }
                />
                <Choices
                  label={`框架 ${index + 1} 来源`}
                  value={frame.source_ids}
                  choices={sourceChoices}
                  onChange={(ids) => changeFrame(frame.id, { source_ids: ids })}
                />
                <Choices
                  label={`框架 ${index + 1} 专业关系`}
                  value={memberships
                    .filter((item) => item.frameworkIds.includes(frame.id))
                    .map((item) => item.edgeId)}
                  choices={edgeChoices}
                  onChange={(ids) => {
                    setMemberships((values) =>
                      values.map((item) => ({
                        ...item,
                        frameworkIds: ids.includes(item.edgeId)
                          ? [...new Set([...item.frameworkIds, frame.id])]
                          : item.frameworkIds.filter((id) => id !== frame.id),
                      })),
                    );
                    setConfirmed(false);
                  }}
                />
              </section>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={frames.length >= 8}
              onClick={() => {
                setFrames((values) => [
                  ...values,
                  {
                    id: `frame_${crypto.randomUUID()}`,
                    label: "",
                    case_label: labels[0] ?? "",
                    source_ids: [],
                    element_node_ids: [],
                    issue_node_ids: [],
                  },
                ]);
                setConfirmed(false);
              }}
            >
              添加候选框架
            </Button>
            <p className="text-muted-foreground text-xs">
              移除框架只解除其归属，事实、节点、关系和来源继续保留在全图中。
            </p>
            <div className="space-y-2">
              <h3 className="text-sm font-medium">适用范围与待核验事项</h3>
              {notes.map((note, index) => (
                <label key={index} className="grid gap-1 text-sm">
                  分析说明 {index + 1}
                  <textarea
                    rows={2}
                    value={note}
                    maxLength={1000}
                    className="bg-background w-full rounded-md border p-2"
                    onChange={(event) => {
                      setNotes((values) =>
                        values.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      );
                      setConfirmed(false);
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setNotes((values) =>
                        values.filter((_, i) => i !== index),
                      );
                      setConfirmed(false);
                    }}
                  >
                    移除分析说明 {index + 1}
                  </Button>
                </label>
              ))}
              <Button
                size="sm"
                variant="outline"
                disabled={notes.length >= 16}
                onClick={() => {
                  setNotes((values) => [...values, ""]);
                  setConfirmed(false);
                }}
              >
                添加分析说明
              </Button>
            </div>
          </fieldset>
        </div>
        <footer className="shrink-0 space-y-2 border-t pt-3">
          {stale && (
            <p role="alert" className="text-destructive text-sm">
              图谱或项目已变化，请关闭后重新打开；未应用表单。
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm break-words">
              {error}
            </p>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={disabled || !matter}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            已对照本案详情核对本轮候选框架及适用范围
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={close}>
              取消
            </Button>
            <Button
              disabled={disabled || !matter || !confirmed || !labels.length}
              onClick={() => void apply()}
            >
              {saving ? "正在重新核对…" : "应用分析框架到草稿"}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
