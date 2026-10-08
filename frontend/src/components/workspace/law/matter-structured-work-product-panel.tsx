"use client";

import {
  AlertTriangleIcon,
  CheckIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useLawCaseWorkbench,
  useLawWorkProductProposals,
  useLawWorkProductProposalComparison,
  useLawProjectArtifactContent,
  useLawProjectArtifactSources,
  useLawProjectArtifactVersions,
  useLawProjectArtifacts,
  useAcceptLawWorkProductProposal,
  useRejectLawWorkProductProposal,
  useSaveWorkspaceEditorArtifact,
  useReadLegalAuthorityVersion,
} from "@/core/law/hooks";
import type {
  ProjectArtifact,
  WorkProductProposalChange,
} from "@/core/law/types";

import { EvidenceWorkbench } from "./evidence-workbench";

type AnalysisCategory =
  | "material_record"
  | "party_assertion"
  | "lawyer_inference"
  | "issue"
  | "evidence_conflict"
  | "information_gap";

interface AnalysisEntry {
  id: string;
  category: AnalysisCategory;
  text: string;
  source_refs: string[];
}

interface CaseAnalysisDocument {
  format: "matrix-law.case-analysis";
  schema_version: 1;
  entries: AnalysisEntry[];
}

interface StrategyPath {
  id: string;
  title: string;
  conditions: string[];
  issue_ids: string[];
  source_refs: string[];
  legal_authority_refs: Array<{
    document_id: string;
    version_id: string;
    review_id: string | null;
  }>;
  risks: string[];
  alternatives: string[];
  next_actions: string[];
}

interface StrategyDocument {
  format: "matrix-law.litigation-strategy";
  schema_version: 1;
  analysis_version_id: string;
  representative_position: "plaintiff" | "defendant" | "other";
  objective: string;
  paths: StrategyPath[];
}

type WorkProductSource =
  | {
      type: "citation";
      citationId: string;
      evidenceItemId: string;
      evidenceVersionId: string;
      physicalPageNumber: number | null;
    }
  | {
      type: "authority";
      documentId: string;
      versionId: string;
      reviewId: string | null;
    };

const ANALYSIS_CATEGORIES: AnalysisCategory[] = [
  "material_record",
  "party_assertion",
  "lawyer_inference",
  "issue",
  "evidence_conflict",
  "information_gap",
];

function parseJson<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function displayCategory(category: AnalysisCategory, zh: boolean) {
  const names: Record<AnalysisCategory, { zh: string; en: string }> = {
    material_record: { zh: "材料记载", en: "Material record" },
    party_assertion: { zh: "当事人主张", en: "Party assertion" },
    lawyer_inference: { zh: "律师或 AI 推断", en: "Lawyer or AI inference" },
    issue: { zh: "争点", en: "Issue" },
    evidence_conflict: { zh: "证据冲突", en: "Evidence conflict" },
    information_gap: { zh: "信息缺口", en: "Information gap" },
  };
  return names[category][zh ? "zh" : "en"];
}

