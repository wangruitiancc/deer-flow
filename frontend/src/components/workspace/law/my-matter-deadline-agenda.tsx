"use client";

import { ArrowRightIcon, CalendarDaysIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/core/i18n";
import { useLawMyDeadlineAgenda } from "@/core/law";
import { pathOfLawProject } from "@/core/law/project-tree";
import type { MatterDeadlineAgendaItem } from "@/core/law/types";

function formatDue(item: MatterDeadlineAgendaItem, locale: Locale): string {
  if (item.due_precision === "date_only" && item.legal_due_date) {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${item.legal_due_date}T00:00:00Z`));
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: item.timezone_name,
  }).format(new Date(item.due_at));
}

export function MyMatterDeadlineAgenda({
  tenantId,
  locale,
}: {
  tenantId: string;
  locale: Locale;
}) {
  const query = useLawMyDeadlineAgenda(tenantId);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const isZh = locale === "zh-CN";
  const kindLabel: Record<MatterDeadlineAgendaItem["kind"], string> = isZh
    ? {
        filing: "期限",
        hearing: "庭审",
        performance: "履行事项",
        internal_task: "内部待办",
      }
    : {
        filing: "Deadline",
        hearing: "Hearing",
        performance: "Performance",
        internal_task: "Internal task",
      };

  return (
    <Card aria-labelledby="my-matter-deadline-agenda-title">
      <CardHeader className="flex-row items-center gap-2">
        <CalendarDaysIcon className="text-muted-foreground size-4" />
        <CardTitle id="my-matter-deadline-agenda-title" className="text-base">
          {isZh ? "我的跨案件日程" : "My cross-matter agenda"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : query.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3" role="alert">
            <p className="text-destructive text-sm">
              {isZh ? "日程读取失败；请重试。" : "The agenda could not be loaded. Try again."}
            </p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              <RefreshCwIcon />
              {isZh ? "重试" : "Retry"}
            </Button>
          </div>
        ) : !items.length ? (
          <p className="text-muted-foreground text-sm">
            {isZh ? "没有分配给你的已确认期限或事项。" : "No confirmed items are assigned to you."}
          </p>
        ) : (
          <>
            <div className="divide-y">
              {items.map((item) => (
                <div
                  key={`${item.matter_id}:${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{item.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline">{kindLabel[item.kind]}</Badge>
                      <Link
                        className="text-muted-foreground underline-offset-4 hover:underline"
                        href={`${pathOfLawProject(item.tenant_id, item.matter_id)}&view=schedule`}
                      >
                        {item.case_number ?? item.matter_title}
                      </Link>
                    </div>
                  </div>
                  <time className="text-muted-foreground shrink-0 text-xs" dateTime={item.due_at}>
                    {formatDue(item, locale)}
                  </time>
                </div>
              ))}
            </div>
            {query.hasNextPage && (
              <div className="mt-3 border-t pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {query.isFetchingNextPage
                    ? isZh
                      ? "正在读取…"
                      : "Loading…"
                    : isZh
                      ? "加载更多"
                      : "Load more"}
                  <ArrowRightIcon />
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
