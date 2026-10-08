"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCitation, type OcrCitation } from "@/core/law";
import {
  type LegalAuthorities,
  type LegalAuthorityEntry,
  type LegalAuthoritySource,
} from "@/core/law/legal-authorities";

import {
  LegalAuthoritiesEditor,
  type AuthorityEditorTarget,
} from "./legal-authorities-editor";

type Scope = { tenant_id: string; matter_id: string };
const sourceStateLabels: Record<OcrCitation["source_state"], string> = {
  available: "来源可用",
  archived: "原材料已归档",
  legal_hold: "原材料保全中",
  purge_pending: "原材料待清除",
  purge_failed: "原材料清除失败",
  purged: "原材料已清除",
};
const origins = {
  manual: "手工整理",
  mining: "材料提取",
  favorite: "收藏",
  legacy_import: "旧项目导入",
  research: "法律研究",
};
const textKinds = {
  legacy_excerpt: "历史摘录",
  quotation: "引用条文",
  summary: "摘要（非条文原文）",
  reference_only: "仅引用（正文缺失）",
};
const sourceKinds = {
  manual: "手工文本",
  legacy_excerpt: "历史目录摘录",
  web_capture: "网页捕获",
  project_citation: "项目材料引用",
  legacy_reference: "旧收藏引用记录（非条文正文）",
};

export function LegalAuthoritiesViewer({
  document,
  scope,
  onChange,
}: {
  document: LegalAuthorities;
  scope?: Scope;
  onChange?: (document: LegalAuthorities) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [showSources, setShowSources] = useState(false);
  const [target, setTarget] = useState<AuthorityEditorTarget | null>(null);
  const needle = query.trim().toLocaleLowerCase();
  const visible = document.entries.filter(
    (entry) =>
      (filter === "all" || entry.state === filter) &&
      [
        entry.law_name,
        entry.article_label,
        entry.text,
        entry.applicability_analysis,
        entry.inclusion_reason,
        entry.removal_reason,
      ].some((value) => value?.toLocaleLowerCase().includes(needle)),
  );
  const active = document.entries.filter(
    (entry) => entry.state === "active",
  ).length;
  return (
    <section
      aria-label="法律依据"
      className="flex size-full min-h-0 min-w-0 flex-col text-sm"
    >
      <header className="shrink-0 space-y-2 border-b p-3">
        <h2 className="font-semibold [overflow-wrap:anywhere] break-words">
          {document.title}
        </h2>
        <p className="text-muted-foreground text-xs">
          未审核 · 效力未核验 · 保存不代表法律结论获批
        </p>
        {onChange && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setTarget({ kind: "manual" })}
            >
              手工添加
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={document.sources.length === 0}
              onClick={() => setTarget({ kind: "collect" })}
            >
              从来源收录
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setTarget({ kind: "document" })}
            >
              编辑研究问题
            </Button>
          </div>
        )}
        <Input
          aria-label="搜索法律依据"
          placeholder="搜索法律、条号或内容"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="依据收录状态"
            className="bg-background min-h-9 rounded-md border px-2"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">全部依据</option>
            <option value="active">已收录</option>
            <option value="removed">已移除</option>
          </select>
          <p role="status" className="text-muted-foreground text-xs">
            显示 {visible.length} / {document.entries.length} 条 · 收录 {active}{" "}
            · 移除 {document.entries.length - active}
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3 [overflow-wrap:anywhere]">
        <details>
          <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2">
            研究问题
          </summary>
          <p className="mt-2 whitespace-pre-wrap">{document.question}</p>
        </details>
        {visible.length === 0 && (
          <p className="text-muted-foreground">
            {document.entries.length
              ? "没有符合筛选条件的依据。"
              : "尚未收录依据；空列表不代表没有相关法律。"}
          </p>
        )}
        {visible.map((entry) => (
          <AuthorityCard
            key={entry.id}
            entry={entry}
            sources={document.sources}
            scope={scope}
            onEdit={onChange ? setTarget : undefined}
          />
        ))}
        <div className="rounded-md border p-3">
          <Button
            variant="ghost"
            className="h-auto min-h-9 w-full justify-start text-left whitespace-normal"
            aria-expanded={showSources}
            onClick={() => setShowSources(!showSources)}
          >
            全部来源记录（{document.sources.length}）
          </Button>
          {showSources && (
            <>
              <p className="text-muted-foreground my-2 text-xs">
                包含未被当前条目引用的记录。摘要匹配只证明本文字节一致，不证明网页真实、完整或法律现行有效。
              </p>
              {document.sources.map((source) => (
                <Source key={source.id} source={source} scope={scope} />
              ))}
            </>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          {onChange
            ? "整理操作只改当前文件草稿，仍须点击原生文件保存，再保存到项目。"
            : "本会话文件可点击原生编辑按钮整理，或切换源码；项目历史版本只读。"}
        </p>
      </div>
      {target && (
        <LegalAuthoritiesEditor
          document={document}
          target={target}
          onChange={onChange}
          onClose={() => setTarget(null)}
        />
      )}
    </section>
  );
}

