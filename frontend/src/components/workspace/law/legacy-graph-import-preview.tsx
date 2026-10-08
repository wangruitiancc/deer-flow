"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAX_LEGAL_GRAPH_BYTES } from "@/core/law/legal-graph";
import {
  convertLegacyGraph,
  serializeLegacyGraphPreview,
  type LegacyGraphPreviewData,
} from "@/core/law/legal-graph-import";

const LegalGraphViewer = dynamic(
  () =>
    import("./legal-graph-viewer").then((module) => module.LegalGraphViewer),
  { ssr: false, loading: () => <p role="status">正在加载图谱视图…</p> },
);

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function Downloads({ preview }: { preview: LegacyGraphPreviewData }) {
  const [urls, setUrls] = useState<{ graph: string; report: string } | null>(
    null,
  );
  useEffect(() => {
    const serialized = serializeLegacyGraphPreview(preview);
    const graph = URL.createObjectURL(
      new Blob([serialized.graph], {
        type: "application/json",
      }),
    );
    const report = URL.createObjectURL(
      new Blob([serialized.report], { type: "application/json" }),
    );
    setUrls({ graph, report });
    return () => {
      URL.revokeObjectURL(graph);
      URL.revokeObjectURL(report);
    };
  }, [preview]);
  return (
    <div className="flex flex-wrap gap-2">
      {urls && (
        <>
          <Button asChild size="sm">
            <a href={urls.graph} download="converted.law-graph.json">
              下载转换图谱
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={urls.report} download="graph-import-report.json">
              下载完整迁移报告
            </a>
          </Button>
        </>
      )}
    </div>
  );
}

export function LegacyGraphImportPreview({
  onStage,
  stageBlockedReason,
  targetLabel,
}: {
  onStage?: (
    preview: LegacyGraphPreviewData,
    signal: AbortSignal,
  ) => Promise<void>;
  stageBlockedReason?: string;
  targetLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<LegacyGraphPreviewData | null>(null);
  const [staging, setStaging] = useState(false);
  const stageRequest = useRef<AbortController | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      stageRequest.current?.abort();
    },
    [],
  );

  async function read(file: File | undefined) {
    const current = ++generation.current;
    setPreview(null);
    setError("");
    setPending(Boolean(file));
    if (!file) return;
    try {
      if (file.size > MAX_LEGAL_GRAPH_BYTES)
        throw new Error("文件超过 2 MiB，未读取或上传。");
      const bytes = await file.arrayBuffer();
      if (generation.current !== current) return;
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error("文件不是有效 UTF-8 文本；请先导出为 UTF-8 JSON。");
      }
      const converted = convertLegacyGraph(content, "旧版案情图谱（待核验）");
      const sourceSha256 = await sha256(bytes);
      const graphSha256 = await sha256(
        new TextEncoder().encode(JSON.stringify(converted.graph, null, 2))
          .buffer,
      );
      if (generation.current === current)
        setPreview({
          ...converted,
          filename: file.name,
          sourceSha256,
          graphSha256,
        });
    } catch (cause) {
      if (generation.current === current)
        setError(
          cause instanceof Error ? cause.message : "无法转换文件，请重新选择。",
        );
    } finally {
      if (generation.current === current) setPending(false);
    }
  }
  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      generation.current++;
      stageRequest.current?.abort();
      setStaging(false);
      setPreview(null);
      setPending(false);
      setError("");
    }
  }
  async function stage() {
    if (!preview || !onStage || staging || stageBlockedReason) return;
    const request = new AbortController();
    stageRequest.current = request;
    setStaging(true);
    setError("");
    try {
      await onStage(preview, request.signal);
      if (!request.signal.aborted) changeOpen(false);
    } catch (cause) {
      if (!request.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "无法放入会话草稿，请重试。",
        );
    } finally {
      if (!request.signal.aborted) setStaging(false);
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        转换旧图谱
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>转换旧版案情图谱</DialogTitle>
            <DialogDescription>
              预览和下载仅在当前浏览器内进行。“放入会话草稿”也不上传；只有在会话中点击发送后才上传并运行。不覆盖原文件，不自动保存为项目成果。
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm">
            选择旧项目 03-知识图谱/graph.json（最多 2 MiB）
            <input
              type="file"
              accept=".json,application/json"
              disabled={staging}
              className="file:mr-3 file:cursor-pointer file:rounded file:border file:px-3 file:py-2"
              onChange={(event) => {
                void read(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {pending && <p role="status">正在转换本地文件…</p>}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {preview && (
            <>
              <p className="text-sm break-all">已读取：{preview.filename}</p>
              <p role="status" className="text-sm">
                {preview.graph.nodes.length} 个节点 ·{" "}
                {preview.graph.edges.length} 条关系 ·{" "}
                {preview.report.unmappedSources} 个待映射旧来源 ·{" "}
                {preview.report.unverifiedQuotes} 个未核验摘录 ·{" "}
                {preview.report.edgesWithoutSources} 条无来源关系
              </p>
              <p className="text-muted-foreground text-sm">
                ID
                已重新编号，对应表及原案件标识仅保留在报告，不决定新项目归属。日期保持原精度并标为旧版待核验；没有给节点补造来源。
              </p>
              <Downloads preview={preview} />
              {onStage && (
                <div className="space-y-2 rounded-md border p-3 text-sm">
                  <p>目标法律项目：{targetLabel ?? "核验中…"} · 当前会话</p>
                  <p className="text-muted-foreground">
                    将图谱与报告放入原生附件区，不覆盖已有输入。旧材料不会自动上传；来源仍需确认与映射。
                  </p>
                  {stageBlockedReason && (
                    <p role="status">{stageBlockedReason}</p>
                  )}
                  <Button
                    size="sm"
                    disabled={staging || Boolean(stageBlockedReason)}
                    onClick={() => void stage()}
                  >
                    {staging ? "正在核验会话…" : "放入当前会话草稿"}
                  </Button>
                </div>
              )}
              <details className="rounded-md border p-3 text-sm">
                <summary className="cursor-pointer">
                  转换提示（{preview.report.notices.length} 条；完整报告含全部
                  ID 对应表）
                </summary>
                <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                  {preview.report.notices.map((notice, index) => (
                    <li key={index} className="break-words">
                      {notice.location}：{notice.reason}
                      {notice.original !== undefined && (
                        <pre className="break-all whitespace-pre-wrap">
                          {typeof notice.original === "string"
                            ? notice.original
                            : JSON.stringify(notice.original)}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
              <div className="h-[55dvh] min-h-64 overflow-hidden rounded-md border">
                <LegalGraphViewer graph={preview.graph} />
              </div>
              <p className="text-muted-foreground text-sm">
                这是转换预览，不是已导入项目。原始证据文件不会随图谱迁移；旧路径仅作为文本展示，不打开本机路径或外部链接。
              </p>
            </>
          )}
          <Button variant="outline" onClick={() => changeOpen(false)}>
            关闭预览
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
