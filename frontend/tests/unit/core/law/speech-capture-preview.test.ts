import { describe, expect, it } from "@rstest/core";

import { mergeSpeechCapturePreview } from "@/core/law/speech-capture-preview";
import type {
  SpeechCapturePreviewReceipt,
  SpeechCapturePreviewWindow,
} from "@/core/law/types";

function window(
  windowId: string,
  windowIndex: number,
  revision: number,
  text: string,
): SpeechCapturePreviewWindow {
  return {
    window_id: windowId,
    window_index: windowIndex,
    start_sample: windowIndex * 80_000,
    end_sample: (windowIndex + 1) * 80_000,
    revision,
    provisional: true,
    transcript: {
      text,
      segments: [],
      warnings: [],
      provisional: true,
      offset_unit: "utf16",
      speakers: [],
    },
  };
}

function receipt(
  revision: number,
  ...items: SpeechCapturePreviewWindow[]
): SpeechCapturePreviewReceipt {
  return {
    capture_id: "capture-1",
    revision,
    items,
  };
}

describe("speech capture preview revisions", () => {
  it("updates a window by revision and keeps windows in sample order", () => {
    const initial = {
      revision: 1,
      windows: [window("window-1", 1, 1, "后半段")],
    };
    const merged = mergeSpeechCapturePreview(
      initial,
      receipt(
        3,
        window("window-2", 0, 2, "前半段"),
        window("window-1", 1, 2, "修订后的后半段"),
      ),
    );

    expect(merged.revision).toBe(3);
    expect(merged.windows.map((item) => item.transcript?.text)).toEqual([
      "前半段",
      "修订后的后半段",
    ]);
  });

  it("ignores older response and item revisions without text deduplication", () => {
    const current = {
      revision: 4,
      windows: [window("window-1", 0, 3, "相同文本")],
    };
    expect(
      mergeSpeechCapturePreview(
        current,
        receipt(3, window("window-1", 0, 4, "迟到旧响应")),
      ),
    ).toBe(current);

    const merged = mergeSpeechCapturePreview(
      current,
      receipt(
        5,
        window("window-1", 0, 2, "旧窗口 revision"),
        window("window-2", 1, 1, "相同文本"),
      ),
    );
    expect(merged.windows.map((item) => item.transcript?.text)).toEqual([
      "相同文本",
      "相同文本",
    ]);
    expect(merged.windows[0]?.revision).toBe(3);
  });
});
