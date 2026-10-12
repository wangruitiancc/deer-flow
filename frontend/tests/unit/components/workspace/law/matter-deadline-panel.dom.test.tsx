import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";

rs.mock("@/core/law", () => ({
  useCalculateLawMatterDeadlineCandidate: rs.fn(),
  useConfirmLawMatterDeadline: rs.fn(),
  useCreateLawMatterDeadline: rs.fn(),
  useLawMatterDeadlineEvents: rs.fn(),
  useLawMatterDeadlineCandidateDrafts: rs.fn(),
  useLawMatterDeadlineRecipients: rs.fn(),
  useLawMatterDeadlines: rs.fn(),
  useLawMatterDeadlineRules: rs.fn(),
  useLawMatterNotificationOutbox: rs.fn(),
  useLawDeadlineNotificationCapabilities: rs.fn(),
  useMarkLawMatterNotificationRead: rs.fn(),
  useHandoffLawMatterDeadline: rs.fn(),
  useLawMatterNotificationIncidents: rs.fn(),
  useClaimLawMatterNotificationIncident: rs.fn(),
  useCloseLawMatterNotificationIncident: rs.fn(),
  useRescheduleLawMatterDeadline: rs.fn(),
  useTransitionLawMatterDeadline: rs.fn(),
}));

import { MatterDeadlinePanel } from "@/components/workspace/law/matter-deadline-panel";
import {
  useCalculateLawMatterDeadlineCandidate,
  useConfirmLawMatterDeadline,
  useCreateLawMatterDeadline,
  useLawMatterDeadlineEvents,
  useLawMatterDeadlineCandidateDrafts,
  useLawMatterDeadlineRecipients,
  useLawMatterDeadlines,
  useLawMatterDeadlineRules,
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
  MatterDeadline,
  MatterDeadlineCandidate,
  MatterDeadlineRuleCatalog,
  MatterNotificationOutboxItem,
  MatterNotificationIncident,
} from "@/core/law/types";

const mutate = rs.fn();
const mutateAsync = rs.fn(async () => deadline);
const refetch = rs.fn();
const markRead = rs.fn();
const mutateReschedule = rs.fn();
const mutateTransition = rs.fn();
const mutateHandoff = rs.fn();
const mutateCandidate = rs.fn();
const resetCandidate = rs.fn();
const claimIncidentMutation = rs.fn();
const closeIncidentMutation = rs.fn();

const candidateResult: MatterDeadlineCandidate = {
  mode: "candidate_only",
  candidate_due_date: "2026-11-09",
  rule_id: "caller-rule",
  rule_version: "caller-version",
  source_refs: ["synthetic-source"],
  duration_days: 3,
  counting_basis: "calendar_days",
  include_anchor: false,
  weekend_days: [5, 6],
  holidays: [],
  adjustment: "none",
  trace: {
    anchor_date: "2026-11-06",
    counted_dates: ["2026-11-07", "2026-11-08", "2026-11-09"],
    unadjusted_due_date: "2026-11-09",
    adjustment: "none",
    adjustment_days: 0,
    candidate_due_date: "2026-11-09",
  },
  requires_lawyer_confirmation: true,
};

function mockCandidatePreview(data?: MatterDeadlineCandidate) {
  rs.mocked(useCalculateLawMatterDeadlineCandidate).mockReturnValue({
    mutate: mutateCandidate,
    reset: resetCandidate,
    data,
    error: null,
    isError: false,
    isPending: false,
  } as unknown as ReturnType<typeof useCalculateLawMatterDeadlineCandidate>);
}

