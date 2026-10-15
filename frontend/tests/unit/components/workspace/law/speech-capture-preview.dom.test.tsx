import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SpeechCapturePreview } from "@/components/workspace/law/speech-capture-preview";
import type { SpeechCapturePreviewWindow } from "@/core/law/types";

afterEach(cleanup);
function windows(count: number): SpeechCapturePreviewWindow[] {
  return Array.from({ length: count }, (_, index) => ({
    window_id: `window-${index}`,
    window_index: index,
    start_sample: index * 80000,
    end_sample: (index + 1) * 80000,
    revision: 1,
    provisional: true,
    transcript: {
      text: "合成预览",
      segments: [],
      warnings: [],
      provisional: true,
      offset_unit: "utf16",
      speakers: [],
    },
  }));
}

describe("recording preview follow", () => {
  it("does not reveal a closed work area and reveals only once when it becomes active", () => {
    const view = render(
      <div inert>
        <SpeechCapturePreview windows={windows(1)} />
      </div>,
    );
    const section = view.container.querySelector<HTMLElement>(
      ".law-speech-preview",
    )!;
    section.getClientRects = () =>
      [new DOMRect(0, 0, 200, 100)] as unknown as DOMRectList;
    const reveal = rs.fn();
    section.scrollIntoView = reveal;
    view.rerender(
      <div inert>
        <SpeechCapturePreview windows={windows(2)} />
      </div>,
    );
    expect(reveal).not.toHaveBeenCalled();
    view.rerender(
      <div>
        <SpeechCapturePreview windows={windows(3)} />
      </div>,
    );
    expect(reveal).toHaveBeenCalledTimes(1);
    view.rerender(
      <div>
        <SpeechCapturePreview windows={windows(4)} />
      </div>,
    );
    expect(reveal).toHaveBeenCalledTimes(1);
  });
  it("distinguishes an empty ASR result from a missing result and times only computed previews", () => {
    const rows = windows(2);
    rows[0]!.transcript!.text = "";
    rows[1]!.transcript = null;
    render(<SpeechCapturePreview windows={rows} />);
    expect(screen.getByText("本窗口未识别到文字。")).toBeDefined();
    expect(screen.getByText("本窗口暂未产生识别预览。")).toBeDefined();
    expect(
      screen.getByText("0–5 秒").hasAttribute("data-speech-preview-time"),
    ).toBe(true);
    expect(
      screen.getByText("5–10 秒").hasAttribute("data-speech-preview-time"),
    ).toBe(false);
  });
  it("follows new windows, preserves a reader's position, and explicitly resumes", () => {
    const view = render(<SpeechCapturePreview windows={windows(1)} />);
    const list = screen.getByRole("log", { name: "录音预览内容" });
    let height = 300;
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      get: () => height,
    });
    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 100,
    });
    view.rerender(<SpeechCapturePreview windows={windows(2)} />);
    expect(list.scrollTop).toBe(200);
    list.scrollTop = 0;
    fireEvent.scroll(list);
    expect(screen.getByRole("button", { name: "回到最新" })).toBeDefined();
    height = 600;
    view.rerender(<SpeechCapturePreview windows={windows(3)} />);
    expect(list.scrollTop).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "回到最新" }));
    expect(list.scrollTop).toBe(500);
    expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
    height = 900;
    view.rerender(<SpeechCapturePreview windows={windows(4)} />);
    expect(list.scrollTop).toBe(800);
  });
  it("resets follow state when the owning capture changes and retains unreviewed labels", () => {
    const view = render(
      <SpeechCapturePreview key="capture-A" windows={windows(2)} />,
    );
    const old = screen.getByRole("log");
    Object.defineProperty(old, "scrollHeight", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(old, "clientHeight", {
      configurable: true,
      value: 100,
    });
    old.scrollTop = 0;
    fireEvent.scroll(old);
    expect(screen.getByRole("button", { name: "回到最新" })).toBeDefined();
    view.rerender(
      <SpeechCapturePreview key="capture-B" windows={windows(1)} />,
    );
    expect(screen.queryByRole("button", { name: "回到最新" })).toBeNull();
    expect(screen.getByText("机器预览 · 未审核，不可引用")).toBeDefined();
    expect(
      screen.getByText("0–5 秒").hasAttribute("data-speech-preview-time"),
    ).toBe(true);
  });
});
