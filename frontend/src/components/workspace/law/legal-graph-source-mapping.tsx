"use client";

import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCitation,
  listCitations,
  listEvidence,
  listEvidenceVersions,
  type EvidenceItem,
  type EvidenceVersion,
  type OcrCitation,
} from "@/core/law";
import { type LegalGraph, type LegalGraphSource } from "@/core/law/legal-graph";
import { editLegalGraph } from "@/core/law/legal-graph-editing";

type Scope = { tenant_id: string; matter_id: string };
type OldSource = Exclude<LegalGraphSource, { kind: "citation" }>;

export function LegalGraphSourceMapping({
  graph,
  source,
  scope,
  onChange,
  onClose,
}: {
  graph: LegalGraph;
  source: OldSource;
  scope: Scope;
  onChange?: (graph: LegalGraph) => void;
  onClose: () => void;
}) {
  const [baseline] = useState(graph);
  const [initialScope] = useState(scope);
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [versions, setVersions] = useState<EvidenceVersion[]>([]);
  const [citations, setCitations] = useState<OcrCitation[]>([]);
  const [itemId, setItemId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [citationId, setCitationId] = useState("");
  const [loaded, setLoaded] = useState<OcrCitation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const latest = useRef({ graph, scope, onChange });
  latest.current = { graph, scope, onChange };
  const id = useId();
  const stale =
    graph !== baseline ||
    scope.tenant_id !== initialScope.tenant_id ||
    scope.matter_id !== initialScope.matter_id;
  const affectedNodes = graph.nodes.filter((node) =>
    node.source_ids.includes(source.id),
  ).length;
  const affectedEdges = graph.edges.filter((edge) =>
    edge.source_ids.includes(source.id),
  ).length;
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading("materials");
    void listEvidence(scope.tenant_id, scope.matter_id, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setItems(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("无法读取当前项目材料，请关闭后重试。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading("");
      });
    return () => controller.abort();
  }, [scope.tenant_id, scope.matter_id]);

  async function chooseItem(value: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setItemId(value);
    setVersionId("");
    setCitationId("");
    setVersions([]);
    setCitations([]);
    setLoaded(null);
    setConfirmed(false);
    setError("");
    if (!value) {
      setLoading("");
      return;
    }
    setLoading("versions");
    try {
      const result = await listEvidenceVersions(
        scope.tenant_id,
        scope.matter_id,
        value,
        controller.signal,
      );
      if (!controller.signal.aborted) setVersions(result);
    } catch {
      if (!controller.signal.aborted) setError("材料版本不可用或无权访问。");
    } finally {
      if (!controller.signal.aborted) setLoading("");
    }
  }
  async function chooseVersion(value: string) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setVersionId(value);
    setCitationId("");
    setCitations([]);
    setLoaded(null);
    setConfirmed(false);
    setError("");
    if (!value) {
      setLoading("");
      return;
    }
    setLoading("citations");
    try {
      const result = await listCitations(
        scope.tenant_id,
        scope.matter_id,
        itemId,
        value,
        controller.signal,
      );
      if (!controller.signal.aborted) setCitations(result);
    } catch {
      if (!controller.signal.aborted) setError("无法读取所选版本的引用。");
    } finally {
      if (!controller.signal.aborted) setLoading("");
    }
  }
  async function readCitation(apply = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const previous = loaded;
    setLoaded(null);
    setError("");
    setLoading(apply ? "apply" : "quote");
    try {
      const citation = await getCitation(
        scope.tenant_id,
        scope.matter_id,
        itemId,
        versionId,
        citationId,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (
        citation.id !== citationId ||
        citation.evidence_item_id !== itemId ||
        citation.evidence_version_id !== versionId ||
        !citation.quote_text
      )
        throw new Error("引用身份或完整原文缺失，不能关联。");
      const current = latest.current;
      if (
        current.graph !== baseline ||
        current.scope.tenant_id !== initialScope.tenant_id ||
        current.scope.matter_id !== initialScope.matter_id
      )
        throw new Error("图谱或项目已变化，请重新打开。");
      setLoaded(citation);
      if (apply) {
        if (
          !confirmed ||
          citation.quote_text !== previous?.quote_text ||
          citation.source_state !== previous?.source_state ||
          citation.source_type !== previous?.source_type ||
          citation.ocr_result_state !== previous?.ocr_result_state ||
          citation.publication_state !== previous?.publication_state
        ) {
          setConfirmed(false);
          throw new Error("引用正文或来源状态已变化，请重新核对并确认。");
        }
        if (
          current.graph !== baseline ||
          current.scope.tenant_id !== initialScope.tenant_id ||
          current.scope.matter_id !== initialScope.matter_id ||
          !current.onChange
        )
          throw new Error("图谱或编辑状态已变化，未应用映射，请重新打开。");
        current.onChange(
          editLegalGraph(current.graph, {
            kind: "map-source",
            id: source.id,
            citation: {
              citation_id: citation.id,
              evidence_item_id: citation.evidence_item_id,
              evidence_version_id: citation.evidence_version_id,
            },
          }),
        );
        onClose();
      } else setConfirmed(false);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "引用不可用或无权访问。",
        );
    } finally {
      if (!controller.signal.aborted) setLoading("");
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          request.current?.abort();
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>将旧来源关联到项目引用</DialogTitle>
          <DialogDescription>
            只选择当前项目中已有的证据引用，不按同名文件自动匹配。影响{" "}
            {affectedNodes} 个节点、{affectedEdges}{" "}
            条关系；只修改草稿，之后仍需保存文件和项目版本。
          </DialogDescription>
        </DialogHeader>
        <section
          className="rounded-md border p-3 text-sm"
          aria-label="原始旧来源"
        >
          <h3 className="font-medium">旧路径与摘录（未核验，映射后仍保留）</h3>
          <p className="break-all">{source.reference ?? "未提供路径"}</p>
          <blockquote className="break-words whitespace-pre-wrap">
            {source.quote ?? "未提供摘录"}
          </blockquote>
        </section>
        <div className="grid gap-3 text-sm">
          <label htmlFor={`${id}-item`}>当前项目材料</label>
          <select
            id={`${id}-item`}
            className="bg-background min-w-0 rounded-md border p-2"
            value={itemId}
            disabled={stale || loading === "apply" || loading === "materials"}
            onChange={(event) => void chooseItem(event.target.value)}
          >
            <option value="">请选择材料</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {item.status}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-version`}>证据版本</label>
          <select
            id={`${id}-version`}
            className="bg-background min-w-0 rounded-md border p-2"
            value={versionId}
            disabled={
              stale || !itemId || loading === "versions" || loading === "apply"
            }
            onChange={(event) => void chooseVersion(event.target.value)}
          >
            <option value="">请选择版本</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                第 {version.version_number} 版 · {version.original_filename}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-citation`}>已有引用</label>
          <select
            id={`${id}-citation`}
            className="bg-background min-w-0 rounded-md border p-2"
            value={citationId}
            disabled={
              stale ||
              !versionId ||
              loading === "citations" ||
              loading === "apply"
            }
            onChange={(event) => {
              request.current?.abort();
              setLoading("");
              setCitationId(event.target.value);
              setLoaded(null);
              setConfirmed(false);
              setError("");
            }}
          >
            <option value="">请选择引用</option>
            {citations.map((citation) => (
              <option key={citation.id} value={citation.id}>
                第 {citation.physical_page_number} 页 ·{" "}
                {citation.source_type === "proofreading_publication"
                  ? "校对发布版 · "
                  : "OCR · "}
                {citation.quote_preview ?? citation.id}
              </option>
            ))}
          </select>
          {versionId && !loading && citations.length === 0 && (
            <p>
              该版本暂无已有引用；请先在材料工作台建立并核对引用，不能直接用旧摘录创建可信来源。
            </p>
          )}
        </div>
        <Button
          variant="outline"
          disabled={!citationId || Boolean(loading) || stale}
          onClick={() => void readCitation()}
        >
          读取受保护原文
        </Button>
        {loading && <p role="status">正在读取并核验…</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {stale && <p role="alert">图谱或项目已变化，请关闭后重新打开。</p>}
        {loaded && (
          <section
            aria-label="所选引用原文"
            className="rounded-md border p-3 text-sm"
          >
            <p>
              第 {loaded.physical_page_number} 页 ·{" "}
              {loaded.source_state === "available"
                ? "来源可用"
                : `原材料状态：${loaded.source_state}`}{" "}
              ·{" "}
              {loaded.ocr_result_state === "current"
                ? "当前 OCR 版本"
                : "历史 OCR 版本"}
            </p>
            <blockquote className="max-h-48 overflow-y-auto break-words whitespace-pre-wrap">
              {loaded.quote_text}
            </blockquote>
            <p className="text-muted-foreground mt-2">
              此处为创建引用时保存的原文。人工关联不改变事实认定、日期依据或审核状态。
            </p>
          </section>
        )}
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!loaded || Boolean(loading) || stale}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          我已核对上述原文与旧来源，确认将相关节点和关系关联到此引用。
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              !loaded || !confirmed || Boolean(loading) || stale || !onChange
            }
            onClick={() => void readCitation(true)}
          >
            确认关联到图谱草稿
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              request.current?.abort();
              onClose();
            }}
          >
            取消
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
