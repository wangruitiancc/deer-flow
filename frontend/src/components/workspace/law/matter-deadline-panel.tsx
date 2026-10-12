"use client";

import {
  BellRingIcon,
  CalendarClockIcon,
  Clock3Icon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  useCalculateLawMatterDeadlineCandidate,
  useConfirmLawMatterDeadline,
  useCreateLawMatterDeadline,
  useLawMatterDeadlineEvents,
  useLawMatterDeadlineRules,
  useLawMatterDeadlineRecipients,
  useLawMatterDeadlineCandidateDrafts,
  useLawMatterDeadlines,
  useLawMatterNotificationOutbox,
  useLawDeadlineNotificationCapabilities,
  useHandoffLawMatterDeadline,
  useLawMatterNotificationIncidents,
  useClaimLawMatterNotificationIncident,
  useCloseLawMatterNotificationIncident,
  useMarkLawMatterNotificationRead,
  useRescheduleLawMatterDeadline,
  useTransitionLawMatterDeadline,
} from "@/core/law";
import type {
  ConfirmMatterDeadlineInput,
  MatterDeadline,
  MatterDeadlineCandidateDraft,
  MatterDeadlineKind,
  MatterDeadlineRecipient,
  MatterDeadlineSourceBinding,
  MatterMemberRole,
  MatterNotificationOutboxItem,
  MatterNotificationAttempt,
  MatterNotificationIncident,
  MatterDeadlineNotificationCapabilities,
  MatterNotificationChannel,
  HandoffMatterDeadlineInput,
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

function DeadlineChannelOptions({
  selectedChannels,
  capabilities,
  onToggle,
}: {
  selectedChannels: MatterNotificationChannel[];
  capabilities?: MatterDeadlineNotificationCapabilities["channels"];
  onToggle: (channel: MatterNotificationChannel) => void;
}) {
  const emailCapability = capabilities?.email;
  const emailLabel =
    !emailCapability || emailCapability.disabled_reason === "email_not_configured"
      ? "邮件（未启用）"
      : emailCapability.disabled_reason === "dispatch_paused"
        ? "邮件（派发暂停）"
        : "邮件";
  const inAppPaused = capabilities?.in_app.dispatch_state === "paused";

  return (
    <fieldset className="flex flex-wrap gap-4 text-sm">
      <legend className="text-muted-foreground mb-2 text-xs">通知渠道</legend>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={selectedChannels.includes("in_app")}
          onChange={() => onToggle("in_app")}
        />
        {inAppPaused ? "站内队列（派发暂停，计划仍可保存）" : "站内队列"}
      </label>
      <label className="text-muted-foreground flex items-center gap-2">
        <input
          type="checkbox"
          checked={selectedChannels.includes("email")}
          disabled={!emailCapability?.selectable}
          onChange={() => onToggle("email")}
        />
        {emailCapability?.selectable ? "邮件" : emailLabel}
      </label>
    </fieldset>
  );
}

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

function formatDeadlineDue(deadline: MatterDeadline): string {
  if (deadline.due_precision === "date_only" && deadline.legal_due_date) {
    return new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(`${deadline.legal_due_date}T00:00:00Z`));
  }
  return formatDate(deadline.due_at, deadline.timezone_name);
}

function displayRecipient(recipient: MatterDeadlineRecipient): string {
  const name = recipient.display_name?.trim();
  return `${name && name.length > 0 ? name : `成员 ${recipient.membership_id.slice(0, 8)}`} · ${recipient.role}`;
}

function notificationStatusLabel(item: MatterNotificationOutboxItem): string {
  switch (item.status) {
    case "pending":
      return "已排期，待通知服务处理";
    case "sending":
      return "通知服务处理中";
    case "sent":
      if (item.channel !== "in_app") {
        return "通知服务已处理，实际送达状态未知";
      }
      return item.read_at ? "已读" : "已送达，未读";
    case "failed":
      return "通知处理失败";
    case "cancelled":
      return "已取消";
    default:
      return `状态未知（${String(item.status)}）`;
  }
}

function notificationFailureLabel(
  code: MatterNotificationOutboxItem["failure_code"],
): string | null {
  switch (code) {
    case "smtp_temporary":
      return "邮件服务临时失败";
    case "smtp_permanent":
      return "邮件服务拒收";
    case "smtp_delivery_unknown":
      return "邮件结果未知，已停止自动重投";
    case "recipient_unavailable":
      return "收件人不可用";
    default:
      return null;
  }
}

function notificationAttemptLabel(attempt: MatterNotificationAttempt): string {
  switch (attempt.outcome) {
    case "in_progress":
      return "处理中，结果尚未确定";
    case "channel_accepted":
      return "通知渠道已接收；邮件实际送达仍未知";
    case "retryable_failure":
      return `${notificationFailureLabel(attempt.failure_code) ?? "临时失败"}，将按计划重试`;
    case "permanent_failure":
      return notificationFailureLabel(attempt.failure_code) ?? "永久失败，待人工处置";
    case "outcome_unknown":
      return "结果未知，已停止自动重投";
    case "cancelled_before_submission":
      return "发送前因权限或期限变更取消";
    default:
      return `结果未知（${String(attempt.outcome)}）`;
  }
}

