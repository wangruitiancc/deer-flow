"use client";

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  LoaderCircleIcon,
  QuoteIcon,
  SaveAllIcon,
  Table2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { Locale } from "@/core/i18n/locale";
import {
  useCreateLawCitation,
  useLawOcrProofreadingCollection,
  useLawOcrProofreadingPublication,
  usePublishLawOcrProofreading,
} from "@/core/law";
import { getOcrPage, getOcrPageDraft } from "@/core/law/api";
import type {
  OcrPageDraftHead,
  OcrTableMergeSelection,
} from "@/core/law/types";

import {
  draftTableCandidates,
  sourceTableBody,
} from "./ocr-cross-page-table-selection";
import type { DraftTableCandidate } from "./ocr-cross-page-table-selection";
import { parsePublishedHtmlTable } from "./ocr-published-table";

const COPY = {
  "en-US": {
    title: "Proofreading version",
    ready: (saved: number, expected: number, reviewed: number) =>
      `${saved}/${expected} selected pages saved · ${reviewed} reviewed`,
    missing: (pages: number[]) =>
      `Pages ${pages.join(", ")} have no saved draft or OCR result. Publishing now creates an explicitly partial version.`,
    publish: "Save proofreading version",
    publishPartial: "Save partial version",
    publishing: "Publishing…",
    latest: (number: number, status: string) =>
      `Latest: v${number} · ${status === "complete" ? "complete" : "partial"}`,
    failed: "The proofreading version could not be published.",
    cite: "Cite published text",
    citeTitle: "Create citation from published proofreading",
    citeDescription:
      "Select exact text from an immutable published page. The server derives and seals the quote from that version.",
    page: "Page",
    selectText: "Select text in the published page to create a citation.",
    selected: (count: number) => `${count} characters selected`,
    createCitation: "Create citation",
    creatingCitation: "Creating…",
    citationCreated:
      "Citation created. It is now available to the case graph and Agent tools.",
    citationFailed: "The citation could not be created.",
    merge: "Join tables across pages",
    mergeTitle: "Join adjacent page tables",
    mergeDescription:
      "Select the table in each reviewed draft and its original OCR table block. Check edited values against the scanned pages. The published version keeps every row's page and block source.",
    mergePrepare: "Check both tables",
    mergeConfirm: "Include in next version",
    mergePlanned: (first: number, second: number) =>
      `Tables on pages ${first}–${second} will be joined in the next version.`,
    mergeUnavailable: "Both adjacent pages must be saved and reviewed.",
    mergeAmbiguous:
      "No table with clear rows was found in one of these drafts or OCR pages.",
    mergeHeaderRows: "Repeated header rows",
    mergeHeaderEffect: (count: number, retained: number) =>
      `Page 2's first ${count} rows will be omitted as repeated headers; ${retained} data rows will remain with their original page source.`,
    mergePreview: "Source tables to join",
    mergeOriginal: "Original OCR block",
    mergeProofread: "Reviewed draft table",
    mergeDraftTable: (page: number) => `Proofread table on page ${page}`,
    mergeSourceBlock: (page: number) =>
      `Original OCR table block on page ${page}`,
    mergeChoice: (index: number) => `Table ${index}`,
    mergeSelect: "Choose one",
    mergeEdited:
      "The proofreading table differs from the original OCR block. Check each corrected cell against the scanned page before confirming.",
    mergeDuplicate:
      "This OCR table block is already included in a planned merge.",
    removeMerge: "Remove",
    mergedResult: "View joined tables",
    mergedNone: "This version has no joined tables.",
    sourceRow: (number: number, page: number) =>
      `Row ${number} · original page ${page}`,
    citeMergedRow: "Cite row",
    mergedRowCited: "Cited",
    htmlRowCitation:
      "Cite exact cells, including cells carried from the row above. Each citation stays anchored to its original page; check the scanned image before citing.",
    citeMergedCell: "Cite cell",
    carriedCell: "spans from a prior row",
    encodedCell: "Select this cell's exact source text manually",
    oldHtmlCellAnchors:
      "This published version has no cell anchors. Select exact text from its published source page, or publish a new reviewed version.",
  },
  "zh-CN": {
    title: "校对成果（已选页面）",
    ready: (saved: number, expected: number, reviewed: number) =>
      `已保存 ${saved}/${expected} 个已选页面 · 已校对 ${reviewed} 页`,
    missing: (pages: number[]) =>
      `第 ${pages.join("、")} 页缺少校对稿或 OCR 结果；现在发布会明确生成“部分版本”。`,
    publish: "生成校对成果",
    publishPartial: "生成部分成果",
    publishing: "正在发布…",
    latest: (number: number, status: string) =>
      `最新：第 ${number} 版 · ${status === "complete" ? "已选页面齐全" : "部分页面缺失"}`,
    failed: "无法发布整份校对版本。",
    cite: "引用已发布文字",
    citeTitle: "从已发布校对版创建引用",
    citeDescription:
      "请在不可变的已发布页面中选择准确文字；服务端会从该版本重新截取并封存引文。",
    page: "页码",
    selectText: "请先在已发布页面中选择需要引用的文字。",
    selected: (count: number) => `已选择 ${count} 个字符`,
    createCitation: "创建正式引用",
    creatingCitation: "正在创建…",
    citationCreated: "引用已创建，可供案情图谱与 Agent 工具使用。",
    citationFailed: "无法创建校对版引用。",
    merge: "跨页合并表格",
    mergeTitle: "合并相邻页表格",
    mergeDescription:
      "明确选择两页校对稿中的表格及各自对应的原 OCR 表格块。改过的数字请逐项对照扫描原件；发布版本会逐行保留原页和识别块来源。",
    mergePrepare: "检查两页表格",
    mergeConfirm: "纳入下次发布",
    mergePlanned: (first: number, second: number) =>
      `第 ${first}–${second} 页表格将纳入下一校对版本的合并视图。`,
    mergeUnavailable: "相邻两页都须已保存并标记校对。",
    mergeAmbiguous: "某页校对稿或 OCR 结果中没有结构明确的表格。",
    mergeHeaderRows: "两页重复表头行数",
    mergeHeaderEffect: (count: number, retained: number) =>
      `第 2 页前 ${count} 行将作为重复表头从合并视图中去除，其后 ${retained} 行保留第 2 页来源。`,
    mergePreview: "待合并的来源表格",
    mergeOriginal: "原 OCR 表格块",
    mergeProofread: "已校对稿表格",
    mergeDraftTable: (page: number) => `第 ${page} 页校对表格`,
    mergeSourceBlock: (page: number) => `第 ${page} 页原 OCR 表格块`,
    mergeChoice: (index: number) => `表格 ${index}`,
    mergeSelect: "请选择",
    mergeEdited:
      "校对表格与原 OCR 块文字不同。确认前请逐格对照扫描原件，特别是金额、日期和公式。",
    mergeDuplicate: "此 OCR 表格块已纳入待发布的合并。",
    removeMerge: "移除",
    mergedResult: "查看已发布合并表",
    mergedNone: "当前版本没有合并表格。",
    sourceRow: (number: number, page: number) =>
      `第 ${number} 行 · 原件第 ${page} 页`,
    citeMergedRow: "引用此行",
    mergedRowCited: "已引用",
    htmlRowCitation:
      "按单元格分别引用；承接上行的跨行格仍固定到其原页文字。引用前请对照扫描原件。",
    citeMergedCell: "引用单元格",
    carriedCell: "承接上行的跨行单元格",
    encodedCell: "此单元格含转义字符，请手动选取原页准确文字",
    oldHtmlCellAnchors:
      "此已发布版本没有单元格锚点。请在原页选取准确文字，或发布新的已校对版本。",
  },
} as const;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

