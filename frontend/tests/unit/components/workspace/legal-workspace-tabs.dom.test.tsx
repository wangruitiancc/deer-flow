import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useReducer } from "react";

import { LegalWorkspaceTabs } from "@/components/workspace/law/legal-workspace-tabs";
import {
  initialWorkspaceTabs,
  workspaceTabsReducer,
} from "@/core/law/workspace-tabs";

afterEach(cleanup);

function Harness() {
  const [state, dispatch] = useReducer(
    workspaceTabsReducer,
    initialWorkspaceTabs,
  );
  return (
    <LegalWorkspaceTabs
      state={state}
      onOpen={(id) => dispatch({ type: "open", id })}
      onClose={(id) => dispatch({ type: "close", id })}
      onHide={rs.fn()}
      expanded={false}
      recording
      dirtyFunctions={["drafting"]}
    />
  );
}

describe("legal workspace tab keyboard", () => {
  it("uses distinct tab and panel associations for separate workspace instances", () => {
    render(
      <>
        <Harness />
        <Harness />
      </>,
    );
    const tabs = screen.getAllByRole("tab");
    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(8);
    expect(
      new Set(tabs.map((tab) => tab.getAttribute("aria-controls"))).size,
    ).toBe(8);
  });

  it("moves selection with keys and restores focus after active close", () => {
    render(<Harness />);
    const first = screen.getByRole("tab", { name: "文档校对" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const speech = screen.getByRole("tab", { name: /录音.*正在录音/ });
    expect(document.activeElement).toBe(speech);
    expect(speech.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(
      screen.getByRole("button", { name: "关闭录音 / 实时转写页签" }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "案情图谱" }),
    );
    expect(
      screen.getByRole("tab", { name: /文书撰写，有未保存修改/ }),
    ).toBeTruthy();
  });

  it("leaves a reachable add trigger after closing the last tab", () => {
    render(<Harness />);
    for (const name of ["文档校对", "录音 / 实时转写", "案情图谱", "文书撰写"])
      fireEvent.click(screen.getByRole("button", { name: `关闭${name}页签` }));
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "打开功能" }),
    );
  });
});
