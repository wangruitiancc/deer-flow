import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("@/core/law", () => ({
  useConfirmLawMatterDeadline: rs.fn(),
  useCreateLawMatterDeadline: rs.fn(),
  useLawMatterDeadlineEvents: rs.fn(),
  useLawMatterDeadlineRecipients: rs.fn(),
  useLawMatterDeadlines: rs.fn(),
  useLawMatterNotificationOutbox: rs.fn(),
  useMarkLawMatterNotificationRead: rs.fn(),
  useRescheduleLawMatterDeadline: rs.fn(),
  useTransitionLawMatterDeadline: rs.fn(),
}));

import { MatterDeadlinePanel } from "@/components/workspace/law/matter-deadline-panel";
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
import type { MatterDeadline } from "@/core/law/types";

const mutate = rs.fn();
const mutateAsync = rs.fn(async () => deadline);
const refetch = rs.fn();
const markRead = rs.fn();
const mutateReschedule = rs.fn();
const mutateTransition = rs.fn();

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
  confirmed_by_membership_id: "membership-owner",
  confirmed_at: "2026-10-03T00:00:00Z",
  version: 2,
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
  rs.mocked(useLawMatterDeadlines).mockReturnValue({
    data: [deadline],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch,
  } as unknown as ReturnType<typeof useLawMatterDeadlines>);
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
});

afterEach(() => cleanup());

describe("matter deadline panel", () => {
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
    const wecom = screen.getByRole("checkbox", { name: "企业微信（未启用）" });
    expect((email as HTMLInputElement).disabled).toBe(true);
    expect((wecom as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "李律师 · lawyer" }));
    fireEvent.change(screen.getByRole("textbox", { name: "提醒分钟数" }), {
      target: { value: "2880,60" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "确认期限并安排站内提醒" }),
    );

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        deadlineId: "deadline-1",
        input: {
          expected_version: 1,
          recipient_membership_ids: ["membership-owner", "membership-lawyer"],
          reminder_offsets_minutes: [2880, 60],
          channels: ["in_app"],
        },
      }),
    );
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
    fireEvent.change(screen.getByLabelText("当地日期与时间"), {
      target: { value: "2026-11-03T17:00" },
    });
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
        timezone_name: "Asia/Shanghai",
        fold: null,
        basis_note: "法院通知",
        rule_version: "manual-entry-v1",
        source_refs: ["通知-2", "第3项"],
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