interface MergePageCandidates {
  physicalPageNumber: number;
  tables: DraftTableCandidate[];
  blocks: Array<{ id: string; text: string }>;
}

export function OcrProofreadingPublicationBar({
  tenantId,
  matterId,
  evidenceItemId,
  evidenceVersionId,
  locale,
  currentPageNumber,
  onBeforePublish,
}: {
  tenantId: string;
  matterId: string;
  evidenceItemId: string;
  evidenceVersionId: string;
  locale: Locale;
  currentPageNumber: number;
  onBeforePublish: () => Promise<void>;
}) {
  const copy = COPY[locale];
  const collectionQuery = useLawOcrProofreadingCollection(
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersionId,
  );
  const publishMutation = usePublishLawOcrProofreading(
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersionId,
  );
  const [citationOpen, setCitationOpen] = useState(false);
  const [citationPage, setCitationPage] = useState(currentPageNumber);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [createdCitationId, setCreatedCitationId] = useState<string | null>(
    null,
  );
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeResultOpen, setMergeResultOpen] = useState(false);
  const [mergeFirstPage, setMergeFirstPage] = useState(currentPageNumber);
  const [mergeChecking, setMergeChecking] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeCandidates, setMergeCandidates] = useState<{
    first: MergePageCandidates;
    second: MergePageCandidates;
  } | null>(null);
  const [firstTableIndex, setFirstTableIndex] = useState<number | null>(null);
  const [secondTableIndex, setSecondTableIndex] = useState<number | null>(null);
  const [firstBlockId, setFirstBlockId] = useState<string | null>(null);
  const [secondBlockId, setSecondBlockId] = useState<string | null>(null);
  const [mergeHeaderRows, setMergeHeaderRows] = useState<number | null>(null);
  const [mergePlanned, setMergePlanned] = useState<
    Array<{
      first: OcrTableMergeSelection;
      second: OcrTableMergeSelection;
      header_row_count?: number;
    }>
  >([]);
  const [mergedRowCitationIds, setMergedRowCitationIds] = useState<
    Record<string, string>
  >({});
  const [mergedCellCitationIds, setMergedCellCitationIds] = useState<
    Record<string, string>
  >({});
  const collection = collectionQuery.data;
  const latestPublicationId = collection?.latest_publication?.id ?? null;
  const publicationQuery = useLawOcrProofreadingPublication(
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersionId,
    citationOpen || mergeResultOpen ? latestPublicationId : null,
  );
  const createCitationMutation = useCreateLawCitation(
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersionId,
  );
  const mergeCitationMutation = useCreateLawCitation(
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersionId,
  );
  const missingCount = collection?.missing_page_numbers.length ?? 0;
  const reviewedCount =
    collection?.ocr_page_drafts.filter((draft) => draft.status === "reviewed")
      .length ?? 0;
  const publicationPage = publicationQuery.data?.pages.find(
    (page) => page.physical_page_number === citationPage,
  );
  const publicationPageText = useMemo(() => {
    if (!publicationQuery.data || !publicationPage) return "";
    return Array.from(publicationQuery.data.markdown_text)
      .slice(
        publicationPage.markdown_start_character,
        publicationPage.markdown_end_character,
      )
      .join("");
  }, [publicationPage, publicationQuery.data]);
  const reviewedHeads =
    collection?.ocr_page_drafts.filter(
      (draft) => draft.status === "reviewed",
    ) ?? [];
  const mergeStartPages = reviewedHeads.filter((draft) =>
    reviewedHeads.some(
      (next) => next.physical_page_number === draft.physical_page_number + 1,
    ),
  );
  const mergePreview = useMemo(() => {
    if (
      !mergeCandidates ||
      firstTableIndex === null ||
      secondTableIndex === null ||
      !firstBlockId ||
      !secondBlockId
    ) {
      return null;
    }
    const firstTable = mergeCandidates.first.tables[firstTableIndex];
    const secondTable = mergeCandidates.second.tables[secondTableIndex];
    const firstBlock = mergeCandidates.first.blocks.find(
      (block) => block.id === firstBlockId,
    );
    const secondBlock = mergeCandidates.second.blocks.find(
      (block) => block.id === secondBlockId,
    );
    if (!firstTable || !secondTable || !firstBlock || !secondBlock) return null;
    if (firstTable.format !== secondTable.format) return null;
    if (
      firstTable.format === "html" &&
      (mergeHeaderRows === null ||
        mergeHeaderRows >=
          Math.min(firstTable.row_count, secondTable.row_count))
    )
      return null;
    return {
      first: {
        physical_page_number: mergeCandidates.first.physicalPageNumber,
        source_block_id: firstBlock.id,
        start_character: firstTable.start_character,
        end_character: firstTable.end_character,
      },
      second: {
        physical_page_number: mergeCandidates.second.physicalPageNumber,
        source_block_id: secondBlock.id,
        start_character: secondTable.start_character,
        end_character: secondTable.end_character,
      },
      firstText: firstTable.text,
      secondText: secondTable.text,
      firstOriginalText: firstBlock.text,
      secondOriginalText: secondBlock.text,
      edited:
        firstTable.text !== sourceTableBody(firstBlock.text) ||
        secondTable.text !== sourceTableBody(secondBlock.text),
      header_row_count:
        firstTable.format === "html" ? mergeHeaderRows! : undefined,
    };
  }, [
    mergeCandidates,
    firstTableIndex,
    secondTableIndex,
    firstBlockId,
    secondBlockId,
    mergeHeaderRows,
  ]);

  useEffect(() => {
    if (!citationOpen) return;
    const pages = publicationQuery.data?.pages ?? [];
    if (pages.some((page) => page.physical_page_number === currentPageNumber)) {
      setCitationPage(currentPageNumber);
    } else if (pages[0]) {
      setCitationPage(pages[0].physical_page_number);
    }
  }, [citationOpen, currentPageNumber, publicationQuery.data?.pages]);

  useEffect(() => {
    setSelection({ start: 0, end: 0 });
    setCreatedCitationId(null);
    createCitationMutation.reset();
    // The mutation object is intentionally excluded; its identity is not stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citationOpen, citationPage, latestPublicationId]);

  useEffect(() => {
    setMergedRowCitationIds({});
  }, [latestPublicationId]);

  async function publish() {
    try {
      await onBeforePublish();
      const refreshed = await collectionQuery.refetch();
      if (!refreshed.data?.ocr_page_drafts.length) return;
      await publishMutation.mutateAsync({
        expectedVersions: Object.fromEntries(
          refreshed.data.ocr_page_drafts.map((draft) => [
            draft.physical_page_number,
            draft.version,
          ]),
        ),
        allowPartial: refreshed.data.missing_page_numbers.length > 0,
        tableMerges: mergePlanned,
      });
      setMergePlanned([]);
      setMergeCandidates(null);
    } catch {
      // The page editor or mutation renders its own persistent error state.
    }
  }

  async function prepareMerge() {
    const heads = collection?.ocr_page_drafts ?? [];
    const first = heads.find(
      (head) => head.physical_page_number === mergeFirstPage,
    );
    const second = heads.find(
      (head) => head.physical_page_number === mergeFirstPage + 1,
    );
    if (
      !first ||
      !second ||
      first.status !== "reviewed" ||
      second.status !== "reviewed"
    ) {
      setMergeError(copy.mergeUnavailable);
      return;
    }
    setMergeChecking(true);
    setMergeError(null);
    setMergeCandidates(null);
    try {
      const load = (head: OcrPageDraftHead) =>
        Promise.all([
          getOcrPageDraft(
            tenantId,
            matterId,
            evidenceItemId,
            evidenceVersionId,
            head.physical_page_number,
            head.source_ocr_job_id,
          ),
          getOcrPage(
            tenantId,
            matterId,
            evidenceItemId,
            evidenceVersionId,
            head.source_ocr_job_id,
            head.physical_page_number,
          ),
        ]);
      const [[firstDraft, firstPage], [secondDraft, secondPage]] =
        await Promise.all([load(first), load(second)]);
      if (
        firstDraft.version !== first.version ||
        secondDraft.version !== second.version ||
        firstDraft.status !== "reviewed" ||
        secondDraft.status !== "reviewed"
      ) {
        throw new Error(copy.mergeUnavailable);
      }
      const firstCandidates: MergePageCandidates = {
        physicalPageNumber: first.physical_page_number,
        tables: draftTableCandidates(firstDraft.markdown_text),
        blocks: firstPage.blocks.filter((block) => block.kind === "table"),
      };
      const secondCandidates: MergePageCandidates = {
        physicalPageNumber: second.physical_page_number,
        tables: draftTableCandidates(secondDraft.markdown_text),
        blocks: secondPage.blocks.filter((block) => block.kind === "table"),
      };
      if (
        !firstCandidates.tables.length ||
        !secondCandidates.tables.length ||
        !firstCandidates.blocks.length ||
        !secondCandidates.blocks.length
      ) {
        throw new Error(copy.mergeAmbiguous);
      }
      setMergeCandidates({ first: firstCandidates, second: secondCandidates });
      setMergeHeaderRows(null);
      setFirstTableIndex(firstCandidates.tables.length === 1 ? 0 : null);
      setSecondTableIndex(secondCandidates.tables.length === 1 ? 0 : null);
      setFirstBlockId(
        firstCandidates.blocks.length === 1
          ? firstCandidates.blocks[0]!.id
          : null,
      );
      setSecondBlockId(
        secondCandidates.blocks.length === 1
          ? secondCandidates.blocks[0]!.id
          : null,
      );
    } catch (error) {
      setMergeError(errorText(error, copy.mergeAmbiguous));
    } finally {
      setMergeChecking(false);
    }
  }

  async function createPublishedCitation() {
    if (
      !latestPublicationId ||
      !publicationPage ||
      selection.end <= selection.start
    )
      return;
    const startCharacter = Array.from(
      publicationPageText.slice(0, selection.start),
    ).length;
    const endCharacter = Array.from(
      publicationPageText.slice(0, selection.end),
    ).length;
    try {
      const citation = await createCitationMutation.mutateAsync({
        source_type: "proofreading_publication",
        publication_id: latestPublicationId,
        physical_page_number: publicationPage.physical_page_number,
        start_character: startCharacter,
        end_character: endCharacter,
      });
      setCreatedCitationId(citation.id);
    } catch {
      // The mutation error is rendered below without exposing request internals.
    }
  }

  async function citeMergedRow(row: {
    physical_page_number: number;
    source_block_id: string;
    merged_row_number: number;
    start_character: number;
    end_character: number;
  }) {
    if (!latestPublicationId) return;
    try {
      const citation = await mergeCitationMutation.mutateAsync({
        source_type: "proofreading_publication",
        publication_id: latestPublicationId,
        physical_page_number: row.physical_page_number,
        start_character: row.start_character,
        end_character: row.end_character,
      });
      setMergedRowCitationIds((current) => ({
        ...current,
        [`${row.source_block_id}-${row.merged_row_number}`]: citation.id,
      }));
    } catch {
      // The dialog shows the mutation error; no citation is created locally.
    }
  }

  async function citeMergedCell(
    physicalPageNumber: number,
    startCharacter: number,
    endCharacter: number,
  ) {
    if (!latestPublicationId) return;
    const key = `${physicalPageNumber}:${startCharacter}:${endCharacter}`;
    try {
      const citation = await mergeCitationMutation.mutateAsync({
        source_type: "proofreading_publication",
        publication_id: latestPublicationId,
        physical_page_number: physicalPageNumber,
        start_character: startCharacter,
        end_character: endCharacter,
      });
      setMergedCellCitationIds((current) => ({
        ...current,
        [key]: citation.id,
      }));
    } catch {
      // The dialog shows the mutation error; no citation is created locally.
    }
  }

  return (
    <div className="bg-muted/25 rounded-lg border p-3">
      <div className="flex flex-col gap-3 @[900px]/ocr:flex-row @[900px]/ocr:items-center @[900px]/ocr:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{copy.title}</p>
            {collection?.latest_publication ? (
              <Badge variant="secondary">
                <CheckCircle2Icon />
                {copy.latest(
                  collection.latest_publication.publication_number,
                  collection.latest_publication.status,
                )}
              </Badge>
            ) : null}
          </div>
          {collection ? (
            <p className="text-muted-foreground mt-1 text-xs leading-5">
              {copy.ready(
                collection.ocr_page_drafts.length,
                collection.expected_page_numbers.length,
                reviewedCount,
              )}
            </p>
          ) : null}
          {missingCount > 0 ? (
            <p className="mt-1 flex items-start gap-1 text-xs leading-5 text-amber-700 dark:text-amber-300">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              {copy.missing(collection?.missing_page_numbers ?? [])}
            </p>
          ) : null}
          {mergePlanned.map((planned) => (
            <div
              key={`${planned.first.source_block_id}-${planned.second.source_block_id}`}
              className="mt-1 flex items-center gap-2 text-xs text-sky-700 dark:text-sky-300"
            >
              <span role="status">
                {copy.mergePlanned(
                  planned.first.physical_page_number,
                  planned.second.physical_page_number,
                )}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setMergePlanned((current) =>
                    current.filter((item) => item !== planned),
                  )
                }
              >
                {copy.removeMerge}
              </Button>
            </div>
          ))}
          {collectionQuery.error || publishMutation.error ? (
            <p role="alert" className="text-destructive mt-1 text-xs leading-5">
              {errorText(
                collectionQuery.error ?? publishMutation.error,
                copy.failed,
              )}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <details className="relative">
            <summary className="cursor-pointer rounded-md border px-3 py-2 text-xs font-medium">
              {locale === "zh-CN" ? "更多操作" : "More actions"}
            </summary>
            <div className="bg-background absolute right-0 z-20 mt-1 flex min-w-56 flex-col gap-2 rounded-md border p-2 shadow-md">
              <Button
                size="sm"
                variant="outline"
                disabled={!mergeStartPages.length}
                onClick={() => {
                  setMergeFirstPage(
                    mergeStartPages[0]?.physical_page_number ??
                      currentPageNumber,
                  );
                  setMergeCandidates(null);
                  setMergeError(null);
                  setMergeOpen(true);
                }}
              >
                <Table2Icon />
                {copy.merge}
              </Button>
            </div>
          </details>
          <details className="relative">
            <summary className="cursor-pointer rounded-md border px-3 py-2 text-xs font-medium">
              {locale === "zh-CN" ? "查看成果与引用" : "View results and cite"}
            </summary>
            <div className="bg-background absolute right-0 z-20 mt-1 flex min-w-56 flex-col gap-2 rounded-md border p-2 shadow-md">
              <Button
                size="sm"
                variant="outline"
                disabled={!latestPublicationId}
                onClick={() => setMergeResultOpen(true)}
              >
                <Table2Icon />
                {copy.mergedResult}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!latestPublicationId}
                onClick={() => setCitationOpen(true)}
              >
                <QuoteIcon />
                {copy.cite}
              </Button>
            </div>
          </details>
          <Button
            size="sm"
            disabled={collectionQuery.isPending || publishMutation.isPending}
            onClick={() => void publish()}
          >
            {publishMutation.isPending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <SaveAllIcon />
            )}
            {publishMutation.isPending
              ? copy.publishing
              : missingCount > 0
                ? copy.publishPartial
                : copy.publish}
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {locale === "zh-CN"
          ? "修改文字会自动保存；逐页确认校对完成后，再生成可查看、引用的固定版本。生成成果不等于全部文字已通过复核。"
          : "Edits save automatically. Confirm each page, then generate a fixed version to view and cite. Generating a version does not approve every text block."}
      </p>
      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{copy.mergeTitle}</DialogTitle>
            <DialogDescription>{copy.mergeDescription}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 space-y-3 overflow-y-auto">
            <label className="flex items-center gap-2 text-sm font-medium">
              {copy.page}
              <select
                className="bg-background rounded-md border px-2 py-1"
                value={mergeFirstPage}
                onChange={(event) => {
                  setMergeFirstPage(Number(event.target.value));
                  setMergeCandidates(null);
                  setMergeError(null);
                }}
              >
                {mergeStartPages.map((head) => (
                  <option
                    key={head.physical_page_number}
                    value={head.physical_page_number}
                  >
                    {head.physical_page_number}–{head.physical_page_number + 1}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={mergeChecking}
              onClick={() => void prepareMerge()}
            >
              {mergeChecking ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <Table2Icon />
              )}
              {copy.mergePrepare}
            </Button>
            {mergeCandidates ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    [
                      mergeCandidates.first,
                      firstTableIndex,
                      setFirstTableIndex,
                      firstBlockId,
                      setFirstBlockId,
                    ],
                    [
                      mergeCandidates.second,
                      secondTableIndex,
                      setSecondTableIndex,
                      secondBlockId,
                      setSecondBlockId,
                    ],
                  ] as const
                ).map(
                  ([
                    candidate,
                    tableIndex,
                    setTableIndex,
                    blockId,
                    setBlockId,
                  ]) => (
                    <div
                      key={candidate.physicalPageNumber}
                      className="space-y-2 rounded-md border p-2"
                    >
                      <label className="block text-xs font-medium">
                        {copy.mergeDraftTable(candidate.physicalPageNumber)}
                        <select
                          className="bg-background mt-1 w-full rounded-md border px-2 py-1"
                          value={tableIndex ?? ""}
                          onChange={(event) => {
                            setTableIndex(Number(event.target.value));
                            setMergeHeaderRows(null);
                          }}
                        >
                          <option value="" disabled>
                            {copy.mergeSelect}
                          </option>
                          {candidate.tables.map((table, index) => (
                            <option
                              key={`${table.start_character}-${table.end_character}`}
                              value={index}
                            >
                              {copy.mergeChoice(index + 1)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs font-medium">
                        {copy.mergeSourceBlock(candidate.physicalPageNumber)}
                        <select
                          className="bg-background mt-1 w-full rounded-md border px-2 py-1"
                          value={blockId ?? ""}
                          onChange={(event) => setBlockId(event.target.value)}
                        >
                          <option value="" disabled>
                            {copy.mergeSelect}
                          </option>
                          {candidate.blocks.map((block, index) => (
                            <option key={block.id} value={block.id}>
                              {copy.mergeChoice(index + 1)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ),
                )}
              </div>
            ) : null}
            {mergeCandidates &&
            firstTableIndex !== null &&
            secondTableIndex !== null &&
            mergeCandidates.first.tables[firstTableIndex]?.format === "html" &&
            mergeCandidates.second.tables[secondTableIndex]?.format ===
              "html" ? (
              <label className="block text-xs font-medium">
                {copy.mergeHeaderRows}
                <select
                  className="bg-background mt-1 w-full rounded-md border px-2 py-1"
                  value={mergeHeaderRows ?? ""}
                  onChange={(event) =>
                    setMergeHeaderRows(Number(event.target.value))
                  }
                >
                  <option value="" disabled>
                    {copy.mergeSelect}
                  </option>
                  {Array.from(
                    {
                      length: Math.min(
                        20,
                        mergeCandidates.first.tables[firstTableIndex]
                          .row_count - 1,
                        mergeCandidates.second.tables[secondTableIndex]
                          .row_count - 1,
                      ),
                    },
                    (_, index) => index + 1,
                  ).map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
                {mergeHeaderRows !== null ? (
                  <span className="text-muted-foreground mt-1 block font-normal">
                    {copy.mergeHeaderEffect(
                      mergeHeaderRows,
                      mergeCandidates.second.tables[secondTableIndex]
                        .row_count - mergeHeaderRows,
                    )}
                  </span>
                ) : null}
              </label>
            ) : null}
            {mergeError ? (
              <p role="alert" className="text-destructive text-sm">
                {mergeError}
              </p>
            ) : null}
            {mergePreview ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{copy.mergePreview}</p>
                {(
                  [
                    [
                      mergePreview.first.physical_page_number,
                      mergePreview.firstOriginalText,
                      mergePreview.firstText,
                    ],
                    [
                      mergePreview.second.physical_page_number,
                      mergePreview.secondOriginalText,
                      mergePreview.secondText,
                    ],
                  ] as const
                ).map(([pageNumber, original, proofread]) => (
                  <div key={pageNumber} className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {copy.mergeOriginal} · {copy.page} {pageNumber}
                      </p>
                      <pre className="bg-muted max-h-40 overflow-auto rounded-md p-2 text-xs">
                        {original}
                      </pre>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">
                        {copy.mergeProofread} · {copy.page} {pageNumber}
                      </p>
                      <pre className="bg-muted max-h-40 overflow-auto rounded-md p-2 text-xs">
                        {proofread}
                      </pre>
                    </div>
                  </div>
                ))}
                {mergePreview.edited ? (
                  <p
                    role="alert"
                    className="text-sm text-amber-700 dark:text-amber-300"
                  >
                    {copy.mergeEdited}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              disabled={!mergePreview || mergeChecking}
              onClick={() => {
                if (!mergePreview) return;
                if (
                  mergePlanned.some((item) =>
                    [
                      item.first.source_block_id,
                      item.second.source_block_id,
                    ].some(
                      (id) =>
                        id === mergePreview.first.source_block_id ||
                        id === mergePreview.second.source_block_id,
                    ),
                  )
                ) {
                  setMergeError(copy.mergeDuplicate);
                  return;
                }
                setMergePlanned((current) => [
                  ...current,
                  {
                    first: mergePreview.first,
                    second: mergePreview.second,
                    header_row_count: mergePreview.header_row_count,
                  },
                ]);
                setMergeOpen(false);
              }}
            >
              {copy.mergeConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={mergeResultOpen} onOpenChange={setMergeResultOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{copy.mergedResult}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 space-y-4 overflow-y-auto">
            {publicationQuery.data?.manifest.cross_page_tables?.length ? (
              publicationQuery.data.manifest.cross_page_tables.map((table) => (
                <div key={table.markdown_sha256} className="space-y-2">
                  {table.markdown_text.startsWith("<table>") ? (
                    <p className="text-muted-foreground text-xs">
                      {copy.htmlRowCitation}
                    </p>
                  ) : null}
                  {(() => {
                    const displayRows = parsePublishedHtmlTable(
                      table.markdown_text,
                    );
                    if (!displayRows)
                      return (
                        <pre className="bg-muted overflow-auto rounded-md p-2 text-xs">
                          {table.markdown_text}
                        </pre>
                      );
                    return (
                      <div className="max-h-80 overflow-auto rounded-md border">
                        <table className="w-full border-collapse text-left text-xs">
                          <tbody>
                            {displayRows.map((row, rowIndex) => {
                              const source =
                                table.rows[
                                  rowIndex - (table.header_row_count ?? 1)
                                ];
                              return (
                                <tr
                                  key={rowIndex}
                                  aria-label={
                                    source
                                      ? copy.sourceRow(
                                          source.merged_row_number,
                                          source.physical_page_number,
                                        )
                                      : undefined
                                  }
                                  className={
                                    rowIndex < (table.header_row_count ?? 1)
                                      ? "bg-muted font-medium"
                                      : ""
                                  }
                                >
                                  {row.cells.map((cell, cellIndex) => (
                                    <td
                                      key={cellIndex}
                                      rowSpan={cell.rowSpan}
                                      colSpan={cell.colSpan}
                                      className="border px-3 py-2 align-top"
                                    >
                                      {cell.text}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                  <ul className="text-muted-foreground text-xs">
                    {table.rows.map((row) => (
                      <li
                        key={`${row.source_block_id}-${row.merged_row_number}`}
                        className="border-b py-2 last:border-b-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            {copy.sourceRow(
                              row.merged_row_number,
                              row.physical_page_number,
                            )}
                          </span>
                          {!table.markdown_text.startsWith("<table>") ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                mergeCitationMutation.isPending ||
                                Boolean(
                                  mergedRowCitationIds[
                                    `${row.source_block_id}-${row.merged_row_number}`
                                  ],
                                )
                              }
                              onClick={() => void citeMergedRow(row)}
                            >
                              <QuoteIcon />
                              {mergedRowCitationIds[
                                `${row.source_block_id}-${row.merged_row_number}`
                              ]
                                ? copy.mergedRowCited
                                : copy.citeMergedRow}
                            </Button>
                          ) : null}
                        </div>
                        {table.markdown_text.startsWith("<table>") ? (
                          row.cells?.length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {row.cells.map((cell) => {
                                const key = `${row.physical_page_number}:${cell.start_character}:${cell.end_character}`;
                                return (
                                  <div
                                    key={`${cell.column}:${key}`}
                                    className="flex items-center gap-1 rounded border px-2 py-1"
                                  >
                                    <span>{cell.text}</span>
                                    {cell.continued_from_prior_row ? (
                                      <span>({copy.carriedCell})</span>
                                    ) : null}
                                    {cell.citable ? (
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={
                                          mergeCitationMutation.isPending ||
                                          Boolean(mergedCellCitationIds[key])
                                        }
                                        onClick={() =>
                                          void citeMergedCell(
                                            row.physical_page_number,
                                            cell.start_character,
                                            cell.end_character,
                                          )
                                        }
                                      >
                                        <QuoteIcon />
                                        {mergedCellCitationIds[key]
                                          ? copy.mergedRowCited
                                          : copy.citeMergedCell}
                                      </Button>
                                    ) : (
                                      <span>{copy.encodedCell}</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="mt-1">{copy.oldHtmlCellAnchors}</p>
                          )
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            ) : publicationQuery.isPending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <p className="text-muted-foreground text-sm">{copy.mergedNone}</p>
            )}
            {mergeCitationMutation.error ? (
              <p role="alert" className="text-destructive text-xs">
                {errorText(mergeCitationMutation.error, copy.citationFailed)}
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={citationOpen} onOpenChange={setCitationOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{copy.citeTitle}</DialogTitle>
            <DialogDescription>{copy.citeDescription}</DialogDescription>
          </DialogHeader>
          {publicationQuery.isPending ? (
            <div className="flex min-h-64 items-center justify-center">
              <LoaderCircleIcon className="text-muted-foreground animate-spin" />
            </div>
          ) : publicationQuery.error || !publicationQuery.data ? (
            <p role="alert" className="text-destructive text-sm">
              {errorText(publicationQuery.error, copy.citationFailed)}
            </p>
          ) : (
            <div className="min-h-0 space-y-3 overflow-y-auto">
              <label className="flex items-center gap-2 text-sm font-medium">
                {copy.page}
                <select
                  className="bg-background rounded-md border px-2 py-1"
                  value={citationPage}
                  onChange={(event) =>
                    setCitationPage(Number(event.target.value))
                  }
                >
                  {publicationQuery.data.pages.map((page) => (
                    <option
                      key={page.physical_page_number}
                      value={page.physical_page_number}
                    >
                      {page.physical_page_number}
                    </option>
                  ))}
                </select>
              </label>
              <Textarea
                readOnly
                aria-label={copy.selectText}
                className="min-h-80 resize-none font-mono text-sm leading-6"
                value={publicationPageText}
                onSelect={(event) => {
                  const target = event.currentTarget;
                  setSelection({
                    start: target.selectionStart,
                    end: target.selectionEnd,
                  });
                }}
              />
              <p className="text-muted-foreground text-xs">
                {selection.end > selection.start
                  ? copy.selected(
                      Array.from(
                        publicationPageText.slice(
                          selection.start,
                          selection.end,
                        ),
                      ).length,
                    )
                  : copy.selectText}
              </p>
              {createdCitationId ? (
                <p
                  role="status"
                  className="text-sm text-emerald-700 dark:text-emerald-300"
                >
                  {copy.citationCreated}
                </p>
              ) : null}
              {createCitationMutation.error ? (
                <p role="alert" className="text-destructive text-sm">
                  {errorText(createCitationMutation.error, copy.citationFailed)}
                </p>
              ) : null}
            </div>
          )}
          <DialogFooter>
            <Button
              disabled={
                !publicationPage ||
                selection.end <= selection.start ||
                createCitationMutation.isPending ||
                Boolean(createdCitationId)
              }
              onClick={() => void createPublishedCitation()}
            >
              {createCitationMutation.isPending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <QuoteIcon />
              )}
              {createCitationMutation.isPending
                ? copy.creatingCitation
                : copy.createCitation}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
