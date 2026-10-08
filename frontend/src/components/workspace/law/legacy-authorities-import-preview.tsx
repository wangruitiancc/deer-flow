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
import { MAX_LEGAL_AUTHORITIES_BYTES } from "@/core/law/legal-authorities";
import { convertLegacyLawRefs } from "@/core/law/legal-authorities-import";

const LegalAuthoritiesViewer = dynamic(
  () =>
    import("./legal-authorities-viewer").then(
      (module) => module.LegalAuthoritiesViewer,
    ),
  { ssr: false, loading: () => <p role="status">正在加载法律依据预览…</p> },
);

export type LegacyAuthoritiesPreview = Awaited<
  ReturnType<typeof convertLegacyLawRefs>
>;

function Downloads({ preview }: { preview: LegacyAuthoritiesPreview }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = [preview.content, JSON.stringify(preview.report, null, 2)].map(
      (text) =>
        URL.createObjectURL(new Blob([text], { type: "application/json" })),
    );
    setUrls(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
  }, [preview]);
  return (
    <div className="flex flex-wrap gap-2">
      {urls.length === 2 && (
        <>
          <Button asChild size="sm" variant="outline">
            <a href={urls[0]} download="converted.law-authorities.json">
              下载转换依据
            </a>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={urls[1]} download="law-refs.import-report.json">
              下载完整迁移报告
            </a>
          </Button>
        </>
      )}
    </div>
  );
}

export function LegacyAuthoritiesImportPreview({
  onStage,
  blocked,
  targetLabel,
}: {
  onStage: (
    preview: LegacyAuthoritiesPreview,
    signal: AbortSignal,
  ) => Promise<void>;
  blocked?: string;
  targetLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<LegacyAuthoritiesPreview | null>(null);
  const [filename, setFilename] = useState("");
  const [pending, setPending] = useState(false);
  const [staging, setStaging] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      request.current?.abort();
    },
    [],
  );

  function reset() {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setPreview(null);
    setFilename("");
    setConfirmed(false);
    setError("");
    setPending(false);
    setStaging(false);
  }
  function changeOpen(next: boolean) {
    if (!next) reset();
    setOpen(next);
  }
  async function read(file?: File) {
    reset();
    if (!file) return;
    const current = generation.current;
    setPending(true);
    try {
      if (!file.size || file.size > MAX_LEGAL_AUTHORITIES_BYTES)
        throw new Error("文件为空或超过 2 MiB，未读取或上传。");
      const bytes = await file.arrayBuffer();
      if (current !== generation.current) return;
      const result = await convertLegacyLawRefs(new Uint8Array(bytes), {
        title: "旧法条收藏（待核验）",
        question: "旧收藏迁移；法律适用问题待明确。",
      });
      if (current !== generation.current) return;
      setFilename(file.name);
      setPreview(result);
    } catch (cause) {
      if (current === generation.current)
        setError(
          cause instanceof Error ? cause.message : "读取失败，请重新选择文件。",
        );
    } finally {
      if (current === generation.current) setPending(false);
    }
  }
  async function stage() {
    if (!preview || !confirmed || blocked || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setStaging(true);
    setError("");
    try {
      await onStage(preview, controller.signal);
      if (!controller.signal.aborted) changeOpen(false);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setConfirmed(false);
        setError(
          cause instanceof Error
            ? cause.message
            : "无法放入草稿，请重新核对后重试。",
        );
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setStaging(false);
      }
    }
  }
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={Boolean(blocked)}
        title={blocked}
        onClick={() => setOpen(true)}
      >
        导入旧法条收藏
      </Button>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogContent className="flex max-h-[90dvh] min-h-0 flex-col overflow-hidden sm:max-w-4xl">
          <DialogHeader className="shrink-0 pr-5">
            <DialogTitle>导入旧法条收藏</DialogTitle>
            <DialogDescription>
              本地预览不上传。确认仅放入会话草稿，点击发送才上传并运行；不覆盖原件、不自动保存项目成果。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto [overflow-wrap:anywhere]">
            <label className="grid gap-2 text-sm">
              选择旧项目 .case/law-refs.json（最多 2 MiB）
              <input
                type="file"
                accept=".json,application/json"
                disabled={staging}
                className="w-full min-w-0 file:mr-2 file:cursor-pointer file:rounded file:border file:px-2 file:py-2"
                onChange={(event) => {
                  void read(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            {pending && <p role="status">正在本地转换，尚未上传…</p>}
            {preview && (
              <>
                <p className="text-sm">已读取：{filename}</p>
                <p role="status" className="text-sm">
                  {preview.report.entries_total} 条记录 ·{" "}
                  {preview.report.missing_body_count} 条缺正文 ·{" "}
                  {preview.report.duplicate_name_article_count}{" "}
                  条同名同条号（全部保留）
                </p>
                <Downloads preview={preview} />
                <ul className="text-muted-foreground list-inside list-disc space-y-1 text-sm">
                  {preview.report.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                <details className="rounded-md border p-3 text-sm">
                  <summary className="cursor-pointer">
                    完整原始文件与对应报告（含私人信息）
                  </summary>
                  <pre className="mt-2 [overflow-wrap:anywhere] whitespace-pre-wrap">
                    {JSON.stringify(preview.report, null, 2)}
                  </pre>
                </details>
                <div className="h-[45dvh] min-h-64 overflow-hidden rounded-md border">
                  <LegalAuthoritiesViewer document={preview.authorities} />
                </div>
              </>
            )}
          </div>
          <div className="shrink-0 space-y-2 border-t pt-3 text-sm [overflow-wrap:anywhere]">
            <p>目标法律项目：{targetLabel ?? "核验中…"} · 当前会话</p>
            {blocked && <p role="status">{blocked}</p>}
            {error && (
              <p
                role="alert"
                className="text-destructive max-h-20 overflow-y-auto"
              >
                {error}
              </p>
            )}
            {preview && (
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1 shrink-0"
                  checked={confirmed}
                  disabled={staging}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我已核对目标与隐私；将完整原始记录报告和转换依据交给当前会话，所有条目仍待核验。
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!preview || !confirmed || staging || Boolean(blocked)}
                onClick={() => void stage()}
              >
                {staging ? "正在核验会话…" : "放入当前会话草稿"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => changeOpen(false)}
              >
                关闭预览
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
