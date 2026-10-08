"use client";

import {
  ChevronDownIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  FileScanIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/core/i18n/locale";
import { getPersonalMineruCredential, quoteOcrWorkflow, type OcrWorkflowQuote, type PersonalMineruCredential } from "@/core/law";
import {
  useLawOcrWorkflows,
  usePlanLawOcrWorkflow,
  useTransitionLawOcrWorkflow,
} from "@/core/law/hooks";
import type {
  EvidenceVersion,
  OcrWorkflow,
  OcrWorkflowSegment,
} from "@/core/law/types";
import { cn } from "@/lib/utils";

const COPY = {
  "en-US": {
    title: "Document recognition",
    description:
      "Inspect the immutable file, split it into ordered page segments, and keep progress after this panel closes.",
    prepare: "Recognize text",
    preparing: "Inspecting pages…",
    start: "Start recognition",
    quote: "View price",
    quoting: "Getting price…",
    confirmCharge: "Confirm cost and start",
    chargeNotice: "The firm prepaid balance pays. This cost is attributed to your account. Your file stays in the firm workspace.",
    chargeLimit: "Maximum for this document",
    pause: "Pause after current segment",
    resume: "Resume",
    cancel: "Stop recognition",
    retry: "Reload",
    planReady: "Plan ready",
    pages: "pages",
    segments: "segments",
    ready: "recognized",
    failed: "failed",
    processing: "Processing",
    queued: "Queued",
    pending: "Pending",
    cancelled: "Cancelled",
    planned: "Planned",
    running: "Running",
    paused: "Paused",
    stopping: "Stopping",
    awaiting_review: "Ready for proofreading",
    partially_completed: "Partially completed",
    completedHint:
      "Completed pages are available in OCR history and can be proofread immediately.",
    activeHint: "Closing the panel does not stop this document task.",
    segmentList: "Processing list",
    segment: "Segment",
    source: "Current OCR route",
    viewResult: "Open result",
    unavailable: "The evidence must pass scanning before recognition.",
    personal: "My MinerU token",
    tenantSource: "Firm OCR route",
    platformSource: "Platform OCR",
    quotaUnknown: "MinerU does not provide a reliable remaining-page count. This route sends material to MinerU cloud.",
    quotaPaused: "Personal MinerU daily limit reached. Continue after the account allowance recovers.",
    ratePaused: "MinerU is rate limiting this task. Continue later; no platform charge is started.",
    authFailed: "Personal MinerU token was rejected. Replace it in OCR settings.",
    outcomeUnknown: "MinerU submission outcome is unknown. This segment will not be submitted again automatically.",
  },
  "zh-CN": {
    title: "文档识别与校对准备",
    description:
      "先读取原件真实页数和方向，再按页段顺序识别；关闭右栏后任务仍会继续并保留进度。",
    prepare: "识别文字",
    preparing: "正在检查页数…",
    start: "开始识别",
    quote: "查看报价",
    quoting: "正在获取报价…",
    confirmCharge: "确认费用并开始",
    chargeNotice: "费用从律所预充值扣取，并记在你的个人名下；文件仍保存在律所工作区。",
    chargeLimit: "本次文档费用上限",
    pause: "当前段完成后暂停",
    resume: "继续识别",
    cancel: "停止识别",
    retry: "重新加载",
    planReady: "处理方案已生成",
    pages: "页",
    segments: "个页段",
    ready: "已识别",
    failed: "失败",
    processing: "识别中",
    queued: "等待处理",
    pending: "未开始",
    cancelled: "已取消",
    planned: "待确认",
    running: "识别中",
    paused: "已暂停",
    stopping: "停止中",
    awaiting_review: "待校对",
    partially_completed: "部分完成",
    completedHint: "已完成页会出现在下方 OCR 历史中，可以立即查看和校对。",
    activeHint: "关闭右栏不会停止这份文档任务。",
    segmentList: "处理列表",
    segment: "页段",
    source: "当前 OCR 线路",
    viewResult: "查看结果",
    unavailable: "材料通过安全扫描后才能识别。",
    personal: "我的 MinerU 额度",
    tenantSource: "律所识别线路",
    platformSource: "平台 OCR",
    quotaUnknown: "MinerU 未提供可靠的剩余页数查询；选择此线路会将材料发送至 MinerU 云端。",
    quotaPaused: "个人 MinerU 已达到每日任务上限，额度恢复后可继续。",
    ratePaused: "MinerU 正在限流，请稍后继续；不会自动启用平台付费识别。",
    authFailed: "个人 MinerU 凭证被拒绝，请在 OCR 设置中更换。",
    outcomeUnknown: "MinerU 提交结果未确认，此页段不会自动重复提交。",
  },
} as const;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "OCR workflow request failed.";
}

