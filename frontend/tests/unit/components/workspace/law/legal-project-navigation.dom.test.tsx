import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { LegalProjectTree } from "@/components/workspace/law/legal-project-tree";

const mocks = rs.hoisted(() => ({
  active: false,
  create: rs.fn(),
  push: rs.fn(),
}));
rs.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({ thread_id: mocks.active ? "thread-0" : undefined }),
  useSearchParams: () => new URLSearchParams(),
}));
rs.mock("@/core/i18n/hooks", () => ({ useI18n: () => ({ locale: "zh-CN" }) }));
rs.mock("@/components/workspace/chats/use-thread-chat", () => ({
  resetThreadChatAfterDelete: rs.fn(),
}));
rs.mock("@/core/threads/hooks", () => ({
  useDeleteThread: () => ({ mutateAsync: rs.fn() }),
  useThreadMetadata: (id: string) => ({
    isSuccess: true,
    data: { title: id, status: id === "thread-1" ? "busy" : "idle" },
  }),
}));
rs.mock("@/core/threads/utils", () => ({
  pathOfThread: (id: string) => `/workspace/chats/${id}`,
  titleOfThread: (thread: { title: string }) => thread.title,
}));
rs.mock("@/core/law", () => {
  return {
    useLawThreadContext: () => ({
      data: mocks.active
        ? { tenant_id: "tenant-A", matter_id: "matter-A" }
        : undefined,
    }),
    useLawTenants: () => ({
      data: [
        {
          tenant: { id: "tenant-A", name: "合成律所" },
          membership: { id: "member-A" },
        },
      ],
    }),
    useLawMatters: (tenant: string | null) => ({
      data: tenant
        ? [
            {
              id: "matter-A",
              tenant_id: tenant,
              title: "合成案件",
              kind: "case",
              status: "active",
              updated_at: "2026-10-15",
            },
          ]
        : [],
    }),
    useLawMatterThreads: () => ({
      data: Array.from({ length: 7 }, (_, index) => ({
        id: `mapping-${index}`,
        thread_id: `thread-${index}`,
        status: "active",
        updated_at: `2026-10-${index + 10}`,
        created_by_membership_id: "member-A",
      })),
    }),
    useCreateMatterConversation: () => ({
      isPending: false,
      mutateAsync: mocks.create,
    }),
    useDetachMatterConversation: () => ({
      isPending: false,
      mutateAsync: rs.fn(),
    }),
  };
});
afterEach(() => {
  cleanup();
  mocks.active = false;
  rs.clearAllMocks();
});
function mount(request = 0) {
  return render(
    <SidebarProvider>
      <LegalProjectTree searchRequest={request} />
    </SidebarProvider>,
  );
}

describe("legal navigation hierarchy", () => {
  it("asks for the owning project before starting an unscoped conversation", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
    expect(
      screen.getByRole("dialog", { name: "选择会话所属案件" }),
    ).toBeDefined();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog").textContent).toContain("合成案件");
  });
  it("keeps the active thread in a five-row list, expands the rest, and focuses search on request", () => {
    mocks.active = true;
    const view = mount();
    expect(screen.getAllByRole("link", { name: /^thread-/ })).toHaveLength(5);
    expect(screen.getByRole("link", { name: "thread-0" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "展开显示" }));
    expect(screen.getAllByRole("link", { name: /^thread-/ })).toHaveLength(7);
    expect(screen.getByLabelText("正在处理")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "收起列表" }));
    expect(screen.getAllByRole("link", { name: /^thread-/ })).toHaveLength(5);
    view.rerender(
      <SidebarProvider>
        <LegalProjectTree searchRequest={1} />
      </SidebarProvider>,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "搜索法律项目" }),
    );
  });
});
