"use client";

import {
  ArrowDownToLineIcon,
  ExternalLinkIcon,
  FileClockIcon,
  HeartIcon,
  LoaderCircleIcon,
  RotateCwIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  useCaptureLegalAuthority,
  useLawAuthorities,
  useLegalAuthorityVersions,
  useReadLegalAuthorityVersion,
  useRefreshLegalAuthority,
  useReviewLegalAuthorityVersion,
  useSaveLegalAuthoritySummary,
  useSetLegalAuthorityFavorite,
} from "@/core/law/hooks";
import type {
  LegalAuthorityDocumentView,
  LegalAuthorityReviewDecision,
} from "@/core/law/types";

const DECISION_LABELS: Record<LegalAuthorityReviewDecision, string> = {
  current_on_date: "在该日期适用",
  historical_on_date: "在该日期为历史版本",
  not_effective_on_date: "在该日期尚未生效",
  repealed_on_date: "在该日期已废止",
  source_rejected: "来源不可信",
  needs_review: "仍需核验",
};

const REUSE_PERMISSION_LABELS: Record<LegalAuthorityDocumentView["reuse_permission_state"], string> = {
  unverified: "未核验",
};

const REVIEW_DECISIONS: LegalAuthorityReviewDecision[] = [
  "current_on_date",
  "historical_on_date",
  "not_effective_on_date",
  "repealed_on_date",
  "needs_review",
  "source_rejected",
];

function displayTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function MatterAuthorityCard({
  tenantId,
  matterId,
  authority,
  canEdit,
  canReview,
}: {
  tenantId: string;
  matterId: string;
  authority: LegalAuthorityDocumentView;
  canEdit: boolean;
  canReview: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [readingVersionId, setReadingVersionId] = useState<string | null>(null);
  const [readOffset, setReadOffset] = useState(0);
  const [reviewTarget, setReviewTarget] = useState<string | null>(null);
  const [decision, setDecision] = useState<LegalAuthorityReviewDecision>("needs_review");
  const [jurisdiction, setJurisdiction] = useState("中国大陆");
  const [relevantOn, setRelevantOn] = useState(new Date().toISOString().slice(0, 10));
  const [basisNote, setBasisNote] = useState("");
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [summaryDraft, setSummaryDraft] = useState("");

  const versions = useLegalAuthorityVersions(
    tenantId,
    matterId,
    showHistory ? authority.id : null,
  );
  const content = useReadLegalAuthorityVersion(
    tenantId,
    matterId,
    authority.id,
    readingVersionId,
    readOffset,
    Boolean(readingVersionId),
  );
  const favorite = useSetLegalAuthorityFavorite(tenantId, matterId);
  const refresh = useRefreshLegalAuthority(tenantId, matterId);
  const review = useReviewLegalAuthorityVersion(tenantId, matterId);
  const saveSummary = useSaveLegalAuthoritySummary(tenantId, matterId);
  const latest = authority.latest_version;
  const nextOffset = content.data?.next_offset;

  const readVersion = (versionId: string) => {
    setReadingVersionId(versionId);
    setReadOffset(0);
  };
  const saveReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reviewTarget || !basisNote.trim()) return;
    review.mutate(
      {
        documentId: authority.id,
        versionId: reviewTarget,
        input: {
          decision,
          ...(decision === "source_rejected" || decision === "needs_review"
            ? {}
            : { jurisdiction, relevant_on: relevantOn }),
          basis_note: basisNote.trim(),
        },
      },
      { onSuccess: () => setBasisNote("") },
    );
  };
  const submitSummary = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!latest || !summaryDraft.trim()) return;
    saveSummary.mutate(
      {
        documentId: authority.id,
        versionId: latest.id,
        input: {
          summary_text: summaryDraft.trim(),
          source_content_sha256: latest.content_sha256,
        },
      },
      { onSuccess: () => setSummaryDraft("") },
    );
  };

  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="break-words font-medium">{latest?.title ?? "未命名法律依据"}</h4>
          <p className="text-muted-foreground mt-1 text-xs">
            {authority.source_key === "npc_nlrd" ? "国家法律法规数据库" : "司法部行政法规库"}
            {latest?.issuer ? ` · ${latest.issuer}` : ""}
            {latest?.document_type ? ` · ${latest.document_type}` : ""}
          </p>
          <p className="text-muted-foreground mt-1 text-xs break-all">
            记录号 {authority.source_record_id} · 版本 {latest?.version_number ?? "—"} · 获取于 {latest ? displayTime(latest.retrieved_at) : "—"}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label={authority.is_favorite ? "取消收藏" : "收藏法律依据"}
            disabled={!canEdit || favorite.isPending}
            onClick={() => favorite.mutate({ documentId: authority.id, isFavorite: !authority.is_favorite })}
          >
            <HeartIcon className={authority.is_favorite ? "fill-current" : ""} />
            {authority.is_favorite ? "已收藏" : "收藏"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canEdit || refresh.isPending}
            onClick={() => refresh.mutate(authority.id, {
              onSuccess: (receipt) => setRefreshMessage(
                receipt.unchanged
                  ? "官方来源内容未变化，已保留原版本。"
                  : `发现来源变化，已追加版本 ${receipt.version.version_number}。`
              ),
            })}
          >
            {refresh.isPending ? <LoaderCircleIcon className="animate-spin" /> : <RotateCwIcon />}
            检查更新
          </Button>
        </div>
      </div>
      {refreshMessage && <p role="status" className="text-muted-foreground mt-2 text-xs">{refreshMessage}</p>}

      <div className="bg-muted/40 mt-3 rounded-md p-3 text-xs">
        <p>
          来源全文商业复制/再发布许可：{REUSE_PERMISSION_LABELS[authority.reuse_permission_state]}。
          案件内保存不代表可跨案件共享或对外发布全文。
        </p>
        <p>
          {latest?.source_validity_label
            ? `来源页面标示：${latest.source_validity_label}`
            : "来源页面未标注效力状态"}
          {latest?.effective_on ? ` · 页面施行日期 ${latest.effective_on}` : ""}
          {latest?.promulgated_on ? ` · 公布日期 ${latest.promulgated_on}` : ""}
        </p>
        <p className="text-muted-foreground mt-1">
          完整性未自动核验 · SHA-256 {latest?.source_sha256 ?? "—"}
        </p>
        {latest?.snippet && <p className="mt-2 whitespace-pre-wrap break-words">{latest.snippet}</p>}
      </div>

      {authority.latest_summary && (
        <div className="mt-3 rounded-md border p-3 text-xs">
          <p className="font-semibold">版本摘要 · 序号 {authority.latest_summary.sequence_number}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{authority.latest_summary.summary_text}</p>
          <p className="text-muted-foreground mt-1 break-all">
            正文 SHA-256 {authority.latest_summary.source_content_sha256} · 作者 {authority.latest_summary.authored_by_membership_id} · {displayTime(authority.latest_summary.created_at)}
          </p>
        </div>
      )}
      {canEdit && latest && (
        <form className="mt-3 space-y-2 rounded-md border p-3" onSubmit={submitSummary}>
          <label className="block text-xs">
            为版本 {latest.version_number} 保存摘要
            <Textarea
              value={summaryDraft}
              maxLength={16000}
              onChange={(event) => setSummaryDraft(event.target.value)}
              required
              placeholder="摘要会绑定到当前正文哈希并追加保存，不会改写来源正文或效力核验状态。"
            />
          </label>
          <Button size="sm" disabled={saveSummary.isPending || !summaryDraft.trim()}>
            {saveSummary.isPending && <LoaderCircleIcon className="animate-spin" />}
            保存版本摘要
          </Button>
          {saveSummary.isError && <p role="alert" className="text-destructive text-xs">{saveSummary.error.message}</p>}
        </form>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          className="text-primary inline-flex items-center gap-1 text-xs underline underline-offset-4"
          href={authority.official_url}
          target="_blank"
          rel="noreferrer"
        >
          打开官方来源 <ExternalLinkIcon className="size-3" />
        </a>
        <Button variant="link" size="sm" className="h-auto px-1 text-xs" onClick={() => setShowHistory((value) => !value)}>
          <FileClockIcon />
          {showHistory ? "收起版本历史" : "版本与核验历史"}
        </Button>
      </div>

      {authority.lawyer_review ? (
        <div className="mt-3 rounded-md border border-green-700/20 p-3 text-xs">
          <p className="flex items-center gap-1 font-medium">
            <ShieldCheckIcon className="size-3.5" />
            {DECISION_LABELS[authority.lawyer_review.decision]}
            {authority.lawyer_review.relevant_on ? ` · ${authority.lawyer_review.jurisdiction} · ${authority.lawyer_review.relevant_on}` : ""}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words">{authority.lawyer_review.basis_note}</p>
          <p className="text-muted-foreground mt-1">
            核验律师 {authority.lawyer_review.reviewed_by_display_name ?? "姓名未留存"}
            {authority.lawyer_review.reviewer_matter_role === "lawyer" ? " · 案件角色：律师" : " · 历史记录未保存角色"}
            {` · 成员 ID ${authority.lawyer_review.reviewed_by_membership_id} · ${displayTime(authority.lawyer_review.reviewed_at)}`}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground mt-2 text-xs">尚无律师按适用地域和日期核验；页面效力标示不代表当前法律结论。</p>
      )}

      {showHistory && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <h5 className="text-xs font-semibold">不可变版本记录</h5>
          {versions.isPending ? (
            <p role="status" className="text-muted-foreground text-xs">正在读取版本历史…</p>
          ) : versions.isError ? (
            <p role="alert" className="text-destructive text-xs">{versions.error.message}</p>
          ) : (
            versions.data?.map((version) => (
              <div key={version.id} className="rounded-md border p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">版本 {version.version_number} · {displayTime(version.retrieved_at)}</p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => readVersion(version.id)}>
                      <ArrowDownToLineIcon /> 阅读正文片段
                    </Button>
                    {canReview && (
                      <Button variant="outline" size="sm" onClick={() => setReviewTarget(reviewTarget === version.id ? null : version.id)}>
                        核验此版本
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-muted-foreground mt-1 break-all">正文摘要 SHA-256 {version.content_sha256}</p>
                {version.lawyer_review && (
                  <div className="mt-1 space-y-1">
                    <p>{DECISION_LABELS[version.lawyer_review.decision]} · {version.lawyer_review.jurisdiction ?? "未指定地域"} · {version.lawyer_review.relevant_on ?? "未指定日期"}</p>
                    <p className="text-muted-foreground break-all">
                      核验律师 {version.lawyer_review.reviewed_by_display_name ?? "姓名未留存"}
                      {version.lawyer_review.reviewer_matter_role === "lawyer" ? " · 案件角色：律师" : " · 历史记录未保存角色"}
                      {` · 成员 ID ${version.lawyer_review.reviewed_by_membership_id} · ${displayTime(version.lawyer_review.reviewed_at)}`}
                    </p>
                  </div>
                )}
                {version.summaries?.map((summary) => (
                  <div key={summary.id} className="mt-2 border-t pt-2">
                    <p className="whitespace-pre-wrap break-words">摘要 {summary.sequence_number} · {summary.summary_text}</p>
                    <p className="text-muted-foreground mt-1 break-all">正文 SHA-256 {summary.source_content_sha256} · {displayTime(summary.created_at)}</p>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {readingVersionId && (
        <div className="bg-muted/30 mt-3 rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold">固定版本正文 · {content.data?.total_chars ?? ""} 字符</p>
            <Button variant="ghost" size="sm" onClick={() => setReadingVersionId(null)}>关闭</Button>
          </div>
          {content.isPending ? (
            <p role="status" className="text-xs">正在读取…</p>
          ) : content.isError ? (
            <p role="alert" className="text-destructive text-xs">{content.error.message}</p>
          ) : (
            <>
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{content.data?.text_chunk}</pre>
              {nextOffset !== null && nextOffset !== undefined && (
                <Button className="mt-2" size="sm" variant="outline" onClick={() => setReadOffset(nextOffset)}>
                  读取下一段
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {reviewTarget && canReview && (
        <form className="mt-3 space-y-2 rounded-md border p-3" onSubmit={saveReview}>
          <p className="text-xs font-semibold">律师核验版本 {versions.data?.find((item) => item.id === reviewTarget)?.version_number ?? ""}</p>
          <label className="block text-xs">
            核验结论
            <select className="border-input mt-1 h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={decision} onChange={(event) => setDecision(event.target.value as LegalAuthorityReviewDecision)}>
              {REVIEW_DECISIONS.map((item) => <option key={item} value={item}>{DECISION_LABELS[item]}</option>)}
            </select>
          </label>
          {!(["source_rejected", "needs_review"] as LegalAuthorityReviewDecision[]).includes(decision) && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs">适用地域<Input value={jurisdiction} maxLength={500} onChange={(event) => setJurisdiction(event.target.value)} required /></label>
              <label className="text-xs">适用日期<Input type="date" value={relevantOn} onChange={(event) => setRelevantOn(event.target.value)} required /></label>
            </div>
          )}
          <label className="block text-xs">核验依据<Textarea value={basisNote} maxLength={8000} onChange={(event) => setBasisNote(event.target.value)} required placeholder="记录核对的官方版本、修订或废止信息，以及适用日期判断依据。" /></label>
          <Button size="sm" disabled={review.isPending || !basisNote.trim()}>
            {review.isPending && <LoaderCircleIcon className="animate-spin" />}
            保存核验记录
          </Button>
          {review.isError && <p role="alert" className="text-destructive text-xs">{review.error.message}</p>}
        </form>
      )}
      {(favorite.isError || refresh.isError) && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {favorite.error?.message ?? refresh.error?.message}
        </p>
      )}
    </article>
  );
}

export function MatterAuthoritiesPanel({ tenantId, matterId }: { tenantId: string; matterId: string }) {
  const [officialUrl, setOfficialUrl] = useState("");
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const authorities = useLawAuthorities(tenantId, matterId, query);
  const capture = useCaptureLegalAuthority(tenantId, matterId);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!officialUrl.trim()) return;
    capture.mutate(officialUrl.trim(), { onSuccess: () => setOfficialUrl("") });
  };

  return (
    <section className="mb-7" aria-labelledby="matter-authorities-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 id="matter-authorities-title" className="text-sm font-semibold">法律依据库</h3>
          <p className="text-muted-foreground mt-1 text-xs">官方来源版本、律师核验与历史记录均按案件保存。</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void authorities.refetch()} disabled={authorities.isFetching}>
          {authorities.isFetching && <LoaderCircleIcon className="animate-spin" />}
          刷新
        </Button>
      </div>

      {authorities.data?.can_edit && (
        <form className="mb-3 space-y-2 rounded-lg border p-3" onSubmit={submit}>
          <label className="block text-xs font-medium" htmlFor="official-authority-url">导入官方详情页链接</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="official-authority-url" type="url" maxLength={2048} value={officialUrl} onChange={(event) => setOfficialUrl(event.target.value)} placeholder="粘贴国家法律法规数据库或司法部行政法规库的详情页链接" required />
            <Button disabled={capture.isPending || !officialUrl.trim()}>
              {capture.isPending ? <LoaderCircleIcon className="animate-spin" /> : <ArrowDownToLineIcon />}
              获取来源
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            <a className="underline underline-offset-4" href="https://flk.npc.gov.cn/search" target="_blank" rel="noreferrer">国家法律法规数据库</a>
            {" · "}
            <a className="underline underline-offset-4" href="https://xzfg.moj.gov.cn/" target="_blank" rel="noreferrer">司法部行政法规库</a>
            {" · 仅接受这两个官方站点的详情页；系统不向站点发送案件信息。"}
          </p>
          <p className="text-muted-foreground text-xs">
            本次获取会将来源正文保存到当前案件的律所数据域。公开可访问不代表来源全文已获商业复制或再发布许可；当前许可状态未核验。
          </p>
          {capture.isError && <p role="alert" className="text-destructive text-xs">{capture.error.message}</p>}
        </form>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="text-muted-foreground absolute left-3 top-2.5 size-4" />
          <Input className="pl-9" aria-label="搜索案件法律依据" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已保存的法律依据" />
        </div>
        <Button variant={favoritesOnly ? "default" : "outline"} size="sm" onClick={() => setFavoritesOnly((value) => !value)}>
          <HeartIcon /> {favoritesOnly ? "显示全部" : "只看收藏"}
        </Button>
      </div>

      {authorities.isPending ? (
        <p role="status" className="text-muted-foreground rounded-lg border p-4 text-sm">正在读取法律依据…</p>
      ) : authorities.isError ? (
        <div className="rounded-lg border p-4">
          <p role="alert" className="text-sm">{authorities.error.message || "无法读取案件法律依据。"}</p>
          <Button className="mt-2" variant="outline" size="sm" onClick={() => void authorities.refetch()}>重试</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {(authorities.data?.items ?? []).filter((item) => !favoritesOnly || item.is_favorite).map((item) => (
            <MatterAuthorityCard key={item.id} tenantId={tenantId} matterId={matterId} authority={item} canEdit={Boolean(authorities.data?.can_edit)} canReview={Boolean(authorities.data?.can_review)} />
          ))}
          {!authorities.data?.items.length && (
            <p className="text-muted-foreground rounded-lg border p-4 text-sm">本案还没有保存官方法律依据。可从上方官方数据库检索后导入详情页。</p>
          )}
          {favoritesOnly && authorities.data?.items.length && !authorities.data.items.some((item) => item.is_favorite) && (
            <p className="text-muted-foreground rounded-lg border p-4 text-sm">当前列表没有收藏项。</p>
          )}
        </div>
      )}
      <p className="text-muted-foreground mt-3 text-xs">
        来源页面的效力标签只作为来源声明保存，完整性默认未知。系统不会据此自动标记为现行有效；律师核验绑定到具体来源版本、地域和日期。
      </p>
    </section>
  );
}