function AuthorityCard({
  entry,
  sources,
  scope,
  onEdit,
}: {
  entry: LegalAuthorityEntry;
  sources: LegalAuthoritySource[];
  scope?: Scope;
  onEdit?: (target: AuthorityEditorTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border p-2">
      <Button
        variant="ghost"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="h-auto min-h-11 w-full flex-col items-start text-left whitespace-normal"
      >
        <span className="font-medium">
          {entry.law_name} {entry.article_label}
        </span>
        <span className="text-muted-foreground mt-1 text-xs">
          {entry.state === "active" ? "已收录" : "已移除"} ·{" "}
          {origins[entry.origin]} · {textKinds[entry.text_kind]}
        </span>
      </Button>
      {open && (
        <>
          {onEdit && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit({ kind: "entry", id: entry.id })}
              >
                编辑依据
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  onEdit({
                    kind: entry.state === "active" ? "remove" : "restore",
                    id: entry.id,
                  })
                }
              >
                {entry.state === "active" ? "移除依据" : "恢复收录"}
              </Button>
            </div>
          )}
          <EntryBody entry={entry} sources={sources} scope={scope} />
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap">{value ?? "未提供"}</dd>
    </div>
  );
}
function EntryBody({
  entry,
  sources,
  scope,
}: {
  entry: LegalAuthorityEntry;
  sources: LegalAuthoritySource[];
  scope?: Scope;
}) {
  const dates = [
    ["公布日期", entry.published_date],
    ["施行日期", entry.effective_date],
    ["废止日期", entry.repealed_date],
    ["待分析事实时点", entry.relevant_date],
  ] as const;
  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <p className="text-muted-foreground text-xs">未审核 · 当前效力未核验</p>
      <dl className="space-y-3">
        <Field label="法律版本（自述）" value={entry.law_version} />
        <Field label="地域 / 法域（自述）" value={entry.jurisdiction} />
        {dates.map(([label, date]) => (
          <div key={label}>
            <Field label={label} value={date?.value} />
            {date && (
              <p className="text-muted-foreground mt-1 whitespace-pre-wrap">
                日期依据：{date.basis}
              </p>
            )}
          </div>
        ))}
        <Field label={textKinds[entry.text_kind]} value={entry.text} />
        <Field label="效力说明（未核验）" value={entry.validity_statement} />
        <Field
          label="适用性分析（非条文原文）"
          value={entry.applicability_analysis}
        />
        <Field label="不确定性 / 待核实问题" value={entry.uncertainty} />
        <Field label="收录理由" value={entry.inclusion_reason} />
        {entry.state === "removed" && (
          <Field label="移除原因" value={entry.removal_reason} />
        )}
      </dl>
      <div className="space-y-2">
        <h3 className="font-medium">关联来源</h3>
        {entry.source_ids.map((id) => {
          const source = sources.find((item) => item.id === id);
          return source ? (
            <Source key={id} source={source} scope={scope} />
          ) : (
            <p key={id} role="alert">
              来源缺失
            </p>
          );
        })}
      </div>
      {entry.legacy_origin && (
        <details>
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2">
            旧引用原始记录（未核验）
          </summary>
          <pre className="mt-2 whitespace-pre-wrap">
            {JSON.stringify(entry.legacy_origin, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function Source({
  source,
  scope,
}: {
  source: LegalAuthoritySource;
  scope?: Scope;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-md border p-2">
      <Button
        variant="ghost"
        className="h-auto w-full justify-start text-left whitespace-normal"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "收起" : "查看"}
        {sourceKinds[source.kind]} · {source.id}
      </Button>
      {open &&
        (source.kind === "project_citation" ? (
          <Citation
            key={`${scope?.tenant_id}:${scope?.matter_id}:${source.citation_id}:${source.evidence_item_id}:${source.evidence_version_id}`}
            source={source}
            scope={scope}
          />
        ) : source.kind === "legacy_reference" ? (
          <div className="mt-2 space-y-2 text-sm">
            <p>
              仅保留旧收藏记录，不是官方正文或已授权项目引用；不会访问原路径或自动补造条文。
            </p>
            <pre className="[overflow-wrap:anywhere] whitespace-pre-wrap">
              {JSON.stringify(source.legacy_origin, null, 2)}
            </pre>
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {source.kind === "web_capture" ? (
              <>
                <p>{source.title}</p>
                <p>发布机构（自述）：{source.publisher ?? "未提供"}</p>
                <p>捕获时间（自述）：{source.retrieved_at}</p>
                <p>
                  完整性：
                  {
                    {
                      unknown: "未知",
                      partial: "部分内容",
                      claimed_complete: "自述完整（未独立核验）",
                    }[source.completeness]
                  }
                </p>
                <a
                  className="text-primary underline"
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  在外部打开来源：{source.url}
                </a>
                <p className="text-muted-foreground text-xs">
                  仅打开已记录的地址，不会自动抓取或核验官方网站。
                </p>
              </>
            ) : (
              <>
                <p>出处（自述）：{source.reference ?? "未提供"}</p>
                {source.legacy_id && <p>旧条目标识：{source.legacy_id}</p>}
                {source.catalog_sha256 && (
                  <p>旧目录 SHA-256：{source.catalog_sha256}</p>
                )}
              </>
            )}
            <p className="text-muted-foreground text-xs">
              来源文字 SHA-256：{source.text_sha256}（仅字节匹配）
            </p>
            <blockquote className="border-l-2 pl-3 whitespace-pre-wrap">
              {source.text}
            </blockquote>
          </div>
        ))}
    </div>
  );
}

function Citation({
  source,
  scope,
}: {
  source: Extract<LegalAuthoritySource, { kind: "project_citation" }>;
  scope?: Scope;
}) {
  const [citation, setCitation] = useState<OcrCitation>();
  const [error, setError] = useState("");
  const tenantId = scope?.tenant_id;
  const matterId = scope?.matter_id;
  useEffect(() => {
    if (!tenantId || !matterId) return;
    let alive = true;
    const request = new AbortController();
    setCitation(undefined);
    setError("");
    void getCitation(
      tenantId,
      matterId,
      source.evidence_item_id,
      source.evidence_version_id,
      source.citation_id,
      request.signal,
    )
      .then((value) => {
        if (
          value.id !== source.citation_id ||
          value.evidence_item_id !== source.evidence_item_id ||
          value.evidence_version_id !== source.evidence_version_id
        )
          throw new Error();
        if (alive) setCitation(value);
      })
      .catch(() => {
        if (alive)
          setError("引用不可用或无权访问，未显示缓存正文。收起后可重新读取。");
      });
    return () => {
      alive = false;
      request.abort();
    };
  }, [tenantId, matterId, source]);
  if (!scope) return <p role="status">项目归属尚未确认，不能读取来源。</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!citation) return <p role="status">正在通过项目权限检查读取引用…</p>;
  return (
    <div className="mt-2 space-y-2">
      <p>
        第 {citation.physical_page_number} 页 ·{" "}
        {sourceStateLabels[citation.source_state] ?? "材料状态未知"} ·{" "}
        {citation.source_type === "proofreading_publication"
          ? citation.publication_state === "current"
            ? "当前校对发布版"
            : "历史校对发布版"
          : citation.ocr_result_state === "superseded"
            ? "历史 OCR 版本"
            : citation.ocr_result_state === "current"
              ? "当前 OCR 版本"
              : "OCR 状态未知"}
      </p>
      <p className="text-muted-foreground text-xs">
        以下为创建引用时保留的文字。可读取不代表原材料仍可用、条文现行有效或适用于本项目。
      </p>
      <blockquote className="border-l-2 pl-3 whitespace-pre-wrap">
        {citation.quote_text ?? "接口未返回完整引文，请到证据工作台核对。"}
      </blockquote>
    </div>
  );
}