function notificationIncidentLabel(
  incident: MatterNotificationIncident,
): string {
  const labels = {
    delivery_failure: "通知发送失败",
    delivery_unknown: "外部发送结果未知",
    retry_exhausted: "自动重试已耗尽",
    owner_missing: "期限尚未指定负责人",
    handoff_pending: "期限负责人待交接",
    deadline_overdue: "期限已过，待人工处理",
    dispatch_stalled: "通知任务超过两个轮询周期未推进",
  } as const;
  return labels[incident.incident_type];
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
  const canManageIncidents = matterRole === "owner" || matterRole === "lead";
  const deadlines = useLawMatterDeadlines(tenantId, matterId);
  const candidateDrafts = useLawMatterDeadlineCandidateDrafts(tenantId, matterId);
  const channelCapabilities = useLawDeadlineNotificationCapabilities(tenantId);
  const deadlineRules = useLawMatterDeadlineRules(tenantId, matterId);
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
  const incidents = useLawMatterNotificationIncidents(
    tenantId,
    matterId,
    canManageIncidents,
  );
  const claimIncident = useClaimLawMatterNotificationIncident(
    tenantId,
    matterId,
  );
  const closeIncident = useCloseLawMatterNotificationIncident(
    tenantId,
    matterId,
  );
  const createDeadline = useCreateLawMatterDeadline(tenantId, matterId);
  const candidatePreview = useCalculateLawMatterDeadlineCandidate(
    tenantId,
    matterId,
  );
  const resetCandidatePreview = candidatePreview.reset;
  const confirmDeadline = useConfirmLawMatterDeadline(tenantId, matterId);
  const rescheduleDeadline = useRescheduleLawMatterDeadline(tenantId, matterId);
  const transitionDeadline = useTransitionLawMatterDeadline(tenantId, matterId);
  const handoffDeadline = useHandoffLawMatterDeadline(tenantId, matterId);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [candidateRuleJson, setCandidateRuleJson] = useState("");
  const [candidateInputError, setCandidateInputError] = useState<string | null>(
    null,
  );
  const scopeKey = `${tenantId}:${matterId}`;
  const previousScope = useRef(scopeKey);
  const [candidateScope, setCandidateScope] = useState<string | null>(null);
  const [incidentResolutions, setIncidentResolutions] = useState<
    Record<string, string>
  >({});
  const [proposalPrefill, setProposalPrefill] = useState<{
    scopeKey: string;
    dueDate: string;
    duePrecision: "date_only";
    ruleVersion: string;
    sourceRefs: string;
    sourceBindingsJson: string;
    calculationExplanation: string;
  } | null>(null);
  const proposalFormRef = useRef<HTMLFormElement | null>(null);
  const [proposalFormGeneration, setProposalFormGeneration] = useState(0);
  const candidate = candidateScope === scopeKey ? candidatePreview.data : null;
  const activePrefill =
    proposalPrefill?.scopeKey === scopeKey ? proposalPrefill : null;

  const clearCandidatePrefill = useCallback(() => {
    const form = proposalFormRef.current;
    if (form && activePrefill) {
      const dueDate = form.elements.namedItem("local_due_date");
      const duePrecision = form.elements.namedItem("due_precision");
      const ruleVersion = form.elements.namedItem("rule_version");
      const sourceRefs = form.elements.namedItem("source_refs");
      const sourceBindings = form.elements.namedItem("source_bindings");
      const calculationExplanation = form.elements.namedItem(
        "calculation_explanation",
      );
      if (
        dueDate instanceof HTMLInputElement &&
        dueDate.value === activePrefill.dueDate
      ) {
        dueDate.value = "";
      }
      if (
        duePrecision instanceof HTMLSelectElement &&
        duePrecision.value === "date_only"
      ) {
        duePrecision.value = "instant";
      }
      if (
        ruleVersion instanceof HTMLInputElement &&
        ruleVersion.value === activePrefill.ruleVersion
      ) {
        ruleVersion.value = "";
      }
      if (
        sourceRefs instanceof HTMLTextAreaElement &&
        sourceRefs.value === activePrefill.sourceRefs
      ) {
        sourceRefs.value = "";
      }
      if (
        sourceBindings instanceof HTMLInputElement &&
        sourceBindings.value === activePrefill.sourceBindingsJson
      ) {
        sourceBindings.value = "";
      }
      if (
        calculationExplanation instanceof HTMLTextAreaElement &&
        calculationExplanation.value === activePrefill.calculationExplanation
      ) {
        calculationExplanation.value = "";
      }
    }
    setProposalPrefill(null);
  }, [activePrefill]);

  useEffect(() => {
    if (previousScope.current === scopeKey) return;
    previousScope.current = scopeKey;
    resetCandidatePreview();
    setCandidateScope(null);
    clearCandidatePrefill();
    setCandidateRuleJson("");
    setCandidateInputError(null);
    setShowCreateForm(false);
  }, [clearCandidatePrefill, resetCandidatePreview, scopeKey]);

  const submitProposal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const localDueDate = formString(data, "local_due_date").trim();
    const localDueTime = formString(data, "local_due_time").trim();
    const basisNote = formString(data, "basis_note").trim();
    const calculationExplanation = formString(
      data,
      "calculation_explanation",
    ).trim();
    const ruleVersion = formString(data, "rule_version").trim();
    const sourceBindingsValue = formString(data, "source_bindings").trim();
    const foldValue = formString(data, "fold");
    const duePrecision =
      formString(data, "due_precision") === "date_only"
        ? "date_only"
        : "instant";
    if (
      !formString(data, "title").trim() ||
      !localDueDate ||
      !localDueTime ||
      !formString(data, "timezone_name").trim() ||
      !basisNote ||
      !calculationExplanation ||
      !ruleVersion
    ) {
      setFormError(
        "请填写事项名称、当地日期与时间、时区、依据、规则版本和计算说明。",
      );
      return;
    }
    let sourceBindings: MatterDeadlineSourceBinding[] = [];
    if (sourceBindingsValue) {
      try {
        const parsed: unknown = JSON.parse(sourceBindingsValue);
        if (!Array.isArray(parsed)) throw new Error("not an array");
        sourceBindings = parsed as MatterDeadlineSourceBinding[];
      } catch {
        setFormError("来源版本绑定格式无效，请重新从经核验的候选生成草稿。");
        return;
      }
    }
    try {
      await createDeadline.mutateAsync({
        kind: formString(data, "kind") as MatterDeadlineKind,
        title: formString(data, "title").trim(),
        origin: "lawyer_entry",
        local_due_at: `${localDueDate}T${localDueTime}`,
        due_precision: duePrecision,
        legal_due_date: duePrecision === "date_only" ? localDueDate : null,
        timezone_name: formString(data, "timezone_name").trim(),
        fold: foldValue === "" ? null : (Number(foldValue) as 0 | 1),
        basis_note: basisNote,
        rule_version: ruleVersion,
        source_refs: formString(data, "source_refs")
          .split(/\r?\n/u)
          .map((value) => value.trim())
          .filter(Boolean),
        source_bindings: sourceBindings,
        calculation: {
          method: "lawyer_entry",
          explanation: calculationExplanation,
          ...(duePrecision === "date_only"
            ? { reminder_schedule_time_is_not_legal_cutoff_time: true }
            : {}),
        },
      });
      form.reset();
      setProposalPrefill(null);
      setShowCreateForm(false);
    } catch {
      // The mutation renders its server error below; the form remains available for correction.
    }
  };

  const submitCandidateRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCandidateInputError(null);
    candidatePreview.reset();
    setCandidateScope(null);
    setProposalPrefill(null);
    let parsedRule: unknown;
    try {
      parsedRule = JSON.parse(candidateRuleJson);
    } catch {
      setCandidateInputError("请输入有效的规则 JSON 对象。");
      return;
    }
    if (
      typeof parsedRule !== "object" ||
      parsedRule === null ||
      Array.isArray(parsedRule)
    ) {
      setCandidateInputError("规则 JSON 须为对象。");
      return;
    }
    const ruleObject = { ...(parsedRule as Record<string, unknown>) };
    const sourceBindings = Array.isArray(ruleObject.source_bindings)
      ? (ruleObject.source_bindings as MatterDeadlineSourceBinding[])
      : [];
    delete ruleObject.source_bindings;
    setCandidateScope(scopeKey);
    candidatePreview.mutate({
      rule: ruleObject,
      source_bindings: sourceBindings,
    });
  };

  const refresh = () => {
    void deadlines.refetch();
    void candidateDrafts.refetch();
    void notifications.refetch();
    if (canManageIncidents) void incidents.refetch();
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
            disabled={
              deadlines.isFetching ||
              candidateDrafts.isFetching ||
              notifications.isFetching ||
              incidents.isFetching
            }
          >
            {deadlines.isFetching ||
            notifications.isFetching ||
            incidents.isFetching ? (
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
              onClick={() => {
                clearCandidatePrefill();
                setFormError(null);
                setProposalFormGeneration((generation) => generation + 1);
                setShowCreateForm((value) => !value);
              }}
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

      {deadlineRules.data && (
        <section
          className="mb-4 rounded-lg border p-4"
          aria-label="期限规则审核状态"
        >
          <h4 className="font-medium">期限规则审核状态</h4>
          <p className="text-muted-foreground mt-1 text-xs">
            规则未完成律师审核前，不用于正常业务日期计算；无法确认的事实继续人工登记并复核。
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {deadlineRules.data.rules.map((rule) => (
              <li key={`${rule.rule_id}:${rule.version}`}>
                <span className="font-medium">{rule.title}</span>
                <span className="text-muted-foreground ml-2">
                  {rule.approval_status === "approved"
                    ? "已审核"
                    : "待律师审核"}
                </span>
                <p className="text-muted-foreground text-xs">{rule.summary}</p>
              </li>
            ))}
          </ul>
          {(deadlineRules.data.calendars ?? []).length > 0 && (
            <div className="mt-4 border-t pt-3">
              <h5 className="font-medium">受控日历版本</h5>
              <ul className="mt-2 space-y-2 text-xs">
                {(deadlineRules.data.calendars ?? []).map((calendar) => (
                  <li key={`${calendar.calendar_id}:${calendar.version}`}>
                    <span className="font-medium">
                      {calendar.jurisdiction} · {calendar.version}
                    </span>
                    <span className="text-muted-foreground ml-2">
                      {calendar.approval_status === "approved"
                        ? "已审核"
                        : "待律师审核"}
                      {calendar.test_only ? " · 仅测试配置" : ""}
                    </span>
                    <p className="text-muted-foreground">
                      覆盖 {calendar.coverage_from} 至 {calendar.coverage_through} · {calendar.source_note}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
      {candidateDrafts.data?.length ? (
        <section
          className="mb-4 rounded-lg border p-4"
          aria-labelledby="deadline-candidate-drafts-title"
        >
          <h4 id="deadline-candidate-drafts-title" className="font-medium">
            待补资料的期限候选
          </h4>
          <ul className="mt-3 space-y-2">
            {candidateDrafts.data.map((draft: MatterDeadlineCandidateDraft) => (
              <li key={draft.id} className="rounded-md bg-muted/40 p-3 text-sm">
                <p className="font-medium">{draft.title} · 待补资料</p>
                <p className="text-muted-foreground mt-1">
                  规则 {draft.rule_id}（{draft.rule_version}）· 日历 {draft.calendar_version}
                </p>
                {draft.missing_information.length ? (
                  <ul className="text-muted-foreground mt-1 list-disc pl-5">
                    {draft.missing_information.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-muted-foreground mt-1 text-xs">
                  {draft.source_bindings.length} 条已核验来源；没有生成正式期限或提醒。补齐事实后需重新提交并由律师确认。
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {canManage && deadlineRules.data?.unreviewed_preview_enabled && (
        <form
          className="mb-4 space-y-3 rounded-lg border p-4"
          onSubmit={submitCandidateRule}
        >
          <h4 className="font-medium">期限规则候选试算</h4>
          <p className="text-muted-foreground text-xs">
            仅隔离测试配置可试算候选。规则预览只接受服务端目录中的日历版本标识；客户端提交的节假日和工作日明细不会作为可信输入。结果仍待律师审核。
          </p>
          <label className="block space-y-1 text-sm">
            <span>期限规则 JSON</span>
            <textarea
              aria-label="期限规则 JSON"
              value={candidateRuleJson}
              onChange={(event) => {
                setCandidateRuleJson(event.target.value);
                setCandidateInputError(null);
                candidatePreview.reset();
                setCandidateScope(null);
                clearCandidatePrefill();
              }}
              rows={8}
              spellCheck={false}
              className="bg-background w-full rounded-md border px-3 py-2 font-mono text-xs"
              placeholder="粘贴规则 JSON，并在对象中提供 source_bindings 列表（版本 ID、版本号和页码/定位）；旧式 source_refs 不会被当作已核验来源"
            />
          </label>
          {candidateInputError && (
            <p role="alert" className="text-destructive text-sm">
              {candidateInputError}
            </p>
          )}
          {candidatePreview.isError && (
            <p role="alert" className="text-destructive text-sm">
              {candidatePreview.error.message || "期限规则候选试算失败。"}
            </p>
          )}
          {candidate && (
            <div
              role="status"
              className="bg-muted/40 space-y-2 rounded-md p-3 text-sm"
            >
              <p>
                候选日期：<strong>{candidate.candidate_due_date}</strong>
              </p>
              <p>
                {candidate.requires_lawyer_confirmation
                  ? "需要律师核验确认"
                  : "未经律师确认"}
              </p>
              {"approval_status" in candidate && (
                <p>
                  规则审核状态：
                  {candidate.approval_status === "approved"
                    ? "已审核"
                    : "待律师审核"}
                </p>
              )}
              {"calendar_version" in candidate && (
                <p>
                  日历版本：{candidate.calendar_version} ·
                  {candidate.calendar_approval_status === "approved"
                    ? "已审核"
                    : "待律师审核"}
                </p>
              )}
              <h5 className="font-medium">计算过程 trace</h5>
              <pre className="overflow-x-auto text-xs whitespace-pre-wrap">
                {JSON.stringify(candidate.trace, null, 2)}
              </pre>
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            试算不创建或保存期限，也不安排站内或外部通知。生产/正常业务配置禁止使用未审核规则；规则审核完成后应使用受控规则包。
          </p>
          {candidate && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setProposalPrefill({
                    scopeKey,
                    dueDate: candidate.candidate_due_date,
                    duePrecision: "date_only",
                    ruleVersion: candidate.rule_version,
                    sourceRefs: candidate.source_refs.join("\n"),
                    sourceBindingsJson: JSON.stringify(candidate.source_bindings ?? []),
                    calculationExplanation: [
                      "规则候选，须律师复核；这不是法律结论。",
                      `规则：${candidate.rule_id} · 版本：${candidate.rule_version}`,
                      `来源：${candidate.source_refs.join("；") || "未提供"}`,
                      `计算 trace：\n${JSON.stringify(candidate.trace, null, 2)}`,
                    ].join("\n"),
                  });
                  setProposalFormGeneration((generation) => generation + 1);
                  setShowCreateForm(true);
                  setFormError(null);
                }}
              >
                带入提案草稿
              </Button>
            </div>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={candidatePreview.isPending}>
              {candidatePreview.isPending && (
                <LoaderCircleIcon className="animate-spin" />
              )}
              试算候选日期
            </Button>
          </div>
        </form>
      )}

      {showCreateForm && canManage && (
        <form
          key={`${scopeKey}:${proposalFormGeneration}`}
          ref={proposalFormRef}
          className="mb-4 space-y-3 rounded-lg border p-4"
          onSubmit={(event) => void submitProposal(event)}
        >
          <h4 className="font-medium">新增待确认期限</h4>
          <input
            type="hidden"
            name="source_bindings"
            defaultValue={activePrefill?.sourceBindingsJson ?? ""}
          />
          <p className="text-muted-foreground text-xs">
            {activePrefill
              ? "规则候选，须律师复核。请补充事项名称、依据、当地到期时间和 IANA 时区后再保存。"
              : "当前为律师手工登记；尚未接入 AI 日期建议或法定节假日计算。"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>期限精度</span>
              <select
                name="due_precision"
                defaultValue={activePrefill?.duePrecision ?? "instant"}
                className="bg-background w-full rounded-md border px-3 py-2"
              >
                <option value="instant">明确日期与时刻</option>
                <option value="date_only">仅明确日期</option>
              </select>
            </label>
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
              <span>当地到期日期</span>
              <input
                name="local_due_date"
                type="date"
                required
                defaultValue={activePrefill?.dueDate}
                aria-label="当地到期日期"
                className="bg-background w-full rounded-md border px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>当地时间（仅日期期限时，此项只用于内部提醒排期）</span>
              <input
                name="local_due_time"
                type="time"
                required
                className="bg-background w-full rounded-md border px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>IANA 时区</span>
              <input
                name="timezone_name"
                defaultValue={activePrefill ? "" : "Asia/Shanghai"}
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
                defaultValue={activePrefill?.ruleVersion ?? "manual-entry-v1"}
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
              defaultValue={activePrefill?.sourceRefs}
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
              defaultValue={activePrefill?.calculationExplanation}
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
              channelCapabilities={channelCapabilities.data?.channels}
              recipients={recipients.data ?? []}
              recipientsPending={recipients.isPending}
              canManage={canManage}
              canManageHandoff={matterRole === "owner" || matterRole === "lead"}
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
              onHandoff={(input) =>
                handoffDeadline.mutate({ deadlineId: deadline.id, input })
              }
              handingOff={handoffDeadline.isPending}
              handoffError={handoffDeadline.error?.message ?? null}
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
                  data-notification-id={item.id}
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
                    · {notificationStatusLabel(item)}
                  </span>
                  {(item.attempt_count > 0 ||
                    Boolean(item.failure_code) ||
                    Boolean(item.next_attempt_at)) && (
                    <span className="text-muted-foreground w-full text-xs">
                      {item.attempt_count > 0
                        ? `已尝试 ${item.attempt_count} 次`
                        : null}
                      {notificationFailureLabel(item.failure_code)
                        ? ` · ${notificationFailureLabel(item.failure_code)}`
                        : null}
                      {item.next_attempt_at
                        ? ` · 下次尝试 ${formatDate(
                            item.next_attempt_at,
                            deadline?.timezone_name ?? "Asia/Shanghai",
                          )}`
                        : null}
                    </span>
                  )}
                  {item.attempts?.length ? (
                    <ul
                      aria-label="通知尝试记录"
                      className="text-muted-foreground w-full space-y-1 text-xs"
                    >
                      {item.attempts.map((attempt) => (
                        <li key={`${item.id}:${attempt.attempt_number}`}>
                          第 {attempt.attempt_number} 次 · {formatDate(
                            attempt.started_at,
                            deadline?.timezone_name ?? "Asia/Shanghai",
                          )} · {notificationAttemptLabel(attempt)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
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
          站内提醒服务按计划时间派发；站内送达与已读状态分别保存。邮件当前未启用；企业微信延期。
        </p>
      </section>
      {canManageIncidents && (
        <section className="mt-5" aria-labelledby="deadline-incident-title">
          <h4 id="deadline-incident-title" className="mb-2 text-sm font-medium">
            期限异常处置
          </h4>
          <p className="text-muted-foreground mb-2 text-xs">
            仅案件负责人和主办律师可查看并处置；关闭前必须填写处理结果。外部邮件状态未知不会被改写为送达。
          </p>
          {incidents.isPending ? (
            <p role="status" className="text-muted-foreground text-sm">
              正在读取异常事项…
            </p>
          ) : incidents.isError ? (
            <p role="alert" className="text-destructive text-sm">
              {incidents.error.message || "无法读取期限异常事项。"}
            </p>
          ) : incidents.data?.length ? (
            <ul className="divide-y rounded-lg border">
              {incidents.data.map((incident) => {
                const deadline = deadlines.data?.find(
                  (item) => item.id === incident.deadline_id,
                );
                const claimedByMe =
                  incident.claimed_by_membership_id === currentMembershipId;
                return (
                  <li key={incident.id} className="space-y-2 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">
                        {notificationIncidentLabel(incident)}
                        {deadline ? ` · ${deadline.title}` : ""}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {incident.urgency === "urgent" ? "紧急 · " : ""}
                        {incident.failure_code ?? incident.status}
                      </span>
                    </div>
                    {incident.status === "open" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={claimIncident.isPending}
                        onClick={() =>
                          claimIncident.mutate({
                            incidentId: incident.id,
                            input: { expected_version: incident.version },
                          })
                        }
                      >
                        认领处置
                      </Button>
                    ) : claimedByMe ? (
                      <form
                        className="space-y-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const note =
                            incidentResolutions[incident.id]?.trim() ?? "";
                          if (!note) return;
                          closeIncident.mutate({
                            incidentId: incident.id,
                            input: {
                              expected_version: incident.version,
                              resolution_note: note,
                            },
                          });
                        }}
                      >
                        <label className="block space-y-1 text-xs">
                          <span>处理结果</span>
                          <textarea
                            aria-label={`异常 ${incident.id} 处理结果`}
                            maxLength={2000}
                            required
                            value={incidentResolutions[incident.id] ?? ""}
                            onChange={(event) =>
                              setIncidentResolutions((current) => ({
                                ...current,
                                [incident.id]: event.target.value,
                              }))
                            }
                            className="bg-background w-full rounded-md border px-3 py-2"
                            rows={2}
                          />
                        </label>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={closeIncident.isPending}
                        >
                          记录结果并关闭
                        </Button>
                      </form>
                    ) : (
                      <p className="text-muted-foreground text-xs">
                        已由案件负责人认领，等待处理结果。
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground rounded-lg border p-3 text-sm">
              当前没有待处理的期限异常。
            </p>
          )}
          {(claimIncident.error ?? closeIncident.error) && (
            <p role="alert" className="text-destructive mt-2 text-sm">
              {claimIncident.error?.message ?? closeIncident.error?.message}
            </p>
          )}
        </section>
      )}
    </section>
  );
}

function MatterDeadlineCard({
  deadline,
  channelCapabilities,
  recipients,
  recipientsPending,
  canManage,
  canManageHandoff,
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
  onHandoff,
  handingOff,
  handoffError,
}: {
  deadline: MatterDeadline;
  channelCapabilities?: MatterDeadlineNotificationCapabilities["channels"];
  recipients: MatterDeadlineRecipient[];
  recipientsPending: boolean;
  canManage: boolean;
  canManageHandoff: boolean;
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
  onHandoff: (input: HandoffMatterDeadlineInput) => void;
  handingOff: boolean;
  handoffError: string | null;
}) {
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([
    currentMembershipId,
  ]);
  const [selectedChannels, setSelectedChannels] = useState<MatterNotificationChannel[]>([
    "in_app",
  ]);
  const [selectedResponsibleMembershipId, setSelectedResponsibleMembershipId] =
    useState("");
  const [reminderOffsets, setReminderOffsets] = useState("1440,60");
  const [reminderTimeLocal, setReminderTimeLocal] = useState("09:00");
  const [reminderFold, setReminderFold] = useState("");
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [changeNote, setChangeNote] = useState("");
  const [successorMembershipId, setSuccessorMembershipId] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const history = useLawMatterDeadlineEvents(
    deadline.tenant_id,
    deadline.matter_id,
    showHistory ? deadline.id : null,
  );

  useEffect(() => {
    setSelectedResponsibleMembershipId(
      deadline.primary_responsible_membership_id ?? "",
    );
    const storedTime = deadline.reminder_plan?.reminder_time_local;
    const proposalClock = deadline.local_due_at.slice(11, 16);
    setReminderTimeLocal(
      typeof storedTime === "string"
        ? storedTime
        : proposalClock && proposalClock !== "00:00"
          ? proposalClock
          : "09:00",
    );
    setReminderFold(
      typeof deadline.reminder_plan?.reminder_fold === "number"
        ? String(deadline.reminder_plan.reminder_fold)
        : deadline.fold === null
          ? ""
          : String(deadline.fold),
    );
  }, [
    deadline.id,
    deadline.primary_responsible_membership_id,
    deadline.reminder_plan,
    deadline.fold,
    deadline.local_due_at,
  ]);

  useEffect(() => {
    const channels = deadline.reminder_plan?.channels;
    setSelectedChannels(
      Array.isArray(channels)
        ? channels.filter(
            (value): value is MatterNotificationChannel =>
              value === "in_app" || value === "email",
          )
        : ["in_app"],
    );
  }, [deadline.id, deadline.reminder_plan]);

  const toggleRecipient = (membershipId: string) => {
    setSelectedRecipients((current) =>
      current.includes(membershipId)
        ? current.filter((value) => value !== membershipId)
        : [...current, membershipId],
    );
  };

  const toggleChannel = (channel: MatterNotificationChannel) => {
    setSelectedChannels((current) =>
      current.includes(channel)
        ? current.filter((value) => value !== channel)
        : [...current, channel],
    );
  };

  const confirm = () => {
    setScheduleError(null);
    const offsets = parseReminderOffsets(reminderOffsets);
    if (!selectedRecipients.length) {
      setScheduleError("至少选择一位提醒接收人。");
      return;
    }
    if (!selectedResponsibleMembershipId) {
      setScheduleError("请选择期限主要负责人。");
      return;
    }
    if (!offsets) {
      setScheduleError("提醒分钟数必须是唯一的正整数，范围为 1 到 525600。");
      return;
    }
    if (!selectedChannels.length) {
      setScheduleError("至少选择一个可用通知渠道。");
      return;
    }
    if (deadline.due_precision === "date_only" && !reminderTimeLocal) {
      setScheduleError("请指定内部提醒排期时刻；该时刻不是法律截止时刻。");
      return;
    }
    onConfirm({
      expected_version: deadline.version,
      primary_responsible_membership_id: selectedResponsibleMembershipId,
      recipient_membership_ids: selectedRecipients,
      reminder_offsets_minutes: offsets,
      ...(deadline.due_precision === "date_only"
        ? {
            reminder_time_local: reminderTimeLocal,
            reminder_fold:
              reminderFold === "" ? null : (Number(reminderFold) as 0 | 1),
          }
        : {}),
      channels: selectedChannels,
    });
  };

  const submitReschedule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setScheduleError(null);
    const data = new FormData(event.currentTarget);
    const offsets = parseReminderOffsets(formString(data, "reminder_offsets"));
    if (
      !selectedRecipients.length ||
      !offsets ||
      !selectedResponsibleMembershipId ||
      !selectedChannels.length
    ) {
      setScheduleError(
        "请指定主要负责人、至少一位接收人、有效的提醒分钟数和可用通知渠道。",
      );
      return;
    }
    const localDueAt = formString(data, "local_due_at").trim();
    const timezoneName = formString(data, "timezone_name").trim();
    const basisNote = formString(data, "basis_note").trim();
    const ruleVersion = formString(data, "rule_version").trim();
    const changeSummary = formString(data, "change_note").trim();
    if (
      !localDueAt ||
      !timezoneName ||
      !basisNote ||
      !ruleVersion ||
      !changeSummary
    ) {
      setScheduleError("请填写新日期、依据、规则版本和改期原因。");
      return;
    }
    const input: RescheduleMatterDeadlineInput = {
      expected_version: deadline.version,
      primary_responsible_membership_id: selectedResponsibleMembershipId,
      local_due_at: localDueAt,
      due_precision: deadline.due_precision ?? "instant",
      legal_due_date:
        deadline.due_precision === "date_only" ? localDueAt.slice(0, 10) : null,
      timezone_name: timezoneName,
      fold:
        formString(data, "fold") === ""
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
      ...(deadline.due_precision === "date_only"
        ? {
            reminder_time_local: localDueAt.slice(11, 16),
            reminder_fold:
              formString(data, "fold") === ""
                ? null
                : (Number(formString(data, "fold")) as 0 | 1),
          }
        : {}),
      channels: selectedChannels,
    };
    onReschedule(input);
    setShowRescheduleForm(false);
  };

  const submitHandoff = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const note = handoffNote.trim();
    if (!successorMembershipId || !note) return;
    onHandoff({
      expected_version: deadline.version,
      new_primary_responsible_membership_id: successorMembershipId,
      change_note: note,
    });
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
          {formatDeadlineDue(deadline)}
          <span className="text-muted-foreground text-xs">
            {deadline.timezone_name}
          </span>
        </div>
      </div>

      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground text-xs">主要负责人</dt>
          <dd className="mt-1 break-words">
            {deadline.primary_responsible_membership_id
              ? recipients.find(
                  (item) =>
                    item.membership_id ===
                    deadline.primary_responsible_membership_id,
                )
                ? displayRecipient(
                    recipients.find(
                      (item) =>
                        item.membership_id ===
                        deadline.primary_responsible_membership_id,
                    )!,
                  )
                : `成员 ${deadline.primary_responsible_membership_id.slice(0, 8)}`
              : deadline.responsibility_state === "pending_handoff"
                ? "待交接"
                : "未指定"}
          </dd>
        </div>
        {deadline.due_precision === "date_only" &&
        typeof deadline.reminder_plan?.reminder_time_local === "string" ? (
          <div>
            <dt className="text-muted-foreground text-xs">内部提醒排期</dt>
            <dd className="mt-1 break-words">
              每次提醒以当地 {deadline.reminder_plan.reminder_time_local} 为排期基准；这不是法律截止时刻。
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-muted-foreground text-xs">依据</dt>
          <dd className="mt-1 break-words whitespace-pre-wrap">
            {deadline.basis_note}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">来源版本状态</dt>
          <dd className="mt-1 break-words">
            {deadline.source_bindings_state === "verified"
              ? `已核验 ${deadline.source_bindings?.length ?? 0} 个当前案件版本`
              : deadline.source_bindings_state === "review_required"
                ? "来源版本或审核状态已变化，请律师复核此期限"
                : deadline.source_bindings_state === "legacy_unverified" || deadline.source_refs_trust === "legacy_unverified"
                ? "仅有旧式来源标识，未验证版本或定位"
                : "尚未提供结构化来源版本"}
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

      {deadline.state === "confirmed" &&
        deadline.responsibility_state === "pending_handoff" &&
        canManageHandoff && (
          <form
            className="mt-4 space-y-3 rounded-md border border-amber-500/40 p-3"
            aria-label="期限责任交接"
            onSubmit={submitHandoff}
          >
            <h5 className="text-sm font-medium">期限待交接</h5>
            <p className="text-muted-foreground text-xs">
              接任人必须先通过案件成员管理获得本案访问权限。交接会保留期限历史并重建尚未到期的提醒。
            </p>
            <label className="block space-y-1 text-sm">
              <span>接任负责人</span>
              <select
                aria-label="接任负责人"
                value={successorMembershipId}
                onChange={(event) =>
                  setSuccessorMembershipId(event.target.value)
                }
                className="bg-background w-full rounded-md border px-3 py-2"
              >
                <option value="">请选择已授权的案件成员</option>
                {recipients
                  .filter(
                    (recipient) =>
                      recipient.membership_id !==
                      deadline.primary_responsible_membership_id,
                  )
                  .map((recipient) => (
                    <option
                      key={recipient.membership_id}
                      value={recipient.membership_id}
                    >
                      {displayRecipient(recipient)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span>交接说明</span>
              <textarea
                aria-label="交接说明"
                value={handoffNote}
                onChange={(event) => setHandoffNote(event.target.value)}
                maxLength={2000}
                required
                rows={2}
                className="bg-background w-full rounded-md border px-3 py-2"
              />
            </label>
            {handoffError && (
              <p role="alert" className="text-destructive text-sm">
                {handoffError}
              </p>
            )}
            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={
                  handingOff ||
                  !successorMembershipId ||
                  !handoffNote.trim() ||
                  recipientsPending
                }
              >
                {handingOff && <LoaderCircleIcon className="animate-spin" />}
                确认交接
              </Button>
            </div>
          </form>
        )}

      {deadline.state === "proposed" && canManage && (
        <div className="mt-4 space-y-3 border-t pt-4">
          <h5 className="text-sm font-medium">律师确认并安排提醒</h5>
          {recipientsPending ? (
            <p role="status" className="text-muted-foreground text-sm">
              正在读取案件成员…
            </p>
          ) : recipients.length ? (
            <>
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
              <label className="block space-y-1 text-sm">
                <span>期限主要负责人</span>
                <select
                  value={selectedResponsibleMembershipId}
                  onChange={(event) =>
                    setSelectedResponsibleMembershipId(event.target.value)
                  }
                  className="bg-background w-full rounded-md border px-3 py-2"
                >
                  <option value="">请选择负责人</option>
                  {recipients.map((recipient) => (
                    <option
                      key={recipient.membership_id}
                      value={recipient.membership_id}
                    >
                      {displayRecipient(recipient)}
                    </option>
                  ))}
                </select>
              </label>
            </>
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
          {deadline.due_precision === "date_only" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span>内部提醒排期时刻</span>
                <input
                  type="time"
                  required
                  value={reminderTimeLocal}
                  onChange={(event) => setReminderTimeLocal(event.target.value)}
                  aria-label="内部提醒排期时刻"
                  className="bg-background w-full rounded-md border px-3 py-2"
                />
                <span className="text-muted-foreground block text-xs">
                  仅用于计算提醒时间，不是法院规定的截止时刻。法律截止时间仍按上方日期保存。
                </span>
              </label>
              <label className="space-y-1 text-sm">
                <span>提醒时刻遇到夏令时重叠</span>
                <select
                  value={reminderFold}
                  onChange={(event) => setReminderFold(event.target.value)}
                  aria-label="提醒时刻夏令时重叠"
                  className="bg-background w-full rounded-md border px-3 py-2"
                >
                  <option value="">由系统判断（仅非重叠时刻）</option>
                  <option value="0">较早的一次</option>
                  <option value="1">较晚的一次</option>
                </select>
              </label>
            </div>
          )}
          <DeadlineChannelOptions
            selectedChannels={selectedChannels}
            capabilities={channelCapabilities}
            onToggle={toggleChannel}
          />
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

      {(deadline.state === "confirmed" || deadline.state === "proposed") &&
        canManage && (
          <div className="mt-4 space-y-3 border-t pt-4">
            {deadline.state === "confirmed" && showRescheduleForm ? (
              <form className="space-y-3" onSubmit={submitReschedule}>
                <h5 className="text-sm font-medium">改期并重新安排提醒</h5>
                <p className="text-muted-foreground text-xs">
                  保存时会原子取消旧版本尚未派发的提醒，并为新版本建立所选提醒。
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span>
                      {deadline.due_precision === "date_only"
                        ? "新法律截止日期与内部提醒排期时刻"
                        : "新的当地日期与时间"}
                    </span>
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
                    <select
                      name="fold"
                      defaultValue={deadline.fold ?? ""}
                      className="bg-background w-full rounded-md border px-3 py-2"
                    >
                      <option value="">由系统判断</option>
                      <option value="0">较早的一次</option>
                      <option value="1">较晚的一次</option>
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>规则版本</span>
                    <input
                      name="rule_version"
                      required
                      maxLength={120}
                      defaultValue={deadline.rule_version}
                      className="bg-background w-full rounded-md border px-3 py-2"
                    />
                  </label>
                </div>
                <label className="block space-y-1 text-sm">
                  <span>期限依据</span>
                  <textarea
                    name="basis_note"
                    required
                    maxLength={8000}
                    rows={2}
                    defaultValue={deadline.basis_note}
                    className="bg-background w-full rounded-md border px-3 py-2"
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>来源标识（每行一条）</span>
                  <textarea
                    name="source_refs"
                    rows={2}
                    defaultValue={deadline.source_refs.join("\n")}
                    className="bg-background w-full rounded-md border px-3 py-2"
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>计算说明</span>
                  <textarea
                    name="calculation_explanation"
                    rows={2}
                    defaultValue={
                      typeof deadline.calculation.explanation === "string"
                        ? deadline.calculation.explanation
                        : ""
                    }
                    className="bg-background w-full rounded-md border px-3 py-2"
                  />
                </label>
                <fieldset className="space-y-2">
                  <legend className="text-muted-foreground mb-2 text-xs">
                    新提醒接收成员
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
                        onChange={() =>
                          toggleRecipient(recipient.membership_id)
                        }
                      />
                      {displayRecipient(recipient)}
                    </label>
                  ))}
                </fieldset>
                <label className="block space-y-1 text-sm">
                  <span>期限主要负责人</span>
                  <select
                    value={selectedResponsibleMembershipId}
                    onChange={(event) =>
                      setSelectedResponsibleMembershipId(event.target.value)
                    }
                    className="bg-background w-full rounded-md border px-3 py-2"
                  >
                    <option value="">请选择负责人</option>
                    {recipients.map((recipient) => (
                      <option
                        key={recipient.membership_id}
                        value={recipient.membership_id}
                      >
                        {displayRecipient(recipient)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-sm">
                  <span>提醒时间（相对新期限的分钟数）</span>
                  <input
                    name="reminder_offsets"
                    defaultValue={reminderOffsets}
                    className="bg-background w-full rounded-md border px-3 py-2"
                  />
                </label>
                <DeadlineChannelOptions
                  selectedChannels={selectedChannels}
                  capabilities={channelCapabilities}
                  onToggle={toggleChannel}
                />
                <label className="block space-y-1 text-sm">
                  <span>改期原因</span>
                  <textarea
                    name="change_note"
                    required
                    maxLength={2000}
                    rows={2}
                    className="bg-background w-full rounded-md border px-3 py-2"
                  />
                </label>
                {scheduleError && (
                  <p role="alert" className="text-destructive text-sm">
                    {scheduleError}
                  </p>
                )}
                {rescheduleError && (
                  <p role="alert" className="text-destructive text-sm">
                    {rescheduleError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowRescheduleForm(false)}
                  >
                    返回
                  </Button>
                  <Button
                    type="submit"
                    disabled={rescheduling || recipientsPending}
                  >
                    {rescheduling ? (
                      <LoaderCircleIcon className="animate-spin" />
                    ) : null}
                    保存改期
                  </Button>
                </div>
              </form>
            ) : deadline.state === "confirmed" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowRescheduleForm(true)}
              >
                改期 / 调整提醒
              </Button>
            ) : null}
            <label className="block space-y-1 text-sm">
              <span>
                {deadline.state === "proposed"
                  ? "取消提案原因"
                  : "取消或完成原因"}
              </span>
              <input
                value={changeNote}
                onChange={(event) => setChangeNote(event.target.value)}
                maxLength={2000}
                className="bg-background w-full rounded-md border px-3 py-2"
              />
            </label>
            {transitionError && (
              <p role="alert" className="text-destructive text-sm">
                {transitionError}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={transitioning || changeNote.trim().length === 0}
                onClick={() =>
                  onTransition("cancelled", {
                    expected_version: deadline.version,
                    change_note: changeNote.trim(),
                  })
                }
              >
                取消期限
              </Button>
              {deadline.state === "confirmed" ? (
                <Button
                  type="button"
                  disabled={transitioning || changeNote.trim().length === 0}
                  onClick={() =>
                    onTransition("completed", {
                      expected_version: deadline.version,
                      change_note: changeNote.trim(),
                    })
                  }
                >
                  标记完成
                </Button>
              ) : null}
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
