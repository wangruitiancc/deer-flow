"use client";

import {
  BellRingIcon,
  CalendarClockIcon,
  Clock3Icon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  useConfirmLawMatterDeadline,
  useCreateLawMatterDeadline,
  useLawMatterDeadlineEvents,
  useLawMatterDeadlineRecipients,
  useLawMatterDeadlines,
  useLawMatterNotificationOutbox,
  useMarkLawMatterNotificationRead,
  useRescheduleLawMatterDeadline,
  useTransitionLawMatterDeadline,
} from "@/core/law";
import type {
  ConfirmMatterDeadlineInput,
  MatterDeadline,
  MatterDeadlineKind,
  MatterDeadlineRecipient,
  MatterMemberRole,
  RescheduleMatterDeadlineInput,
} from "@/core/law/types";

const KIND_LABEL: Record<MatterDeadlineKind, string> = {
  filing: "诉讼/程序期限",
  hearing: "庭审/会议",
  performance: "履行事项",
  internal_task: "内部任务",
};

const STATE_LABEL = {
  proposed: "待律师确认",
  confirmed: "已确认",
  cancelled: "已取消",
  completed: "已完成",
} as const;

const EVENT_LABEL = {
  proposed: "创建提案",
  confirmed: "律师确认",
  rescheduled: "改期并重排提醒",
  cancelled: "取消期限",
  completed: "完成事项",
} as const;

const CONFIRMING_ROLES: MatterMemberRole[] = ["owner", "lead", "lawyer"];

function formatDate(value: string, timezoneName: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezoneName,
  }).format(new Date(value));
}

function displayRecipient(recipient: MatterDeadlineRecipient): string {
  const name = recipient.display_name?.trim();
  return `${name && name.length > 0 ? name : `成员 ${recipient.membership_id.slice(0, 8)}`} · ${recipient.role}`;
}

function formString(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value : "";
}

function parseReminderOffsets(raw: string): number[] | null {
  const values = raw
    .split(/[，,]/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number);
  if (
    !values.length ||
    values.some(
      (value) => !Number.isInteger(value) || value < 1 || value > 525_600,
    ) ||
    new Set(values).size !== values.length
  ) {
    return null;
  }
  return values;
}

