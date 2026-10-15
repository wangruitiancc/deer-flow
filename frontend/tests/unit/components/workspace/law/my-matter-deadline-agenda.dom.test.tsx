import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

rs.mock("@/core/law", () => ({
  useLawMyDeadlineAgenda: rs.fn(),
}));

import { MyMatterDeadlineAgenda } from "@/components/workspace/law/my-matter-deadline-agenda";
import { useLawMyDeadlineAgenda } from "@/core/law";
import type { MatterDeadlineAgendaItem } from "@/core/law/types";

const refetch = rs.fn();
const fetchNextPage = rs.fn();

const item: MatterDeadlineAgendaItem = {
  id: "deadline-1",
  tenant_id: "tenant-1",
  matter_id: "matter-1",
  matter_title: "合成劳动争议案件",
  case_number: null,
  kind: "filing",
  title: "提交证据",
  state: "confirmed",
  local_due_at: "2026-11-09T17:00:00",
  due_precision: "date_only",
  legal_due_date: "2026-11-09",
  timezone_name: "Asia/Shanghai",
  due_at: "2026-11-09T09:00:00Z",
  primary_responsible_membership_id: "membership-1",
  responsibility_state: "assigned",
  version: 1,
};

function mockAgenda(overrides: Record<string, unknown> = {}) {
  rs.mocked(useLawMyDeadlineAgenda).mockReturnValue({
    data: {
      pages: [
        {
          items: [item],
          next_cursor: { after_due_at: item.due_at, after_id: item.id },
        },
      ],
    },
    isPending: false,
    isError: false,
    hasNextPage: true,
    isFetchingNextPage: false,
    refetch,
    fetchNextPage,
    ...overrides,
  } as unknown as ReturnType<typeof useLawMyDeadlineAgenda>);
}

beforeEach(() => {
  refetch.mockReset();
  fetchNextPage.mockReset();
  mockAgenda();
});

afterEach(() => cleanup());

describe("my cross-matter deadline agenda", () => {
  it("shows assigned confirmed items and preserves date-only precision", () => {
    render(<MyMatterDeadlineAgenda tenantId="tenant-1" locale="zh-CN" />);

    expect(screen.getByText("我的跨案件日程")).toBeTruthy();
    expect(screen.getByText("提交证据")).toBeTruthy();
    expect(screen.getByText("合成劳动争议案件")).toBeTruthy();
    expect(screen.getByText("2026年11月9日")).toBeTruthy();
    expect(screen.queryByText(/17:00/u)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("reports an agenda read failure without replacing it with an empty state", () => {
    mockAgenda({ data: undefined, isError: true });
    render(<MyMatterDeadlineAgenda tenantId="tenant-1" locale="zh-CN" />);

    expect(screen.getByRole("alert").textContent).toContain("日程读取失败");
    expect(screen.queryByText("没有分配给你的已确认期限或事项。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
