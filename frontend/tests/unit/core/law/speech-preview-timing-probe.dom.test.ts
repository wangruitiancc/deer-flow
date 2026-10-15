import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import { installSpeechPreviewTimingProbe } from "../../../helpers/speech-preview-timing-probe";

type Report = {
  state: string;
  failure: string | null;
  p95_ms: number | null;
  target_met: boolean | null;
  windows: { latency_ms: number; window_index: number }[];
  pending_end_samples: number[];
};
const host = window as typeof window & {
  __w11SpeechTimingProbe?: { snapshot: () => Report; dispose: () => void };
};
let now = 7000;
let changed: () => void = () => undefined;
let frames: FrameRequestCallback[] = [];
class FakeNode {
  port = new EventTarget();
  constructor(_context: object, _name: string) {
    /* Metadata-only constructor stub. */
  }
}
function snapshot() {
  return host.__w11SpeechTimingProbe!.snapshot();
}
function tick() {
  const queued = frames;
  frames = [];
  now += 16;
  queued.forEach((run) => run(now));
}
function label(start: number, end: number) {
  let root = document.querySelector('[aria-label="录音临时识别预览"]');
  if (!root) {
    root = document.createElement("div");
    root.setAttribute("aria-label", "录音临时识别预览");
    document.body.append(root);
  }
  const row = document.createElement("div");
  const span = document.createElement("span");
  span.setAttribute("data-speech-preview-time", "");
  span.textContent = `${start}–${end} 秒`;
  span.getClientRects = () =>
    [new DOMRect(0, 0, 100, 20)] as unknown as DOMRectList;
  row.append(span, document.createTextNode("SECRET_TRANSCRIPT_MARKER"));
  root.append(row);
  changed();
  return span;
}
function capture(seconds: number, finish = true) {
  const context = {
    sampleRate: 16000,
    state: "running",
    currentTime: seconds + 1,
  };
  const node = new window.AudioWorkletNode(
    context as unknown as AudioContext,
    "matrix-law-pcm16-capture",
  );
  for (let i = 0; i < seconds; i++)
    node.port.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "pcm",
          samples: new ArrayBuffer(32000),
          endFrame: (i + 1) * 16000,
        },
      }),
    );
  if (finish)
    node.port.dispatchEvent(
      new MessageEvent("message", { data: { type: "flushed" } }),
    );
  return node;
}
beforeEach(() => {
  now = 7000;
  frames = [];
  rs.stubGlobal("AudioWorkletNode", FakeNode);
  rs.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        changed = callback;
      }
      observe() {
        /* Mutations are delivered explicitly by the test. */
      }
      disconnect() {
        /* No native observer was created. */
      }
    },
  );
  rs.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    frames.push(run);
    return frames.length;
  });
  rs.spyOn(performance, "now").mockImplementation(() => now);
  rs.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  host.__w11SpeechTimingProbe?.dispose();
  document.body.replaceChildren();
  rs.restoreAllMocks();
  rs.unstubAllGlobals();
});
describe("numeric-only preview timing probe", () => {
  it("waits until a window outside the viewport is actually visible", () => {
    installSpeechPreviewTimingProbe();
    capture(5);
    const span = label(0, 5);
    span.getClientRects = () =>
      [new DOMRect(0, innerHeight + 10, 100, 20)] as unknown as DOMRectList;
    tick();
    tick();
    expect(snapshot().windows).toHaveLength(0);
    expect(snapshot().p95_ms).toBeNull();
    span.getClientRects = () =>
      [new DOMRect(0, 10, 100, 20)] as unknown as DOMRectList;
    window.dispatchEvent(new Event("resize"));
    tick();
    tick();
    expect(snapshot().state).toBe("complete");
  });
  it("does not count a time label clipped by an ancestor until it is scrolled into view", () => {
    installSpeechPreviewTimingProbe();
    capture(5);
    const span = label(0, 5);
    const parent = span.parentElement!;
    parent.style.overflowY = "auto";
    parent.getBoundingClientRect = () => new DOMRect(0, 0, 200, 40);
    span.getClientRects = () =>
      [new DOMRect(0, 50, 100, 20)] as unknown as DOMRectList;
    tick();
    tick();
    expect(snapshot().windows).toHaveLength(0);
    span.getClientRects = () =>
      [new DOMRect(0, 10, 100, 20)] as unknown as DOMRectList;
    parent.dispatchEvent(new Event("scroll"));
    tick();
    tick();
    expect(snapshot().state).toBe("complete");
  });
  it("does not count an inert panel even if it still has layout rectangles", () => {
    installSpeechPreviewTimingProbe();
    capture(5);
    const span = label(0, 5);
    span.parentElement!.setAttribute("inert", "");
    tick();
    tick();
    expect(snapshot().windows).toHaveLength(0);
    span.parentElement!.removeAttribute("inert");
    changed();
    tick();
    tick();
    expect(snapshot().state).toBe("complete");
  });
  it("counts worklet-to-main delay, waits for two frames, and exports no transcript or media", () => {
    installSpeechPreviewTimingProbe();
    capture(5);
    now = 8000;
    label(0, 5);
    expect(snapshot().p95_ms).toBeNull();
    tick();
    expect(snapshot().p95_ms).toBeNull();
    tick();
    const result = snapshot();
    expect(result.state).toBe("complete");
    expect(result.p95_ms).toBe(2040);
    expect(result.windows[0]?.window_index).toBe(0);
    expect(result.target_met).toBeNull();
    expect(JSON.stringify(result)).not.toContain("SECRET_TRANSCRIPT_MARKER");
    expect(JSON.stringify(result)).not.toContain('"samples":');
  });
  it("does not turn missing windows into a passing P95 or count stale previews", () => {
    label(0, 5);
    installSpeechPreviewTimingProbe();
    capture(10);
    tick();
    tick();
    expect(snapshot().windows).toHaveLength(0);
    expect(snapshot().p95_ms).toBeNull();
    label(5, 10);
    tick();
    tick();
    expect(snapshot().pending_end_samples).toEqual([80000]);
    expect(snapshot().target_met).toBeNull();
    label(0, 5);
    tick();
    tick();
    expect(snapshot().state).toBe("complete");
    label(0, 5);
    tick();
    tick();
    expect(snapshot().windows).toHaveLength(2);
  });
  it("fails closed for old worklets that do not provide a sampled-frame timestamp", () => {
    installSpeechPreviewTimingProbe();
    const node = capture(0, false);
    node.port.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "pcm", samples: new ArrayBuffer(32000) },
      }),
    );
    expect(snapshot().state).toBe("invalid");
    expect(snapshot().failure).toBe("pcm_timing_metadata_missing_or_invalid");
    expect(snapshot().p95_ms).toBeNull();
  });
  it("excludes only a flushed short tail while retaining all complete windows", () => {
    installSpeechPreviewTimingProbe();
    const node = capture(5, false);
    node.port.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "pcm", samples: new ArrayBuffer(16000), endFrame: 88000 },
      }),
    );
    node.port.dispatchEvent(
      new MessageEvent("message", { data: { type: "flushed" } }),
    );
    label(0, 5);
    label(5, 5);
    tick();
    tick();
    expect(snapshot().state).toBe("complete");
    expect(snapshot().windows).toHaveLength(1);
    expect(snapshot().target_met).toBeNull();
  });
  it("invalidates measurements after hiding the page or starting another recording", () => {
    installSpeechPreviewTimingProbe();
    capture(5, false);
    rs.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(snapshot().failure).toBe("page_hidden");
    expect(snapshot().target_met).toBeNull();
    host.__w11SpeechTimingProbe!.dispose();
    rs.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    installSpeechPreviewTimingProbe();
    capture(5);
    capture(5);
    expect(snapshot().failure).toBe("multiple_captures");
  });
});
