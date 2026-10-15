import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";

const mocks = rs.hoisted(() => ({
  context: undefined as undefined | { tenant_id: string; matter_id: string },
  query: new URLSearchParams(),
  role: "member",
  openSettings: rs.fn(),
}));
rs.mock("next/navigation", () => ({
  useParams: () => ({ thread_id: "current" }),
  useSearchParams: () => mocks.query,
}));
rs.mock("@/core/law", () => ({
  useLawTenants: () => ({ data: [{ membership: { role: mocks.role } }] }),
  useLawThreadContext: () => ({ data: mocks.context }),
  pathOfLawProject: (tenant: string, matter: string) =>
    `/workspace/law?${new URLSearchParams({ tenant, matter })}`,
}));
rs.mock("@/components/workspace/settings", () => ({
  useSettingsDialog: () => ({ openSettings: mocks.openSettings }),
}));
afterEach(() => {
  cleanup();
  mocks.context = undefined;
  mocks.query = new URLSearchParams();
  mocks.role = "member";
  rs.clearAllMocks();
});
function mount(onSearch = rs.fn()) {
  render(
    <SidebarProvider>
      <WorkspaceHeader onSearch={onSearch} />
    </SidebarProvider>,
  );
  return onSearch;
}
describe("workspace header actions", () => {
  it("opens reminders for the bound matter rather than an unrelated route selection", () => {
    mocks.context = {
      tenant_id: "trusted-tenant",
      matter_id: "trusted-matter",
    };
    mocks.query = new URLSearchParams({ tenant: "other", matter: "other" });
    mount();
    expect(
      screen.getByRole("link", { name: "案件提醒与日程" }).getAttribute("href"),
    ).toBe(
      "/workspace/law?tenant=trusted-tenant&matter=trusted-matter&view=schedule",
    );
  });
  it("keeps search usable without fabricating a notification count or a cross-matter link", () => {
    const search = mount();
    const legalHome = screen.getAllByRole("link", {
      name: "Matrix Law · 法律工作",
    });
    expect(legalHome).toHaveLength(1);
    expect(legalHome[0]?.getAttribute("href")).toBe("/workspace/law");
    expect(screen.queryByRole("link", { name: "案件提醒与日程" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "搜索法律项目" }));
    expect(search).toHaveBeenCalledTimes(1);
  });
  it("offers real workspace destinations and settings, while hiding management from ordinary members", () => {
    mount();
    fireEvent.pointerDown(screen.getByRole("button", { name: "工作区菜单" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      screen.getByRole("menuitem", { name: "法律工作" }).getAttribute("href"),
    ).toBe("/workspace/law");
    expect(screen.queryByRole("menuitem", { name: "律所管理后台" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "设置与外观" }));
    expect(mocks.openSettings).toHaveBeenCalledWith("appearance");
  });
  it("includes the existing management destination for firm administrators", () => {
    mocks.role = "admin";
    mount();
    fireEvent.pointerDown(screen.getByRole("button", { name: "工作区菜单" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      screen
        .getByRole("menuitem", { name: "律所管理后台" })
        .getAttribute("href"),
    ).toBe("/law-admin");
  });
});