function CurrentStructuredVersion({
  tenantId,
  matterId,
  artifact,
  locale,
}: {
  tenantId: string;
  matterId: string;
  artifact: ProjectArtifact | undefined;
  locale: "zh-CN" | "en-US";
}) {
  const versionsQuery = useLawProjectArtifactVersions(
    tenantId,
    matterId,
    artifact?.id ?? null,
  );
  const currentVersion = versionsQuery.data?.find(
    (version) => version.version_number === artifact?.current_version_number,
  );
  const contentQuery = useLawProjectArtifactContent(currentVersion ?? null);
  const sourcesQuery = useLawProjectArtifactSources(
    tenantId,
    matterId,
    artifact?.id ?? null,
    currentVersion?.id ?? null,
  );
  const zh = locale === "zh-CN";
  const [selectedSource, setSelectedSource] =
    useState<WorkProductSource | null>(null);

  useEffect(() => {
    setSelectedSource(null);
  }, [artifact?.id, currentVersion?.id]);

  if (!artifact) return null;
  if (
    versionsQuery.isPending ||
    (currentVersion && (contentQuery.isPending || sourcesQuery.isPending))
  ) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (
    versionsQuery.isError ||
    !currentVersion ||
    contentQuery.isError ||
    sourcesQuery.isError ||
    !sourcesQuery.data
  ) {
    return (
      <Card role="alert">
        <CardContent className="text-destructive pt-5 text-sm">
          {zh
            ? "无法读取当前成果版本或核验来源；来源状态不可用。"
            : "Unable to read the current version or verify its sources."}
        </CardContent>
      </Card>
    );
  }

  const manifest = sourcesQuery.data.source_manifest;
  const citations = Array.isArray(manifest?.citations)
    ? (manifest.citations as Array<Record<string, unknown>>)
    : [];
  const authorities = Array.isArray(manifest?.authorities)
    ? (manifest.authorities as Array<Record<string, unknown>>)
    : [];

  return (
    <div className="space-y-3">
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline">V{currentVersion.version_number}</Badge>
        <span>{zh ? "来源校验" : "Source receipt"}:</span>
        <Badge
          variant={
            sourcesQuery.data.source_state === "bound" ? "secondary" : "outline"
          }
        >
          {sourcesQuery.data.source_state === "bound"
            ? zh
              ? "已绑定精确版本"
              : "Exact versions bound"
            : zh
              ? "未记录来源"
              : "No source record"}
        </Badge>
        {artifact.kind === "litigation_strategy" &&
          currentVersion.derived_from_version_id && (
            <span>
              {zh ? "依据案情版本" : "Based on analysis version"}:{" "}
              {currentVersion.derived_from_version_id.slice(0, 8)}
            </span>
          )}
      </div>
      {(citations.length > 0 || authorities.length > 0) && (
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            {zh
              ? `查看来源回执（材料 ${citations.length} · 法源 ${authorities.length}）`
              : `View source receipt (${citations.length} materials · ${authorities.length} authorities)`}
          </summary>
          <div className="mt-3 space-y-2">
            {citations.map((citation) => (
              <div
                key={String(citation.citation_id)}
                className="bg-muted/40 rounded p-2"
              >
                <div className="font-medium">
                  {zh ? "材料引用" : "Material citation"} ·{" "}
                  {typeof citation.physical_page_number === "number"
                    ? citation.physical_page_number
                    : "—"}
                  {zh ? " 页" : " page"}
                </div>
                <div className="text-muted-foreground text-xs break-all">
                  {String(citation.evidence_item_id)} /{" "}
                  {String(citation.evidence_version_id)}
                </div>
                {typeof citation.citation_id === "string" &&
                  typeof citation.evidence_item_id === "string" &&
                  typeof citation.evidence_version_id === "string" && (
                    <Button
                      className="mt-2 h-auto px-0"
                      size="sm"
                      variant="link"
                      onClick={() =>
                        setSelectedSource({
                          type: "citation",
                          citationId: citation.citation_id as string,
                          evidenceItemId: citation.evidence_item_id as string,
                          evidenceVersionId:
                            citation.evidence_version_id as string,
                          physicalPageNumber:
                            typeof citation.physical_page_number === "number"
                              ? citation.physical_page_number
                              : null,
                        })
                      }
                    >
                      {zh ? "打开精确材料来源" : "Open exact material source"}
                    </Button>
                  )}
              </div>
            ))}
            {authorities.map((authority) => (
              <div
                key={String(authority.version_id)}
                className="bg-muted/40 rounded p-2"
              >
                <div className="font-medium">
                  {zh ? "法源版本" : "Authority version"}
                </div>
                <div className="text-muted-foreground text-xs break-all">
                  {typeof authority.document_id === "string"
                    ? authority.document_id
                    : "—"}{" "}
                  /{" "}
                  {typeof authority.version_id === "string"
                    ? authority.version_id
                    : "—"}
                  {typeof authority.review_id === "string"
                    ? ` · ${zh ? "审核" : "review"} ${authority.review_id}`
                    : ` · ${zh ? "未核验" : "unreviewed"}`}
                </div>
                {typeof authority.document_id === "string" &&
                  typeof authority.version_id === "string" && (
                    <Button
                      className="mt-2 h-auto px-0"
                      size="sm"
                      variant="link"
                      onClick={() =>
                        setSelectedSource({
                          type: "authority",
                          documentId: authority.document_id as string,
                          versionId: authority.version_id as string,
                          reviewId:
                            typeof authority.review_id === "string"
                              ? authority.review_id
                              : null,
                        })
                      }
                    >
                      {zh ? "打开精确法源版本" : "Open exact authority version"}
                    </Button>
                  )}
              </div>
            ))}
          </div>
        </details>
      )}
      {selectedSource?.type === "citation" && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setSelectedSource(null);
          }}
        >
          <DialogContent className="h-[90vh] max-w-6xl overflow-hidden">
            <DialogHeader>
              <DialogTitle>
                {zh ? "精确材料来源" : "Exact material source"}
              </DialogTitle>
              <DialogDescription>
                {zh
                  ? `固定材料版本与引用 ${selectedSource.citationId}；服务端重新核验当前访问权限。`
                  : `Pinned material version and citation ${selectedSource.citationId}; access is checked by the server.`}
              </DialogDescription>
            </DialogHeader>
            <div className="h-[72vh] min-h-0 overflow-hidden">
              <EvidenceWorkbench
                key={selectedSource.citationId}
                tenantId={tenantId}
                matterId={matterId}
                locale={locale}
                mode="document"
                initialEvidenceId={selectedSource.evidenceItemId}
                initialEvidenceVersionId={selectedSource.evidenceVersionId}
                initialCitationId={selectedSource.citationId}
                initialPage={selectedSource.physicalPageNumber ?? undefined}
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
      {selectedSource?.type === "authority" && (
        <AuthoritySourceDialog
          key={`${selectedSource.documentId}:${selectedSource.versionId}`}
          tenantId={tenantId}
          matterId={matterId}
          source={selectedSource}
          locale={locale}
          onClose={() => setSelectedSource(null)}
        />
      )}
    </div>
  );
}

