import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SidebarProvider } from "@/components/ui/sidebar";
import { WorkspaceActivityRail } from "@/components/workspace/workspace-activity-rail";

const mocks = rs.hoisted(() => ({ openSettings: rs.fn(), role: "member" }));
rs.mock("next/navigation", () => ({
  usePathname: () => "/workspace/chats/test",
}));
rs.mock("@/core/law", () => ({
  useLawTenants: () => ({ data: [{ membership: { role: mocks.role } }] }),
}));
rs.mock("@/components/workspace/settings", () => ({
  useSettingsDialog: () => ({ openSettings: mocks.openSettings }),
}));
rs.mock("@/components/workspace/workspace-nav-menu", () => ({
  WorkspaceNavMenu: () => <button>当前用户菜单</button>,
}));

afterEach(() => {
  cleanup();
  mocks.role = "member";
  rs.restoreAllMocks();
});
function mount(open: boolean) {
  rs.spyOn(window, "matchMedia").mockReturnValue({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as MediaQueryList);
  return render(
    <SidebarProvider defaultOpen={open}>
      <WorkspaceActivityRail />
    </SidebarProvider>,
  );
}
describe("persistent activity rail", () => {
  it("keeps a labelled toggle and account menu when collapsed, and reopens without hover", () => {
    mount(false);
    const toggle = screen.getByRole("button", { name: "展开案件侧栏" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.className.includes("hidden")).toBe(false);
    expect(screen.getByRole("button", { name: "当前用户菜单" })).toBeDefined();
    fireEvent.click(toggle);
    expect(
      screen
        .getByRole("button", { name: "收起案件侧栏" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "收起案件侧栏" }));
    expect(screen.getByRole("button", { name: "展开案件侧栏" })).toBeDefined();
  });
  it("preserves role-gated admin navigation and opens real settings", () => {
    mocks.role = "admin";
    mount(true);
    expect(
      screen.getByRole("link", { name: "律所管理后台" }).getAttribute("href"),
    ).toBe("/law-admin");
    fireEvent.click(screen.getByRole("button", { name: /^设置$/ }));
    expect(mocks.openSettings).toHaveBeenCalledWith("appearance");
  });
  it("does not show firm management for ordinary members", () => {
    mount(true);
    expect(screen.queryByRole("link", { name: "律所管理后台" })).toBeNull();
  });
});
