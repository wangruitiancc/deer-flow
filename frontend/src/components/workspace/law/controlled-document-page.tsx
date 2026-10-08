"use client";

import { LoaderCircleIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from "pdfjs-dist";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import type { OcrBlock, OcrRightAngle } from "@/core/law";
import { cn } from "@/lib/utils";

const importPdfJs = () => import("pdfjs-dist");
const PDF_ZOOM_LEVELS = [1, 1.5, 2, 3] as const;
let pdfJsPromise: ReturnType<typeof importPdfJs> | null = null;

async function loadPdfJs() {
  pdfJsPromise ??= importPdfJs().then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return pdfjs;
  });
  return pdfJsPromise;
}

export function normalizeDocumentRotation(value: number): OcrRightAngle {
  const normalized = ((value % 360) + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270
    ? normalized
    : 0;
}

export function resolvePdfViewportRotation(
  intrinsicRotation: number,
  orientationCorrection: OcrRightAngle,
): OcrRightAngle {
  return normalizeDocumentRotation(intrinsicRotation + orientationCorrection);
}

export function shouldShowOcrOverlay(
  displayedRotation: OcrRightAngle,
  recognizedRotation: OcrRightAngle,
): boolean {
  return displayedRotation === recognizedRotation;
}

export function pdfBlockScrollTarget(
  bbox: NonNullable<OcrBlock["bbox"]>,
  page: { width: number; height: number; left: number; top: number },
  viewport: { width: number; height: number; scrollWidth: number; scrollHeight: number },
): { left: number; top: number } {
  const centerX = page.left + ((bbox.x0 + bbox.x1) / 2) * page.width;
  const centerY = page.top + ((bbox.y0 + bbox.y1) / 2) * page.height;
  return {
    left: Math.max(0, Math.min(viewport.scrollWidth - viewport.width, centerX - viewport.width / 2)),
    top: Math.max(0, Math.min(viewport.scrollHeight - viewport.height, centerY - viewport.height / 2)),
  };
}

export function pdfRenderScale(
  page: { width: number; height: number },
  availableWidth: number,
  devicePixelRatio: number,
  zoom: number,
): { scale: number; outputScale: number } {
  const outputScale = Math.min(Math.max(devicePixelRatio, 1), 2);
  const fitScale = Math.min(2.25, Math.max(180, availableWidth) / page.width);
  const canvasBound = 4096 / (Math.max(page.width, page.height) * outputScale);
  return { scale: Math.min(fitScale * zoom, canvasBound), outputScale };
}

export type ProtectedDocumentState = {
  url: string | null;
  mediaType: string;
  loading: boolean;
  error: string | null;
};

type ControlledDocumentPageProps = {
  document: ProtectedDocumentState;
  pageNumber: number;
  orientationCorrection?: OcrRightAngle;
  recognizedOrientation?: OcrRightAngle;
  blocks?: OcrBlock[];
  highlightedBlockIds?: ReadonlySet<string>;
  onBlockSelect?: (block: OcrBlock) => void;
  ariaLabel: string;
  loadingLabel: string;
  errorLabel: string;
  fallbackLabel: string;
  staleOverlayLabel?: string;
  zoomInLabel?: string;
  zoomOutLabel?: string;
  zoomResetLabel?: string;
  onPageCount?: (pageCount: number) => void;
  className?: string;
  onScrollContainerChange?: (element: HTMLElement | null) => void;
};

export function ControlledDocumentPage({
  document,
  pageNumber,
  orientationCorrection = 0,
  recognizedOrientation = orientationCorrection,
  blocks = [],
  highlightedBlockIds,
  onBlockSelect,
  ariaLabel,
  loadingLabel,
  errorLabel,
  fallbackLabel,
  staleOverlayLabel,
  zoomInLabel = "Zoom in on source",
  zoomOutLabel = "Zoom out of source",
  zoomResetLabel = "Fit source to width",
  onPageCount,
  className,
  onScrollContainerChange,
}: ControlledDocumentPageProps) {
  if (document.loading) {
    return (
      <div
        className={cn(
          "flex min-h-64 items-center justify-center rounded-lg border",
          className,
        )}
      >
        <LoaderCircleIcon className="text-muted-foreground mr-2 size-5 animate-spin" />
        <span className="text-muted-foreground text-sm">{loadingLabel}</span>
      </div>
    );
  }
  if (document.error || !document.url) {
    return (
      <div
        role="alert"
        className={cn(
          "text-destructive flex min-h-48 items-center justify-center rounded-lg border p-4 text-sm",
          className,
        )}
      >
        {document.error ?? errorLabel}
      </div>
    );
  }
  if (document.mediaType === "application/pdf") {
    return (
      <PdfCanvasPage
        sourceUrl={document.url}
        pageNumber={pageNumber}
        orientationCorrection={orientationCorrection}
        blocks={blocks}
        highlightedBlockIds={highlightedBlockIds}
        onBlockSelect={onBlockSelect}
        showOverlay={shouldShowOcrOverlay(
          orientationCorrection,
          recognizedOrientation,
        )}
        ariaLabel={ariaLabel}
        errorLabel={errorLabel}
        fallbackLabel={fallbackLabel}
        staleOverlayLabel={staleOverlayLabel}
        zoomInLabel={zoomInLabel}
        zoomOutLabel={zoomOutLabel}
        zoomResetLabel={zoomResetLabel}
        onPageCount={onPageCount}
        className={className}
        onScrollContainerChange={onScrollContainerChange}
      />
    );
  }
  return (
    <div
      ref={onScrollContainerChange}
      className={cn(
        "bg-muted/20 flex min-h-64 items-center justify-center overflow-auto rounded-lg border p-3",
        className,
      )}
    >
      <img
        src={document.url}
        alt={ariaLabel}
        className="max-h-[62vh] max-w-full origin-center object-contain transition-transform"
        style={{ transform: `rotate(${orientationCorrection}deg)` }}
      />
    </div>
  );
}

function PdfCanvasPage({
  sourceUrl,
  pageNumber,
  orientationCorrection,
  blocks,
  highlightedBlockIds,
  onBlockSelect,
  showOverlay,
  ariaLabel,
  errorLabel,
  fallbackLabel,
  staleOverlayLabel,
  zoomInLabel,
  zoomOutLabel,
  zoomResetLabel,
  onPageCount,
  className,
  onScrollContainerChange,
}: {
  sourceUrl: string;
  pageNumber: number;
  orientationCorrection: OcrRightAngle;
  blocks: OcrBlock[];
  highlightedBlockIds?: ReadonlySet<string>;
  onBlockSelect?: (block: OcrBlock) => void;
  showOverlay: boolean;
  ariaLabel: string;
  errorLabel: string;
  fallbackLabel: string;
  staleOverlayLabel?: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  zoomResetLabel: string;
  onPageCount?: (pageCount: number) => void;
  className?: string;
  onScrollContainerChange?: (element: HTMLElement | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [hostWidth, setHostWidth] = useState(0);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(0);
  const setHost = useCallback((element: HTMLDivElement | null) => {
    hostRef.current = element;
    onScrollContainerChange?.(element);
  }, [onScrollContainerChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setHostWidth(host.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setPdf(null);
    setLoading(true);
    setError(null);
    void loadPdfJs()
      .then((pdfjs) => {
        if (disposed) return null;
        loadingTask = pdfjs.getDocument({ url: sourceUrl });
        return loadingTask.promise;
      })
      .then((loaded) => {
        if (!loaded || disposed) return;
        setPdf(loaded);
        onPageCount?.(loaded.numPages);
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        setError(cause instanceof Error ? cause.message : errorLabel);
        setLoading(false);
      });
    return () => {
      disposed = true;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [errorLabel, onPageCount, sourceUrl]);

  useEffect(() => {
    if (!pdf || hostWidth <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let pageProxy: PDFPageProxy | null = null;
    let renderTask: RenderTask | null = null;
    setLoading(true);
    setError(null);
    void pdf
      .getPage(Math.min(Math.max(1, pageNumber), pdf.numPages))
      .then((page) => {
        if (disposed) return null;
        pageProxy = page;
        const rotation = resolvePdfViewportRotation(
          page.rotate,
          orientationCorrection,
        );
        const baseViewport = page.getViewport({ scale: 1, rotation });
        const { scale, outputScale } = pdfRenderScale(
          baseViewport,
          hostWidth - 24,
          window.devicePixelRatio || 1,
          PDF_ZOOM_LEVELS[zoomLevel]!,
        );
        const viewport = page.getViewport({ scale, rotation });
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        setFrame({ width: viewport.width, height: viewport.height });
        renderTask = page.render({
          canvas,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
        });
        return renderTask.promise;
      })
      .then(() => {
        if (!disposed) setLoading(false);
      })
      .catch((cause: unknown) => {
        if (
          disposed ||
          (cause instanceof Error &&
            cause.name === "RenderingCancelledException")
        ) {
          return;
        }
        setError(cause instanceof Error ? cause.message : errorLabel);
        setLoading(false);
      });
    return () => {
      disposed = true;
      renderTask?.cancel();
      pageProxy?.cleanup();
    };
  }, [errorLabel, hostWidth, orientationCorrection, pageNumber, pdf, zoomLevel]);

  const visibleBlocks = useMemo(
    () => (showOverlay ? blocks.filter((block) => block.bbox) : []),
    [blocks, showOverlay],
  );

  useEffect(() => {
    if (loading || !frame.width || !frame.height || !highlightedBlockIds?.size) return;
    const focused = visibleBlocks.find((block) => highlightedBlockIds.has(block.id));
    const host = hostRef.current;
    const sheet = canvasRef.current?.parentElement;
    if (!focused?.bbox || !host || !sheet) return;
    host.scrollTo({
      ...pdfBlockScrollTarget(
        focused.bbox,
        { width: frame.width, height: frame.height, left: sheet.offsetLeft, top: sheet.offsetTop },
        {
          width: host.clientWidth,
          height: host.clientHeight,
          scrollWidth: host.scrollWidth,
          scrollHeight: host.scrollHeight,
        },
      ),
      behavior: "smooth",
    });
  }, [frame, highlightedBlockIds, loading, visibleBlocks]);

  return (
    <div
      ref={setHost}
      className={cn(
        "bg-muted/30 relative min-h-64 overflow-auto rounded-lg border p-3",
        className,
      )}
      aria-label={ariaLabel}
    >
      {loading ? (
        <div className="bg-background/70 absolute inset-0 z-20 flex items-center justify-center">
          <LoaderCircleIcon className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : null}
      {error ? (
        <div className="text-destructive bg-background absolute inset-x-3 top-3 z-30 rounded-md border p-3 text-sm">
          <p>{error}</p>
          <a
            className="text-primary mt-2 inline-block underline"
            href={`${sourceUrl}#page=${pageNumber}`}
            target="_blank"
            rel="noreferrer"
          >
            {fallbackLabel}
          </a>
        </div>
      ) : null}
      {!showOverlay && blocks.length > 0 && staleOverlayLabel ? (
        <p className="border-border bg-background/95 text-muted-foreground sticky top-0 z-20 mb-2 rounded-md border px-3 py-2 text-xs shadow-sm">
          {staleOverlayLabel}
        </p>
      ) : null}
      <div className="border-border bg-background/95 sticky top-0 z-30 mb-2 flex w-fit items-center gap-1 rounded-md border p-1 shadow-sm">
        <button type="button" aria-label={zoomOutLabel} title={zoomOutLabel}
          disabled={zoomLevel === 0} onClick={() => setZoomLevel((level) => Math.max(0, level - 1))}
          className="hover:bg-muted rounded p-1 disabled:opacity-40">
          <MinusIcon className="size-4" />
        </button>
        <span className="min-w-10 text-center text-xs tabular-nums">{PDF_ZOOM_LEVELS[zoomLevel]}×</span>
        <button type="button" aria-label={zoomInLabel} title={zoomInLabel}
          disabled={zoomLevel === PDF_ZOOM_LEVELS.length - 1}
          onClick={() => setZoomLevel((level) => Math.min(PDF_ZOOM_LEVELS.length - 1, level + 1))}
          className="hover:bg-muted rounded p-1 disabled:opacity-40">
          <PlusIcon className="size-4" />
        </button>
        <button type="button" aria-label={zoomResetLabel} title={zoomResetLabel}
          disabled={zoomLevel === 0} onClick={() => setZoomLevel(0)}
          className="hover:bg-muted rounded p-1 disabled:opacity-40">
          <RotateCcwIcon className="size-4" />
        </button>
      </div>
      <div
        className="relative mx-auto bg-white shadow-sm"
        style={{
          width: frame.width || undefined,
          height: frame.height || undefined,
        }}
      >
        <canvas ref={canvasRef} className="block" />
        <div className="pointer-events-none absolute inset-0">
          {visibleBlocks.map((block) => {
            const bbox = block.bbox!;
            const style: CSSProperties = {
              left: `${bbox.x0 * 100}%`,
              top: `${bbox.y0 * 100}%`,
              width: `${(bbox.x1 - bbox.x0) * 100}%`,
              height: `${(bbox.y1 - bbox.y0) * 100}%`,
            };
            const highlighted = highlightedBlockIds?.has(block.id) ?? false;
            return (
              <button
                type="button"
                key={block.id}
                style={style}
                title={block.text}
                aria-label={`定位识别块：${block.text.slice(0, 40)}`}
                onClick={() => onBlockSelect?.(block)}
                className={cn(
                  "border-primary/70 bg-primary/10 absolute border",
                  onBlockSelect &&
                    "pointer-events-auto cursor-pointer focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none",
                  highlighted &&
                    "border-amber-600 bg-amber-300/35 ring-2 ring-amber-500/50",
                )}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