function AuthoritySourceDialog({
  tenantId,
  matterId,
  source,
  locale,
  onClose,
}: {
  tenantId: string;
  matterId: string;
  source: Extract<WorkProductSource, { type: "authority" }>;
  locale: "zh-CN" | "en-US";
  onClose: () => void;
}) {
  const zh = locale === "zh-CN";
  const [offset, setOffset] = useState(0);
  const query = useReadLegalAuthorityVersion(
    tenantId,
    matterId,
    source.documentId,
    source.versionId,
    offset,
    true,
  );
  const content = query.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {zh ? "精确法源版本" : "Exact authority version"}
          </DialogTitle>
          <DialogDescription className="break-all">
            {source.documentId} / {source.versionId}
            {source.reviewId
              ? ` · ${zh ? "审核记录" : "Review"} ${source.reviewId}`
              : ` · ${zh ? "保存时未绑定审核记录" : "No review was bound at save time"}`}
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError || !content ? (
          <p role="alert" className="text-destructive text-sm">
            {zh
              ? "无法读取该法源版本；不会切换到其他版本。"
              : "This authority version could not be read; no other version was substituted."}
          </p>
        ) : (
          <div className="space-y-3 overflow-auto">
            <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>{content.version.title}</span>
              <span>
                {content.version.document_type ?? content.version.issuer ?? "—"}
              </span>
              <span>{content.version.content_sha256}</span>
              <span>
                {source.reviewId
                  ? `${zh ? "绑定审核记录" : "Bound review"}: ${source.reviewId}`
                  : zh
                    ? "未绑定审核记录"
                    : "No bound review"}
              </span>
            </div>
            <a
              className="text-primary text-xs break-all underline"
              href={content.official_url}
              target="_blank"
              rel="noreferrer"
            >
              {content.official_url}
            </a>
            <pre className="max-h-[55vh] overflow-auto rounded-md border p-3 text-sm whitespace-pre-wrap">
              {content.text_chunk}
            </pre>
            {content.next_offset !== null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOffset(content.next_offset!)}
                disabled={query.isFetching}
              >
                {zh ? "读取下一段原文" : "Read next source segment"}
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MatterProposalReviewPanel({
  tenantId,
  matterId,
  kind,
  locale,
}: {
  tenantId: string;
  matterId: string;
  kind: "case_analysis" | "litigation_strategy";
  locale: "zh-CN" | "en-US";
}) {
  const zh = locale === "zh-CN";
  const proposalsQuery = useLawWorkProductProposals(tenantId, matterId);
  const permissionQuery = useLawCaseWorkbench(tenantId, matterId);
  const allProposals = proposalsQuery.data ?? [];
  const proposals = allProposals.filter((item) => item.kind === kind);
  const pending = proposals.filter((item) => item.status === "pending");
  const [proposalId, setProposalId] = useState<string | null>(null);
  const comparisonQuery = useLawWorkProductProposalComparison(
    tenantId,
    matterId,
    proposalId,
  );
  const [selectedChangeIds, setSelectedChangeIds] = useState<string[]>([]);
  const acceptMutation = useAcceptLawWorkProductProposal(tenantId, matterId);
  const rejectMutation = useRejectLawWorkProductProposal(tenantId, matterId);
  const comparison = comparisonQuery.data;
  const proposal = proposals.find((item) => item.id === proposalId);

  useEffect(() => {
    if (!proposalId || !pending.some((item) => item.id === proposalId)) {
      setProposalId(pending[0]?.id ?? null);
    }
  }, [pending, proposalId]);

  useEffect(() => {
    setSelectedChangeIds([]);
  }, [proposalId, comparison?.proposal.version]);

  const copy = zh
    ? {
        title: "待处理 AI 建议",
        loading: "正在读取候选建议…",
        failed: "候选建议读取失败；不会用空列表替代。",
        empty: "目前没有待处理的 AI 候选建议。",
        pending: "待律师决定",
        accepted: "已采纳",
        rejected: "已拒绝",
        expired: "已过期",
        stale: "基础案情或策略已变化。请重新生成候选后再决定。",
        select: "选择候选",
        added: "新增",
        modified: "修改",
        deleted: "删除",
        before: "当前版本",
        after: "候选版本",
        accept: "采纳所选变更",
        reject: "拒绝候选",
        noPermission: "当前身份无权决定 AI 候选。",
        noneSelected: "先逐项勾选要采纳的变更。",
        source: "候选来源清单摘要",
        saving: "提交中…",
      }
    : {
        title: "AI proposals awaiting review",
        loading: "Loading candidate proposals…",
        failed:
          "Candidate proposals could not be loaded; unavailable data is not shown as empty.",
        empty: "There are no pending AI proposals.",
        pending: "Awaiting lawyer decision",
        accepted: "Accepted",
        rejected: "Rejected",
        expired: "Expired",
        stale:
          "The base analysis or strategy changed. Generate a fresh candidate before deciding.",
        select: "Select candidate",
        added: "Added",
        modified: "Modified",
        deleted: "Deleted",
        before: "Current version",
        after: "Candidate version",
        accept: "Accept selected changes",
        reject: "Reject candidate",
        noPermission: "This identity cannot decide AI proposals.",
        noneSelected: "Select the changes you want to accept.",
        source: "Candidate source manifest digest",
        saving: "Submitting…",
      };

  function changeLabel(change: WorkProductProposalChange) {
    const kindLabel =
      change.change === "added"
        ? copy.added
        : change.change === "deleted"
          ? copy.deleted
          : copy.modified;
    return `${kindLabel} · ${change.item_id}`;
  }

  function prettyValue(value: unknown) {
    if (value === null || value === undefined) return zh ? "（无）" : "(none)";
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  function toggleChange(changeId: string) {
    setSelectedChangeIds((current) =>
      current.includes(changeId)
        ? current.filter((id) => id !== changeId)
        : [...current, changeId],
    );
  }

  async function acceptSelected() {
    if (!proposal || !comparison || comparison.is_stale) return;
    await acceptMutation.mutateAsync({
      tenantId,
      matterId,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      selectedChangeIds,
      idempotencyKey: crypto.randomUUID(),
    });
    setProposalId(null);
    setSelectedChangeIds([]);
  }

  async function rejectSelected() {
    if (!proposal) return;
    await rejectMutation.mutateAsync({
      tenantId,
      matterId,
      proposalId: proposal.id,
      proposalVersion: proposal.version,
      decisionNote: zh
        ? "律师未采纳此候选。"
        : "Lawyer did not accept this candidate.",
      idempotencyKey: crypto.randomUUID(),
    });
    setProposalId(null);
    setSelectedChangeIds([]);
  }

  const stateLabel = (status: string) =>
    status === "accepted"
      ? copy.accepted
      : status === "rejected"
        ? copy.rejected
        : status === "expired"
          ? copy.expired
          : copy.pending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{copy.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {proposalsQuery.isPending ? (
          <p className="text-muted-foreground text-sm">{copy.loading}</p>
        ) : proposalsQuery.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {copy.failed}
          </p>
        ) : pending.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.empty}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2" aria-label={copy.select}>
              {pending.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={item.id === proposalId ? "default" : "outline"}
                  onClick={() => setProposalId(item.id)}
                >
                  {item.id.slice(0, 8)} · V{item.version}
                </Button>
              ))}
            </div>
            {comparisonQuery.isPending ? (
              <Skeleton className="h-36 w-full" />
            ) : comparisonQuery.isError || !comparison || !proposal ? (
              <p role="alert" className="text-destructive text-sm">
                {copy.failed}
              </p>
            ) : (
              <>
                <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">{stateLabel(proposal.status)}</Badge>
                  <span>
                    {zh ? "生成于" : "Created"}:{" "}
                    {new Date(proposal.created_at).toLocaleString(locale)}
                  </span>
                  <span className="break-all">
                    {copy.source}:{" "}
                    {proposal.source_manifest_sha256.slice(0, 16)}
                  </span>
                </div>
                {comparison.is_stale && (
                  <div
                    role="alert"
                    className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                  >
                    <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                    <span>{copy.stale}</span>
                  </div>
                )}
                <div className="space-y-3">
                  {comparison.changes.map((change) => (
                    <section
                      key={change.change_id}
                      className="space-y-2 rounded-md border p-3"
                    >
                      <label className="flex cursor-pointer items-start gap-2 text-sm font-medium">
                        <input
                          className="mt-1"
                          type="checkbox"
                          checked={selectedChangeIds.includes(change.change_id)}
                          onChange={() => toggleChange(change.change_id)}
                          disabled={
                            comparison.is_stale || acceptMutation.isPending
                          }
                        />
                        <span>{changeLabel(change)}</span>
                      </label>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="text-muted-foreground mb-1 text-xs">
                            {copy.before}
                          </p>
                          <pre className="bg-muted/40 max-h-44 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                            {prettyValue(change.before)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-muted-foreground mb-1 text-xs">
                            {copy.after}
                          </p>
                          <pre className="bg-muted/40 max-h-44 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                            {prettyValue(change.after)}
                          </pre>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
                {!permissionQuery.data?.permissions.can_edit && (
                  <p className="text-muted-foreground text-sm">
                    {copy.noPermission}
                  </p>
                )}
                {selectedChangeIds.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    {copy.noneSelected}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={
                      !permissionQuery.data?.permissions.can_edit ||
                      comparison.is_stale ||
                      selectedChangeIds.length === 0 ||
                      acceptMutation.isPending ||
                      rejectMutation.isPending
                    }
                    onClick={() => void acceptSelected()}
                  >
                    <CheckIcon />
                    {acceptMutation.isPending ? copy.saving : copy.accept}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      !permissionQuery.data?.permissions.can_edit ||
                      rejectMutation.isPending ||
                      acceptMutation.isPending
                    }
                    onClick={() => void rejectSelected()}
                  >
                    <XIcon />
                    {rejectMutation.isPending ? copy.saving : copy.reject}
                  </Button>
                </div>
                {(acceptMutation.isError || rejectMutation.isError) && (
                  <p role="alert" className="text-destructive text-sm">
                    {acceptMutation.error?.message ??
                      rejectMutation.error?.message}
                  </p>
                )}
              </>
            )}
          </>
        )}
        {proposals.length > pending.length && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">
              {zh ? "已处理的候选" : "Resolved candidates"}
            </summary>
            <div className="mt-2 space-y-1">
              {proposals
                .filter((item) => item.status !== "pending")
                .slice(0, 10)
                .map((item) => (
                  <div
                    key={item.id}
                    className="text-muted-foreground flex gap-2 text-xs"
                  >
                    <Badge variant="outline">{stateLabel(item.status)}</Badge>
                    <span>{item.id.slice(0, 8)}</span>
                    {item.result_version_id && (
                      <span>
                        {zh ? "成果版本" : "Result version"}{" "}
                        {item.result_version_id.slice(0, 8)}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

export function MatterCaseAnalysisPanel({
  tenantId,
  matterId,
  locale,
}: {
  tenantId: string;
  matterId: string;
  locale: "zh-CN" | "en-US";
}) {
  const zh = locale === "zh-CN";
  const artifactsQuery = useLawProjectArtifacts(tenantId, matterId);
  const artifact = artifactsQuery.data?.find(
    (item) => item.kind === "case_analysis" && item.status === "active",
  );
  const versionsQuery = useLawProjectArtifactVersions(
    tenantId,
    matterId,
    artifact?.id ?? null,
  );
  const currentVersion = versionsQuery.data?.find(
    (version) => version.version_number === artifact?.current_version_number,
  );
  const contentQuery = useLawProjectArtifactContent(currentVersion ?? null);
  const saveMutation = useSaveWorkspaceEditorArtifact(tenantId, matterId);
  const permissionQuery = useLawCaseWorkbench(tenantId, matterId);
  const loaded = useMemo(
    () => parseJson<CaseAnalysisDocument>(contentQuery.data),
    [contentQuery.data],
  );
  const [draft, setDraft] = useState<CaseAnalysisDocument | null>(null);
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty && loaded) {
      setDraft(loaded);
      setBaseVersionId(currentVersion?.id ?? null);
    }
  }, [currentVersion?.id, dirty, loaded]);

  const categoryLabels = zh
    ? {
        title: "案情与证据",
        empty:
          "尚无已保存的案情分析。可从空白记录开始，逐条记录材料内容、主张、推断、争点、冲突与缺口。",
        create: "创建空白分析",
        add: "添加条目",
        save: "保存新版本",
        saving: "保存中…",
        conflict:
          "案情分析已产生新版本。请先刷新并比较，未保存的编辑仍保留在当前窗口。",
        noPermission: "当前身份无权编辑案情成果。",
        invalid: "当前版本不是受支持的案情分析格式。",
        noText: "暂无条目。",
      }
    : {
        title: "Case facts and evidence",
        empty:
          "No saved analysis yet. Start from a blank record and separate source records, party assertions, inferences, issues, conflicts, and gaps.",
        create: "Create blank analysis",
        add: "Add entry",
        save: "Save new version",
        saving: "Saving…",
        conflict:
          "A newer analysis version exists. Refresh and compare before saving; this window's unsaved edits are preserved.",
        noPermission: "This identity cannot edit case work products.",
        invalid:
          "The current version does not match the supported analysis format.",
        noText: "No entries yet.",
      };

  function updateEntry(index: number, patch: Partial<AnalysisEntry>) {
    if (!draft) return;
    setDirty(true);
    setDraft({
      ...draft,
      entries: draft.entries.map((entry, i) =>
        i === index ? { ...entry, ...patch } : entry,
      ),
    });
  }

  async function save(nextDraft: CaseAnalysisDocument, isCreate = false) {
    if (!permissionQuery.data?.permissions.can_edit) return;
    await saveMutation.mutateAsync({
      tenantId,
      matterId,
      content: JSON.stringify(nextDraft),
      title: artifact?.title ?? (zh ? "案情分析" : "Case analysis"),
      kind: "case_analysis",
      artifactId: isCreate ? undefined : artifact?.id,
      expectedVersion: isCreate ? undefined : artifact?.version,
      idempotencyKey: crypto.randomUUID(),
    });
    setDirty(false);
    setDraft(null);
  }

  if (artifactsQuery.isPending) return <Skeleton className="h-44 w-full" />;
  if (artifactsQuery.isError)
    return (
      <Card role="alert">
        <CardContent className="text-destructive pt-5 text-sm">
          {zh
            ? "案情成果读取失败；不会用空数据替代。"
            : "Case analysis could not be loaded; unavailable data is not shown as empty."}
        </CardContent>
      </Card>
    );
  if (!artifact) {
    const blank: CaseAnalysisDocument = {
      format: "matrix-law.case-analysis",
      schema_version: 1,
      entries: [],
    };
    return (
      <Card>
        <CardHeader>
          <CardTitle>{categoryLabels.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {categoryLabels.empty}
          </p>
          <Button
            disabled={
              !permissionQuery.data?.permissions.can_edit ||
              saveMutation.isPending
            }
            onClick={() => void save(blank, true)}
          >
            <PlusIcon />
            {categoryLabels.create}
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (versionsQuery.isPending || contentQuery.isPending)
    return <Skeleton className="h-44 w-full" />;
  if (
    versionsQuery.isError ||
    contentQuery.isError ||
    !loaded ||
    !currentVersion ||
    !draft
  )
    return (
      <Card role="alert">
        <CardContent className="text-destructive pt-5 text-sm">
          {categoryLabels.invalid}
        </CardContent>
      </Card>
    );
  const hasVersionConflict = dirty && baseVersionId !== currentVersion.id;

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{categoryLabels.title}</CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">
            {zh
              ? `当前版本 V${currentVersion.version_number}`
              : `Current version V${currentVersion.version_number}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={saveMutation.isPending}
            onClick={() => void artifactsQuery.refetch()}
          >
            <RefreshCwIcon />
            {zh ? "刷新版本" : "Refresh version"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={
              !permissionQuery.data?.permissions.can_edit ||
              saveMutation.isPending
            }
            onClick={() => {
              setDirty(true);
              setDraft({
                ...draft,
                entries: [
                  ...draft.entries,
                  {
                    id: crypto.randomUUID(),
                    category: "information_gap",
                    text: "",
                    source_refs: [],
                  },
                ],
              });
            }}
          >
            <PlusIcon />
            {categoryLabels.add}
          </Button>
          <Button
            size="sm"
            disabled={
              !dirty ||
              !permissionQuery.data?.permissions.can_edit ||
              saveMutation.isPending ||
              hasVersionConflict
            }
            onClick={() => void save(draft)}
          >
            <SaveIcon />
            {saveMutation.isPending
              ? categoryLabels.saving
              : categoryLabels.save}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasVersionConflict && (
          <div
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            {categoryLabels.conflict}
          </div>
        )}
        {!permissionQuery.data?.permissions.can_edit && (
          <p className="text-muted-foreground text-sm">
            {categoryLabels.noPermission}
          </p>
        )}
        {draft.entries.length === 0 && (
          <p className="text-muted-foreground text-sm">
            {categoryLabels.noText}
          </p>
        )}
        {draft.entries.map((entry, index) => (
          <section key={entry.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {displayCategory(entry.category, zh)}
                </Badge>
                <code className="text-muted-foreground text-xs">
                  {entry.id.slice(0, 8)}
                </code>
                <select
                  aria-label={zh ? "条目类别" : "Entry category"}
                  className="bg-background h-8 rounded-md border px-2 text-xs"
                  value={entry.category}
                  disabled={!permissionQuery.data?.permissions.can_edit}
                  onChange={(event) =>
                    updateEntry(index, {
                      category: event.target.value as AnalysisCategory,
                    })
                  }
                >
                  {ANALYSIS_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {displayCategory(category, zh)}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={zh ? "删除条目" : "Remove entry"}
                disabled={!permissionQuery.data?.permissions.can_edit}
                onClick={() => {
                  setDirty(true);
                  setDraft({
                    ...draft,
                    entries: draft.entries.filter((_, i) => i !== index),
                  });
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
            <Textarea
              value={entry.text}
              disabled={!permissionQuery.data?.permissions.can_edit}
              onChange={(event) =>
                updateEntry(index, { text: event.target.value })
              }
              rows={3}
              aria-label={displayCategory(entry.category, zh)}
            />
            <p className="text-muted-foreground text-xs">
              {zh ? "来源引用" : "Source references"}:{" "}
              {entry.source_refs.length
                ? entry.source_refs.map((id) => id.slice(0, 8)).join(" · ")
                : zh
                  ? "未绑定"
                  : "Unbound"}
            </p>
          </section>
        ))}
        {saveMutation.isError && (
          <p role="alert" className="text-destructive text-sm">
            {saveMutation.error.message}
          </p>
        )}
        <CurrentStructuredVersion
          tenantId={tenantId}
          matterId={matterId}
          artifact={artifact}
          locale={locale}
        />
      </CardContent>
    </Card>
  );
}

export function MatterLitigationStrategyPanel({
  tenantId,
  matterId,
  locale,
}: {
  tenantId: string;
  matterId: string;
  locale: "zh-CN" | "en-US";
}) {
  const zh = locale === "zh-CN";
  const artifactsQuery = useLawProjectArtifacts(tenantId, matterId);
  const artifacts = artifactsQuery.data ?? [];
  const strategy = artifacts.find(
    (item) => item.kind === "litigation_strategy" && item.status === "active",
  );
  const analysis = artifacts.find(
    (item) => item.kind === "case_analysis" && item.status === "active",
  );
  const analysisVersions = useLawProjectArtifactVersions(
    tenantId,
    matterId,
    analysis?.id ?? null,
  );
  const latestAnalysisVersion = analysisVersions.data?.find(
    (version) => version.version_number === analysis?.current_version_number,
  );
  const versionsQuery = useLawProjectArtifactVersions(
    tenantId,
    matterId,
    strategy?.id ?? null,
  );
  const currentVersion = versionsQuery.data?.find(
    (version) => version.version_number === strategy?.current_version_number,
  );
  const contentQuery = useLawProjectArtifactContent(currentVersion ?? null);
  const saveMutation = useSaveWorkspaceEditorArtifact(tenantId, matterId);
  const permissionQuery = useLawCaseWorkbench(tenantId, matterId);
  const loaded = useMemo(
    () => parseJson<StrategyDocument>(contentQuery.data),
    [contentQuery.data],
  );
  const [draft, setDraft] = useState<StrategyDocument | null>(null);
  const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty && loaded) {
      setDraft(loaded);
      setBaseVersionId(currentVersion?.id ?? null);
    }
  }, [currentVersion?.id, dirty, loaded]);

  const copy = zh
    ? {
        title: "诉讼策略",
        empty:
          "暂无已保存策略。策略必须引用一个精确的案情分析版本；先保存案情分析后再创建策略。",
        create: "基于当前案情创建空白策略",
        position: "代理立场",
        plaintiff: "原告方",
        defendant: "被告方",
        other: "其他",
        objective: "主要目标",
        path: "策略路径",
        pathTitle: "路径名称",
        conditions: "适用前提",
        risks: "主要风险",
        alternatives: "替代路径",
        actions: "下一步行动",
        issues: "对应争点 ID",
        sources: "来源引用 ID",
        authorities: "法源版本 ID",
        add: "添加路径",
        save: "保存新版本",
        saving: "保存中…",
        conflict: "策略已有更新版本；请刷新比较后再保存。",
        parentChanged: "所依据的案情已更新；当前策略需要律师复核。",
      }
    : {
        title: "Litigation strategy",
        empty:
          "No saved strategy. A strategy must reference an exact analysis version; save an analysis first.",
        create: "Create blank strategy from current analysis",
        position: "Representation",
        plaintiff: "Plaintiff",
        defendant: "Defendant",
        other: "Other",
        objective: "Main objective",
        path: "Strategy path",
        pathTitle: "Path title",
        conditions: "Conditions",
        risks: "Key risks",
        alternatives: "Alternatives",
        actions: "Next actions",
        issues: "Issue IDs",
        sources: "Source citation IDs",
        authorities: "Authority version IDs",
        add: "Add path",
        save: "Save new version",
        saving: "Saving…",
        conflict:
          "A newer strategy version exists; refresh and compare before saving.",
        parentChanged:
          "The underlying analysis changed; this strategy needs lawyer review.",
      };

  const isStale = Boolean(
    currentVersion?.derived_from_version_id &&
    latestAnalysisVersion &&
    currentVersion.derived_from_version_id !== latestAnalysisVersion.id,
  );

  function updatePath(
    index: number,
    key: "title" | "conditions" | "risks" | "alternatives" | "next_actions",
    value: string,
  ) {
    if (!draft) return;
    setDirty(true);
    setDraft({
      ...draft,
      paths: draft.paths.map((path, i) =>
        i === index
          ? {
              ...path,
              [key]:
                key === "title"
                  ? value
                  : value
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
            }
          : path,
      ),
    });
  }

  async function save(nextDraft: StrategyDocument, isCreate = false) {
    if (
      !permissionQuery.data?.permissions.can_edit ||
      !analysis ||
      !latestAnalysisVersion
    )
      return;
    await saveMutation.mutateAsync({
      tenantId,
      matterId,
      content: JSON.stringify(nextDraft),
      title: strategy?.title ?? (zh ? "诉讼策略" : "Litigation strategy"),
      kind: "litigation_strategy",
      artifactId: isCreate ? undefined : strategy?.id,
      expectedVersion: isCreate ? undefined : strategy?.version,
      derivedFromVersionId: nextDraft.analysis_version_id,
      idempotencyKey: crypto.randomUUID(),
    });
    setDirty(false);
    setDraft(null);
  }

  if (artifactsQuery.isPending) return <Skeleton className="h-44 w-full" />;
  if (artifactsQuery.isError)
    return (
      <Card role="alert">
        <CardContent className="text-destructive pt-5 text-sm">
          {zh
            ? "策略读取失败；不会以空策略代替。"
            : "Strategy could not be loaded; unavailable data is not shown as empty."}
        </CardContent>
      </Card>
    );
  if (!strategy && !draft) {
    if (!analysis || analysisVersions.isPending)
      return (
        <Card>
          <CardHeader>
            <CardTitle>{copy.title}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {copy.empty}
          </CardContent>
        </Card>
      );
    if (!latestAnalysisVersion)
      return (
        <Card role="alert">
          <CardContent className="text-destructive pt-5 text-sm">
            {zh
              ? "无法确认案情分析版本，已停止创建策略。"
              : "The exact analysis version is unavailable; strategy creation is stopped."}
          </CardContent>
        </Card>
      );
    const blank: StrategyDocument = {
      format: "matrix-law.litigation-strategy",
      schema_version: 1,
      analysis_version_id: latestAnalysisVersion.id,
      representative_position: "plaintiff",
      objective: "",
      paths: [
        {
          id: crypto.randomUUID(),
          title: "",
          conditions: [],
          issue_ids: [],
          source_refs: [],
          legal_authority_refs: [],
          risks: [],
          alternatives: [],
          next_actions: [],
        },
      ],
    };
    return (
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">{copy.empty}</p>
          <Button
            disabled={!permissionQuery.data?.permissions.can_edit}
            onClick={() => {
              setDraft(blank);
              setBaseVersionId(null);
              setDirty(true);
            }}
          >
            <PlusIcon />
            {copy.create}
          </Button>
        </CardContent>
      </Card>
    );
  }
  if (strategy && (versionsQuery.isPending || contentQuery.isPending))
    return <Skeleton className="h-44 w-full" />;
  if (
    strategy &&
    (versionsQuery.isError ||
      contentQuery.isError ||
      !loaded ||
      !currentVersion)
  )
    return (
      <Card role="alert">
        <CardContent className="text-destructive pt-5 text-sm">
          {zh
            ? "当前策略版本无法解析，已停止编辑。"
            : "The current strategy version cannot be parsed; editing is stopped."}
        </CardContent>
      </Card>
    );
  if (!draft) return <Skeleton className="h-44 w-full" />;
  const hasVersionConflict = Boolean(
    strategy && dirty && baseVersionId !== currentVersion?.id,
  );
  const incompleteDraft =
    !draft.objective.trim() ||
    draft.paths.length === 0 ||
    draft.paths.some(
      (path) =>
        !path.title.trim() ||
        path.conditions.length === 0 ||
        path.risks.length === 0 ||
        path.alternatives.length === 0 ||
        path.next_actions.length === 0,
    );

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{copy.title}</CardTitle>
          <p className="text-muted-foreground mt-1 text-xs">
            {strategy
              ? `V${currentVersion?.version_number}`
              : zh
                ? "新建草稿"
                : "New draft"}{" "}
            · {zh ? "案情版本" : "Analysis version"}{" "}
            {draft.analysis_version_id.slice(0, 8)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={saveMutation.isPending}
            onClick={() => {
              setDirty(false);
              setDraft(null);
              void artifactsQuery.refetch();
            }}
          >
            <RefreshCwIcon />
            {zh ? "放弃编辑并刷新" : "Discard and refresh"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={
              !permissionQuery.data?.permissions.can_edit ||
              saveMutation.isPending
            }
            onClick={() => {
              setDirty(true);
              setDraft({
                ...draft,
                paths: [
                  ...draft.paths,
                  {
                    id: crypto.randomUUID(),
                    title: "",
                    conditions: [],
                    issue_ids: [],
                    source_refs: [],
                    legal_authority_refs: [],
                    risks: [],
                    alternatives: [],
                    next_actions: [],
                  },
                ],
              });
            }}
          >
            <PlusIcon />
            {copy.add}
          </Button>
          <Button
            size="sm"
            disabled={
              !dirty ||
              incompleteDraft ||
              !permissionQuery.data?.permissions.can_edit ||
              saveMutation.isPending ||
              hasVersionConflict
            }
            onClick={() => void save(draft, !strategy)}
          >
            <SaveIcon />
            {saveMutation.isPending ? copy.saving : copy.save}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isStale && (
          <div
            role="status"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            {copy.parentChanged}
          </div>
        )}
        {hasVersionConflict && (
          <div
            role="alert"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            {copy.conflict}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="font-medium">{copy.position}</span>
            <select
              className="bg-background h-9 w-full rounded-md border px-3"
              value={draft.representative_position}
              disabled={!permissionQuery.data?.permissions.can_edit}
              onChange={(event) => {
                setDirty(true);
                setDraft({
                  ...draft,
                  representative_position: event.target
                    .value as StrategyDocument["representative_position"],
                });
              }}
            >
              <option value="plaintiff">{copy.plaintiff}</option>
              <option value="defendant">{copy.defendant}</option>
              <option value="other">{copy.other}</option>
            </select>
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-medium">{copy.objective}</span>
            <Input
              value={draft.objective}
              disabled={!permissionQuery.data?.permissions.can_edit}
              onChange={(event) => {
                setDirty(true);
                setDraft({ ...draft, objective: event.target.value });
              }}
            />
          </label>
        </div>
        {draft.paths.map((path, index) => (
          <section key={path.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">
                {copy.path} {index + 1}
              </h3>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={zh ? "删除策略路径" : "Remove strategy path"}
                disabled={!permissionQuery.data?.permissions.can_edit}
                onClick={() => {
                  setDirty(true);
                  setDraft({
                    ...draft,
                    paths: draft.paths.filter((_, i) => i !== index),
                  });
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
            <label className="block space-y-2 text-sm">
              <span>{copy.pathTitle}</span>
              <Input
                value={path.title}
                disabled={!permissionQuery.data?.permissions.can_edit}
                onChange={(event) =>
                  updatePath(index, "title", event.target.value)
                }
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["conditions", copy.conditions],
                  ["risks", copy.risks],
                  ["alternatives", copy.alternatives],
                  ["next_actions", copy.actions],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="space-y-2 text-sm">
                  <span>{label}</span>
                  <Textarea
                    value={path[key].join("\n")}
                    disabled={!permissionQuery.data?.permissions.can_edit}
                    onChange={(event) =>
                      updatePath(index, key, event.target.value)
                    }
                    rows={3}
                  />
                </label>
              ))}
            </div>
            <div className="text-muted-foreground space-y-1 text-xs">
              <p>
                {copy.issues}:{" "}
                {path.issue_ids.length
                  ? path.issue_ids.map((id) => id.slice(0, 8)).join(" · ")
                  : "—"}
              </p>
              <p>
                {copy.sources}:{" "}
                {path.source_refs.length
                  ? path.source_refs.map((id) => id.slice(0, 8)).join(" · ")
                  : "—"}
              </p>
              <p>
                {copy.authorities}:{" "}
                {path.legal_authority_refs.length
                  ? path.legal_authority_refs
                      .map((ref) => ref.version_id.slice(0, 8))
                      .join(" · ")
                  : "—"}
              </p>
            </div>
          </section>
        ))}
        {saveMutation.isError && (
          <p role="alert" className="text-destructive text-sm">
            {saveMutation.error.message}
          </p>
        )}
        {strategy && (
          <CurrentStructuredVersion
            tenantId={tenantId}
            matterId={matterId}
            artifact={strategy}
            locale={locale}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function MatterWorkProductList({
  tenantId,
  matterId,
  locale,
}: {
  tenantId: string;
  matterId: string;
  locale: "zh-CN" | "en-US";
}) {
  const zh = locale === "zh-CN";
  const query = useLawProjectArtifacts(tenantId, matterId);
  if (query.isPending) return <Skeleton className="h-32 w-full" />;
  if (query.isError)
    return (
      <Card role="alert">
        <CardContent className="text-destructive pt-5 text-sm">
          {zh ? "成果列表读取失败。" : "Work products could not be loaded."}
        </CardContent>
      </Card>
    );
  const artifacts = query.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{zh ? "案件成果" : "Case work products"}</CardTitle>
      </CardHeader>
      <CardContent>
        {artifacts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {zh ? "此案件尚无保存成果。" : "No saved work products yet."}
          </p>
        ) : (
          <div className="divide-y">
            {artifacts.map((artifact) => (
              <div
                key={artifact.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div>
                  <div className="font-medium">{artifact.title}</div>
                  <div className="text-muted-foreground text-xs">
                    {artifact.kind} · V{artifact.current_version_number}
                  </div>
                </div>
                <Badge
                  variant={
                    artifact.status === "active" ? "secondary" : "outline"
                  }
                >
                  {artifact.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
