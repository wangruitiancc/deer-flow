"use client";

import {
  AlertTriangleIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  Clock3Icon,
  FileCheck2Icon,
  FilesIcon,
  HistoryIcon,
  ListTodoIcon,
  RefreshCwIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/core/i18n/hooks";
import {
  useLawCaseWorkbench,
  useLawCaseWorkbenchDeadlines,
  useLawCaseWorkbenchEvents,
} from "@/core/law";
import type { Matter } from "@/core/law";

function displayTime(value: string, timezone: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "short",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
}

function activityLabel(action: string, locale: "en-US" | "zh-CN") {
  const known: Record<string, { en: string; zh: string }> = {
    "matter.created": { en: "Matter created", zh: "创建案件" },
    "matter.updated": { en: "Matter updated", zh: "更新案件信息" },
    "evidence.created": { en: "Material added", zh: "添加材料" },
    "evidence.version.created": {
      en: "Material version added",
      zh: "发布材料版本",
    },
    "project_artifact.version.created": {
      en: "Work-product version saved",
      zh: "保存成果版本",
    },
    "project_artifact.review.created": {
      en: "Work product reviewed",
      zh: "审核成果",
    },
  };
  return (
    known[action]?.[locale === "zh-CN" ? "zh" : "en"] ??
    action.replaceAll("_", " ")
  );
}

export function MatterOverviewDashboard({
  matter,
  view = "overview",
}: {
  matter: Matter;
  view?: "overview" | "schedule";
}) {
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  const query = useLawCaseWorkbench(matter.tenant_id, matter.id);
  useLawCaseWorkbenchEvents(matter.tenant_id, matter.id, query.data?.revision);
  const [scheduleRange] = useState(() => {
    const from = new Date();
    const until = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { fromAt: from.toISOString(), untilAt: until.toISOString() };
  });
  const scheduleQuery = useLawCaseWorkbenchDeadlines(
    matter.tenant_id,
    matter.id,
    scheduleRange.fromAt,
    scheduleRange.untilAt,
  );
  const data = query.data;

  const labels = isZh
    ? {
        stats: "办案概况",
        materials: "有效材料",
        usable: "当前版本扫描可用",
        pendingReview: "待审核成果",
        overdue: "逾期事项",
        nextWeek: "未来七日事项",
        tasks: "内部待办完成",
        progress: "办案进展",
        stage: "当前阶段",
        updated: "案件更新时间",
        schedule: "未来七日日程",
        emptySchedule: "未来七日没有已确认事项。候选事项不会计入正式日程。",
        loadMore: "加载更多日程",
        loadingSchedule: "正在读取日程…",
        scheduleError: "日程读取失败。统计仍以独立聚合结果为准。",
        pending: "待处理提示",
        proposed: "待确认日程建议",
        activity: "最近动态",
        emptyActivity: "暂无可显示的案件动态。",
        loading: "正在读取案件统计…",
        retry: "重试",
        error: "案件总览暂时无法读取；统计未加载，不以零值代替。",
        generated: "数据更新时间",
        caseStages: {
          intake: "接案",
          analysis: "分析",
          drafting: "文书起草",
          litigation: "诉讼进行中",
          closed: "已结案",
        },
        deadlineKinds: {
          filing: "期限",
          hearing: "庭审",
          performance: "履行事项",
          internal_task: "内部待办",
        },
      }
    : {
        stats: "Case at a glance",
        materials: "Active materials",
        usable: "Current versions with clean scans",
        pendingReview: "Work products awaiting review",
        overdue: "Overdue items",
        nextWeek: "Items in the next 7 days",
        tasks: "Internal tasks completed",
        progress: "Matter progress",
        stage: "Current stage",
        updated: "Matter updated",
        schedule: "Next 7 days",
        emptySchedule:
          "No confirmed items in the next 7 days. Proposed items are not formal deadlines.",
        loadMore: "Load more dates",
        loadingSchedule: "Loading schedule…",
        scheduleError:
          "The schedule could not be loaded. Counts come from a separate aggregate.",
        pending: "Needs attention",
        proposed: "Proposed dates to confirm",
        activity: "Recent activity",
        emptyActivity: "No matter activity is available yet.",
        loading: "Loading case statistics…",
        retry: "Retry",
        error:
          "The case overview could not be loaded. Counts are unavailable, not zero.",
        generated: "Data refreshed",
        caseStages: {
          intake: "Intake",
          analysis: "Analysis",
          drafting: "Drafting",
          litigation: "Litigation",
          closed: "Closed",
        },
        deadlineKinds: {
          filing: "Deadline",
          hearing: "Hearing",
          performance: "Performance",
          internal_task: "Internal task",
        },
      };

  if (query.isPending) {
    return (
      <div className="space-y-4" aria-label={labels.loading}>
        <Skeleton className="h-7 w-40" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  const requiredCounts = [
    "evidence_items",
    "derived_artifacts",
    "clean_scanned_current_materials",
    "pending_document_reviews",
    "overdue_confirmed_deadlines",
    "confirmed_deadlines_next_7_days",
    "confirmed_internal_tasks",
    "completed_internal_tasks",
    "proposed_deadlines",
  ] as const;
  const completeOverview =
    data?.statistics &&
    data.matter &&
    requiredCounts.every(
      (key) =>
        Number.isSafeInteger(data.statistics[key]) && data.statistics[key] >= 0,
    ) &&
    Array.isArray(data.statistics.current_artifacts) &&
    Array.isArray(data.upcoming_deadlines) &&
    Array.isArray(data.recent_activity);
  if (query.isError || !data || !completeOverview) {
    return (
      <Card role="alert">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <p className="text-destructive text-sm">{labels.error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCwIcon />
            {labels.retry}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const stats = data.statistics;
  const totalMaterials = stats.evidence_items + stats.derived_artifacts;
  const taskTotal = stats.confirmed_internal_tasks;
  const taskCompletion = `${stats.completed_internal_tasks} / ${taskTotal}`;
  const scheduleItems =
    scheduleQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-5">
      {view === "overview" && (
        <section aria-labelledby="matter-overview-statistics">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2
              id="matter-overview-statistics"
              className="text-base font-semibold"
            >
              {labels.stats}
            </h2>
            <span className="text-muted-foreground text-xs">
              {labels.generated}:{" "}
              {displayTime(data.generated_at, "UTC", locale)}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              icon={<FilesIcon />}
              label={labels.materials}
              value={totalMaterials}
              detail={`${stats.clean_scanned_current_materials} · ${labels.usable}`}
            />
            <StatCard
              icon={<FileCheck2Icon />}
              label={labels.pendingReview}
              value={stats.pending_document_reviews}
            />
            <StatCard
              icon={<AlertTriangleIcon />}
              label={labels.overdue}
              value={stats.overdue_confirmed_deadlines}
              danger={stats.overdue_confirmed_deadlines > 0}
            />
            <StatCard
              icon={<CalendarDaysIcon />}
              label={labels.nextWeek}
              value={stats.confirmed_deadlines_next_7_days}
            />
            <StatCard
              icon={<ListTodoIcon />}
              label={labels.tasks}
              value={taskCompletion}
            />
          </div>
        </section>
      )}

      <div
        className={
          view === "overview" ? "grid gap-5 xl:grid-cols-2" : "grid gap-5"
        }
      >
        {view === "overview" && (
          <>
            <Card>
              <CardHeader className="flex-row items-center gap-2">
                <CheckCircle2Icon className="text-muted-foreground size-4" />
                <CardTitle className="text-base">{labels.progress}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground text-sm">
                    {labels.stage}
                  </span>
                  <Badge variant="secondary">
                    {labels.caseStages[matter.stage] ?? matter.stage}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground text-sm">
                    {labels.updated}
                  </span>
                  <span className="text-sm">
                    {displayTime(matter.updated_at, "UTC", locale)}
                  </span>
                </div>
                {stats.proposed_deadlines > 0 && (
                  <div className="border-t pt-3">
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-muted-foreground">
                        {labels.proposed}
                      </span>
                      <Badge variant="outline">
                        {stats.proposed_deadlines}
                      </Badge>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {(view === "schedule" || view === "overview") && (
          <Card>
            <CardHeader className="flex-row items-center gap-2">
              <Clock3Icon className="text-muted-foreground size-4" />
              <CardTitle className="text-base">{labels.schedule}</CardTitle>
            </CardHeader>
            <CardContent>
              {scheduleQuery.isPending ? (
                <Skeleton className="h-20 w-full" />
              ) : scheduleQuery.isError ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-destructive text-sm">
                    {labels.scheduleError}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void scheduleQuery.refetch()}
                  >
                    <RefreshCwIcon />
                    {labels.retry}
                  </Button>
                </div>
              ) : !scheduleItems.length ? (
                <p className="text-muted-foreground text-sm">
                  {labels.emptySchedule}
                </p>
              ) : (
                <>
                  <div className="divide-y">
                    {scheduleItems.map((deadline) => (
                      <div
                        key={deadline.id}
                        className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {deadline.title}
                          </div>
                          <div className="text-muted-foreground mt-1 text-xs">
                            {labels.deadlineKinds[deadline.kind] ??
                              deadline.kind}
                          </div>
                        </div>
                        <time
                          className="text-muted-foreground shrink-0 text-xs"
                          dateTime={deadline.due_at}
                        >
                          {displayTime(
                            deadline.due_at,
                            deadline.timezone_name,
                            locale,
                          )}
                        </time>
                      </div>
                    ))}
                  </div>
                  {scheduleQuery.hasNextPage && (
                    <div className="mt-3 border-t pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={scheduleQuery.isFetchingNextPage}
                        onClick={() => void scheduleQuery.fetchNextPage()}
                      >
                        {scheduleQuery.isFetchingNextPage
                          ? labels.loadingSchedule
                          : labels.loadMore}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {view === "overview" && (
        <Card>
          <CardHeader className="flex-row items-center gap-2">
            <HistoryIcon className="text-muted-foreground size-4" />
            <CardTitle className="text-base">{labels.activity}</CardTitle>
          </CardHeader>
          <CardContent>
            {!data.recent_activity.length ? (
              <p className="text-muted-foreground text-sm">
                {labels.emptyActivity}
              </p>
            ) : (
              <div className="divide-y">
                {data.recent_activity.map((event, index) => (
                  <div
                    key={`${event.resource_id}-${event.action}-${event.created_at}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 text-sm">
                      <span>{activityLabel(event.action, locale)}</span>
                      <span className="text-muted-foreground ml-2 text-xs">
                        {event.resource_type}
                      </span>
                    </div>
                    <time
                      className="text-muted-foreground shrink-0 text-xs"
                      dateTime={event.created_at}
                    >
                      {displayTime(event.created_at, "UTC", locale)}
                    </time>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  danger = false,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  detail?: string;
  danger?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {icon}
          <span>{label}</span>
        </div>
        <div
          className={`mt-3 text-2xl font-semibold ${danger ? "text-destructive" : ""}`}
        >
          {value}
        </div>
        {detail && (
          <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
        )}
      </CardContent>
    </Card>
  );
}
