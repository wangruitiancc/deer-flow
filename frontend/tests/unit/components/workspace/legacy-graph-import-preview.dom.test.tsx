import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("next/dynamic", () => ({
  default: () => () => <div>本地图谱预览</div>,
}));

import { LegacyGraphImportPreview } from "@/components/workspace/law/legacy-graph-import-preview";

const createUrl = rs.fn(() => "blob:synthetic-import");
const revokeUrl = rs.fn(() => undefined);
const content = JSON.stringify({
  caseId: "synthetic-old-case",
  updatedAt: "",
  nodes: [{ id: "甲", label: "合成甲方", type: "party" }],
  edges: [],
});
function choose(file: File) {
  fireEvent.change(screen.getByLabelText(/选择旧项目/), {
    target: { files: [file] },
  });
}
function mount() {
  const result = render(<LegacyGraphImportPreview />);
  fireEvent.click(screen.getByRole("button", { name: "转换旧图谱" }));
  return result;
}
beforeEach(() => {
  createUrl.mockClear();
  revokeUrl.mockClear();
  rs.spyOn(URL, "createObjectURL").mockImplementation(createUrl);
  rs.spyOn(URL, "revokeObjectURL").mockImplementation(revokeUrl);
});
afterEach(() => {
  cleanup();
  rs.restoreAllMocks();
});

describe("local graph import preview", () => {
  it("converts locally, exposes two downloads and revokes buffers on close", async () => {
    const fetch = rs.spyOn(globalThis, "fetch");
    mount();
    choose(new File([content], "graph.json"));
    await screen.findByRole("link", { name: "下载转换图谱" });
    expect(screen.getByText("已读取：graph.json")).toBeDefined();
    expect(
      screen
        .getByRole("link", { name: "下载完整迁移报告" })
        .getAttribute("download"),
    ).toBe("graph-import-report.json");
    expect(fetch).not.toHaveBeenCalled();
    expect(createUrl).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    await waitFor(() => expect(revokeUrl).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "转换旧图谱" }));
    expect(screen.queryByRole("link", { name: "下载转换图谱" })).toBeNull();
  });
  it("rejects size before reading, invalid UTF-8 and malformed JSON, clearing old downloads", async () => {
    mount();
    choose(new File([content], "graph.json"));
    await screen.findByRole("link", { name: "下载转换图谱" });
    const huge = new File(
      [new Uint8Array(2 * 1024 * 1024 + 1)],
      "too-big.json",
    );
    const read = rs.spyOn(huge, "arrayBuffer");
    choose(huge);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "超过 2 MiB",
    );
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "下载转换图谱" })).toBeNull();
    choose(new File([new Uint8Array([255])], "invalid.json"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("UTF-8"),
    );
    choose(new File(["{}"], "not-a-graph.json"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("CaseGraph"),
    );
  });
  it("ignores late file reads after replacement or unmount", async () => {
    const view = mount();
    let resolve!: (value: ArrayBuffer) => void;
    const slow = new File([content], "slow.json");
    rs.spyOn(slow, "arrayBuffer").mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    choose(slow);
    choose(new File(["{}"], "new.json"));
    await screen.findByRole("alert");
    resolve(new TextEncoder().encode(content).buffer);
    await Promise.resolve();
    expect(screen.queryByRole("link", { name: "下载转换图谱" })).toBeNull();
    choose(slow);
    view.unmount();
    resolve(new TextEncoder().encode(content).buffer);
    await Promise.resolve();
    expect(createUrl).not.toHaveBeenCalled();
  });
});