const ruleCatalog: MatterDeadlineRuleCatalog = {
  unreviewed_preview_enabled: true,
  calendars: [
    {
      calendar_id: "cn-sh-2026",
      version: "cn-sh-2026-review-1",
      jurisdiction: "CN-SH",
      approval_status: "pending_lawyer_review",
      coverage_from: "2026-01-01",
      coverage_through: "2026-12-31",
      source_ref:
        "https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html",
      source_note: "国务院年度安排的工程测试夹具；待律师审核",
      test_only: true,
    },
  ],
  rules: [
    "一审民事判决上诉",
    "一审可上诉裁定上诉",
    "一审民事答辩",
    "二审民事答辩",
    "民事申请执行期间",
    "民事申请再审期间",
  ].map((title, index) => ({
    rule_id: `rule-${index}`,
    version: "review-pending-1",
    title,
    approval_status: "pending_lawyer_review" as const,
    legal_sources: [{ url: "https://example.test/law", article: "synthetic" }],
    required_facts: [],
    manual_review_conditions: [],
    effective_from: "2024-01-01",
    effective_through: null,
    summary: "范围及事实条件须复核",
  })),
};

function mockDeadlineRuleCatalog(
  unreviewedPreviewEnabled = true,
  data = ruleCatalog,
) {
  rs.mocked(useLawMatterDeadlineRules).mockReturnValue({
    data: {
      ...data,
      calendars: unreviewedPreviewEnabled ? data.calendars : [],
      unreviewed_preview_enabled: unreviewedPreviewEnabled,
    },
    isPending: false,
    isError: false,
    isFetching: false,
  } as unknown as ReturnType<typeof useLawMatterDeadlineRules>);
}

const deadline: MatterDeadline = {
  id: "deadline-1",
  tenant_id: "tenant-1",
  matter_id: "matter-1",
  kind: "filing",
  title: "提交答辩状",
  origin: "lawyer_entry",
  state: "proposed",
  local_due_at: "2026-11-03T17:00:00",
  timezone_name: "Asia/Shanghai",
  fold: null,
  due_at: "2026-11-03T09:00:00Z",
  basis_note: "送达日期后第十五日",
  rule_version: "人工核对-v1",
  source_refs: ["送达回证-1"],
  calculation: {
    method: "lawyer_entry",
    explanation: "按实际送达日期计算，已由律师核验。",
  },
  created_by_membership_id: "membership-owner",
  confirmed_by_membership_id: null,
  confirmed_at: null,
  version: 1,
  created_at: "2026-10-03T00:00:00Z",
  updated_at: "2026-10-03T00:00:00Z",
};

const confirmedDeadline: MatterDeadline = {
  ...deadline,
  state: "confirmed",
  primary_responsible_membership_id: "membership-owner",
  responsibility_state: "assigned",
  confirmed_by_membership_id: "membership-owner",
  confirmed_at: "2026-10-03T00:00:00Z",
  version: 2,
};

const notificationIncident: MatterNotificationIncident = {
  id: "incident-1",
  deadline_id: "deadline-1",
  notification_id: "notification-1",
  incident_type: "delivery_unknown",
  urgency: "urgent",
  status: "open",
  failure_code: "smtp_delivery_unknown",
  detected_at: "2026-10-11T00:00:00Z",
  claimed_by_membership_id: null,
  claimed_at: null,
  resolution_note: null,
  closed_at: null,
  version: 1,
  updated_at: "2026-10-11T00:00:00Z",
};

const recipients = [
  {
    membership_id: "membership-owner",
    role: "owner" as const,
    display_name: "张律师",
  },
  {
    membership_id: "membership-lawyer",
    role: "lawyer" as const,
    display_name: "李律师",
  },
];

