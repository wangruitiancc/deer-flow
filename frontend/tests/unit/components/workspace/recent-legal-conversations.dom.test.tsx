import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { RecentLegalConversations } from "@/components/workspace/law/recent-legal-conversations";
import type { Matter } from "@/core/law";

const mocks = rs.hoisted(() => ({
  count: 1,
  threadError: false,
  contextTenant: "tenant-a",
  contextMatter: "matter-a",
  contextError: false,
  wrongThread: false,
}));
rs.mock("@/core/threads/hooks", () => ({
  useThreads: () => ({
    data: Array.from({ length: mocks.count }, (_, index) => ({
      thread_id: `thread-${index}`,
      values: { title: `会话 ${index}` },
      status: index === 0 ? "busy" : "idle",
    })),
    isPending: false,
    isError: mocks.threadError,
  }),
}));
rs.mock("@tanstack/react-query", () => ({
  useQueries: ({ queries }: { queries: unknown[] }) =>
    queries.map((_, index) => ({
      isSuccess: !mocks.contextError,
      isPending: false,
      data: {
        tenant_id: mocks.contextTenant,
        matter_id: mocks.contextMatter,
        thread_id: mocks.wrongThread ? "another-thread" : `thread-${index}`,
      },
    })),
}));
function mount(tenantId = "tenant-a") {
  return render(
    <SidebarProvider>
      <RecentLegalConversations
        tenantId={tenantId}
        matters={[{ id: "matter-a", status: "active" } as Matter]}
        activeThreadId="thread-0"
      />
    </SidebarProvider>,
  );
}
afterEach(() => {
  cleanup();
  Object.assign(mocks, {
    count: 1,
    threadError: false,
    contextTenant: "tenant-a",
    contextMatter: "matter-a",
    contextError: false,
    wrongThread: false,
  });
});
describe("authorized recent legal conversations", () => {
  it("shows a native thread link and running state after matching legal authorization", () => {
    mount();
    expect(
      screen.getByRole("link", { name: /会话 0/ }).getAttribute("href"),
    ).toBe("/workspace/chats/thread-0");
    expect(screen.getByLabelText("正在处理")).toBeDefined();
  });
  it("bounds the initial list to five and expands only the twelve inspected results", () => {
    mocks.count = 20;
    mount();
    expect(screen.getAllByRole("link")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "展开显示" }));
    expect(screen.getAllByRole("link")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "收起列表" }));
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });
  it("hides a previous tenant's titles immediately when the selected organization changes", () => {
    mount("tenant-b");
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("does not use stale titles after a search or authorization error", () => {
    mocks.contextError = true;
    const view = mount();
    expect(screen.queryByRole("link")).toBeNull();
    view.unmount();
    mocks.contextError = false;
    mocks.threadError = true;
    mount();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("最近会话暂时不可用");
  });
  it("rejects mismatched thread identity or unavailable matters", () => {
    mocks.wrongThread = true;
    const view = mount();
    expect(screen.queryByRole("link")).toBeNull();
    view.unmount();
    mocks.wrongThread = false;
    mocks.contextMatter = "unavailable-matter";
    mount();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