function reminderLabel(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} 天前`;
  if (minutes % 60 === 0) return `${minutes / 60} 小时前`;
  return `${minutes} 分钟前`;
}

export function MatterDeadlinePanel({
  tenantId,
  matterId,
  matterRole,
  currentMembershipId,
}: {
  tenantId: string;
  matterId: string;
  matterRole: MatterMemberRole;
  currentMembershipId: string;
}) {
  const canManage = CONFIRMING_ROLES.includes(matterRole);
  const deadlines = useLawMatterDeadlines(tenantId, matterId);
  const recipients = useLawMatterDeadlineRecipients(
    tenantId,
    matterId,
    canManage,
  );
  const notifications = useLawMatterNotificationOutbox(tenantId, matterId);
  const markNotificationRead = useMarkLawMatterNotificationRead(
    tenantId,
    matterId,
  );
  const createDeadline = useCreateLawMatterDeadline(tenantId, matterId);
  const confirmDeadline = useConfirmLawMatterDeadline(tenantId, matterId);
  const rescheduleDeadline = useRescheduleLawMatterDeadline(tenantId, matterId);
  const transitionDeadline = useTransitionLawMatterDeadline(tenantId, matterId);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submitProposal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const localDueAt = formString(data, "local_due_at").trim();
    const basisNote = formString(data, "basis_note").trim();
    const calculationExplanation = formString(
      data,
      "calculation_explanation",
    ).trim();
    const ruleVersion = formString(data, "rule_version").trim();
    const foldValue = formString(data, "fold");
    if (!localDueAt || !basisNote || !calculationExplanation || !ruleVersion) {
      setFormError("请填写日期、依据、规则版本和计算说明。");
      return;
    }
    try {
      await createDeadline.mutateAsync({
        kind: formString(data, "kind") as MatterDeadlineKind,
        title: formString(data, "title").trim(),
        origin: "lawyer_entry",
        local_due_at: localDueAt,
        timezone_name: formString(data, "timezone_name").trim(),
        fold: foldValue === "" ? null : (Number(foldValue) as 0 | 1),
        basis_note: basisNote,
        rule_version: ruleVersion,
        source_refs: formString(data, "source_refs")
          .split(/\r?\n/u)
          .map((value) => value.trim())
          .filter(Boolean),
        calculation: {
          method: "lawyer_entry",
          explanation: calculationExplanation,
        },
      });
      form.reset();
      setShowCreateForm(false);
    } catch {
      // The mutation renders its server error below; the form remains available for correction.
    }
  };

  const refresh = () => {
    void deadlines.refetch();
    void notifications.refetch();
  };

  return (
    <section className="mb-7" aria-labelledby="matter-deadlines-title">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarClockIcon className="size-4" />
          <h3 id="matter-deadlines-title" className="text-sm font-semibold">
            期限与提醒
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={deadlines.isFetching || notifications.isFetching}
          >
            {deadlines.isFetching || notifications.isFetching ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <RefreshCwIcon />
            )}
            刷新
          </Button>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCreateForm((value) => !value)}
            >
              <PlusIcon />
              新建提案
            </Button>
          )}
        </div>
      </div>

      <p className="text-muted-foreground mb-3 text-xs">
        日期、依据、来源和计算说明由登记者提供，系统不自动判断法律效力。提案经有权限的律师确认后才会排入提醒。
      </p>

      {showCreateForm && canManage && (
        <form
          className="mb-4 space-y-3 rounded-lg border p-4"
          onSubmit={(event) => void submitProposal(event)}
        >
          <h4 className="font-medium">新增待确认期限</h4>
          <p className="text-muted-foreground text-xs">
            当前为律师手工登记；尚未接入 AI 日期建议或法定节假日计算。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>事项类型</span>
              <select
                name="kind"
                className="bg-background w-full rounded-md border px-3 py-2"
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>事项名称</span>
              <input
                name="title"
                required
                maxLength={240}
                className="bg-background w-full rounded-md border px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>当地日期与时间</span>
              <input
                name="local_due_at"
                type="datetime-local"
                required
                className="bg-background w-full rounded-md border px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>IANA 时区</span>
              <input
                name="timezone_name"
                defaultValue="Asia/Shanghai"
                required
                maxLength={80}
                className="bg-background w-full rounded-md border px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>夏令时重叠时间</span>
              <select
                name="fold"
                defaultValue=""
                className="bg-background w-full rounded-md border px-3 py-2"
              >
                <option value="">由系统判断</option>
                <option value="0">较早的一次</option>
                <option value="1">较晚的一次</option>
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span>规则版本/人工依据标记</span>
              <input
                name="rule_version"
                defaultValue="manual-entry-v1"
                required
                maxLength={120}
                className="bg-background w-full rounded-md border px-3 py-2"
              />
            </label>
          </div>
          <label className="block space-y-1 text-sm">
            <span>法律或业务依据</span>
            <textarea
              name="basis_note"
              required
              maxLength={8000}
              rows={3}
              className="bg-background w-full rounded-md border px-3 py-2"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>来源标识（每行一条，可选）</span>
            <textarea
              name="source_refs"
              rows={2}
              maxLength={8192}
              className="bg-background w-full rounded-md border px-3 py-2"
              placeholder="来源名称、条款或案件内引用标识"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>计算说明</span>
            <textarea
              name="calculation_explanation"
              required
              maxLength={8000}
              rows={3}
              className="bg-background w-full rounded-md border px-3 py-2"
              placeholder="说明如何从起算事实得到该日期；不确定事项请写明"
            />
          </label>
          {formError && (
            <p role="alert" className="text-destructive text-sm">
              {formError}
            </p>
          )}
          {createDeadline.isError && (
            <p role="alert" className="text-destructive text-sm">
              {createDeadline.error.message || "期限提案未保存。"}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setShowCreateForm(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={createDeadline.isPending}>
              {createDeadline.isPending && (
                <LoaderCircleIcon className="animate-spin" />
              )}
              保存待确认提案
            </Button>
          </div>
        </form>
      )}

      {deadlines.isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          正在读取案件期限…
        </p>
      ) : deadlines.isError ? (
        <div className="rounded-lg border p-4">
          <p role="alert" className="text-sm">
            {deadlines.error.message || "无法读取案件期限。"}
          </p>
          <Button
            className="mt-2"
            variant="outline"
            size="sm"
            onClick={() => void deadlines.refetch()}
          >
            重试
          </Button>
        </div>
      ) : deadlines.data?.length ? (
        <div className="space-y-3">
          {deadlines.data.map((deadline) => (
            <MatterDeadlineCard
              key={deadline.id}
              deadline={deadline}
              recipients={recipients.data ?? []}
              recipientsPending={recipients.isPending}
              canManage={canManage}
              currentMembershipId={currentMembershipId}
              onConfirm={(input) =>
                confirmDeadline.mutate({ deadlineId: deadline.id, input })
              }
              confirming={confirmDeadline.isPending}
              confirmError={confirmDeadline.error?.message ?? null}
              onReschedule={(input) =>
                rescheduleDeadline.mutate({ deadlineId: deadline.id, input })
              }
              rescheduling={rescheduleDeadline.isPending}
              rescheduleError={rescheduleDeadline.error?.message ?? null}
              onTransition={(targetState, input) =>
                transitionDeadline.mutate({
                  deadlineId: deadline.id,
                  targetState,
                  input,
                })
              }
              transitioning={transitionDeadline.isPending}
              transitionError={transitionDeadline.error?.message ?? null}
            />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground rounded-lg border p-4 text-sm">
          当前案件还没有期限提案。
        </p>
      )}

      {!canManage && (
        <p className="text-muted-foreground mt-3 text-xs">
          当前案件角色可查看期限和自己的提醒；新建及确认操作需要案件负责人、主办律师或律师权限。
        </p>
      )}

      <section className="mt-5" aria-labelledby="my-deadline-reminders-title">
        <div className="mb-2 flex items-center gap-2">
          <BellRingIcon className="size-4" />
          <h4 id="my-deadline-reminders-title" className="text-sm font-medium">
            我的提醒安排
          </h4>
        </div>
        {notifications.isPending ? (
          <p role="status" className="text-muted-foreground text-sm">
            正在读取提醒安排…
          </p>
        ) : notifications.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {notifications.error.message || "无法读取提醒安排。"}
          </p>
        ) : notifications.data?.length ? (
          <ul className="divide-y rounded-lg border">
            {notifications.data.map((item) => {
              const deadline = deadlines.data?.find(
                (row) => row.id === item.deadline_id,
              );
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                >
                  <span>
                    {deadline?.title ?? "期限提醒"} ·{" "}
                    {item.channel === "in_app" ? "站内" : item.channel}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatDate(
                      item.scheduled_at,
                      deadline?.timezone_name ?? "Asia/Shanghai",
                    )}{" "}
                    ·{" "}
                    {item.status === "pending"
                      ? "已排期，待通知服务处理"
                      : item.read_at
                        ? "已读"
                        : item.status === "sent"
                          ? "已送达，未读"
                          : item.status}
                  </span>
                  {item.channel === "in_app" &&
                  item.status === "sent" &&
                  !item.read_at ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={markNotificationRead.isPending}
                      onClick={() => markNotificationRead.mutate(item.id)}
                    >
                      标记已读
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground rounded-lg border p-3 text-sm">
            目前没有分配给我的提醒。
          </p>
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          站内提醒服务按计划时间派发；送达与已读状态分别保存。邮件和企业微信仍未启用。
        </p>
      </section>
    </section>
  );
}

function MatterDeadlineCard({
  deadline,
  recipients,
  recipientsPending,
  canManage,
  currentMembershipId,
  onConfirm,
  confirming,
  confirmError,
  onReschedule,
  rescheduling,
  rescheduleError,
  onTransition,
  transitioning,
  transitionError,
}: {
  deadline: MatterDeadline;
  recipients: MatterDeadlineRecipient[];
  recipientsPending: boolean;
  canManage: boolean;
  currentMembershipId: string;
  onConfirm: (input: ConfirmMatterDeadlineInput) => void;
  confirming: boolean;
  confirmError: string | null;
  onReschedule: (input: RescheduleMatterDeadlineInput) => void;
  rescheduling: boolean;
  rescheduleError: string | null;
  onTransition: (
    state: "cancelled" | "completed",
    input: { expected_version: number; change_note: string },
  ) => void;
  transitioning: boolean;
  transitionError: string | null;
}) {
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([
    currentMembershipId,
  ]);
  const [reminderOffsets, setReminderOffsets] = useState("1440,60");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const history = useLawMatterDeadlineEvents(
    deadline.tenant_id,
    deadline.matter_id,
    showHistory ? deadline.id : null,
  );

  const toggleRecipient = (membershipId: string) => {
    setSelectedRecipients((current) =>
      current.includes(membershipId)
        ? current.filter((value) => value !== membershipId)
        : [...current, membershipId],
    );
  };

  const confirm = () => {
    setScheduleError(null);
    const offsets = parseReminderOffsets(reminderOffsets);
    if (!selectedRecipients.length) {
      setScheduleError("至少选择一位提醒接收人。");
      return;
    }
    if (!offsets) {
      setScheduleError("提醒分钟数必须是唯一的正整数，范围为 1 到 525600。");
      return;
    }
    onConfirm({
      expected_version: deadline.version,
      recipient_membership_ids: selectedRecipients,
      reminder_offsets_minutes: offsets,
      channels: ["in_app"],
    });
  };

  const submitReschedule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setScheduleError(null);
    const data = new FormData(event.currentTarget);
    const offsets = parseReminderOffsets(formString(data, "reminder_offsets"));
    if (!selectedRecipients.length || !offsets) {
      setScheduleError("请至少选择一位接收人，并填写有效的提醒分钟数。");
      return;
    }
    const localDueAt = formString(data, "local_due_at").trim();
    const timezoneName = formString(data, "timezone_name").trim();
    const basisNote = formString(data, "basis_note").trim();
    const ruleVersion = formString(data, "rule_version").trim();
    const changeSummary = formString(data, "change_note").trim();
    if (!localDueAt || !timezoneName || !basisNote || !ruleVersion || !changeSummary) {
      setScheduleError("请填写新日期、依据、规则版本和改期原因。");
      return;
    }
    const input: RescheduleMatterDeadlineInput = {
      expected_version: deadline.version,
      local_due_at: localDueAt,
      timezone_name: timezoneName,
      fold: formString(data, "fold") === ""
        ? null
        : (Number(formString(data, "fold")) as 0 | 1),
      basis_note: basisNote,
      rule_version: ruleVersion,
      source_refs: formString(data, "source_refs")
        .split(/\r?\n/u)
        .map((value) => value.trim())
        .filter(Boolean),
      calculation: {
        method: "lawyer_reschedule",
        explanation: formString(data, "calculation_explanation").trim(),
      },
      change_note: changeSummary,
      recipient_membership_ids: selectedRecipients,
      reminder_offsets_minutes: offsets,
      channels: ["in_app"],
    };
    onReschedule(input);
    setShowRescheduleForm(false);
  };

  return (
    <article className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium break-words">{deadline.title}</h4>
            <span className="bg-muted rounded px-2 py-0.5 text-xs">
              {STATE_LABEL[deadline.state]}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            {KIND_LABEL[deadline.kind]} ·{" "}
            {deadline.origin === "lawyer_entry" ? "律师登记" : deadline.origin}{" "}
            · 版本 {deadline.version}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock3Icon className="size-4" />
          {formatDate(deadline.due_at, deadline.timezone_name)}
          <span className="text-muted-foreground text-xs">
            {deadline.timezone_name}
          </span>
        </div>
      </div>

      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">依据</dt>
          <dd className="mt-1 break-words whitespace-pre-wrap">
            {deadline.basis_note}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">规则版本与来源标识</dt>
          <dd className="mt-1 break-words">
            {deadline.rule_version}
            {deadline.source_refs.length
              ? ` · ${deadline.source_refs.join("；")}`
              : " · 未提供来源标识"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">计算说明</dt>
          <dd className="mt-1 break-words whitespace-pre-wrap">
            {typeof deadline.calculation.explanation === "string"
              ? deadline.calculation.explanation
              : JSON.stringify(deadline.calculation)}
          </dd>
        </div>
      </dl>

      {deadline.state === "proposed" && canManage && (
        <div className="mt-4 space-y-3 border-t pt-4">
          <h5 className="text-sm font-medium">律师确认并安排提醒</h5>
          {recipientsPending ? (
            <p role="status" className="text-muted-foreground text-sm">
              正在读取案件成员…
            </p>
          ) : recipients.length ? (
            <fieldset className="space-y-2">
              <legend className="text-muted-foreground mb-2 text-xs">
                提醒接收成员
              </legend>
              {recipients.map((recipient) => (
                <label
                  key={recipient.membership_id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selectedRecipients.includes(
                      recipient.membership_id,
                    )}
                    onChange={() => toggleRecipient(recipient.membership_id)}
                  />
                  {displayRecipient(recipient)}
                </label>
              ))}
            </fieldset>
          ) : (
            <p role="alert" className="text-destructive text-sm">
              当前无法读取可接收提醒的案件成员。
            </p>
          )}
          <label className="block space-y-1 text-sm">
            <span>提醒时间（相对期限的分钟数，以逗号分隔）</span>
            <input
              value={reminderOffsets}
              onChange={(event) => setReminderOffsets(event.target.value)}
              className="bg-background w-full rounded-md border px-3 py-2"
              aria-label="提醒分钟数"
            />
            <span className="text-muted-foreground block text-xs">
              例：1440,60 表示提前 1 天和 1 小时。
              {parseReminderOffsets(reminderOffsets)?.length
                ? `当前安排：${parseReminderOffsets(reminderOffsets)?.map(reminderLabel).join("、")}。`
                : ""}
              选中的渠道目前仅写入待处理队列。
            </span>
          </label>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="text-muted-foreground mb-2 text-xs">
              通知渠道
            </legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked readOnly />
              站内队列
            </label>
            <label className="text-muted-foreground flex items-center gap-2">
              <input type="checkbox" disabled />
              邮件（未启用）
            </label>
            <label className="text-muted-foreground flex items-center gap-2">
              <input type="checkbox" disabled />
              企业微信（未启用）
            </label>
          </fieldset>
          {scheduleError && (
            <p role="alert" className="text-destructive text-sm">
              {scheduleError}
            </p>
          )}
          {confirmError && (
            <p role="alert" className="text-destructive text-sm">
              {confirmError}
            </p>
          )}
          <Button
            onClick={confirm}
            disabled={confirming || recipientsPending || !recipients.length}
          >
            {confirming && <LoaderCircleIcon className="animate-spin" />}
            确认期限并安排站内提醒
          </Button>
        </div>
      )}

      {(deadline.state === "confirmed" || deadline.state === "proposed") && canManage && (
        <div className="mt-4 space-y-3 border-t pt-4">
          {deadline.state === "confirmed" && showRescheduleForm ? (
            <form className="space-y-3" onSubmit={submitReschedule}>
              <h5 className="text-sm font-medium">改期并重新安排提醒</h5>
              <p className="text-muted-foreground text-xs">
                保存时会原子取消旧版本尚未派发的提醒，并为新版本建立所选提醒。
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span>新的当地日期与时间</span>
                  <input
                    name="local_due_at"
                    type="datetime-local"
                    required
                    defaultValue={deadline.local_due_at.slice(0, 16)}
                    className="bg-background w-full rounded-md border px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span>IANA 时区</span>
                  <input
                    name="timezone_name"
                    required
                    maxLength={80}
                    defaultValue={deadline.timezone_name}
                    className="bg-background w-full rounded-md border px-3 py-2"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span>夏令时重叠时间</span>
                  <select name="fold" defaultValue={deadline.fold ?? ""} className="bg-background w-full rounded-md border px-3 py-2">
                    <option value="">由系统判断</option>
                    <option value="0">较早的一次</option>
                    <option value="1">较晚的一次</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span>规则版本</span>
                  <input name="rule_version" required maxLength={120} defaultValue={deadline.rule_version} className="bg-background w-full rounded-md border px-3 py-2" />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                <span>期限依据</span>
                <textarea name="basis_note" required maxLength={8000} rows={2} defaultValue={deadline.basis_note} className="bg-background w-full rounded-md border px-3 py-2" />
              </label>
              <label className="block space-y-1 text-sm">
                <span>来源标识（每行一条）</span>
                <textarea name="source_refs" rows={2} defaultValue={deadline.source_refs.join("\n")} className="bg-background w-full rounded-md border px-3 py-2" />
              </label>
              <label className="block space-y-1 text-sm">
                <span>计算说明</span>
                <textarea name="calculation_explanation" rows={2} defaultValue={typeof deadline.calculation.explanation === "string" ? deadline.calculation.explanation : ""} className="bg-background w-full rounded-md border px-3 py-2" />
              </label>
              <fieldset className="space-y-2">
                <legend className="text-muted-foreground mb-2 text-xs">新提醒接收成员</legend>
                {recipients.map((recipient) => (
                  <label key={recipient.membership_id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={selectedRecipients.includes(recipient.membership_id)} onChange={() => toggleRecipient(recipient.membership_id)} />
                    {displayRecipient(recipient)}
                  </label>
                ))}
              </fieldset>
              <label className="block space-y-1 text-sm">
                <span>提醒时间（相对新期限的分钟数）</span>
                <input name="reminder_offsets" defaultValue={reminderOffsets} className="bg-background w-full rounded-md border px-3 py-2" />
              </label>
              <label className="block space-y-1 text-sm">
                <span>改期原因</span>
                <textarea name="change_note" required maxLength={2000} rows={2} className="bg-background w-full rounded-md border px-3 py-2" />
              </label>
              {scheduleError && <p role="alert" className="text-destructive text-sm">{scheduleError}</p>}
              {rescheduleError && <p role="alert" className="text-destructive text-sm">{rescheduleError}</p>}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowRescheduleForm(false)}>返回</Button>
                <Button type="submit" disabled={rescheduling || recipientsPending}>{rescheduling ? <LoaderCircleIcon className="animate-spin" /> : null}保存改期</Button>
              </div>
            </form>
          ) : deadline.state === "confirmed" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowRescheduleForm(true)}>改期 / 调整提醒</Button>
          ) : null}
          <label className="block space-y-1 text-sm">
            <span>{deadline.state === "proposed" ? "取消提案原因" : "取消或完成原因"}</span>
            <input value={changeNote} onChange={(event) => setChangeNote(event.target.value)} maxLength={2000} className="bg-background w-full rounded-md border px-3 py-2" />
          </label>
          {transitionError && <p role="alert" className="text-destructive text-sm">{transitionError}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={transitioning || changeNote.trim().length === 0} onClick={() => onTransition("cancelled", { expected_version: deadline.version, change_note: changeNote.trim() })}>取消期限</Button>
            {deadline.state === "confirmed" ? <Button type="button" disabled={transitioning || changeNote.trim().length === 0} onClick={() => onTransition("completed", { expected_version: deadline.version, change_note: changeNote.trim() })}>标记完成</Button> : null}
          </div>
        </div>
      )}

      <div className="mt-3 border-t pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowHistory((value) => !value)}
        >
          {showHistory ? "收起记录" : "查看确认记录"}
        </Button>
        {showHistory && (
          <ol className="mt-2 space-y-2 text-xs">
            {history.isPending ? (
              <li role="status" className="text-muted-foreground">
                正在读取记录…
              </li>
            ) : history.isError ? (
              <li role="alert" className="text-destructive">
                {history.error.message || "无法读取期限记录。"}
              </li>
            ) : (
              history.data?.map((event) => {
                const recordedVersion = event.event.version;
                const version =
                  typeof recordedVersion === "string" ||
                  typeof recordedVersion === "number"
                    ? recordedVersion
                    : event.sequence_number;
                return (
                  <li
                    key={event.id}
                    className="text-muted-foreground flex flex-wrap justify-between gap-2"
                  >
                    <span>
                      {EVENT_LABEL[event.event_type] ?? event.event_type} · 版本{" "}
                      {version}
                    </span>
                    <time dateTime={event.created_at}>
                      {formatDate(event.created_at, deadline.timezone_name)}
                    </time>
                  </li>
                );
              })
            )}
          </ol>
        )}
      </div>
    </article>
  );
}
