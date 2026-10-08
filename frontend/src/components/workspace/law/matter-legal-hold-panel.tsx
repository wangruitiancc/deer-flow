"use client";

import {
  LoaderCircleIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import {
  useLawMatterLegalHold,
  useSetLawMatterLegalHold,
  type MatterStatus,
} from "@/core/law";

interface MatterLegalHoldPanelProps {
  tenantId: string;
  matterId: string;
  matterStatus: MatterStatus;
  matterVersion: number;
  canManage: boolean;
}

function formatDate(value: string, locale: "en-US" | "zh-CN"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function MatterLegalHoldPanel({
  tenantId,
  matterId,
  matterStatus,
  matterVersion,
  canManage,
}: MatterLegalHoldPanelProps) {
  const { locale } = useI18n();
  const zh = locale === "zh-CN";
  const [reason, setReason] = useState("");
  const query = useLawMatterLegalHold(
    canManage ? tenantId : null,
    canManage ? matterId : null,
  );
  const mutation = useSetLawMatterLegalHold(tenantId, matterId);
  const active = canManage
    ? (query.data?.active ?? matterStatus === "legal_hold")
    : matterStatus === "legal_hold";
  const labels = zh
    ? {
        title: "案件法律保留",
        active: "保留中",
        inactive: "未设置",
        description:
          "保留期间，归档证据的物理删除会被阻止。此设置不会代替律所确定保留期限或其他派生数据的处理规则。",
        reason: "设置或解除理由",
        place: "设置法律保留",
        release: "解除法律保留",
        history: "变更记录",
        placed: "设置保留",
        released: "解除保留",
        empty: "暂无变更记录。",
        retry: "重试",
        failed: "无法读取保留记录。",
        loading: "正在读取…",
        reasonRequired: "请填写理由。",
      }
    : {
        title: "Matter legal hold",
        active: "Active",
        inactive: "Not set",
        description:
          "While active, physical deletion of archived evidence is blocked. This setting does not define the firm’s retention period or disposition rules for derived data.",
        reason: "Reason for placing or releasing the hold",
        place: "Place legal hold",
        release: "Release legal hold",
        history: "Change history",
        placed: "Hold placed",
        released: "Hold released",
        empty: "There are no changes yet.",
        retry: "Retry",
        failed: "Unable to load hold history.",
        loading: "Loading…",
        reasonRequired: "Enter a reason.",
      };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) return;
    mutation.mutate(
      { active: !active, reason: trimmed, expected_version: matterVersion },
      { onSuccess: () => setReason("") },
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              {active ? (
                <ShieldAlertIcon className="size-4" />
              ) : (
                <ShieldCheckIcon className="size-4" />
              )}
              {labels.title}
            </CardTitle>
            <CardDescription className="mt-2">
              {labels.description}
            </CardDescription>
          </div>
          <Badge variant={active ? "secondary" : "outline"}>
            {active ? labels.active : labels.inactive}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {canManage && (
          <>
            {query.isPending ? (
              <p className="text-muted-foreground text-sm">{labels.loading}</p>
            ) : query.isError ? (
              <div className="flex items-center gap-3 text-sm" role="alert">
                <span>{labels.failed}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void query.refetch()}
                >
                  {labels.retry}
                </Button>
              </div>
            ) : (
              <>
                <form className="space-y-3" onSubmit={submit}>
                  <label className="block space-y-2 text-sm font-medium">
                    <span>{labels.reason}</span>
                    <Textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      maxLength={1000}
                      rows={3}
                      required
                      aria-label={labels.reason}
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="submit"
                      disabled={!reason.trim() || mutation.isPending}
                    >
                      {mutation.isPending && (
                        <LoaderCircleIcon className="animate-spin" />
                      )}
                      {active ? labels.release : labels.place}
                    </Button>
                    {mutation.isError && (
                      <span className="text-destructive text-sm" role="alert">
                        {mutation.error.message}
                      </span>
                    )}
                  </div>
                </form>
                <div className="space-y-2 border-t pt-3">
                  <h3 className="text-sm font-medium">{labels.history}</h3>
                  {!query.data?.events.length ? (
                    <p className="text-muted-foreground text-sm">
                      {labels.empty}
                    </p>
                  ) : (
                    <ol className="space-y-2">
                      {[...query.data.events].reverse().map((item) => (
                        <li
                          key={item.id}
                          className="rounded-md border p-3 text-sm"
                        >
                          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
                            <span className="font-medium">
                              {item.event_type === "placed"
                                ? labels.placed
                                : labels.released}
                            </span>
                            <time
                              className="text-muted-foreground"
                              dateTime={item.created_at}
                            >
                              {formatDate(item.created_at, locale)}
                            </time>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap break-words">
                            {item.reason_note}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