beforeEach(() => {
  mutate.mockReset();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue(deadline);
  refetch.mockReset();
  markRead.mockReset();
  mutateReschedule.mockReset();
  mutateTransition.mockReset();
  mutateHandoff.mockReset();
  mutateCandidate.mockReset();
  resetCandidate.mockReset();
  claimIncidentMutation.mockReset();
  closeIncidentMutation.mockReset();
  mockCandidatePreview();
  mockDeadlineRuleCatalog();
  rs.mocked(useLawMatterDeadlines).mockReturnValue({
    data: [deadline],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch,
  } as unknown as ReturnType<typeof useLawMatterDeadlines>);
  rs.mocked(useLawMatterDeadlineCandidateDrafts).mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch,
  } as unknown as ReturnType<typeof useLawMatterDeadlineCandidateDrafts>);
  rs.mocked(useLawMatterDeadlineRecipients).mockReturnValue({
    data: recipients,
    isPending: false,
  } as unknown as ReturnType<typeof useLawMatterDeadlineRecipients>);
  rs.mocked(useLawMatterDeadlineEvents).mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useLawMatterDeadlineEvents>);
  rs.mocked(useLawMatterNotificationOutbox).mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch,
  } as unknown as ReturnType<typeof useLawMatterNotificationOutbox>);
  rs.mocked(useLawDeadlineNotificationCapabilities).mockReturnValue({
    data: {
      channels: {
        in_app: {
          selectable: true,
          dispatch_active: false,
          disabled_reason: null,
          dispatch_state: "paused",
        },
        email: {
          selectable: false,
          dispatch_active: false,
          disabled_reason: "email_not_configured",
          dispatch_state: "unavailable",
        },
        wecom: {
          selectable: false,
          dispatch_active: false,
          disabled_reason: "not_implemented",
          dispatch_state: "unavailable",
        },
      },
    },
  } as unknown as ReturnType<typeof useLawDeadlineNotificationCapabilities>);
  rs.mocked(useMarkLawMatterNotificationRead).mockReturnValue({
    mutate: markRead,
    isPending: false,
  } as unknown as ReturnType<typeof useMarkLawMatterNotificationRead>);
  rs.mocked(useCreateLawMatterDeadline).mockReturnValue({
    mutateAsync,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useCreateLawMatterDeadline>);
  rs.mocked(useConfirmLawMatterDeadline).mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useConfirmLawMatterDeadline>);
  rs.mocked(useRescheduleLawMatterDeadline).mockReturnValue({
    mutate: mutateReschedule,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useRescheduleLawMatterDeadline>);
  rs.mocked(useTransitionLawMatterDeadline).mockReturnValue({
    mutate: mutateTransition,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useTransitionLawMatterDeadline>);
  rs.mocked(useHandoffLawMatterDeadline).mockReturnValue({
    mutate: mutateHandoff,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useHandoffLawMatterDeadline>);
  rs.mocked(useLawMatterNotificationIncidents).mockReturnValue({
    data: [],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch,
  } as unknown as ReturnType<typeof useLawMatterNotificationIncidents>);
  rs.mocked(useClaimLawMatterNotificationIncident).mockReturnValue({
    mutate: claimIncidentMutation,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useClaimLawMatterNotificationIncident>);
  rs.mocked(useCloseLawMatterNotificationIncident).mockReturnValue({
    mutate: closeIncidentMutation,
    isPending: false,
    error: null,
  } as unknown as ReturnType<typeof useCloseLawMatterNotificationIncident>);
});

afterEach(() => cleanup());

describe("matter deadline panel", () => {
  it("flags a confirmed deadline for lawyer review when its source version changes", () => {
    rs.mocked(useLawMatterDeadlines).mockReturnValue({
      data: [
        {
          ...confirmedDeadline,
          source_bindings_state: "review_required",
          source_bindings: [{ version_id: "source-v2", version_number: 2 }],
        },
      ],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch,
    } as unknown as ReturnType<typeof useLawMatterDeadlines>);

    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="viewer"
        currentMembershipId="membership-viewer"
      />,
    );

    expect(
      screen.getByText("来源版本或审核状态已变化，请律师复核此期限"),
    ).toBeTruthy();
  });

  it("requires an authorized active matter member and a reason before handoff", () => {
    const pendingHandoff: MatterDeadline = {
      ...confirmedDeadline,
      primary_responsible_membership_id: "membership-former",
      responsibility_state: "pending_handoff",
      version: 3,
    };
    rs.mocked(useLawMatterDeadlines).mockReturnValue({
      data: [pendingHandoff],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch,
    } as unknown as ReturnType<typeof useLawMatterDeadlines>);

    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );

    const handoffForm = screen.getByRole("form", { name: "期限责任交接" });
    expect(
      within(handoffForm).getByText(/先通过案件成员管理获得本案访问权限/u),
    ).toBeTruthy();
    const submit = within(handoffForm).getByRole("button", {
      name: "确认交接",
    });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.change(
      within(handoffForm).getByRole("combobox", { name: "接任负责人" }),
      { target: { value: "membership-lawyer" } },
    );
    fireEvent.change(
      within(handoffForm).getByRole("textbox", { name: "交接说明" }),
      { target: { value: "负责人离职后的案件责任交接" } },
    );
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);
    expect(mutateHandoff).toHaveBeenCalledWith({
      deadlineId: "deadline-1",
      input: {
        expected_version: 3,
        new_primary_responsible_membership_id: "membership-lawyer",
        change_note: "负责人离职后的案件责任交接",
      },
    });
  });

  it("lets only case owners and leads claim an incident and records a resolution before closing", () => {
    rs.mocked(useLawMatterNotificationIncidents).mockReturnValue({
      data: [notificationIncident],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch,
    } as unknown as ReturnType<typeof useLawMatterNotificationIncidents>);

    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );

    expect(screen.getByText(/外部邮件状态未知/u)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "认领处置" }));
    expect(claimIncidentMutation).toHaveBeenCalledWith({
      incidentId: "incident-1",
      input: { expected_version: 1 },
    });

    rs.mocked(useLawMatterNotificationIncidents).mockReturnValue({
      data: [
        {
          ...notificationIncident,
          status: "claimed",
          claimed_by_membership_id: "membership-owner",
          claimed_at: "2026-10-11T00:01:00Z",
          version: 2,
        },
      ],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch,
    } as unknown as ReturnType<typeof useLawMatterNotificationIncidents>);
    cleanup();
    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "异常 incident-1 处理结果" }),
      { target: { value: "已通过电话核对，另行建立人工回访提醒。" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "记录结果并关闭" }));
    expect(closeIncidentMutation).toHaveBeenCalledWith({
      incidentId: "incident-1",
      input: {
        expected_version: 2,
        resolution_note: "已通过电话核对，另行建立人工回访提醒。",
      },
    });
  });

  it("does not fetch or display incident details to a member without management rights", () => {
    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="lawyer"
        currentMembershipId="membership-lawyer"
      />,
    );

    expect(screen.queryByText("期限异常处置")).toBeNull();
    expect(useLawMatterNotificationIncidents).toHaveBeenCalledWith(
      "tenant-1",
      "matter-1",
      false,
    );
  });

  it("keeps unreviewed date calculation unavailable in normal business configuration", () => {
    mockDeadlineRuleCatalog(false);
    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );

    expect(screen.queryByRole("textbox", { name: "期限规则 JSON" })).toBeNull();
    expect(
      screen.getByRole("region", { name: "期限规则审核状态" }),
    ).toBeTruthy();
    expect(screen.getAllByText("待律师审核")).toHaveLength(6);
    expect(screen.getByText(/不用于正常业务日期计算/u)).toBeTruthy();
  });

  it("previews only an explicitly supplied rule and never saves or confirms it", () => {
    const view = render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );
    const input = screen.getByRole("textbox", { name: "期限规则 JSON" });
    expect((input as HTMLTextAreaElement).value).toBe("");

    fireEvent.change(input, { target: { value: "{" } });
    fireEvent.click(screen.getByRole("button", { name: "试算候选日期" }));
    expect(screen.getByRole("alert").textContent).toMatch(/有效的规则 JSON/u);
    expect(mutateCandidate).not.toHaveBeenCalled();

    const rule = {
      anchor_date: "2026-11-06",
      duration_days: 3,
      counting_basis: "calendar_days",
      include_anchor: false,
      weekend_days: [5, 6],
      holidays: [],
      adjustment: "none",
      rule_id: "caller-rule",
      rule_version: "caller-version",
      source_refs: ["synthetic-source"],
    };
    fireEvent.change(input, { target: { value: JSON.stringify(rule) } });
    fireEvent.click(screen.getByRole("button", { name: "试算候选日期" }));
    expect(mutateCandidate).toHaveBeenCalledWith({
      rule,
      source_bindings: [],
    });

    mockCandidatePreview(candidateResult);
    view.rerender(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );
    expect(screen.getByText("2026-11-09")).toBeTruthy();
    expect(screen.getByText("计算过程 trace")).toBeTruthy();
    expect(screen.getByText(/需要律师核验确认/u)).toBeTruthy();
    expect(
      screen.getByText(/CN-SH · cn-sh-2026-review-1/u),
    ).toBeTruthy();
    expect(screen.getByText(/仅测试配置/u)).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("shows an unverified proposal and records explicit confirmation with selected recipients", async () => {
    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );

    expect(screen.getByText("待律师确认")).toBeTruthy();
    expect(screen.getByText("送达日期后第十五日")).toBeTruthy();
    expect(screen.getByText("人工核对-v1 · 送达回证-1")).toBeTruthy();
    expect(screen.getByText(/系统不自动判断法律效力/)).toBeTruthy();
    expect(
      screen.getByText(/站内提醒服务按计划时间派发.*送达与已读状态分别保存/),
    ).toBeTruthy();

    const email = screen.getByRole("checkbox", { name: "邮件（未启用）" });
    expect((email as HTMLInputElement).disabled).toBe(true);
    expect(
      screen.queryByRole("checkbox", { name: /企微|企业微信/u }),
    ).toBeNull();
    expect(screen.getByText(/企业微信延期/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "李律师 · lawyer" }));
    fireEvent.change(screen.getByRole("textbox", { name: "提醒分钟数" }), {
      target: { value: "2880,60" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "确认期限并安排站内提醒" }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "请选择期限主要负责人",
    );
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("期限主要负责人"), {
      target: { value: "membership-owner" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "确认期限并安排站内提醒" }),
    );

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        deadlineId: "deadline-1",
        input: {
          expected_version: 1,
          primary_responsible_membership_id: "membership-owner",
          recipient_membership_ids: ["membership-owner", "membership-lawyer"],
          reminder_offsets_minutes: [2880, 60],
          channels: ["in_app"],
        },
      }),
    );
  });

  it("hands a candidate into a local-only proposal draft without guessing time or timezone", async () => {
    const view = render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );
    const rule = {
      anchor_date: "2026-11-06",
      duration_days: 3,
      counting_basis: "calendar_days",
      include_anchor: false,
      weekend_days: [5, 6],
      holidays: [],
      adjustment: "none",
      rule_id: "caller-rule",
      rule_version: "caller-version",
      source_refs: ["synthetic-source"],
    };
    fireEvent.change(screen.getByRole("textbox", { name: "期限规则 JSON" }), {
      target: { value: JSON.stringify(rule) },
    });
    fireEvent.click(screen.getByRole("button", { name: "试算候选日期" }));
    expect(mutateAsync).not.toHaveBeenCalled();

    mockCandidatePreview(candidateResult);
    view.rerender(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "带入提案草稿" }));

    expect(screen.getByLabelText<HTMLInputElement>("当地到期日期").value).toBe(
      "2026-11-09",
    );
    expect(screen.getByLabelText<HTMLSelectElement>("期限精度").value).toBe(
      "date_only",
    );
    expect(
      screen.getByLabelText<HTMLInputElement>(
        "当地时间（仅日期期限时，此项只用于内部提醒排期）",
      ).value,
    ).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("IANA 时区").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("事项名称").value).toBe("");
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("法律或业务依据").value,
    ).toBe("");
    expect(
      screen.getByLabelText<HTMLInputElement>("规则版本/人工依据标记").value,
    ).toBe("caller-version");
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("来源标识（每行一条，可选）")
        .value,
    ).toBe("synthetic-source");
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("计算说明").value,
    ).toContain('"counted_dates"');
    expect(
      screen.getByText(
        /规则候选，须律师复核。请补充事项名称、依据、当地到期时间和 IANA 时区后再保存。/u,
      ),
    ).toBeTruthy();
    expect(mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("事项名称"), {
      target: { value: "补交证据" },
    });
    fireEvent.change(
      screen.getByLabelText("当地时间（仅日期期限时，此项只用于内部提醒排期）"),
      { target: { value: "17:00" } },
    );
    fireEvent.change(screen.getByLabelText("IANA 时区"), {
      target: { value: "Asia/Shanghai" },
    });
    fireEvent.change(screen.getByLabelText("法律或业务依据"), {
      target: { value: "律师复核后的依据" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存待确认提案" }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "补交证据",
          local_due_at: "2026-11-09T17:00",
          due_precision: "date_only",
          legal_due_date: "2026-11-09",
          timezone_name: "Asia/Shanghai",
          rule_version: "caller-version",
          source_refs: ["synthetic-source"],
          calculation: expect.objectContaining({
            explanation: expect.stringContaining('"counted_dates"'),
          }),
        }),
      ),
    );
  });

  it("clears a candidate handoff when its rule changes or the matter changes", () => {
    const view = render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "期限规则 JSON" }), {
      target: { value: "{}" },
    });
    fireEvent.click(screen.getByRole("button", { name: "试算候选日期" }));
    mockCandidatePreview(candidateResult);
    view.rerender(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "带入提案草稿" }));
    fireEvent.change(screen.getByLabelText("事项名称"), {
      target: { value: "律师填写的事项" },
    });
    fireEvent.change(screen.getByLabelText("法律或业务依据"), {
      target: { value: "律师补充的依据" },
    });
    fireEvent.change(
      screen.getByLabelText("当地时间（仅日期期限时，此项只用于内部提醒排期）"),
      { target: { value: "17:00" } },
    );
    fireEvent.change(screen.getByLabelText("IANA 时区"), {
      target: { value: "Asia/Shanghai" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "期限规则 JSON" }), {
      target: { value: '{"rule_version":"changed"}' },
    });
    expect(screen.queryByRole("button", { name: "带入提案草稿" })).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("事项名称").value).toBe(
      "律师填写的事项",
    );
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("法律或业务依据").value,
    ).toBe("律师补充的依据");
    expect(
      screen.getByLabelText<HTMLInputElement>(
        "当地时间（仅日期期限时，此项只用于内部提醒排期）",
      ).value,
    ).toBe("17:00");
    expect(screen.getByLabelText<HTMLInputElement>("IANA 时区").value).toBe(
      "Asia/Shanghai",
    );
    expect(screen.getByLabelText<HTMLInputElement>("当地到期日期").value).toBe(
      "",
    );
    expect(
      screen.getByLabelText<HTMLInputElement>("规则版本/人工依据标记").value,
    ).toBe("");
    expect(
      screen.getByLabelText<HTMLTextAreaElement>("来源标识（每行一条，可选）")
        .value,
    ).toBe("");
    expect(screen.getByLabelText<HTMLTextAreaElement>("计算说明").value).toBe(
      "",
    );

    fireEvent.click(screen.getByRole("button", { name: "试算候选日期" }));
    mockCandidatePreview(candidateResult);
    view.rerender(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "带入提案草稿" }));
    view.rerender(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-2"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );
    expect(screen.queryByRole("button", { name: "带入提案草稿" })).toBeNull();
    expect(screen.queryByText("2026-11-09")).toBeNull();
  });

  it("labels notification lifecycle states without overstating external delivery or read", () => {
    const item = (
      id: string,
      status: string,
      channel: "in_app" | "email" = "in_app",
      read_at: string | null = null,
    ) =>
      ({
        id,
        deadline_id: "deadline-1",
        deadline_version: 2,
        recipient_membership_id: "membership-owner",
        channel,
        scheduled_at: "2026-11-03T08:00:00Z",
        status,
        sent_at: status === "sent" ? "2026-11-03T08:00:01Z" : null,
        attempt_count: status === "failed" ? 5 : 0,
        next_attempt_at: null,
        failure_code: status === "failed" ? "smtp_delivery_unknown" : null,
        read_at,
      }) as MatterNotificationOutboxItem;
    const retryingEmail: MatterNotificationOutboxItem = {
      ...item("retrying-email", "pending", "email"),
      attempt_count: 2,
      next_attempt_at: "2026-11-02T08:00:00Z",
      failure_code: "smtp_temporary",
      attempts: [
        {
          attempt_number: 1,
          started_at: "2026-11-02T07:00:00Z",
          finished_at: "2026-11-02T07:00:02Z",
          outcome: "retryable_failure",
          failure_code: "smtp_temporary",
        },
        {
          attempt_number: 2,
          started_at: "2026-11-02T07:01:00Z",
          finished_at: null,
          outcome: "in_progress",
          failure_code: null,
        },
      ],
    };
    const notifications = [
      item("pending", "pending"),
      item("sending", "sending"),
      item("sent-unread", "sent"),
      item("sent-read", "sent", "in_app", "2026-11-03T08:01:00Z"),
      item("failed", "failed"),
      item("cancelled", "cancelled"),
      item("unknown", "queued"),
      item("email-sent", "sent", "email", "2026-11-03T08:01:00Z"),
      retryingEmail,
    ];
    rs.mocked(useLawMatterNotificationOutbox).mockReturnValue({
      data: notifications,
      isPending: false,
      isError: false,
      isFetching: false,
      refetch,
    } as unknown as ReturnType<typeof useLawMatterNotificationOutbox>);

    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );

    expect(screen.getAllByText(/已排期，待通知服务处理/u)).toHaveLength(2);
    expect(screen.getByText(/通知服务处理中/u)).toBeTruthy();
    expect(screen.getByText(/已送达，未读/u)).toBeTruthy();
    expect(screen.getByText(/· 已读/u)).toBeTruthy();
    expect(screen.getByText(/通知处理失败/u)).toBeTruthy();
    expect(screen.getByText(/邮件结果未知，已停止自动重投/u)).toBeTruthy();
    expect(screen.getByText(/已尝试 5 次/u)).toBeTruthy();
    expect(screen.getByText(/下次尝试/u)).toBeTruthy();
    expect(screen.getAllByText(/邮件服务临时失败/u)).toHaveLength(2);
    expect(screen.getByRole("list", { name: "通知尝试记录" })).toBeTruthy();
    expect(screen.getByText(/第 1 次.*将按计划重试/u)).toBeTruthy();
    expect(screen.getByText(/第 2 次.*结果尚未确定/u)).toBeTruthy();
    expect(screen.getByText(/已取消/u)).toBeTruthy();
    expect(screen.getByText(/状态未知（queued）/u)).toBeTruthy();

    const externalSent = screen
      .getByText(/通知服务已处理，实际送达状态未知/u)
      .closest("li");
    expect(externalSent).not.toBeNull();
    expect(
      within(externalSent as HTMLElement).queryByText(/已读|已送达/u),
    ).toBeNull();
    expect(
      within(externalSent as HTMLElement).queryByRole("button", {
        name: "标记已读",
      }),
    ).toBeNull();
  });

  it("shows a date-only legal deadline without presenting the scheduler time as a legal time", () => {
    rs.mocked(useLawMatterDeadlines).mockReturnValue({
      data: [
        {
          ...deadline,
          due_precision: "date_only",
          legal_due_date: "2026-11-03",
        },
      ],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch,
    } as unknown as ReturnType<typeof useLawMatterDeadlines>);
    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="assistant"
        currentMembershipId="membership-assistant"
      />,
    );

    expect(screen.getByText("2026年11月3日")).toBeTruthy();
    expect(screen.queryByText(/2026\/11\/03 17:00/u)).toBeNull();
  });

  it("submits a manual deadline proposal with its basis and calculation explanation", async () => {
    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="lawyer"
        currentMembershipId="membership-lawyer"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建提案" }));
    fireEvent.change(screen.getByLabelText("事项名称"), {
      target: { value: "补交证据" },
    });
    fireEvent.change(screen.getByLabelText("当地到期日期"), {
      target: { value: "2026-11-03" },
    });
    fireEvent.change(
      screen.getByLabelText("当地时间（仅日期期限时，此项只用于内部提醒排期）"),
      { target: { value: "17:00" } },
    );
    fireEvent.change(screen.getByLabelText("法律或业务依据"), {
      target: { value: "法院通知" },
    });
    fireEvent.change(screen.getByLabelText("来源标识（每行一条，可选）"), {
      target: { value: "通知-2\n第3项" },
    });
    fireEvent.change(screen.getByLabelText("计算说明"), {
      target: { value: "按通知指定日期人工登记" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存待确认提案" }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        kind: "filing",
        title: "补交证据",
        origin: "lawyer_entry",
        local_due_at: "2026-11-03T17:00",
        due_precision: "instant",
        legal_due_date: null,
        timezone_name: "Asia/Shanghai",
        fold: null,
        basis_note: "法院通知",
        rule_version: "manual-entry-v1",
        source_refs: ["通知-2", "第3项"],
        source_bindings: [],
        calculation: {
          method: "lawyer_entry",
          explanation: "按通知指定日期人工登记",
        },
      }),
    );
  });

  it("hides proposal and confirmation actions from read-only matter roles", () => {
    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="assistant"
        currentMembershipId="membership-assistant"
      />,
    );

    expect(screen.queryByRole("button", { name: "新建提案" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "确认期限并安排站内提醒" }),
    ).toBeNull();
    expect(screen.getByText(/新建及确认操作需要案件负责人/)).toBeTruthy();
  });

  it("cancels a proposal with a reason and its current version", () => {
    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );
    fireEvent.change(screen.getByLabelText("取消提案原因"), {
      target: { value: "法院撤回通知" },
    });
    fireEvent.click(screen.getByRole("button", { name: "取消期限" }));
    expect(mutateTransition).toHaveBeenCalledWith({
      deadlineId: "deadline-1",
      targetState: "cancelled",
      input: { expected_version: 1, change_note: "法院撤回通知" },
    });
  });

  it("reschedules a confirmed deadline and submits the new recipients and reminders", async () => {
    rs.mocked(useLawMatterDeadlines).mockReturnValue({
      data: [confirmedDeadline],
      isPending: false,
      isError: false,
      isFetching: false,
      refetch,
    } as unknown as ReturnType<typeof useLawMatterDeadlines>);
    render(
      <MatterDeadlinePanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        currentMembershipId="membership-owner"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "改期 / 调整提醒" }));
    fireEvent.change(screen.getByLabelText("新的当地日期与时间"), {
      target: { value: "2026-11-05T17:00" },
    });
    fireEvent.change(screen.getByLabelText("改期原因"), {
      target: { value: "法院调整开庭日期" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存改期" }));
    await waitFor(() =>
      expect(mutateReschedule).toHaveBeenCalledWith({
        deadlineId: "deadline-1",
        input: expect.objectContaining({
          expected_version: 2,
          primary_responsible_membership_id: "membership-owner",
          local_due_at: "2026-11-05T17:00",
          timezone_name: "Asia/Shanghai",
          change_note: "法院调整开庭日期",
          recipient_membership_ids: ["membership-owner"],
          reminder_offsets_minutes: [1440, 60],
          channels: ["in_app"],
        }),
      }),
    );
  });
});