function pageRange(segment: OcrWorkflowSegment): string {
  const first = segment.physical_pages[0];
  const last = segment.physical_pages.at(-1);
  if (first === undefined || last === undefined) return "—";
  return first === last ? `${first}` : `${first}–${last}`;
}

function segmentError(segment: OcrWorkflowSegment, copy: (typeof COPY)[Locale]): string | null {
  switch (segment.last_error_code) {
    case "OCR_PERSONAL_QUOTA_EXHAUSTED": return copy.quotaPaused;
    case "OCR_PERSONAL_RATE_LIMITED":
    case "OCR_PERSONAL_POLL_RATE_LIMITED": return copy.ratePaused;
    case "OCR_PERSONAL_AUTH_FAILED": return copy.authFailed;
    case "OCR_PERSONAL_OUTCOME_UNKNOWN": return copy.outcomeUnknown;
    default: return segment.last_error_code;
  }
}

function statusLabel(
  workflow: OcrWorkflow,
  copy: (typeof COPY)[Locale],
): string {
  const key = workflow.status as keyof typeof copy;
  const label = copy[key];
  return typeof label === "string" ? label : workflow.status;
}

export function DocumentOcrWorkflow({
  tenantId,
  matterId,
  evidenceItemId,
  evidenceVersion,
  locale,
  onOpenJob,
}: {
  tenantId: string;
  matterId: string;
  evidenceItemId: string;
  evidenceVersion: EvidenceVersion;
  locale: Locale;
  onOpenJob: (ocrJobId: string) => void;
}) {
  const copy = COPY[locale];
  const [personal, setPersonal] = useState<PersonalMineruCredential | null>(null);
  const [resourceSource, setResourceSource] = useState<"tenant_default" | "personal_mineru" | "platform_ocr">("tenant_default");
  const [controlledQuote, setControlledQuote] = useState<{ workflowId: string; version: number; quote: OcrWorkflowQuote } | null>(null);
  const [quotePending, setQuotePending] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getPersonalMineruCredential(tenantId).then(
      (value) => {
        if (active) {
          setPersonal(value);
          setResourceSource(value.configured && value.execution_available ? "personal_mineru" : "tenant_default");
        }
      },
      () => { if (active) setPersonal(null); },
    );
    return () => { active = false; };
  }, [tenantId]);
  const workflows = useLawOcrWorkflows(
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersion.id,
  );
  const plan = usePlanLawOcrWorkflow(
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersion.id,
  );
  const transition = useTransitionLawOcrWorkflow(
    tenantId,
    matterId,
    evidenceItemId,
    evidenceVersion.id,
  );
  const workflow = workflows.data?.[0];
  const quotaPaused = workflow?.status === "paused" && workflow.resource_source === "personal_mineru"
    && workflow.segments.some((segment) => segment.status === "failed"
      && segment.last_error_code === "OCR_PERSONAL_QUOTA_EXHAUSTED" && segment.quota_pre_submit_confirmed);
  const pending = plan.isPending || transition.isPending || quotePending;
  const requestError = plan.error ?? transition.error ?? workflows.error;

  function runTransition(action: "start" | "pause" | "resume" | "continue-paid" | "cancel") {
    if (!workflow) return;
    const quote = controlledQuote?.workflowId === workflow.id && controlledQuote.version === workflow.version ? controlledQuote.quote : null;
    if ((action === "start" && workflow.resource_source === "platform_ocr") || (action === "continue-paid" && quotaPaused)) {
      if (!quote) {
        setQuotePending(true);
        setQuoteError(null);
        void quoteOcrWorkflow(tenantId, matterId, evidenceItemId, evidenceVersion.id, workflow.id)
          .then((value) => setControlledQuote({ workflowId: workflow.id, version: workflow.version, quote: value }))
          .catch((error: unknown) => setQuoteError(errorText(error)))
          .finally(() => setQuotePending(false));
        return;
      }
      const amount = Number(quote.quoted_total_microunits);
      if (!Number.isSafeInteger(amount) || (!quote.accepted && new Date(quote.expires_at).getTime() <= Date.now())) {
        setControlledQuote(null);
        setQuoteError(locale === "zh-CN" ? "报价已过期或金额超出可处理范围，请重新获取。" : "The quote expired or exceeds the supported amount. Get a new quote.");
        return;
      }
      transition.mutate({ workflowId: workflow.id, action, expectedVersion: workflow.version,
        consent: { quoteId: quote.quote_id, maxTotalMicrounits: quote.quoted_total_microunits } });
      return;
    }
    transition.mutate({
      workflowId: workflow.id,
      action,
      expectedVersion: workflow.version,
    });
  }

  if (workflows.isPending) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <section
      className="rounded-xl border bg-gradient-to-br from-background to-muted/30 p-4"
      aria-labelledby="document-ocr-workflow-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileScanIcon className="text-primary size-4" />
            <h3 id="document-ocr-workflow-title" className="text-sm font-semibold">
              {copy.title}
            </h3>
            {workflow ? (
              <Badge
                variant={
                  workflow.status === "failed" || workflow.failed_pages > 0
                    ? "destructive"
                    : workflow.status === "running"
                      ? "secondary"
                      : "outline"
                }
              >
                {statusLabel(workflow, copy)}
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-1 max-w-3xl text-xs leading-5">
            {copy.description}
          </p>
        </div>

        {!workflow ? (
          <div className="flex flex-col items-end gap-2">
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <span>{copy.source}</span>
              <select className="border-input bg-background rounded border px-2 py-1" value={resourceSource} onChange={(event) => setResourceSource(event.target.value as "tenant_default" | "personal_mineru" | "platform_ocr")}>
                <option value="tenant_default">{copy.tenantSource}</option>
                {personal?.configured && personal.execution_available ? <option value="personal_mineru">{copy.personal}</option> : null}
                <option value="platform_ocr">{copy.platformSource}</option>
              </select>
            </label>
          <Button
            size="sm"
            disabled={pending || evidenceVersion.scan_status !== "clean"}
            onClick={() =>
              plan.mutate({
                language: "auto",
                enable_table: true,
                enable_formula: false,
                target_segment_pages: 20,
                resource_source: resourceSource,
              })
            }
          >
            {plan.isPending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <FileScanIcon />
            )}
            {plan.isPending ? copy.preparing : copy.prepare}
          </Button>
          </div>
        ) : null}
      </div>

      {!workflow && evidenceVersion.scan_status !== "clean" ? (
        <p className="text-muted-foreground mt-3 text-xs">{copy.unavailable}</p>
      ) : null}
      {!workflow && resourceSource === "personal_mineru" ? <p className="text-muted-foreground mt-2 text-xs">{copy.quotaUnknown}</p> : null}

      {requestError ? (
        <div className="text-destructive mt-3 flex items-center gap-2 text-sm" role="alert">
          <span className="min-w-0 flex-1">{errorText(requestError)}</span>
          <Button size="sm" variant="outline" onClick={() => void workflows.refetch()}>
            <RotateCcwIcon />
            {copy.retry}
          </Button>
        </div>
      ) : null}
      {quoteError ? <p className="text-destructive mt-3 text-sm" role="alert">{quoteError}</p> : null}

      {workflow ? (
        <div className="mt-4 space-y-4">
          {((workflow.status === "planned" && workflow.resource_source === "platform_ocr") || quotaPaused) && controlledQuote?.workflowId === workflow.id && controlledQuote.version === workflow.version ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status">
              <p className="font-medium">{controlledQuote.quote.billing_mode === "record_only"
                ? locale === "zh-CN" ? "本次仅记账，律所实扣为 0；律师参考费用" : "Usage recording only; firm charge is zero. Lawyer reference amount"
                : copy.chargeLimit}：{controlledQuote.quote.currency} {(
                BigInt(controlledQuote.quote.quoted_total_microunits) / 1_000_000n
              ).toString()}.{(
                BigInt(controlledQuote.quote.quoted_total_microunits) % 1_000_000n
              ).toString().padStart(6, "0")}（{controlledQuote.quote.quoted_pages} {copy.pages}）</p>
              <p className="mt-1">{controlledQuote.quote.billing_mode === "record_only"
                ? locale === "zh-CN" ? "识别成功并交付的页数和参考费用记在你的名下，不从律所预充值扣款。" : "Delivered pages and reference value are attributed to you, with no prepaid deduction."
                : copy.chargeNotice}</p>
              <p className="mt-1 text-xs">{controlledQuote.quote.accepted
                ? locale === "zh-CN" ? "该工作流报价已确认" : "This workflow quote was already confirmed"
                : `${locale === "zh-CN" ? "报价有效至" : "Quote expires"} ${new Date(controlledQuote.quote.expires_at).toLocaleString(locale)}`}</p>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium">
                  {workflow.ready_pages}/{workflow.selected_page_count} {copy.pages} {copy.ready}
                </span>
                <span className="text-muted-foreground">
                  {workflow.segments.length} {copy.segments}
                  {workflow.failed_pages > 0
                    ? ` · ${workflow.failed_pages} ${copy.pages} ${copy.failed}`
                    : ""}
                </span>
              </div>
              <Progress
                className="mt-2"
                value={(workflow.ready_pages / workflow.selected_page_count) * 100}
                aria-label={`${workflow.ready_pages}/${workflow.selected_page_count}`}
              />
              <p className="text-muted-foreground mt-2 text-xs" aria-live="polite">
                {workflow.status === "planned"
                  ? `${copy.planReady}：${workflow.page_count} ${copy.pages}，${workflow.segments.length} ${copy.segments}`
                  : workflow.status === "awaiting_review"
                    ? copy.completedHint
                    : copy.activeHint}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {workflow.status === "planned" ? (
                <Button size="sm" disabled={pending} onClick={() => runTransition("start")}>
                  {pending ? <LoaderCircleIcon className="animate-spin" /> : <CirclePlayIcon />}
                  {workflow.resource_source === "platform_ocr"
                    ? controlledQuote?.workflowId === workflow.id
                      ? controlledQuote.quote.billing_mode === "record_only"
                        ? locale === "zh-CN" ? "确认记账并开始" : "Confirm usage and start"
                        : copy.confirmCharge
                      : quotePending ? copy.quoting : copy.quote
                    : copy.start}
                </Button>
              ) : null}
              {workflow.status === "running" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => runTransition("pause")}
                >
                  <CirclePauseIcon />
                  {copy.pause}
                </Button>
              ) : null}
              {workflow.status === "paused" ? (
                <>
                  <Button size="sm" disabled={pending} onClick={() => runTransition("resume")}>
                    <CirclePlayIcon />
                    {copy.resume}
                  </Button>
                  {quotaPaused ? (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => runTransition("continue-paid")}>
                      {controlledQuote?.workflowId === workflow.id && controlledQuote.version === workflow.version
                        ? copy.confirmCharge : quotePending ? copy.quoting : copy.quote}
                    </Button>
                  ) : null}
                </>
              ) : null}
              {["planned", "running", "paused"].includes(workflow.status) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => runTransition("cancel")}
                >
                  <SquareIcon />
                  {copy.cancel}
                </Button>
              ) : null}
            </div>
          </div>

          <details className="group rounded-lg border bg-background/70">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium">
              <span>{copy.segmentList}</span>
              <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t px-3 py-2">
              <div className="space-y-2">
                {workflow.segments.map((segment) => (
                  <div
                    key={segment.id}
                    className="grid gap-2 rounded-md border px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <p className="font-medium">
                        {copy.segment} {segment.sequence_number} · {pageRange(segment)} {copy.pages}
                      </p>
                      <p className="text-muted-foreground mt-0.5">
                        {segment.resource_source === "personal_mineru"
                          ? copy.personal
                          : segment.resource_source === "platform_ocr"
                            ? copy.platformSource
                            : copy.tenantSource} · {segment.page_count} {copy.pages}
                      </p>
                      {segment.last_error_code && <p className="text-destructive mt-1">{segmentError(segment, copy)}</p>}
                    </div>
                    <Badge
                      variant={segment.status === "failed" ? "destructive" : "outline"}
                      className={cn(segment.status === "processing" && "animate-pulse")}
                    >
                      {copy[segment.status]}
                    </Badge>
                    {segment.status === "ready" && segment.ocr_job_id ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onOpenJob(segment.ocr_job_id!)}
                      >
                        {copy.viewResult}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>
      ) : null}
    </section>
  );
}
