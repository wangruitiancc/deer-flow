"use client";

import { ArchiveIcon, CheckIcon, CircleXIcon, LoaderCircleIcon, NotebookPenIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useDecideLawMatterMemory, useLawMatterMemory } from "@/core/law";
import type { MatterMemoryEntry, MatterMemoryStatus } from "@/core/law/types";

const STATUS_LABEL: Record<MatterMemoryStatus, string> = {
  proposed: "待律师审核",
  approved: "已批准，可供案件内召回",
  rejected: "已驳回",
  archived: "已归档",
};

export function MatterMemoryPanel({
  tenantId,
  matterId,
}: {
  tenantId: string;
  matterId: string;
}) {
  const query = useLawMatterMemory(tenantId, matterId);
  const decision = useDecideLawMatterMemory(tenantId, matterId);

  const decide = (entry: MatterMemoryEntry, status: Exclude<MatterMemoryStatus, "proposed">) => {
    decision.mutate({
      entryId: entry.id,
      input: { decision: status, expected_version: entry.version },
    });
  };

  return (
    <section className="mb-7" aria-labelledby="matter-memory-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <NotebookPenIcon className="size-4" />
          <h3 id="matter-memory-title" className="text-sm font-semibold">案件记忆</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching && <LoaderCircleIcon className="animate-spin" />}
          刷新
        </Button>
      </div>

      {query.isPending ? (
        <p role="status" className="text-muted-foreground text-sm">正在读取案件记忆…</p>
      ) : query.isError ? (
        <div className="rounded-lg border p-4">
          <p role="alert" className="text-sm">{query.error.message || "无法读取案件记忆。"}</p>
          <Button className="mt-2" variant="outline" size="sm" onClick={() => void query.refetch()}>
            重试
          </Button>
        </div>
      ) : !query.data?.items.length ? (
        <p className="text-muted-foreground rounded-lg border p-4 text-sm">
          还没有案件记忆提案。可在对话中让 Agent 根据已选材料和正式引用整理提案；律师批准后才会进入后续任务的案件内召回。
        </p>
      ) : (
        <div className="space-y-3">
          {query.data.items.map((entry) => (
            <article key={entry.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="font-medium break-words">{entry.title}</h4>
                  <p className="text-muted-foreground mt-1 text-xs">{STATUS_LABEL[entry.status]}</p>
                </div>
                {query.data?.can_review && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {entry.status !== "approved" && (
                      <Button
                        size="sm"
                        disabled={decision.isPending}
                        onClick={() => decide(entry, "approved")}
                      >
                        <CheckIcon />
                        {entry.status === "archived" ? "重新启用" : "批准"}
                      </Button>
                    )}
                    {entry.status !== "rejected" && entry.status !== "archived" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={decision.isPending}
                        onClick={() => decide(entry, "rejected")}
                      >
                        <CircleXIcon />
                        驳回
                      </Button>
                    )}
                    {entry.status !== "archived" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={decision.isPending}
                        onClick={() => decide(entry, "archived")}
                      >
                        <ArchiveIcon />
                        归档
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm">{entry.content}</p>
              <div className="mt-4 space-y-2">
                <p className="text-muted-foreground text-xs font-medium">固定来源与引用</p>
                {entry.sources.map((source) => (
                  <div key={source.citation_id} className="bg-muted/40 rounded-md p-3 text-xs">
                    <p className="font-medium">
                      {source.evidence_title ?? "案件材料"} · 第 {source.physical_page_number} 页
                    </p>
                    <p className="text-muted-foreground mt-1 break-all">
                      材料版本 SHA-256 {source.evidence_sha256 ?? "不可用"} · 校对版本 {source.publication_number} · 页面 SHA-256 {source.page_sha256}
                    </p>
                    <blockquote className="mt-2 border-l-2 pl-3 whitespace-pre-wrap break-words">
                      {source.quote_text}
                    </blockquote>
                    <p className="text-muted-foreground mt-2 break-all">
                      引文 SHA-256 {source.quote_sha256} · 发布清单 SHA-256 {source.publication_manifest_sha256}
                    </p>
                  </div>
                ))}
              </div>
              {decision.isError && decision.variables?.entryId === entry.id && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {decision.error.message || "审核结果未保存。请刷新后核对当前状态。"}
                </p>
              )}
            </article>
          ))}
          {!query.data?.can_review && (
            <p className="text-muted-foreground text-xs">
              当前案件角色可查看来源与审核状态；审核操作需要案件负责人、主办律师或律师权限。
            </p>
          )}
        </div>
      )}
      {decision.isError && !query.data?.items.some((entry) => entry.id === decision.variables?.entryId) && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {decision.error.message || "审核结果未保存。请刷新后核对当前状态。"}
        </p>
      )}
    </section>
  );
}

