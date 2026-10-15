import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  WorkspaceResizeProvider,
  clampSidebarWidth,
} from "@/components/workspace/workspace-resize-provider";

afterEach(() => {
  cleanup();
  window.localStorage?.clear();
  rs.restoreAllMocks();
});
describe("workspace left separator", () => {
  it("clamps widths so the remaining workspace remains reachable", () => {
    expect(clampSidebarWidth(0, 1440)).toBe(160);
    expect(clampSidebarWidth(900, 1440)).toBe(640);
    expect(clampSidebarWidth(900, 1000)).toBe(450);
  });
  it("supports keyboard resize, remembers width and resets on double click", async () => {
    rs.spyOn(window, "matchMedia").mockImplementation(
      () =>
        ({
          matches: false,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        clear: () => store.clear(),
      },
    });
    window.localStorage.setItem("matrix-law:sidebar-width:v1", "280");
    render(
      <WorkspaceResizeProvider defaultOpen>
        <p>会话</p>
      </WorkspaceResizeProvider>,
    );
    const handle = screen.getByRole("separator", {
      name: "调整左侧与中间工作区宽度",
    });
    await waitFor(() =>
      expect(handle.getAttribute("aria-valuenow")).toBe("280"),
    );
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("290");
    expect(window.localStorage.getItem("matrix-law:sidebar-width:v1")).toBe(
      "290",
    );
    const desktopWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    fireEvent(window, new Event("resize"));
    expect(window.localStorage.getItem("matrix-law:sidebar-width:v1")).toBe(
      "290",
    );
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: desktopWidth,
    });
    fireEvent(window, new Event("resize"));
    expect(handle.getAttribute("aria-valuenow")).toBe("290");
    fireEvent.doubleClick(handle);
    expect(handle.getAttribute("aria-valuenow")).toBe("216");
  });
});
