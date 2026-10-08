"use client";

import {
  AlertTriangleIcon,
  CheckIcon,
  Code2Icon,
  EyeIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SaveIcon,
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownRichEditor } from "@/components/workspace/artifacts/markdown-rich-editor";
import { getVisualMarkdownUnsupportedReason } from "@/core/artifacts/visual-markdown";
import type { Locale } from "@/core/i18n/locale";
import type { OcrBlock, OcrPageDraft } from "@/core/law";
import {
  useLawOcrPageDraft,
  useReviewLawOcrPageDraft,
  useSaveLawOcrPageDraft,
} from "@/core/law/hooks";
import { cn } from "@/lib/utils";

import { sourceSpanAtSelection, uniqueSourceSpans } from "./ocr-source-mapping";

const COPY = {
  "en-US": {
    title: "Proofread text",
    visual: "Visual",
    markdown: "Markdown",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    saved: "Saved",
    reviewed: "Reviewed",
    save: "Save now",
    markReviewed: "Mark page reviewed",
    sourceChanged:
      "A newer OCR candidate exists. Your saved draft is preserved and was not overwritten.",
    conflict:
      "This page changed elsewhere. Your local text is preserved; reload before choosing how to merge it.",
    loadFailed: "The proofreading draft could not be loaded.",
    retry: "Reload server version",
    empty: "This OCR page has no recognized text yet.",
    sourceOnly:
      "This page contains formatting the visual editor cannot preserve. Edit the original Markdown here.",
  },
  "zh-CN": {
    title: "校对文字",
    visual: "可视化",
    markdown: "Markdown",
    unsaved: "有未保存修改",
    saving: "正在保存…",
    saved: "已保存",
    reviewed: "本页已校对",
    save: "保存修改",
    markReviewed: "确认本页校对完成",
    sourceChanged:
      "检测到新的 OCR 候选结果；现有校对稿已保留，没有被自动覆盖。",
    conflict:
      "这页已被其他窗口修改。本地文字仍保留，请重新加载服务端版本后人工合并。",
    loadFailed: "无法加载本页校对稿。",
    retry: "重新加载服务端版本",
    empty: "本页尚无可校对的识别文字。",
    sourceOnly:
      "本页包含可视化编辑器无法保真的格式，请在 Markdown 源码中校对。",
  },
} as const;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export type OcrProofreadingEditorHandle = {
  save: () => Promise<void>;
  isDirty: () => boolean;
};

type OcrProofreadingEditorProps = {
  tenantId: string;
  matterId: string;
  evidenceItemId: string;
  evidenceVersionId: string;
  physicalPageNumber: number;
  ocrJobId: string;
  locale: Locale;
  sourceBlocks?: Array<Pick<OcrBlock, "id" | "text">>;
  sourceFocusRequest?: { id: string; sequence: number } | null;
  onSourceBlockFocus?: (blockId: string | null) => void;
  onScrollContainerChange?: (element: HTMLElement | null) => void;
  className?: string;
};

export const OcrProofreadingEditor = forwardRef<
  OcrProofreadingEditorHandle,
  OcrProofreadingEditorProps
