"use client";

import {
  ArchiveIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  FileCheck2Icon,
  FileTextIcon,
  HistoryIcon,
  LoaderCircleIcon,
  Link2Icon,
  Unlink2Icon,
  Maximize2Icon,
  Minimize2Icon,
  PencilLineIcon,
  PlusIcon,
  QuoteIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  RotateCwIcon,
  ScanTextIcon,
  ShieldCheckIcon,
  UploadIcon,
  XCircleIcon,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { openSettingsDialog } from "@/components/workspace/settings";
import {
  fetchEvidenceContent,
  useAdoptLawOcrResult,
  useCancelLawOcr,
  useCreateLawCitation,
  useLawCitation,
  useLawCitations,
  useLawEvidence,
  useLawEvidenceVersions,
  useLawOcrJobs,
  useLawOcrDocumentRevision,
  useLawOcrPage,
  useLawOcrReviewQueue,
  useLawOcrResult,
  useProposeLawOcrCorrection,
  useRerunLawOcr,
  useReviewLawOcrBlock,
  useReviewLawOcrCorrection,
  useUploadLawEvidence,
  getOcrFormulaOpinion,
  getOcrTableOpinion,
  requestOcrFormulaOpinion,
  requestOcrTableOpinion,
  type EvidenceItem,
  type EvidenceVersion,
  type OcrBlock,
  type OcrFormulaOpinion,
  type OcrTableOpinion,
  type OcrCitation,
  type OcrJob,
  type OcrRightAngle,
  type OcrReviewQueueEntry,
} from "@/core/law";
import { cn } from "@/lib/utils";

import {
  ControlledDocumentPage,
  type ProtectedDocumentState,
} from "./controlled-document-page";
import { DocumentOcrWorkflow } from "./document-ocr-workflow";
import {
  formulaNumberDisagreement,
  formulaOperatorDisagreement,
} from "./formula-opinion-numbers";
import {
  OcrProofreadingEditor,
  type OcrProofreadingEditorHandle,
} from "./ocr-proofreading-editor";
import { OcrProofreadingPublicationBar } from "./ocr-proofreading-publication-bar";
import { pairedScrollTop } from "./paired-scroll";
import { compareTableOpinion } from "./table-opinion-comparison";

const COPY = {
  "en-US": {
    title: "Evidence workbench",
    description:
      "Upload, scan, OCR and cite immutable evidence versions. Every action is re-authorized by the server.",
    upload: "Upload evidence",
    uploading: "Checking and uploading…",
    noEvidence: "No material has been uploaded to this legal work item.",
    chooseEvidence: "Choose evidence",
    versions: "Versions",
    version: "Version",
    filename: "File",
    size: "Size",
    scan: "Scan",
    openDocument: "Open document",
    expandProofreading: "Expand proofreading workspace",
    collapseProofreading: "Close expanded workspace",
    scrollSyncOn: "Turn off synchronized scrolling",
    scrollSyncOff: "Turn on synchronized scrolling",
    formulaOpinion: "Get private formula opinion",
    formulaOpinionLoading: "Checking formula…",
    formulaOpinionHint:
      "Independent candidate. Compare the whole expression, operators and units with the source; it does not replace OCR text or approve a citation.",
    tableOpinion: "Get private table opinion",
    tableOpinionLoading: "Checking table…",
    tableOpinionHint:
      "Independent candidate. Compare every cell and merged region with the original; it does not replace OCR text or approve a citation.",
    tableOpinionTextDifference:
      "Original OCR and this opinion differ in {count} cells. Check the marked cells against the source.",
    tableOpinionStructureDifference:
      "Rows, columns or merged regions differ. Cell positions cannot be matched reliably; check the source.",
    tableOpinionOriginalUnavailable:
      "The original OCR has no usable table grid. Compare the entire candidate with the source.",
    tableOpinionSame:
      "The two table structures and cell texts match; still check the source before confirmation.",
    formulaNumberMismatch:
      "The original OCR and private opinion contain different number sequences. Check every figure against the source; neither result is selected automatically.",
    formulaOperatorMismatch:
      "The original OCR and private opinion differ in recognizable math signs or their order. Check the complete expression against the source; neither result is selected automatically.",
    zoomInSource: "Zoom in on source",
    zoomOutSource: "Zoom out of source",
    zoomResetSource: "Fit source to width",
    ocr: "OCR history",
    rerun: "Run again",
    rotatePage: "Rotate current page",
    rerunPage: "Re-run this page",
    pendingRotation: "Pending OCR orientation",
    rerunPageHint:
      "Creates a new immutable OCR run for this physical page. Existing results and citations remain unchanged.",
    adoptResult: "Use this result",
    adoptingResult: "Adopting…",
    adoptedResult: "Current document view",
    adoptResultHint:
      "Explicitly composes these pages into the current OCR view. It does not mark text as human verified or rewrite existing citations.",
    cancelJob: "Cancel",
    noJobs: "No OCR run exists for this version.",
    ocrUnavailable:
      "OCR is not enabled on this server yet. The uploaded evidence remains available and unchanged.",
    ocrNotConfigured:
      "The managed OCR route is not configured for this law firm. Ask an administrator to complete the server-side configuration.",
    openOcrSettings: "Open OCR settings",
    pages: "Pages",
    page: "Page",
    blocks: "Text blocks",
    citeBlock: "Cite block",
    reviewRequired:
      "Human verification is required before this OCR text can be cited.",
    formulaDigitWarning:
      "Possible split digits in this formula. Correct the proofreading draft against the original; this raw OCR block cannot be cited directly.",
    sensitiveFieldHint:
      "Check these fields against the original; the marker does not mean OCR is wrong:",
    checkAmount: "amount",
    checkDate: "date",
    checkIdentity: "identity number",
    checkName: "name",
    reviewRejected:
      "A reviewer rejected this OCR text. Verify the visible text before citing it.",
    reviewVerified: "Human verified",
    reviewQueue: "Review queue",
    reviewQueueDescription:
      "OCR blocks that need the responsible lawyer to check against the original.",
    noReviewQueue: "No OCR blocks currently require review.",
    openReview: "Open",
    reviewProgress: "Verification",
    awaitingAnotherReviewer: "Waiting for another reviewer",
    markVerified: "Verify text",
    verifying: "Verifying…",
    correctText: "Correct text",
    correctionTitle: "OCR correction history",
    correctionDescription:
      "The OCR source remains immutable. A correction becomes effective only after another authorized member accepts it.",
    proposedText: "Proposed text",
    correctionReason: "Reason for correction",
    submitCorrection: "Submit correction",
    submittingCorrection: "Submitting…",
    noCorrections: "No correction has been proposed for this block.",
    correctionPending: "Awaiting independent review",
    correctionAccepted: "Accepted correction",
    correctionRejected: "Rejected correction",
    correctionEscalated: "Escalated for specialist review",
    correctionReviewComment: "Review comment",
    acceptCorrection: "Accept",
    rejectCorrection: "Reject",
    escalateCorrection: "Escalate",
    correctionEffective: "Corrected text in effect",
    correctionCitationPending:
      "A new citation will seal this accepted correction and its text hash in the provenance chain.",
    citationOriginalText: "Original OCR text",
    citationCorrectedText: "Accepted correction",
    citationMixedText: "Mixed original and corrected text",
    citationLegacyText: "Legacy OCR citation",
    citationProofreadText: "Published proofreading text",
    citations: "Citations",
    noCitations: "No citation has been created for this version.",
    viewCitation: "View citation",
    citationViewer: "Citation viewer",
    citationViewerDescription:
      "The document opens on the physical PDF page. The OCR map highlights the immutable block anchor.",
    source: "Source",
    result: "OCR result",
    current: "Current",
    superseded: "Superseded",
    retry: "Retry",
    requestFailed: "The request failed. Please try again.",
    close: "Close",
    uploadTitle: "Upload evidence",
    uploadDescription:
      "The browser computes SHA-256 first; the server verifies it again and scans the file before committing metadata.",
    evidenceTitle: "Evidence title",
    file: "Evidence file",
    selectedFile: "Selected file",
    submitUpload: "Scan and upload",
    citationCreated: "Citation created",
    pageLabel: "Physical PDF page",
    ocrMap: "OCR page map",
    quote: "Quoted text",
    loadingDocument: "Loading the protected document…",
    documentError: "The protected document could not be opened.",
    downloadFallback: "Open document in a new tab",
    previousPage: "Previous page",
    nextPage: "Next page",
    pageOf: "of",
    staleOverlay:
      "The page direction has changed. OCR boxes stay hidden until this page is recognized again.",
    refresh: "Refresh",
    archived: "Archived",
    active: "Active",
    available: "Available",
    legal_hold: "Legal hold",
    purge_pending: "Purge pending",
    purge_failed: "Purge failed",
    purged: "Purged",
    clean: "Clean",
    pending: "Pending",
    partially_verified: "Partially verified",
    rejected: "Rejected",
    infected: "Blocked",
    error: "Error",
    queued: "Queued",
    processing: "Processing",
    succeeded: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    wholeBlockHint:
      "This creates a citation for the complete OCR block. The server derives and seals the quoted text.",
  },
  "zh-CN": {
    title: "证据工作台",
    description:
      "管理不可变证据版本、扫描、OCR 与引用；每个操作都由服务端重新校验权限。",
    upload: "上传证据",
    uploading: "正在校验并上传…",
    noEvidence: "这个法律事项还没有上传材料。",
    chooseEvidence: "选择证据",
    versions: "证据版本",
    version: "版本",
    filename: "文件",
    size: "大小",
    scan: "安全扫描",
    openDocument: "打开原文",
    expandProofreading: "展开原文校对工作区",
    collapseProofreading: "退出展开工作区",
    scrollSyncOn: "关闭同步滚动",
    scrollSyncOff: "开启同步滚动",
    formulaOpinion: "获取私有公式第二意见",
    formulaOpinionLoading: "正在识别公式…",
    formulaOpinionHint:
      "独立候选，请对照原件核对整式、运算符和单位；不会替换 OCR 文字，也不会自动通过引用核验。",
    tableOpinion: "获取私有表格第二意见",
    tableOpinionLoading: "正在识别表格…",
    tableOpinionHint:
      "独立候选，请对照原件逐格核对文字与合并范围；不会替换 OCR 文字，也不会自动通过引用核验。",
    tableOpinionTextDifference:
      "原始 OCR 与第二意见有 {count} 格文字不同，请对照原件核对标出的单元格。",
    tableOpinionStructureDifference:
      "行列或合并范围不同，无法可靠地逐格对应；请对照原件核对。",
    tableOpinionOriginalUnavailable:
      "原始 OCR 没有可比较的表格网格，请对照原件核对整张候选表。",
    tableOpinionSame: "两份表的结构和单元格文字相同，确认前仍需对照原件。",
    formulaNumberMismatch:
      "原始 OCR 与私有第二意见的数字序列不同，请逐个对照原件核对；系统不会自动选用任一结果。",
    formulaOperatorMismatch:
      "原始 OCR 与私有第二意见的运算符或等式顺序不同，请对照原件核对完整算式；系统不会自动选用任一结果。",
    zoomInSource: "放大原文",
    zoomOutSource: "缩小原文",
    zoomResetSource: "原文适应宽度",
    ocr: "OCR 历史",
    rerun: "重新识别",
    rotatePage: "顺时针旋转当前页",
    rerunPage: "按此方向重新识别本页",
    pendingRotation: "待识别方向",
    rerunPageHint:
      "将为当前物理页创建新的不可变 OCR 结果；原结果与既有引用不受影响。",
    adoptResult: "采用此结果",
    adoptingResult: "正在采用…",
    adoptedResult: "当前文档识别视图",
    adoptResultHint:
      "显式把本次结果的页面组合进当前识别视图；不会自动标记人工复核，也不会改写既有引用。",
    cancelJob: "取消",
    noJobs: "这个版本还没有 OCR 任务。",
    ocrUnavailable:
      "当前服务器尚未启用 OCR；已上传证据不会受影响，也不会产生假任务。",
    ocrNotConfigured:
      "本律所尚未配置统一 OCR 线路，请联系管理员完成服务端配置。",
    openOcrSettings: "打开 OCR 设置",
    pages: "页码",
    page: "第",
    blocks: "文本区块",
    citeBlock: "引用整段",
    reviewRequired: "这段 OCR 文字需要人工核验，核验前不能作为证据引用。",
    formulaDigitWarning:
      "公式中的数字疑似被拆开。请对照原件修正校对稿；此原始 OCR 块不能直接引用。",
    sensitiveFieldHint: "请对照原件逐项核对以下字段；提示不代表识别有误：",
    checkAmount: "金额",
    checkDate: "日期",
    checkIdentity: "证件号码",
    checkName: "姓名",
    reviewRejected: "这段 OCR 文字曾被审核拒绝；请确认当前可见文字后再引用。",
    reviewVerified: "已人工核验",
    reviewQueue: "待复核队列",
    reviewQueueDescription: "等待负责材料的律师对照原文确认的 OCR 文字。",
    noReviewQueue: "当前没有待复核的 OCR 文字。",
    openReview: "打开",
    reviewProgress: "复核进度",
    awaitingAnotherReviewer: "等待另一名复核人",
    markVerified: "确认文字无误",
    verifying: "正在确认…",
    correctText: "纠正文字",
    correctionTitle: "OCR 纠错记录",
    correctionDescription:
      "OCR 原文保持不可变；纠错提案必须由另一名授权成员独立接受后才生效。",
    proposedText: "纠正后的文字",
    correctionReason: "纠错理由",
    submitCorrection: "提交纠错提案",
    submittingCorrection: "正在提交…",
    noCorrections: "这段文字还没有纠错记录。",
    correctionPending: "等待独立复核",
    correctionAccepted: "纠错已接受",
    correctionRejected: "纠错已拒绝",
    correctionEscalated: "已升级专业复核",
    correctionReviewComment: "复核意见",
    acceptCorrection: "接受",
    rejectCorrection: "拒绝",
    escalateCorrection: "升级处理",
    correctionEffective: "纠错文本已生效",
    correctionCitationPending:
      "新建引用时会把已接受的纠错版本及文本哈希一并封存到证据链。",
    citationOriginalText: "OCR 原始文字",
    citationCorrectedText: "已接受纠错",
    citationMixedText: "原文与纠错混合",
    citationLegacyText: "历史 OCR 引用",
    citationProofreadText: "已发布校对文字",
    citations: "证据引用",
    noCitations: "这个版本还没有创建引用。",
    viewCitation: "查看引用",
    citationViewer: "引用定位",
    citationViewerDescription:
      "原文跳到 PDF 物理页；右侧 OCR 页图高亮不可变 block anchor。",
    source: "来源状态",
    result: "OCR 结果",
    current: "当前结果",
    superseded: "已有新版",
    retry: "重试",
    requestFailed: "请求失败，请重试。",
    close: "关闭",
    uploadTitle: "上传法律工作材料",
    uploadDescription:
      "浏览器先计算 SHA-256；服务端再次复核并完成恶意文件扫描后才写入元数据。",
    evidenceTitle: "证据名称",
    file: "证据文件",
    selectedFile: "已选文件",
    submitUpload: "扫描并上传",
    citationCreated: "引用已创建",
    pageLabel: "PDF 物理页",
    ocrMap: "OCR 页面定位图",
    quote: "引用原文",
    loadingDocument: "正在加载受保护的原文…",
    documentError: "无法打开受保护的原文。",
    downloadFallback: "在新标签页打开原文",
    previousPage: "上一页",
    nextPage: "下一页",
    pageOf: "/",
    staleOverlay:
      "页面方向已调整；重新识别本页后才会显示与新方向一致的 OCR 框。",
    refresh: "刷新",
    archived: "已归档",
    active: "有效",
    available: "可用",
    legal_hold: "诉讼保全",
    purge_pending: "等待清除",
    purge_failed: "清除失败",
    purged: "已清除",
    clean: "扫描通过",
    pending: "待处理",
    partially_verified: "部分通过",
    rejected: "已拒绝",
    infected: "已拦截",
    error: "异常",
    queued: "排队中",
    processing: "识别中",
    succeeded: "已完成",
    failed: "失败",
    cancelled: "已取消",
    wholeBlockHint: "该操作引用完整 OCR 区块；引用正文由服务端裁切并封存。",
  },
} as const;

type Locale = keyof typeof COPY;
type Copy = (typeof COPY)[Locale];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function shortId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function StatusBadge({ value, copy }: { value: string; copy: Copy }) {
  const label = value in copy ? copy[value as keyof Copy] : value;
  const variant =
    value === "clean" || value === "succeeded" || value === "available"
      ? "secondary"
      : value === "failed" || value === "infected" || value === "error"
        ? "destructive"
        : "outline";
  return (
    <Badge variant={variant}>{typeof label === "string" ? label : value}</Badge>
  );
}

function citationTextBasisLabel(citation: OcrCitation, copy: Copy): string {
  if (citation.text_basis === "proofread_markdown")
    return copy.citationProofreadText;
  if (citation.text_basis === "corrected") return copy.citationCorrectedText;
  if (citation.text_basis === "mixed") return copy.citationMixedText;
  if (citation.text_basis === "legacy_ocr") return copy.citationLegacyText;
  return copy.citationOriginalText;
}

export function EvidenceUploadButton({
  tenantId,
  matterId,
  locale,
  onUploaded,
}: {
  tenantId: string;
  matterId: string;
  locale: Locale;
  onUploaded?: (item: EvidenceItem) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <PlusIcon />
        添加材料
      </Button>
      <UploadEvidenceDialog
        open={open}
        onOpenChange={setOpen}
        tenantId={tenantId}
        matterId={matterId}
        copy={COPY[locale]}
        onUploaded={(item) => {
          setOpen(false);
          onUploaded?.(item);
        }}
      />
    </>
  );
}

export function EvidenceWorkbench({
  tenantId,
  matterId,
  locale,
  mode = "full",
  initialEvidenceId,
  initialEvidenceVersionId,
  initialCitationId,
  initialPage,
}: {
  tenantId: string;
  matterId: string;
  locale: Locale;
  mode?: "full" | "panel" | "document";
  initialEvidenceId?: string;
  initialEvidenceVersionId?: string;
  initialCitationId?: string;
  initialPage?: number;
}) {
  const copy = COPY[locale];
  const evidenceQuery = useLawEvidence(tenantId, matterId);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    initialEvidenceId ?? null,
  );
  const [documentView, setDocumentView] = useState<"original" | "proofreading">(
    "original",
  );
  const [originalPage, setOriginalPage] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    initialEvidenceVersionId ?? null,
  );
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<number | null>(
    initialPage ?? null,
  );
  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(
    initialCitationId ?? null,
  );
  const [reviewTarget, setReviewTarget] = useState<OcrReviewQueueEntry | null>(
    null,
  );
  const [correctionTargetId, setCorrectionTargetId] = useState<string | null>(
    null,
  );
  const [uploadOpen, setUploadOpen] = useState(false);
  const [documentOpen, setDocumentOpen] = useState(false);

  const versionsQuery = useLawEvidenceVersions(
    tenantId,
    matterId,
    selectedItemId,
  );
  const jobsQuery = useLawOcrJobs(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
  );
  const documentRevisionQuery = useLawOcrDocumentRevision(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
  );
  const citationsQuery = useLawCitations(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
  );
  const reviewQueueQuery = useLawOcrReviewQueue(tenantId, matterId);
  const { refetch: refetchReviewQueue } = reviewQueueQuery;
  const rerunMutation = useRerunLawOcr(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
  );
  const adoptMutation = useAdoptLawOcrResult(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
  );
  const cancelMutation = useCancelLawOcr(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
  );
  const selectedJob = jobsQuery.data?.find((job) => job.id === selectedJobId);
  const resultQuery = useLawOcrResult(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
    selectedJobId,
    selectedJob?.status === "succeeded",
  );

  useEffect(() => {
    if (!resultQuery.data?.id) return;
    void refetchReviewQueue();
  }, [refetchReviewQueue, resultQuery.data?.id]);
  const pageQuery = useLawOcrPage(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
    selectedJobId,
    selectedPage,
  );
  const createCitationMutation = useCreateLawCitation(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
  );
  const reviewBlockMutation = useReviewLawOcrBlock(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
    selectedJobId,
    selectedPage,
  );
  const proposeCorrectionMutation = useProposeLawOcrCorrection(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
    selectedJobId,
    selectedPage,
  );
  const reviewCorrectionMutation = useReviewLawOcrCorrection(
    tenantId,
    matterId,
    selectedItemId,
    selectedVersionId,
    selectedJobId,
    selectedPage,
  );

  useEffect(() => {
    const items = evidenceQuery.data;
    if (!items?.length) {
      setSelectedItemId(null);
      return;
    }
    if (initialEvidenceId) {
      setSelectedItemId(
        items.some((item) => item.id === initialEvidenceId)
          ? initialEvidenceId
          : null,
      );
      return;
    }
    if (!selectedItemId || !items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(items[0]!.id);
    }
  }, [evidenceQuery.data, selectedItemId, initialEvidenceId]);

  useEffect(() => {
    const versions = versionsQuery.data;
    if (!versions?.length) {
      setSelectedVersionId(null);
      return;
    }
    if (
      reviewTarget?.evidence_item_id === selectedItemId &&
      versions.some(
        (version) => version.id === reviewTarget.evidence_version_id,
      )
    ) {
      setSelectedVersionId(reviewTarget.evidence_version_id);
    } else if (
      initialEvidenceVersionId &&
      versions.some((version) => version.id === initialEvidenceVersionId)
    ) {
      setSelectedVersionId(initialEvidenceVersionId);
    } else if (initialEvidenceVersionId) {
      setSelectedVersionId(null);
    } else if (
      !selectedVersionId ||
      !versions.some((version) => version.id === selectedVersionId)
    ) {
      setSelectedVersionId(versions[0]!.id);
    }
  }, [
    initialEvidenceVersionId,
    reviewTarget,
    selectedItemId,
    selectedVersionId,
    versionsQuery.data,
  ]);

  useEffect(() => {
    const jobs = jobsQuery.data;
    if (!jobs?.length) {
      setSelectedJobId(null);
      return;
    }
    if (
      reviewTarget?.evidence_version_id === selectedVersionId &&
      jobs.some((job) => job.id === reviewTarget.ocr_job_id)
    ) {
      setSelectedJobId(reviewTarget.ocr_job_id);
    } else if (
      !selectedJobId ||
      !jobs.some((job) => job.id === selectedJobId)
    ) {
      setSelectedJobId(jobs[0]!.id);
    }
  }, [jobsQuery.data, reviewTarget, selectedJobId, selectedVersionId]);

  useEffect(() => {
    const pages = resultQuery.data?.pages;
    if (!pages?.length) {
      setSelectedPage(null);
      return;
    }
    if (
      reviewTarget?.ocr_job_id === selectedJobId &&
      pages.some(
        (page) =>
          page.physical_page_number === reviewTarget.physical_page_number,
      )
    ) {
      setSelectedPage(reviewTarget.physical_page_number);
      setReviewTarget(null);
    } else if (
      !selectedPage ||
      !pages.some((page) => page.physical_page_number === selectedPage)
    ) {
      setSelectedPage(pages[0]!.physical_page_number);
    }
  }, [resultQuery.data?.pages, reviewTarget, selectedJobId, selectedPage]);

  const selectedItem = evidenceQuery.data?.find(
    (item) => item.id === selectedItemId,
  );
  const selectedVersion = versionsQuery.data?.find(
    (version) => version.id === selectedVersionId,
  );
  const resultDocument = useProtectedDocument(
    Boolean(
      selectedItem &&
      selectedVersion &&
      (mode === "document" || selectedJob?.status === "succeeded"),
    ),
    tenantId,
    matterId,
    selectedItem?.id ?? "",
    selectedVersion?.id ?? "",
    selectedVersion?.media_type ?? "application/pdf",
  );

  async function citeBlock(block: OcrBlock) {
    if (!resultQuery.data || !selectedPage) return;
    try {
      const citation = await createCitationMutation.mutateAsync({
        ocr_result_id: resultQuery.data.id,
        physical_page_number: selectedPage,
        start_block_id: block.id,
        end_block_id: block.id,
        start_offset: 0,
        end_offset: block.correction.effective_text.length,
      });
      setSelectedCitationId(citation.id);
    } catch {
      // The mutation keeps the server error visible beside the OCR blocks.
    }
  }

  async function verifyBlock(block: OcrBlock) {
    try {
      await reviewBlockMutation.mutateAsync({
        blockId: block.id,
        decision: "verified",
      });
    } catch {
      // The mutation keeps the server error visible beside the OCR blocks.
    }
  }

  const correctionTarget = pageQuery.data?.blocks.find(
    (block) => block.id === correctionTargetId,
  );

  async function proposeCorrection(
    block: OcrBlock,
    correctedText: string,
    reason: string,
  ) {
    await proposeCorrectionMutation.mutateAsync({
      blockId: block.id,
      input: { corrected_text: correctedText, reason },
    });
  }

  async function reviewCorrection(
    block: OcrBlock,
    correctionId: string,
    decision: "accepted" | "rejected" | "escalated",
    comment?: string,
  ) {
    await reviewCorrectionMutation.mutateAsync({
      blockId: block.id,
      correctionId,
      input: { decision, comment },
    });
  }

  function openReview(entry: OcrReviewQueueEntry) {
    setReviewTarget(entry);
    setSelectedItemId(entry.evidence_item_id);
    setSelectedVersionId(null);
    setSelectedJobId(null);
    setSelectedPage(null);
    setSelectedCitationId(null);
  }

  return (
    <Card
      className={cn(
        mode !== "full" &&
          "flex size-full min-h-0 flex-col overflow-hidden rounded-none border-0 shadow-none",
      )}
    >
      <CardHeader className={cn("border-b", mode !== "full" && "p-3")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheckIcon className="text-primary size-4" />
              <h2 className="text-base font-semibold">
                {mode === "document"
                  ? (selectedItem?.title ?? "材料详情")
                  : copy.title}
              </h2>
            </div>
            {mode === "full" ? (
              <p className="text-muted-foreground mt-1 max-w-3xl text-xs leading-5">
                {copy.description}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {mode === "document" && (
              <>
                <Button
                  size="sm"
                  variant={documentView === "original" ? "default" : "outline"}
                  onClick={() => setDocumentView("original")}
                >
                  原件
                </Button>
                <Button
                  size="sm"
                  variant={
                    documentView === "proofreading" ? "default" : "outline"
                  }
                  onClick={() => setDocumentView("proofreading")}
                >
                  校对文字
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              aria-label={copy.refresh}
              onClick={() =>
                void Promise.all([
                  evidenceQuery.refetch(),
                  reviewQueueQuery.refetch(),
                ])
              }
              disabled={evidenceQuery.isFetching || reviewQueueQuery.isFetching}
            >
              <RefreshCwIcon
                className={cn(
                  (evidenceQuery.isFetching || reviewQueueQuery.isFetching) &&
                    "animate-spin",
                )}
              />
              {copy.refresh}
            </Button>
            <Button
              className={mode === "document" ? "hidden" : undefined}
              size="sm"
              onClick={() => setUploadOpen(true)}
            >
              <UploadIcon />
              {copy.upload}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          "p-0",
          mode !== "full" && "min-h-0 flex-1 overflow-y-auto",
        )}
      >
        {evidenceQuery.isPending ? (
          <div className="grid gap-4 p-5 2xl:grid-cols-[18rem_minmax(0,1fr)]">
            <Skeleton className="h-44" />
            <Skeleton className="h-96" />
          </div>
        ) : evidenceQuery.isError ? (
          <InlineError
            message={errorMessage(evidenceQuery.error, copy.requestFailed)}
            retry={copy.retry}
            onRetry={() => void evidenceQuery.refetch()}
          />
        ) : !evidenceQuery.data?.length ? (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <FileCheck2Icon className="text-muted-foreground size-9" />
            <p className="mt-3 text-sm font-medium">{copy.noEvidence}</p>
            <Button
              className="mt-4"
              size="sm"
              onClick={() => setUploadOpen(true)}
            >
              <PlusIcon />
              {copy.upload}
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              "grid min-w-0",
              mode !== "document" && "2xl:grid-cols-[18rem_minmax(0,1fr)]",
            )}
          >
            <div
              hidden={mode === "document"}
              className="border-b p-4 2xl:border-r 2xl:border-b-0"
            >
              <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                {copy.chooseEvidence}
              </p>
              <div className="space-y-2">
                {evidenceQuery.data.map((item) => (
                  <EvidenceButton
                    key={item.id}
                    item={item}
                    selected={item.id === selectedItemId}
                    copy={copy}
                    onSelect={() => {
                      setReviewTarget(null);
                      setSelectedItemId(item.id);
                      setSelectedVersionId(null);
                      setSelectedJobId(null);
                      setSelectedCitationId(null);
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="min-w-0 space-y-5 p-4 sm:p-5">
              {mode === "full" ? (
                <ReviewQueuePanel
                  copy={copy}
                  entries={reviewQueueQuery.data}
                  loading={reviewQueueQuery.isPending}
                  error={reviewQueueQuery.error}
                  onRetry={() => void reviewQueueQuery.refetch()}
                  onOpen={openReview}
                />
              ) : null}

              {mode === "document" && !selectedItem && evidenceQuery.data && (
                <p role="alert">该材料已不可用，请返回概览刷新权限。</p>
              )}
              {mode === "document" &&
                initialEvidenceVersionId &&
                versionsQuery.data &&
                !selectedVersion && (
                  <p role="alert">
                    固定来源版本已不可用，未自动切换到其他版本。
                  </p>
                )}
              <details
                open={mode !== "document"}
                className={
                  mode === "document" ? "rounded-lg border p-3" : undefined
                }
              >
                <summary
                  className={
                    mode === "document" ? "cursor-pointer text-sm" : "hidden"
                  }
                >
                  文件版本与处理记录
                </summary>
                {selectedItem && (
                  <EvidenceVersionPanel
                    copy={copy}
                    item={selectedItem}
                    versions={versionsQuery.data}
                    loading={versionsQuery.isPending}
                    error={versionsQuery.error}
                    selectedVersionId={selectedVersionId}
                    onSelectVersion={(value) => {
                      setSelectedVersionId(value);
                      setSelectedJobId(null);
                      setSelectedCitationId(null);
                    }}
                    onOpenDocument={() => setDocumentOpen(true)}
                    onRetry={() => void versionsQuery.refetch()}
                  />
                )}

                {selectedItem && selectedVersion && (
                  <>
                    <DocumentOcrWorkflow
                      tenantId={tenantId}
                      matterId={matterId}
                      evidenceItemId={selectedItem.id}
                      evidenceVersion={selectedVersion}
                      locale={locale}
                      onOpenJob={(ocrJobId) => {
                        setSelectedJobId(ocrJobId);
                        setSelectedPage(null);
                        void jobsQuery.refetch();
                      }}
                    />

                    <OcrPanel
                      copy={copy}
                      jobs={jobsQuery.data}
                      loading={jobsQuery.isPending}
                      error={jobsQuery.error}
                      selectedJobId={selectedJobId}
                      selectedJob={selectedJob}
                      mutationError={
                        rerunMutation.error ?? cancelMutation.error
                      }
                      mutating={
                        rerunMutation.isPending || cancelMutation.isPending
                      }
                      onSelectJob={(job) => {
                        setSelectedJobId(job.id);
                        setSelectedPage(null);
                      }}
                      onRerun={(job) =>
                        rerunMutation.mutate({ ocr_job_id: job.id })
                      }
                      onCancel={(job) => cancelMutation.mutate(job.id)}
                      onRetry={() => void jobsQuery.refetch()}
                    />
                  </>
                )}
              </details>
              {mode === "document" && selectedVersion && (
                <div hidden={documentView !== "original"}>
                  <div className="mb-3 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={originalPage <= 1}
                      onClick={() =>
                        setOriginalPage((value) => Math.max(1, value - 1))
                      }
                    >
                      上一页
                    </Button>
                    <span className="text-sm">
                      第 {originalPage} 页{pageCount ? ` / ${pageCount}` : ""}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!pageCount || originalPage >= pageCount}
                      onClick={() => setOriginalPage((value) => value + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                  <DocumentFrame
                    document={resultDocument}
                    copy={copy}
                    page={originalPage}
                    onPageCount={setPageCount}
                    className="h-[70vh]"
                  />
                </div>
              )}
              <div
                hidden={mode === "document" && documentView !== "proofreading"}
              >
                {selectedItem && selectedVersion && (
                  <>
                    {selectedJob?.status === "succeeded" && (
                      <OcrResultPanel
                        compact={mode === "document"}
                        copy={copy}
                        locale={locale}
                        tenantId={tenantId}
                        matterId={matterId}
                        evidenceItemId={selectedItem.id}
                        evidenceVersionId={selectedVersion.id}
                        result={resultQuery.data}
                        resultLoading={resultQuery.isPending}
                        resultError={resultQuery.error}
                        page={pageQuery.data}
                        pageLoading={pageQuery.isPending}
                        pageError={pageQuery.error}
                        document={resultDocument}
                        selectedPage={selectedPage}
                        selectedJobId={selectedJob.id}
                        rerunningPage={rerunMutation.isPending}
                        documentRevision={documentRevisionQuery.data}
                        adoptingResult={adoptMutation.isPending}
                        adoptError={adoptMutation.error}
                        creatingCitation={createCitationMutation.isPending}
                        citationError={createCitationMutation.error}
                        reviewingBlockId={
                          reviewBlockMutation.isPending
                            ? (reviewBlockMutation.variables?.blockId ?? null)
                            : null
                        }
                        reviewError={reviewBlockMutation.error}
                        correctionError={
                          proposeCorrectionMutation.error ??
                          reviewCorrectionMutation.error
                        }
                        onSelectPage={setSelectedPage}
                        onRerunPage={(physicalPage, rotation) =>
                          rerunMutation.mutate({
                            ocr_job_id: selectedJob.id,
                            physical_pages: [physicalPage],
                            page_rotations: {
                              [String(physicalPage)]: rotation,
                            },
                          })
                        }
                        onAdoptResult={() =>
                          adoptMutation.mutate({
                            ocrJobId: selectedJob.id,
                            expectedVersion:
                              documentRevisionQuery.data?.version ?? 0,
                          })
                        }
                        onCiteBlock={(block) => void citeBlock(block)}
                        onVerifyBlock={(block) => void verifyBlock(block)}
                        onRetryResult={() => void resultQuery.refetch()}
                        onRetryPage={() => void pageQuery.refetch()}
                      />
                    )}

                    {mode === "document" &&
                      selectedJob?.status !== "succeeded" && (
                        <p className="text-muted-foreground text-sm">
                          尚无可校对结果。请在“文件版本与处理记录”中查看或启动识别。
                        </p>
                      )}
                    <details className="rounded-lg border p-3">
                      <summary className="cursor-pointer text-sm">
                        已保存引用
                      </summary>
                      <CitationList
                        copy={copy}
                        citations={citationsQuery.data}
                        loading={citationsQuery.isPending}
                        error={citationsQuery.error}
                        onRetry={() => void citationsQuery.refetch()}
                        onOpen={setSelectedCitationId}
                      />
                    </details>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <UploadEvidenceDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        tenantId={tenantId}
        matterId={matterId}
        copy={copy}
        onUploaded={(item, version) => {
          setSelectedItemId(item.id);
          setSelectedVersionId(version.id);
        }}
      />

      {selectedItem && selectedVersion && (
        <ProtectedDocumentDialog
          open={documentOpen}
          onOpenChange={setDocumentOpen}
          tenantId={tenantId}
          matterId={matterId}
          item={selectedItem}
          version={selectedVersion}
          copy={copy}
        />
      )}

      {selectedItem && selectedVersion && selectedCitationId && (
        <CitationViewerDialog
          open
          onOpenChange={(open) => {
            if (!open) setSelectedCitationId(null);
          }}
          tenantId={tenantId}
          matterId={matterId}
          item={selectedItem}
          version={selectedVersion}
          citationId={selectedCitationId}
          copy={copy}
        />
      )}
      <CorrectionDialog
        open={Boolean(correctionTargetId)}
        onOpenChange={(open) => {
          if (!open) setCorrectionTargetId(null);
        }}
        copy={copy}
        block={correctionTarget}
        proposing={proposeCorrectionMutation.isPending}
        reviewing={reviewCorrectionMutation.isPending}
        error={
          proposeCorrectionMutation.error ?? reviewCorrectionMutation.error
        }
        onPropose={proposeCorrection}
        onReview={reviewCorrection}
      />
    </Card>
  );
}

function ReviewQueuePanel({
  copy,
  entries,
  loading,
  error,
  onRetry,
  onOpen,
}: {
  copy: Copy;
  entries: OcrReviewQueueEntry[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onOpen: (entry: OcrReviewQueueEntry) => void;
}) {
  return (
    <section aria-labelledby="ocr-review-queue-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="ocr-review-queue-title" className="text-sm font-semibold">
            {copy.reviewQueue}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs leading-5">
            {copy.reviewQueueDescription}
          </p>
        </div>
        {entries?.length ? (
          <Badge variant="outline">{entries.length}</Badge>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-20" />
      ) : error ? (
        <InlineError
          compact
          message={errorMessage(error, copy.requestFailed)}
          retry={copy.retry}
          onRetry={onRetry}
        />
      ) : !entries?.length ? (
        <p className="text-muted-foreground mt-3 rounded-lg border border-dashed px-3 py-4 text-xs">
          {copy.noReviewQueue}
        </p>
      ) : (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {entries.map((entry) => (
            <div key={entry.block.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-5">
                  {entry.block.text}
                </p>
                <StatusBadge value={entry.block.quality.status} copy={copy} />
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                {copy.page} {entry.physical_page_number} · {copy.reviewProgress}{" "}
                {entry.block.quality.verification_count}/
                {entry.block.quality.required_verifications} ·{" "}
                {shortId(entry.evidence_item_id)}
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="outline"
                onClick={() => onOpen(entry)}
              >
                <EyeIcon />
                {copy.openReview}
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EvidenceButton({
  item,
  selected,
  copy,
  onSelect,
}: {
  item: EvidenceItem;
  selected: boolean;
  copy: Copy;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "hover:bg-accent focus-visible:ring-ring flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
        selected && "border-primary bg-accent",
      )}
    >
      <FileTextIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.title}</span>
        <span className="text-muted-foreground mt-1 flex items-center gap-2 text-xs">
          {item.status === "archived" ? (
            <ArchiveIcon className="size-3" />
          ) : null}
          {item.status === "archived" ? copy.archived : copy.active}
        </span>
      </span>
    </button>
  );
}

function EvidenceVersionPanel({
  copy,
  item,
  versions,
  loading,
  error,
  selectedVersionId,
  onSelectVersion,
  onOpenDocument,
  onRetry,
}: {
  copy: Copy;
  item: EvidenceItem;
  versions: EvidenceVersion[] | undefined;
  loading: boolean;
  error: unknown;
  selectedVersionId: string | null;
  onSelectVersion: (value: string) => void;
  onOpenDocument: () => void;
  onRetry: () => void;
}) {
  const version = versions?.find((item) => item.id === selectedVersionId);
  return (
    <section aria-labelledby="evidence-versions-title">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id="evidence-versions-title" className="text-sm font-semibold">
            {item.title}
          </h3>
          <p className="text-muted-foreground text-xs">{copy.versions}</p>
        </div>
        {!loading && versions?.length ? (
          <Select
            value={selectedVersionId ?? ""}
            onValueChange={onSelectVersion}
          >
            <SelectTrigger
              className="w-full sm:w-56"
              aria-label={copy.versions}
            >
              <HistoryIcon className="text-muted-foreground size-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versions.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {copy.version} {entry.version_number} ·{" "}
                  {entry.original_filename}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="h-24" />
      ) : error ? (
        <InlineError
          compact
          message={errorMessage(error, copy.requestFailed)}
          retry={copy.retry}
          onRetry={onRetry}
        />
      ) : version ? (
        <div className="bg-muted/35 grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">
                {version.original_filename}
              </span>
              <StatusBadge value={version.scan_status} copy={copy} />
            </div>
            <p className="text-muted-foreground mt-1 text-xs">
              {version.media_type} · {formatBytes(version.byte_size)} · SHA-256{" "}
              {shortId(version.sha256)}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenDocument}
            disabled={version.scan_status !== "clean"}
          >
            <EyeIcon />
            {copy.openDocument}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function OcrPanel({
  copy,
  jobs,
  loading,
  error,
  selectedJobId,
  selectedJob,
  mutationError,
  mutating,
  onSelectJob,
  onRerun,
  onCancel,
  onRetry,
}: {
  copy: Copy;
  jobs: OcrJob[] | undefined;
  loading: boolean;
  error: unknown;
  selectedJobId: string | null;
  selectedJob: OcrJob | undefined;
  mutationError: unknown;
  mutating: boolean;
  onSelectJob: (job: OcrJob) => void;
  onRerun: (job: OcrJob) => void;
  onCancel: (job: OcrJob) => void;
  onRetry: () => void;
}) {
  const unavailable =
    mutationError instanceof Error &&
    "code" in mutationError &&
    mutationError.code === "OCR_PROCESSOR_UNAVAILABLE";
  const notConfigured =
    mutationError instanceof Error &&
    "code" in mutationError &&
    mutationError.code === "OCR_PROVIDER_NOT_CONFIGURED";
  return (
    <section className="border-t pt-5" aria-labelledby="ocr-history-title">
      <div className="flex items-center gap-2">
        <ScanTextIcon className="text-muted-foreground size-4" />
        <h3 id="ocr-history-title" className="text-sm font-semibold">
          {copy.ocr}
        </h3>
      </div>
      {mutationError ? (
        <div
          role="alert"
          className="text-destructive mt-3 flex flex-wrap items-center gap-2 text-sm"
        >
          <span>
            {unavailable
              ? copy.ocrUnavailable
              : notConfigured
                ? copy.ocrNotConfigured
                : errorMessage(mutationError, copy.requestFailed)}
          </span>
          {unavailable || notConfigured ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => openSettingsDialog("ocr")}
            >
              {copy.openOcrSettings}
            </Button>
          ) : null}
        </div>
      ) : null}
      {loading ? (
        <Skeleton className="mt-3 h-20" />
      ) : error ? (
        <InlineError
          compact
          message={errorMessage(error, copy.requestFailed)}
          retry={copy.retry}
          onRetry={onRetry}
        />
      ) : !jobs?.length ? (
        <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-4 text-sm">
          {copy.noJobs}
        </p>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() => onSelectJob(job)}
              className={cn(
                "hover:bg-accent focus-visible:ring-ring cursor-pointer rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none",
                job.id === selectedJobId && "border-primary bg-accent",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">
                  Run {job.run_number}
                </span>
                <StatusBadge value={job.status} copy={copy} />
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                {job.provider} · {job.language} · {job.attempts}/
                {job.max_attempts}
              </p>
            </button>
          ))}
        </div>
      )}
      {selectedJob ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {(selectedJob.status === "queued" ||
            selectedJob.status === "processing") && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutating}
              onClick={() => onCancel(selectedJob)}
            >
              <XCircleIcon />
              {copy.cancelJob}
            </Button>
          )}
          {(selectedJob.status === "succeeded" ||
            selectedJob.status === "failed" ||
            selectedJob.status === "cancelled") && (
            <Button
              size="sm"
              variant="outline"
              disabled={mutating}
              onClick={() => onRerun(selectedJob)}
            >
              <RotateCcwIcon />
              {copy.rerun}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}

function OcrResultPanel({
  compact = false,
  copy,
  locale,
  tenantId,
  matterId,
  evidenceItemId,
  evidenceVersionId,
  result,
  resultLoading,
  resultError,
  page,
  pageLoading,
  pageError,
  document,
  selectedPage,
  selectedJobId,
  rerunningPage,
  documentRevision,
  adoptingResult,
  adoptError,
  creatingCitation,
  citationError,
  reviewingBlockId,
  reviewError,
  correctionError,
  onSelectPage,
  onRerunPage,
  onAdoptResult,
  onCiteBlock,
  onVerifyBlock,
  onRetryResult,
  onRetryPage,
}: {
  compact?: boolean;
  copy: Copy;
  locale: Locale;
  tenantId: string;
  matterId: string;
  evidenceItemId: string;
  evidenceVersionId: string;
  result: ReturnType<typeof useLawOcrResult>["data"];
  resultLoading: boolean;
  resultError: unknown;
  page: ReturnType<typeof useLawOcrPage>["data"];
  pageLoading: boolean;
  pageError: unknown;
  document: ProtectedDocumentState;
  selectedPage: number | null;
  selectedJobId: string;
  rerunningPage: boolean;
  documentRevision: ReturnType<typeof useLawOcrDocumentRevision>["data"];
  adoptingResult: boolean;
  adoptError: unknown;
  creatingCitation: boolean;
  citationError: unknown;
  reviewingBlockId: string | null;
  reviewError: unknown;
  correctionError: unknown;
  onSelectPage: (page: number) => void;
  onRerunPage: (page: number, rotation: OcrRightAngle) => void;
  onAdoptResult: () => void;
  onCiteBlock: (block: OcrBlock) => void;
  onVerifyBlock: (block: OcrBlock) => void;
  onRetryResult: () => void;
  onRetryPage: () => void;
}) {
  const selectedPageSummary = result?.pages.find(
    (entry) => entry.physical_page_number === selectedPage,
  );
  const persistedRotation =
    selectedPageSummary?.coordinate_space?.orientation_correction_degrees ??
    (selectedPageSummary?.rotation_degrees as OcrRightAngle | undefined) ??
    0;
  const [rotationDraft, setRotationDraft] =
    useState<OcrRightAngle>(persistedRotation);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [sourceFocusRequest, setSourceFocusRequest] = useState<{
    id: string;
    sequence: number;
  } | null>(null);
  const sourceFocusSequence = useRef(0);
  const [expanded, setExpanded] = useState(false);
  const [narrowPane, setNarrowPane] = useState<"source" | "text">("text");
  const [scrollSyncEnabled, setScrollSyncEnabled] = useState(true);
  const [formulaOpinionState, setFormulaOpinionState] = useState<{
    blockId: string;
    loading: boolean;
    opinion?: OcrFormulaOpinion;
    error?: string;
  } | null>(null);
  const formulaOpinionSequence = useRef(0);
  const [tableOpinionState, setTableOpinionState] = useState<{
    blockId: string;
    loading: boolean;
    opinion?: OcrTableOpinion;
    error?: string;
  } | null>(null);
  const tableOpinionSequence = useRef(0);
  const [pdfScrollElement, setPdfScrollElement] = useState<HTMLElement | null>(
    null,
  );
  const [textScrollElement, setTextScrollElement] =
    useState<HTMLElement | null>(null);
  const activeScrollPane = useRef<{ side: "pdf" | "text"; at: number } | null>(
    null,
  );
  const workspaceRef = useRef<HTMLElement>(null);
  const proofreadingEditorRef = useRef<OcrProofreadingEditorHandle>(null);
  const highlightedBlockIds = useMemo(
    () => (focusedBlockId ? new Set([focusedBlockId]) : undefined),
    [focusedBlockId],
  );

  useEffect(() => {
    setRotationDraft(persistedRotation);
    setFocusedBlockId(null);
    setSourceFocusRequest(null);
    setFormulaOpinionState(null);
    formulaOpinionSequence.current += 1;
    setTableOpinionState(null);
    tableOpinionSequence.current += 1;
  }, [persistedRotation, selectedJobId, selectedPage]);

  useEffect(() => {
    if (
      !focusedBlockId ||
      selectedPage === null ||
      !page?.formula_opinion_history_available
    )
      return;
    const block = page.blocks.find(
      (candidate) => candidate.id === focusedBlockId,
    );
    if (
      !block?.bbox ||
      !(
        block.kind === "formula" ||
        ["=", "＝", "$", "\\(", "×", "÷"].some((marker) =>
          block.text.includes(marker),
        )
      )
    )
      return;
    const sequence = ++formulaOpinionSequence.current;
    void getOcrFormulaOpinion(
      tenantId,
      matterId,
      evidenceItemId,
      evidenceVersionId,
      selectedJobId,
      selectedPage,
      focusedBlockId,
    )
      .then((opinion) => {
        if (sequence !== formulaOpinionSequence.current) return;
        setFormulaOpinionState(
          opinion ? { blockId: focusedBlockId, loading: false, opinion } : null,
        );
      })
      .catch(() => {
        if (sequence === formulaOpinionSequence.current)
          setFormulaOpinionState(null);
      });
  }, [
    focusedBlockId,
    selectedPage,
    page,
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersionId,
    selectedJobId,
  ]);

  useEffect(() => {
    if (
      !focusedBlockId ||
      selectedPage === null ||
      !page?.table_opinion_history_available
    )
      return;
    const block = page.blocks.find(
      (candidate) => candidate.id === focusedBlockId,
    );
    if (block?.kind !== "table" || !block.bbox) return;
    const sequence = ++tableOpinionSequence.current;
    void getOcrTableOpinion(
      tenantId,
      matterId,
      evidenceItemId,
      evidenceVersionId,
      selectedJobId,
      selectedPage,
      focusedBlockId,
    )
      .then((opinion) => {
        if (sequence !== tableOpinionSequence.current) return;
        setTableOpinionState(
          opinion ? { blockId: focusedBlockId, loading: false, opinion } : null,
        );
      })
      .catch(() => {
        if (sequence === tableOpinionSequence.current)
          setTableOpinionState(null);
      });
  }, [
    focusedBlockId,
    selectedPage,
    page,
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersionId,
    selectedJobId,
  ]);

  const checkTable = async (block: OcrBlock) => {
    if (selectedPage === null) return;
    const sequence = ++tableOpinionSequence.current;
    setTableOpinionState({ blockId: block.id, loading: true });
    try {
      const opinion = await requestOcrTableOpinion(
        tenantId,
        matterId,
        evidenceItemId,
        evidenceVersionId,
        selectedJobId,
        selectedPage,
        block.id,
      );
      if (sequence === tableOpinionSequence.current) {
        setTableOpinionState({ blockId: block.id, loading: false, opinion });
      }
    } catch (error) {
      if (sequence === tableOpinionSequence.current) {
        setTableOpinionState({
          blockId: block.id,
          loading: false,
          error: errorMessage(error, copy.requestFailed),
        });
      }
    }
  };

  const checkFormula = async (block: OcrBlock) => {
    if (selectedPage === null) return;
    const sequence = ++formulaOpinionSequence.current;
    setFormulaOpinionState({ blockId: block.id, loading: true });
    try {
      const opinion = await requestOcrFormulaOpinion(
        tenantId,
        matterId,
        evidenceItemId,
        evidenceVersionId,
        selectedJobId,
        selectedPage,
        block.id,
      );
      if (sequence === formulaOpinionSequence.current) {
        setFormulaOpinionState({ blockId: block.id, loading: false, opinion });
      }
    } catch (error) {
      if (sequence === formulaOpinionSequence.current) {
        setFormulaOpinionState({
          blockId: block.id,
          loading: false,
          error: errorMessage(error, copy.requestFailed),
        });
      }
    }
  };

  const focusFromSource = (id: string) => {
    setFocusedBlockId(id);
    sourceFocusSequence.current += 1;
    setSourceFocusRequest({ id, sequence: sourceFocusSequence.current });
  };

  useEffect(() => {
    if (!focusedBlockId) return;
    globalThis.document
      .getElementById(`ocr-source-block-${focusedBlockId}`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedBlockId]);

  useEffect(() => {
    if (!pdfScrollElement || !textScrollElement || !scrollSyncEnabled) return;
    const bind = (
      source: HTMLElement,
      target: HTMLElement,
      side: "pdf" | "text",
    ) => {
      const markInput = () => {
        activeScrollPane.current = { side, at: Date.now() };
      };
      const onScroll = () => {
        const active = activeScrollPane.current;
        if (active?.side !== side || Date.now() - active.at > 1500) return;
        const top = pairedScrollTop(source, target);
        if (top !== null) target.scrollTop = top;
      };
      source.addEventListener("wheel", markInput, { passive: true });
      source.addEventListener("pointerdown", markInput, { passive: true });
      source.addEventListener("touchstart", markInput, { passive: true });
      source.addEventListener("keydown", markInput);
      source.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        source.removeEventListener("wheel", markInput);
        source.removeEventListener("pointerdown", markInput);
        source.removeEventListener("touchstart", markInput);
        source.removeEventListener("keydown", markInput);
        source.removeEventListener("scroll", onScroll);
      };
    };
    const detachPdf = bind(pdfScrollElement, textScrollElement, "pdf");
    const detachText = bind(textScrollElement, pdfScrollElement, "text");
    return () => {
      detachPdf();
      detachText();
      activeScrollPane.current = null;
    };
  }, [pdfScrollElement, textScrollElement, scrollSyncEnabled]);

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = globalThis.document.body.style.overflow;
    globalThis.document.body.style.overflow = "hidden";
    return () => {
      globalThis.document.body.style.overflow = previousOverflow;
    };
  }, [expanded]);

  const onWorkspaceKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!expanded) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      setExpanded(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      workspaceRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && globalThis.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && globalThis.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const rotateClockwise = () => {
    setRotationDraft(((rotationDraft + 90) % 360) as OcrRightAngle);
  };

  return (
    <section
      ref={workspaceRef}
      className={cn(
        "@container/ocr border-t pt-5",
        expanded && "bg-background fixed inset-0 z-50 flex flex-col p-4 sm:p-6",
      )}
      aria-labelledby="ocr-result-title"
      role={expanded ? "dialog" : "region"}
      aria-modal={expanded ? true : undefined}
      onKeyDown={onWorkspaceKeyDown}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileCheck2Icon className="text-muted-foreground size-4" />
          <h3 id="ocr-result-title" className="text-sm font-semibold">
            {copy.result}
          </h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setScrollSyncEnabled((current) => !current)}
            aria-pressed={scrollSyncEnabled}
          >
            {scrollSyncEnabled ? <Link2Icon /> : <Unlink2Icon />}
            {scrollSyncEnabled ? copy.scrollSyncOn : copy.scrollSyncOff}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
          >
            {expanded ? <Minimize2Icon /> : <Maximize2Icon />}
            {expanded ? copy.collapseProofreading : copy.expandProofreading}
          </Button>
        </div>
      </div>
      {compact && !expanded && (
        <div className="mt-3 flex gap-2 @[720px]/ocr:hidden">
          <Button
            size="sm"
            variant={narrowPane === "source" ? "default" : "outline"}
            onClick={() => setNarrowPane("source")}
          >
            对照原件
          </Button>
          <Button
            size="sm"
            variant={narrowPane === "text" ? "default" : "outline"}
            onClick={() => setNarrowPane("text")}
          >
            编辑校对文字
          </Button>
        </div>
      )}
      {resultLoading ? (
        <Skeleton className="mt-3 h-52" />
      ) : resultError ? (
        <InlineError
          compact
          message={errorMessage(resultError, copy.requestFailed)}
          retry={copy.retry}
          onRetry={onRetryResult}
        />
      ) : result ? (
        <div
          className={cn(
            "mt-3",
            expanded
              ? "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pb-4 [&>*]:shrink-0"
              : "space-y-3",
          )}
        >
          <div
            className={cn(
              "flex max-w-full gap-2 overflow-x-auto pb-1",
              expanded && "order-[-2] shrink-0",
            )}
          >
            {result.pages.map((entry) => (
              <Button
                key={entry.physical_page_number}
                size="sm"
                variant={
                  entry.physical_page_number === selectedPage
                    ? "default"
                    : "outline"
                }
                onClick={() => onSelectPage(entry.physical_page_number)}
              >
                {copy.page} {entry.physical_page_number}
              </Button>
            ))}
          </div>
          <OcrProofreadingPublicationBar
            tenantId={tenantId}
            matterId={matterId}
            evidenceItemId={evidenceItemId}
            evidenceVersionId={evidenceVersionId}
            locale={locale}
            currentPageNumber={selectedPage ?? 1}
            onBeforePublish={async () => {
              await proofreadingEditorRef.current?.save();
            }}
          />
          {selectedPage !== null ? (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-xs font-medium">
                {locale === "zh-CN"
                  ? "更多页面操作：旋转与重新识别"
                  : "More page actions: rotate and re-recognize"}
              </summary>
              <div className="bg-muted/35 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {copy.pendingRotation}: {rotationDraft}°
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs leading-5">
                    {copy.rerunPageHint}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={rerunningPage}
                    onClick={rotateClockwise}
                  >
                    <RotateCwIcon />
                    {copy.rotatePage}
                  </Button>
                  <Button
                    size="sm"
                    disabled={rerunningPage}
                    onClick={() => onRerunPage(selectedPage, rotationDraft)}
                  >
                    {rerunningPage ? (
                      <LoaderCircleIcon className="animate-spin" />
                    ) : (
                      <ScanTextIcon />
                    )}
                    {copy.rerunPage}
                  </Button>
                </div>
              </div>
            </details>
          ) : null}
          <div className="bg-muted/35 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {documentRevision?.current_revision?.adopted_ocr_job_id ===
                selectedJobId
                  ? copy.adoptedResult
                  : copy.adoptResult}
              </p>
              <p className="text-muted-foreground mt-1 text-xs leading-5">
                {copy.adoptResultHint}
              </p>
            </div>
            <Button
              size="sm"
              variant={
                documentRevision?.current_revision?.adopted_ocr_job_id ===
                selectedJobId
                  ? "outline"
                  : "default"
              }
              disabled={
                adoptingResult ||
                documentRevision?.current_revision?.adopted_ocr_job_id ===
                  selectedJobId
              }
              onClick={onAdoptResult}
            >
              {adoptingResult ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <ShieldCheckIcon />
              )}
              {adoptingResult ? copy.adoptingResult : copy.adoptResult}
            </Button>
          </div>
          {adoptError ? (
            <p role="alert" className="text-destructive text-sm">
              {errorMessage(adoptError, copy.requestFailed)}
            </p>
          ) : null}
          {pageLoading ? (
            <Skeleton className="h-64" />
          ) : pageError ? (
            <InlineError
              compact
              message={errorMessage(pageError, copy.requestFailed)}
              retry={copy.retry}
              onRetry={onRetryPage}
            />
          ) : page ? (
            <div
              className={cn(
                "grid gap-4",
                expanded
                  ? "order-[-1] shrink-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                  : compact
                    ? "@[720px]/ocr:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                    : "2xl:grid-cols-[minmax(14rem,0.75fr)_minmax(0,1.25fr)]",
              )}
            >
              <div
                className={cn(
                  "min-w-0",
                  compact &&
                    !expanded &&
                    narrowPane !== "source" &&
                    "hidden @[720px]/ocr:block",
                )}
              >
                <DocumentFrame
                  document={document}
                  copy={copy}
                  page={selectedPage ?? 1}
                  orientationCorrection={rotationDraft}
                  recognizedOrientation={persistedRotation}
                  blocks={page.blocks}
                  highlightedBlockIds={highlightedBlockIds}
                  onBlockSelect={(block) => focusFromSource(block.id)}
                  onScrollContainerChange={setPdfScrollElement}
                  staleOverlayLabel={copy.staleOverlay}
                  className={expanded ? "h-[70vh]" : "max-h-[72vh]"}
                />
              </div>
              <div
                className={cn(
                  "min-w-0",
                  compact &&
                    !expanded &&
                    narrowPane !== "text" &&
                    "hidden @[720px]/ocr:block",
                )}
              >
                <OcrProofreadingEditor
                  ref={proofreadingEditorRef}
                  key={`${selectedJobId}:${selectedPage ?? 1}`}
                  tenantId={tenantId}
                  matterId={matterId}
                  evidenceItemId={evidenceItemId}
                  evidenceVersionId={evidenceVersionId}
                  physicalPageNumber={selectedPage ?? 1}
                  ocrJobId={selectedJobId}
                  locale={locale}
                  sourceBlocks={page.blocks}
                  sourceFocusRequest={sourceFocusRequest}
                  onSourceBlockFocus={setFocusedBlockId}
                  onScrollContainerChange={setTextScrollElement}
                  className={expanded ? "h-[70vh]" : "h-[72vh]"}
                />
                <details className="mt-3 rounded-lg border">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
                    {copy.blocks} · {copy.wholeBlockHint}
                  </summary>
                  <div className="max-h-80 space-y-2 overflow-y-auto border-t p-3">
                    {page.blocks.map((block) => {
                      const hasAcceptedCorrection = Boolean(
                        block.correction.effective_correction_id,
                      );
                      const uncertainFormula =
                        block.quality.warnings?.includes(
                          "formula_numeric_fragmentation",
                        ) ?? false;
                      const sensitiveFields = (
                        [
                          ["check_amount_against_original", copy.checkAmount],
                          ["check_date_against_original", copy.checkDate],
                          [
                            "check_identity_against_original",
                            copy.checkIdentity,
                          ],
                          ["check_name_against_original", copy.checkName],
                        ] as const
                      )
                        .filter(([code]) =>
                          block.quality.warnings?.includes(code),
                        )
                        .map(([, label]) => label);
                      const citationBlocked =
                        !hasAcceptedCorrection &&
                        (uncertainFormula ||
                          block.quality.status === "rejected" ||
                          block.quality.status === "pending" ||
                          block.quality.status === "partially_verified");
                      const reviewing = reviewingBlockId === block.id;
                      const numberDisagreement =
                        formulaOpinionState?.blockId === block.id &&
                        formulaOpinionState.opinion
                          ? formulaNumberDisagreement(
                              block.text,
                              formulaOpinionState.opinion.formula_opinion.latex,
                            )
                          : null;
                      const operatorDisagreement =
                        formulaOpinionState?.blockId === block.id &&
                        formulaOpinionState.opinion
                          ? formulaOperatorDisagreement(
                              block.text,
                              formulaOpinionState.opinion.formula_opinion.latex,
                            )
                          : null;
                      const tableComparison =
                        tableOpinionState?.blockId === block.id &&
                        tableOpinionState.opinion
                          ? compareTableOpinion(
                              block.structure,
                              tableOpinionState.opinion.table_opinion.structure,
                            )
                          : null;
                      return (
                        <div
                          id={`ocr-source-block-${block.id}`}
                          key={block.id}
                          className={cn(
                            "rounded-lg border p-3 transition-colors",
                            focusedBlockId === block.id &&
                              "border-amber-500 bg-amber-50 dark:bg-amber-950/30",
                          )}
                          onClick={() => focusFromSource(block.id)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="min-w-0 flex-1 text-sm leading-6 whitespace-pre-wrap">
                              {block.correction.effective_text}
                            </p>
                            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  creatingCitation ||
                                  !block.correction.effective_text ||
                                  citationBlocked
                                }
                                onClick={() => onCiteBlock(block)}
                              >
                                {creatingCitation ? (
                                  <LoaderCircleIcon className="animate-spin" />
                                ) : (
                                  <QuoteIcon />
                                )}
                                {copy.citeBlock}
                              </Button>
                            </div>
                          </div>
                          {!hasAcceptedCorrection && block.structure ? (
                            <OcrStructurePreview block={block} />
                          ) : null}
                          {page.formula_opinion_history_available &&
                          block.bbox &&
                          (block.kind === "formula" ||
                            ["=", "＝", "$", "\\(", "×", "÷"].some((marker) =>
                              block.text.includes(marker),
                            )) ? (
                            <div className="mt-2 space-y-2">
                              {page.formula_opinion_available ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={
                                    formulaOpinionState?.loading === true
                                  }
                                  onClick={() => void checkFormula(block)}
                                >
                                  {formulaOpinionState?.blockId === block.id &&
                                  formulaOpinionState.loading ? (
                                    <LoaderCircleIcon className="animate-spin" />
                                  ) : (
                                    <ScanTextIcon />
                                  )}
                                  {formulaOpinionState?.blockId === block.id &&
                                  formulaOpinionState.loading
                                    ? copy.formulaOpinionLoading
                                    : copy.formulaOpinion}
                                </Button>
                              ) : null}
                              {formulaOpinionState?.blockId === block.id &&
                              formulaOpinionState.opinion ? (
                                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-950/40">
                                  <p>{copy.formulaOpinionHint}</p>
                                  {numberDisagreement === true ? (
                                    <p
                                      role="alert"
                                      className="mt-2 font-semibold text-amber-950 dark:text-amber-100"
                                    >
                                      {copy.formulaNumberMismatch}
                                    </p>
                                  ) : null}
                                  {operatorDisagreement === true ? (
                                    <p
                                      role="alert"
                                      className="mt-2 font-semibold text-amber-950 dark:text-amber-100"
                                    >
                                      {copy.formulaOperatorMismatch}
                                    </p>
                                  ) : null}
                                  <pre className="mt-2 overflow-x-auto font-mono whitespace-pre-wrap">
                                    {
                                      formulaOpinionState.opinion
                                        .formula_opinion.latex
                                    }
                                  </pre>
                                </div>
                              ) : null}
                              {formulaOpinionState?.blockId === block.id &&
                              formulaOpinionState.error ? (
                                <p
                                  role="alert"
                                  className="text-destructive text-xs"
                                >
                                  {formulaOpinionState.error}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          {page.table_opinion_history_available &&
                          block.kind === "table" &&
                          block.bbox ? (
                            <div className="mt-2 space-y-2">
                              {page.table_opinion_available ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={tableOpinionState?.loading === true}
                                  onClick={() => void checkTable(block)}
                                >
                                  {tableOpinionState?.blockId === block.id &&
                                  tableOpinionState.loading ? (
                                    <LoaderCircleIcon className="animate-spin" />
                                  ) : (
                                    <ScanTextIcon />
                                  )}
                                  {tableOpinionState?.blockId === block.id &&
                                  tableOpinionState.loading
                                    ? copy.tableOpinionLoading
                                    : copy.tableOpinion}
                                </Button>
                              ) : null}
                              {tableOpinionState?.blockId === block.id &&
                              tableOpinionState.opinion ? (
                                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs dark:border-amber-800 dark:bg-amber-950/40">
                                  <p>{copy.tableOpinionHint}</p>
                                  {tableComparison ? (
                                    <p
                                      role="status"
                                      className="mt-2 font-semibold text-amber-950 dark:text-amber-100"
                                    >
                                      {tableComparison.kind === "text_mismatch"
                                        ? copy.tableOpinionTextDifference.replace(
                                            "{count}",
                                            String(
                                              tableComparison.changedCells.size,
                                            ),
                                          )
                                        : tableComparison.kind ===
                                            "structure_mismatch"
                                          ? copy.tableOpinionStructureDifference
                                          : tableComparison.kind ===
                                              "unavailable"
                                            ? copy.tableOpinionOriginalUnavailable
                                            : copy.tableOpinionSame}
                                    </p>
                                  ) : null}
                                  <div className="mt-2 max-h-80 overflow-auto">
                                    <table className="border-collapse text-left">
                                      <tbody>
                                        {Array.from(
                                          {
                                            length:
                                              tableOpinionState.opinion
                                                .table_opinion.structure.rows,
                                          },
                                          (_, row) => (
                                            <tr key={row}>
                                              {tableOpinionState
                                                .opinion!.table_opinion.structure.cells.filter(
                                                  (cell) => cell.row === row,
                                                )
                                                .map((cell) => (
                                                  <td
                                                    key={`${cell.row}:${cell.column}`}
                                                    rowSpan={cell.row_span}
                                                    colSpan={cell.column_span}
                                                    className={cn(
                                                      "border border-amber-300 px-2 py-1 align-top whitespace-pre-wrap dark:border-amber-800",
                                                      tableComparison?.kind ===
                                                        "text_mismatch" &&
                                                        tableComparison.changedCells.has(
                                                          `${cell.row}:${cell.column}`,
                                                        ) &&
                                                        "bg-rose-200 font-semibold dark:bg-rose-900/60",
                                                    )}
                                                  >
                                                    {cell.text}
                                                  </td>
                                                ))}
                                            </tr>
                                          ),
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : null}
                              {tableOpinionState?.blockId === block.id &&
                              tableOpinionState.error ? (
                                <p
                                  role="alert"
                                  className="text-destructive text-xs"
                                >
                                  {tableOpinionState.error}
                                </p>
                              ) : null}
                            </div>
                          ) : null}
                          {block.quality.warnings?.includes(
                            "formula_numeric_fragmentation",
                          ) ? (
                            <p
                              role="status"
                              className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs leading-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                            >
                              {copy.formulaDigitWarning}
                            </p>
                          ) : null}
                          {sensitiveFields.length ? (
                            <p
                              role="status"
                              className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs leading-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                            >
                              {copy.sensitiveFieldHint}{" "}
                              {sensitiveFields.join(
                                locale === "zh-CN" ? "、" : ", ",
                              )}
                            </p>
                          ) : null}
                          <p className="text-muted-foreground mt-2 text-xs">
                            #{block.reading_order} · {block.kind}
                            {block.confidence === null
                              ? ""
                              : ` · ${Math.round(block.confidence * 100)}%`}
                          </p>
                          {block.correction.effective_correction_id ? (
                            <div className="mt-2 space-y-1">
                              <p className="flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                <PencilLineIcon className="size-3.5" />
                                {copy.correctionEffective}
                              </p>
                              <p className="text-muted-foreground text-xs leading-5">
                                {copy.correctionCitationPending}
                              </p>
                            </div>
                          ) : null}
                          {citationBlocked ? (
                            <div
                              role="status"
                              className="mt-3 flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                            >
                              <p className="text-xs leading-5">
                                {block.quality.status === "rejected"
                                  ? copy.reviewRejected
                                  : copy.reviewRequired}
                                {block.quality.required_verifications > 1 ? (
                                  <span className="mt-1 block font-medium">
                                    {copy.reviewProgress}{" "}
                                    {block.quality.verification_count}/
                                    {block.quality.required_verifications}
                                  </span>
                                ) : null}
                              </p>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={
                                  reviewingBlockId !== null ||
                                  block.quality.current_reviewer_has_verified
                                }
                                onClick={() => onVerifyBlock(block)}
                              >
                                {reviewing ? (
                                  <LoaderCircleIcon className="animate-spin" />
                                ) : (
                                  <ShieldCheckIcon />
                                )}
                                {reviewing
                                  ? copy.verifying
                                  : block.quality.current_reviewer_has_verified
                                    ? copy.awaitingAnotherReviewer
                                    : copy.markVerified}
                              </Button>
                            </div>
                          ) : block.quality.status === "verified" ? (
                            <p className="mt-2 flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                              <ShieldCheckIcon className="size-3.5" />
                              {copy.reviewVerified}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </details>
                {reviewError ? (
                  <p role="alert" className="text-destructive mt-2 text-sm">
                    {errorMessage(reviewError, copy.requestFailed)}
                  </p>
                ) : null}
                {citationError ? (
                  <p role="alert" className="text-destructive mt-2 text-sm">
                    {errorMessage(citationError, copy.requestFailed)}
                  </p>
                ) : null}
                {correctionError ? (
                  <p role="alert" className="text-destructive mt-2 text-sm">
                    {errorMessage(correctionError, copy.requestFailed)}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function OcrStructurePreview({ block }: { block: OcrBlock }) {
  const structure = block.structure;
  if (!structure) return null;
  if (structure.type === "formula") {
    return (
      <pre className="bg-muted/50 mt-3 overflow-x-auto rounded-md border p-3 text-xs">
        {structure.latex}
      </pre>
    );
  }
  const cells = new Map(
    structure.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]),
  );
  return (
    <div className="mt-3 overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-xs">
        <tbody>
          {Array.from({ length: structure.rows }, (_, row) => (
            <tr key={row}>
              {Array.from({ length: structure.columns }, (_, column) => {
                const cell = cells.get(`${row}:${column}`);
                if (!cell) return null;
                return (
                  <td
                    key={column}
                    rowSpan={cell.row_span}
                    colSpan={cell.column_span}
                    className="border p-2 align-top"
                  >
                    {cell.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CorrectionDialog({
  open,
  onOpenChange,
  copy,
  block,
  proposing,
  reviewing,
  error,
  onPropose,
  onReview,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  copy: Copy;
  block: OcrBlock | undefined;
  proposing: boolean;
  reviewing: boolean;
  error: unknown;
  onPropose: (
    block: OcrBlock,
    correctedText: string,
    reason: string,
  ) => Promise<void>;
  onReview: (
    block: OcrBlock,
    correctionId: string,
    decision: "accepted" | "rejected" | "escalated",
    comment?: string,
  ) => Promise<void>;
}) {
  const [correctedText, setCorrectedText] = useState("");
  const [reason, setReason] = useState("");
  const [reviewComment, setReviewComment] = useState("");

  useEffect(() => {
    if (!open || !block) return;
    setCorrectedText(block.correction.effective_text);
    setReason("");
    setReviewComment("");
  }, [block, open]);

  if (!block) return null;
  const pending = block.correction.items.find(
    (correction) => correction.status === "pending",
  );
  const statusLabel = (status: string) => {
    if (status === "accepted") return copy.correctionAccepted;
    if (status === "rejected") return copy.correctionRejected;
    if (status === "escalated") return copy.correctionEscalated;
    return copy.correctionPending;
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!block) return;
    try {
      await onPropose(block, correctedText, reason);
      setReason("");
    } catch {
      // The mutation error is rendered in the dialog.
    }
  }

  async function decide(decision: "accepted" | "rejected" | "escalated") {
    if (!block || !pending) return;
    try {
      await onReview(
        block,
        pending.id,
        decision,
        reviewComment.trim() || undefined,
      );
      setReviewComment("");
    } catch {
      // The mutation error is rendered in the dialog.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{copy.correctionTitle}</DialogTitle>
          <DialogDescription>{copy.correctionDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!block.correction.items.length ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
              {copy.noCorrections}
            </p>
          ) : (
            [...block.correction.items].reverse().map((correction) => (
              <article
                key={correction.id}
                className="space-y-3 rounded-lg border p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">
                    #{correction.correction_number}
                  </p>
                  <Badge
                    variant={
                      correction.status === "accepted" ? "secondary" : "outline"
                    }
                  >
                    {statusLabel(correction.status)}
                  </Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="bg-muted/50 rounded-md p-3">
                    <p className="text-muted-foreground mb-1 text-xs">
                      {copy.source}
                    </p>
                    <p className="text-sm leading-6 whitespace-pre-wrap">
                      {correction.base_text}
                    </p>
                  </div>
                  <div className="rounded-md bg-emerald-50 p-3 dark:bg-emerald-950/30">
                    <p className="mb-1 text-xs text-emerald-700 dark:text-emerald-300">
                      {copy.proposedText}
                    </p>
                    <p className="text-sm leading-6 whitespace-pre-wrap">
                      {correction.corrected_text}
                    </p>
                  </div>
                </div>
                <p className="text-muted-foreground text-xs leading-5">
                  {correction.reason}
                </p>
                {correction.latest_review?.comment ? (
                  <p className="rounded-md border p-2 text-xs leading-5">
                    {correction.latest_review.comment}
                  </p>
                ) : null}
              </article>
            ))
          )}
        </div>

        {pending ? (
          <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-sm font-medium">{copy.correctionPending}</p>
            {pending.can_current_user_review ? (
              <>
                <Textarea
                  aria-label={copy.correctionReviewComment}
                  placeholder={copy.correctionReviewComment}
                  value={reviewComment}
                  maxLength={2000}
                  onChange={(event) => setReviewComment(event.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={reviewing}
                    onClick={() => void decide("accepted")}
                  >
                    {reviewing ? (
                      <LoaderCircleIcon className="animate-spin" />
                    ) : (
                      <ShieldCheckIcon />
                    )}
                    {copy.acceptCorrection}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reviewing}
                    onClick={() => void decide("rejected")}
                  >
                    <XCircleIcon />
                    {copy.rejectCorrection}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reviewing || !reviewComment.trim()}
                    onClick={() => void decide("escalated")}
                  >
                    <HistoryIcon />
                    {copy.escalateCorrection}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-xs leading-5">
                {copy.awaitingAnotherReviewer}
              </p>
            )}
          </div>
        ) : (
          <form className="space-y-3 border-t pt-4" onSubmit={submit}>
            <div className="space-y-1.5">
              <label
                htmlFor="ocr-corrected-text"
                className="text-sm font-medium"
              >
                {copy.proposedText}
              </label>
              <Textarea
                id="ocr-corrected-text"
                value={correctedText}
                maxLength={16384}
                required
                onChange={(event) => setCorrectedText(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="ocr-correction-reason"
                className="text-sm font-medium"
              >
                {copy.correctionReason}
              </label>
              <Textarea
                id="ocr-correction-reason"
                value={reason}
                maxLength={2000}
                required
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={
                proposing ||
                !reason.trim() ||
                !correctedText.trim() ||
                correctedText === block.correction.effective_text
              }
            >
              {proposing ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <PencilLineIcon />
              )}
              {proposing ? copy.submittingCorrection : copy.submitCorrection}
            </Button>
          </form>
        )}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {errorMessage(error, copy.requestFailed)}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CitationList({
  copy,
  citations,
  loading,
  error,
  onRetry,
  onOpen,
}: {
  copy: Copy;
  citations: OcrCitation[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onOpen: (citationId: string) => void;
}) {
  return (
    <section className="border-t pt-5" aria-labelledby="citation-list-title">
      <div className="flex items-center gap-2">
        <QuoteIcon className="text-muted-foreground size-4" />
        <h3 id="citation-list-title" className="text-sm font-semibold">
          {copy.citations}
        </h3>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-24" />
      ) : error ? (
        <InlineError
          compact
          message={errorMessage(error, copy.requestFailed)}
          retry={copy.retry}
          onRetry={onRetry}
        />
      ) : !citations?.length ? (
        <p className="text-muted-foreground mt-3 text-sm">{copy.noCitations}</p>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {citations.map((citation) => (
            <button
              type="button"
              key={citation.id}
              onClick={() => onOpen(citation.id)}
              className="hover:bg-accent focus-visible:ring-ring cursor-pointer rounded-lg border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {copy.page} {citation.physical_page_number}
                </Badge>
                <StatusBadge value={citation.source_state} copy={copy} />
                <Badge variant="secondary">
                  {citationTextBasisLabel(citation, copy)}
                </Badge>
                <Badge
                  variant={
                    citation.source_type === "proofreading_publication" &&
                    citation.publication_state === "current"
                      ? "secondary"
                      : citation.ocr_result_state === "current"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {citation.source_type === "proofreading_publication"
                    ? citation.publication_state === "current"
                      ? copy.current
                      : copy.superseded
                    : citation.ocr_result_state === "current"
                      ? copy.current
                      : copy.superseded}
                </Badge>
              </div>
              <p className="mt-2 line-clamp-3 text-sm leading-6">
                {citation.quote_preview}
              </p>
              <span className="text-primary mt-2 inline-flex items-center gap-1 text-xs font-medium">
                <EyeIcon className="size-3" />
                {copy.viewCitation}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function citationAnchorBlockIds(
  blocks: OcrBlock[],
  citation: OcrCitation | undefined,
) {
  if (!citation) return new Set<string>();
  if (citation.source_type === "proofreading_publication") {
    return new Set(citation.source_block_ids);
  }
  if (!citation.anchor) return new Set<string>();
  const ordered = [...blocks].sort(
    (left, right) => left.reading_order - right.reading_order,
  );
  const start = ordered.findIndex(
    (block) => block.id === citation.anchor?.start_block_id,
  );
  const end = ordered.findIndex(
    (block) => block.id === citation.anchor?.end_block_id,
  );
  if (start < 0 || end < 0) {
    return new Set([
      citation.anchor.start_block_id,
      citation.anchor.end_block_id,
    ]);
  }
  const first = Math.min(start, end);
  const last = Math.max(start, end);
  return new Set(ordered.slice(first, last + 1).map((block) => block.id));
}

function UploadEvidenceDialog({
  open,
  onOpenChange,
  tenantId,
  matterId,
  copy,
  onUploaded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  matterId: string;
  copy: Copy;
  onUploaded: (item: EvidenceItem, version: EvidenceVersion) => void;
}) {
  const mutation = useUploadLawEvidence(tenantId, matterId);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    try {
      const created = await mutation.mutateAsync({ title: title.trim(), file });
      onUploaded(created.evidence_item, created.evidence_version);
      setTitle("");
      setFile(null);
      onOpenChange(false);
    } catch {
      // The mutation keeps the server error visible in the dialog.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!mutation.isPending) {
          mutation.reset();
          onOpenChange(next);
        }
      }}
    >
      <DialogContent>
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{copy.uploadTitle}</DialogTitle>
            <DialogDescription>{copy.uploadDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-5">
            <div className="grid gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="law-evidence-title"
              >
                {copy.evidenceTitle}
              </label>
              <Input
                id="law-evidence-title"
                required
                maxLength={240}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <label
                className="text-sm font-medium"
                htmlFor="law-evidence-file"
              >
                {copy.file}
              </label>
              <Input
                id="law-evidence-file"
                required
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/tiff"
                disabled={mutation.isPending}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              {file ? (
                <p className="text-muted-foreground text-xs">
                  {copy.selectedFile}: {file.name} · {formatBytes(file.size)}
                </p>
              ) : null}
            </div>
            {mutation.isPending ? (
              <div aria-live="polite">
                <Progress value={60} />
                <p className="text-muted-foreground mt-2 text-xs">
                  {copy.uploading}
                </p>
              </div>
            ) : null}
            {mutation.isError ? (
              <p role="alert" className="text-destructive text-sm">
                {errorMessage(mutation.error, copy.requestFailed)}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              {copy.close}
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !file || !title.trim()}
            >
              {mutation.isPending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <UploadIcon />
              )}
              {mutation.isPending ? copy.uploading : copy.submitUpload}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProtectedDocumentDialog({
  open,
  onOpenChange,
  tenantId,
  matterId,
  item,
  version,
  copy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  matterId: string;
  item: EvidenceItem;
  version: EvidenceVersion;
  copy: Copy;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const document = useProtectedDocument(
    open,
    tenantId,
    matterId,
    item.id,
    version.id,
    version.media_type,
  );
  useEffect(() => {
    if (!open) return;
    setPageNumber(1);
    setPageCount(1);
  }, [open, version.id]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{item.title}</DialogTitle>
          <DialogDescription>{version.original_filename}</DialogDescription>
        </DialogHeader>
        {document.mediaType === "application/pdf" ? (
          <div className="flex items-center justify-center gap-2">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={copy.previousPage}
              disabled={pageNumber <= 1}
              onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
            >
              <ChevronLeftIcon />
            </Button>
            <span className="text-muted-foreground min-w-20 text-center text-xs">
              {pageNumber} {copy.pageOf} {pageCount}
            </span>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={copy.nextPage}
              disabled={pageNumber >= pageCount}
              onClick={() =>
                setPageNumber((value) => Math.min(pageCount, value + 1))
              }
            >
              <ChevronRightIcon />
            </Button>
          </div>
        ) : null}
        <DocumentFrame
          document={document}
          copy={copy}
          page={pageNumber}
          onPageCount={setPageCount}
        />
      </DialogContent>
    </Dialog>
  );
}

function CitationViewerDialog({
  open,
  onOpenChange,
  tenantId,
  matterId,
  item,
  version,
  citationId,
  copy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  matterId: string;
  item: EvidenceItem;
  version: EvidenceVersion;
  citationId: string;
  copy: Copy;
}) {
  const citationQuery = useLawCitation(
    tenantId,
    matterId,
    item.id,
    version.id,
    citationId,
  );
  const citation = citationQuery.data;
  const pageQuery = useLawOcrPage(
    tenantId,
    matterId,
    item.id,
    version.id,
    citation?.ocr_job_id ?? null,
    citation?.physical_page_number ?? null,
  );
  const document = useProtectedDocument(
    open,
    tenantId,
    matterId,
    item.id,
    version.id,
    version.media_type,
  );
  const highlightedBlockIds = useMemo(
    () => citationAnchorBlockIds(pageQuery.data?.blocks ?? [], citation),
    [citation, pageQuery.data?.blocks],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{copy.citationViewer}</DialogTitle>
          <DialogDescription>
            {copy.citationViewerDescription}
          </DialogDescription>
        </DialogHeader>
        {citationQuery.isPending ? (
          <Skeleton className="h-[65vh]" />
        ) : citationQuery.isError || !citation ? (
          <InlineError
            message={errorMessage(citationQuery.error, copy.requestFailed)}
            retry={copy.retry}
            onRetry={() => void citationQuery.refetch()}
          />
        ) : (
          <div className="min-h-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {copy.pageLabel} {citation.viewer_location.physical_page_number}
              </Badge>
              <StatusBadge value={citation.source_state} copy={copy} />
              <Badge variant="secondary">
                {citationTextBasisLabel(citation, copy)}
              </Badge>
              <Badge
                variant={
                  citation.source_type === "proofreading_publication" &&
                  citation.publication_state === "current"
                    ? "secondary"
                    : citation.ocr_result_state === "current"
                      ? "secondary"
                      : "outline"
                }
              >
                {citation.source_type === "proofreading_publication"
                  ? citation.publication_state === "current"
                    ? copy.current
                    : copy.superseded
                  : citation.ocr_result_state === "current"
                    ? copy.current
                    : copy.superseded}
              </Badge>
            </div>
            <div className="grid min-h-0 gap-4 lg:grid-cols-2">
              <DocumentFrame
                document={document}
                copy={copy}
                page={citation.viewer_location.physical_page_number}
                orientationCorrection={
                  pageQuery.data?.coordinate_space
                    ?.orientation_correction_degrees ?? 0
                }
                recognizedOrientation={
                  pageQuery.data?.coordinate_space
                    ?.orientation_correction_degrees ?? 0
                }
                blocks={pageQuery.data?.blocks ?? []}
                highlightedBlockIds={highlightedBlockIds}
              />
              <div className="min-h-0 space-y-3 overflow-y-auto">
                {pageQuery.isPending ? (
                  <Skeleton className="h-24" />
                ) : pageQuery.isError || !pageQuery.data ? (
                  <InlineError
                    compact
                    message={errorMessage(pageQuery.error, copy.requestFailed)}
                    retry={copy.retry}
                    onRetry={() => void pageQuery.refetch()}
                  />
                ) : (
                  <p className="text-muted-foreground text-xs leading-5">
                    {copy.ocrMap} · {pageQuery.data.blocks.length} {copy.blocks}
                  </p>
                )}
                <div className="rounded-lg border p-4">
                  <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {copy.quote}
                  </p>
                  <blockquote className="mt-2 text-sm leading-6 whitespace-pre-wrap">
                    {citation.quote_text}
                  </blockquote>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function useProtectedDocument(
  enabled: boolean,
  tenantId: string,
  matterId: string,
  evidenceItemId: string,
  evidenceVersionId: string,
  fallbackMediaType: string,
) {
  const [state, setState] = useState<{
    url: string | null;
    mediaType: string;
    loading: boolean;
    error: string | null;
  }>({
    url: null,
    mediaType: fallbackMediaType,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setState({
      url: null,
      mediaType: fallbackMediaType,
      loading: true,
      error: null,
    });
    void fetchEvidenceContent(
      tenantId,
      matterId,
      evidenceItemId,
      evidenceVersionId,
      controller.signal,
    )
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        setState({
          url: objectUrl,
          mediaType: blob.type || fallbackMediaType,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (disposed || controller.signal.aborted) return;
        setState({
          url: null,
          mediaType: fallbackMediaType,
          loading: false,
          error:
            error instanceof Error ? error.message : "Unable to load document",
        });
      });
    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    enabled,
    evidenceItemId,
    evidenceVersionId,
    fallbackMediaType,
    matterId,
    tenantId,
  ]);

  return state;
}

function DocumentFrame({
  document,
  copy,
  page,
  orientationCorrection = 0,
  recognizedOrientation = orientationCorrection,
  blocks = [],
  highlightedBlockIds,
  onBlockSelect,
  staleOverlayLabel,
  onPageCount,
  className,
  onScrollContainerChange,
}: {
  document: ProtectedDocumentState;
  copy: Copy;
  page: number;
  orientationCorrection?: OcrRightAngle;
  recognizedOrientation?: OcrRightAngle;
  blocks?: OcrBlock[];
  highlightedBlockIds?: ReadonlySet<string>;
  onBlockSelect?: (block: OcrBlock) => void;
  staleOverlayLabel?: string;
  onPageCount?: (pageCount: number) => void;
  className?: string;
  onScrollContainerChange?: (element: HTMLElement | null) => void;
}) {
  const supported =
    document.mediaType === "application/pdf" ||
    document.mediaType.startsWith("image/");
  if (supported || document.loading || document.error || !document.url) {
    return (
      <ControlledDocumentPage
        document={document}
        pageNumber={page}
        orientationCorrection={orientationCorrection}
        recognizedOrientation={recognizedOrientation}
        blocks={blocks}
        highlightedBlockIds={highlightedBlockIds}
        onBlockSelect={onBlockSelect}
        ariaLabel={copy.openDocument}
        loadingLabel={copy.loadingDocument}
        errorLabel={copy.documentError}
        fallbackLabel={copy.downloadFallback}
        staleOverlayLabel={staleOverlayLabel}
        zoomInLabel={copy.zoomInSource}
        zoomOutLabel={copy.zoomOutSource}
        zoomResetLabel={copy.zoomResetSource}
        onPageCount={onPageCount}
        className={cn("h-[62vh]", className)}
        onScrollContainerChange={onScrollContainerChange}
      />
    );
  }
  return (
    <div
      className={cn("bg-muted/20 overflow-hidden rounded-lg border", className)}
    >
      <object
        data={document.url}
        type={document.mediaType}
        className="h-[62vh] w-full object-contain"
        aria-label={copy.openDocument}
      >
        <a
          className="text-primary p-4 text-sm underline"
          href={document.url}
          target="_blank"
          rel="noreferrer"
        >
          {copy.downloadFallback}
        </a>
      </object>
    </div>
  );
}

function InlineError({
  message,
  retry,
  onRetry,
  compact = false,
}: {
  message: string;
  retry: string;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "border-destructive/30 bg-destructive/5 rounded-lg border p-4",
        !compact && "m-5",
      )}
    >
      <p className="text-destructive text-sm">{message}</p>
      <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
        <RefreshCwIcon />
        {retry}
      </Button>
    </div>
  );
}