>(function OcrProofreadingEditor(
  {
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersionId,
    physicalPageNumber,
    ocrJobId,
    locale,
    sourceBlocks = [],
    sourceFocusRequest,
    onSourceBlockFocus,
    onScrollContainerChange,
    className,
  },
  ref,
) {
  const copy = COPY[locale];
  const query = useLawOcrPageDraft(
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersionId,
    physicalPageNumber,
    ocrJobId,
  );
  const saveMutation = useSaveLawOcrPageDraft(
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersionId,
    physicalPageNumber,
    ocrJobId,
  );
  const reviewMutation = useReviewLawOcrPageDraft(
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersionId,
    physicalPageNumber,
    ocrJobId,
  );
  const [mode, setMode] = useState<"visual" | "markdown">("visual");
  const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const setSourceEditor = useCallback(
    (element: HTMLTextAreaElement | null) => {
      sourceEditorRef.current = element;
      onScrollContainerChange?.(element);
    },
    [onScrollContainerChange],
  );
  const [value, setValue] = useState("");
  const [dirty, setDirty] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const valueRef = useRef(value);
  const dirtyRef = useRef(dirty);
  const versionRef = useRef(0);
  const saveInFlightRef = useRef<Promise<OcrPageDraft | null> | null>(null);
  const sourceAnchors = useMemo(
    () => sourceBlocks.map((block) => ({ id: block.id, text: block.text })),
    [sourceBlocks],
  );
  const sourceSpans = useMemo(
    () => uniqueSourceSpans(value, sourceAnchors),
    [value, sourceAnchors],
  );

  useEffect(() => {
    if (mode !== "markdown" || !sourceFocusRequest) return;
    const span = sourceSpans.find((item) => item.id === sourceFocusRequest.id);
    const source = sourceEditorRef.current;
    if (!span || !source) return;
    source.focus();
    source.setSelectionRange(span.start, span.end);
  }, [mode, sourceFocusRequest, sourceSpans]);

  const focusSourceAtCaret = () => {
    const source = sourceEditorRef.current;
    if (!source) return;
    onSourceBlockFocus?.(
      sourceSpanAtSelection(
        sourceSpans,
        source.selectionStart,
        source.selectionEnd,
      )?.id ?? null,
    );
  };

  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    const draft = query.data;
    if (!draft || dirtyRef.current) return;
    setValue(draft.markdown_text);
    setMode(
      getVisualMarkdownUnsupportedReason(draft.markdown_text)
        ? "markdown"
        : "visual",
    );
    valueRef.current = draft.markdown_text;
    versionRef.current = draft.version;
    setHydrated(true);
  }, [query.data]);

  const saveNow = useCallback(async () => {
    if (saveInFlightRef.current) return saveInFlightRef.current;
    if (!dirtyRef.current) return query.data ?? null;
    const pending = saveMutation
      .mutateAsync({
        markdownText: valueRef.current,
        expectedVersion: versionRef.current,
      })
      .then((saved) => {
        versionRef.current = saved.version;
        if (saved.markdown_text === valueRef.current) {
          dirtyRef.current = false;
          setDirty(false);
        }
        return saved;
      });
    saveInFlightRef.current = pending;
    try {
      return await pending;
    } finally {
      if (saveInFlightRef.current === pending) saveInFlightRef.current = null;
    }
  }, [query.data, saveMutation]);

  useImperativeHandle(
    ref,
    () => ({
      save: async () => {
        await saveNow();
      },
      isDirty: () => dirtyRef.current,
    }),
    [saveNow],
  );

  useEffect(() => {
    if (!dirty || saveMutation.isPending || saveMutation.error) return;
    const timer = window.setTimeout(() => void saveNow(), 1000);
    return () => window.clearTimeout(timer);
  }, [dirty, saveMutation.error, saveMutation.isPending, saveNow, value]);

  useEffect(() => {
    if (!dirty || saveMutation.isPending || saveMutation.error) return;
    const interval = window.setInterval(() => void saveNow(), 10_000);
    return () => window.clearInterval(interval);
  }, [dirty, saveMutation.error, saveMutation.isPending, saveNow]);

  if (query.isPending) return <Skeleton className="h-[32rem] w-full" />;
  if (query.error || !query.data) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-4 text-center">
        <AlertTriangleIcon className="text-destructive size-5" />
        <p className="text-sm">{errorText(query.error, copy.loadFailed)}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          <RefreshCwIcon />
          {copy.retry}
        </Button>
      </div>
    );
  }
  // The rich editor must never mount with the temporary empty local value.
  // Its initialization can otherwise report that value as an edit and autosave it.
  if (!hydrated) return <Skeleton className="h-[32rem] w-full" />;

  const draft = query.data;
  const mutationError = saveMutation.error ?? reviewMutation.error;
  const conflict =
    mutationError instanceof Error &&
    "code" in mutationError &&
    mutationError.code === "OCR_PAGE_DRAFT_CONFLICT";
  const sourceOnly = getVisualMarkdownUnsupportedReason(value) !== null;

  async function markReviewed() {
    const saved = dirtyRef.current ? await saveNow() : draft;
    if (!saved || dirtyRef.current) return;
    const reviewed = await reviewMutation.mutateAsync(saved.version);
    versionRef.current = reviewed.version;
  }

  return (
    <section
      className={cn(
        "bg-background flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-lg border",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">{copy.title}</h4>
          <Badge
            variant={
              draft.status === "reviewed" && !dirty ? "secondary" : "outline"
            }
          >
            {saveMutation.isPending
              ? copy.saving
              : dirty
                ? copy.unsaved
                : draft.status === "reviewed"
                  ? copy.reviewed
                  : copy.saved}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={mode === "visual" ? "secondary" : "ghost"}
            disabled={sourceOnly}
            onClick={() => setMode("visual")}
          >
            <EyeIcon />
            {copy.visual}
          </Button>
          <Button
            size="sm"
            variant={mode === "markdown" ? "secondary" : "ghost"}
            onClick={() => setMode("markdown")}
          >
            <Code2Icon />
            {copy.markdown}
          </Button>
        </div>
      </div>

      {draft.source_changed ? (
        <p className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {copy.sourceChanged}
        </p>
      ) : null}
      {sourceOnly ? (
        <p
          role="status"
          className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        >
          {copy.sourceOnly}
        </p>
      ) : null}

      <div className="min-h-0 flex-1">
        {mode === "visual" ? (
          <MarkdownRichEditor
            value={value}
            onScrollContainerChange={onScrollContainerChange}
            requireFocusForChange
            disabled={saveMutation.isPending || reviewMutation.isPending}
            sourceAnchors={sourceAnchors}
            sourceFocusRequest={sourceFocusRequest}
            onSourceAnchorFocus={onSourceBlockFocus}
            onChange={(next) => {
              if (next === valueRef.current) return;
              saveMutation.reset();
              valueRef.current = next;
              dirtyRef.current = true;
              setValue(next);
              setDirty(true);
            }}
            onSave={() => void saveNow()}
          />
        ) : (
          <Textarea
            ref={setSourceEditor}
            className="size-full min-h-[26rem] resize-none rounded-none border-0 font-mono text-sm leading-6 shadow-none focus-visible:ring-0"
            value={value}
            placeholder={copy.empty}
            disabled={saveMutation.isPending || reviewMutation.isPending}
            onClick={focusSourceAtCaret}
            onKeyUp={focusSourceAtCaret}
            onSelect={focusSourceAtCaret}
            onChange={(event) => {
              if (event.target.value === valueRef.current) return;
              saveMutation.reset();
              valueRef.current = event.target.value;
              dirtyRef.current = true;
              setValue(event.target.value);
              setDirty(true);
            }}
          />
        )}
      </div>

      <div className="border-t px-3 py-2">
        {mutationError ? (
          <p role="alert" className="text-destructive mb-2 text-xs leading-5">
            {conflict
              ? copy.conflict
              : errorText(mutationError, copy.loadFailed)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">
            {draft.updated_at
              ? new Date(draft.updated_at).toLocaleString()
              : copy.unsaved}
          </span>
          <div className="flex gap-2">
            {!dirty && !saveMutation.isPending ? (
              <span
                role="status"
                className="text-muted-foreground flex items-center gap-1 text-xs"
              >
                <CheckIcon className="size-3.5" />
                {draft.updated_at ? copy.saved : copy.unsaved}
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={
                  !dirty || saveMutation.isPending || reviewMutation.isPending
                }
                onClick={() => void saveNow()}
              >
                {saveMutation.isPending ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <SaveIcon />
                )}
                {copy.save}
              </Button>
            )}
            {draft.status === "reviewed" &&
            !dirty &&
            !reviewMutation.isPending ? null : (
              <Button
                size="sm"
                disabled={saveMutation.isPending || reviewMutation.isPending}
                onClick={() => void markReviewed()}
              >
                {reviewMutation.isPending ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : (
                  <CheckIcon />
                )}
                {copy.markReviewed}
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
});
