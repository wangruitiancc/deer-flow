/** Install with page.addInitScript before app code, on a synthetic-only journey.
 * No request interception, auth persistence, text capture, or PCM copies.
 * This module is test instrumentation and is never imported by application code.
 */
export function installSpeechPreviewTimingProbe() {
  const key = "__w11SpeechTimingProbe";
  const host = window as typeof window & {
    __w11SpeechTimingProbe?: { snapshot: () => unknown; dispose: () => void };
  };
  if (host[key]) throw new Error("speech_timing_probe_already_installed");
  const Original = window.AudioWorkletNode;
  if (typeof Original !== "function")
    throw new Error("native_worklet_required");
  const selector = '[aria-label="录音临时识别预览"] > div > span';
  const rate = 16_000;
  const windowSamples = 80_000;
  // Chromium's rendering quantum is 128 frames. Subtract a full quantum from
  // the estimated end so a render-head boundary cannot make latency optimistic.
  const quantumMs = (128 / rate) * 1000;
  let failure: string | null = null;
  let sampled = 0;
  let nodes = 0;
  let flushed = false;
  let disposed = false;
  let pendingFrame = false;
  let lastFrame = 0;
  let shortTail = false;
  let baseline = new WeakSet<Element>();
  const ends = new Map<number, { endMs: number; deliveredMs: number }>();
  const shown = new Map<
    number,
    { endMs: number; deliveredMs: number; paintedMs: number }
  >();
  const cleanups: (() => void)[] = [];
  const fail = (reason: string) => {
    failure ??= reason;
  };

  function scan() {
    if (disposed || failure || nodes !== 1) return;
    if (document.visibilityState !== "visible") {
      fail("page_hidden");
      return;
    }
    // Only time labels are read. Never read a containing transcript node.
    for (const label of document.querySelectorAll(selector)) {
      if (baseline.has(label) || label.getClientRects().length === 0) continue;
      const match = /^(\d+)\s*–\s*(\d+)\s*秒$/.exec(
        label.textContent?.trim() ?? "",
      );
      if (!match) {
        fail("preview_time_label_changed");
        return;
      }
      const start = Number(match[1]) * rate;
      const end = Number(match[2]) * rate;
      if (
        flushed &&
        start === Math.floor(sampled / windowSamples) * windowSamples &&
        sampled > start &&
        end >= start &&
        end <= sampled &&
        end - start < windowSamples
      )
        continue;
      if (end - start !== windowSamples || start % windowSamples !== 0) {
        fail("unexpected_preview_range");
        return;
      }
      const timing = ends.get(end);
      if (!timing || shown.has(end)) continue;
      const paintedMs = performance.now();
      if (paintedMs < timing.endMs) {
        fail("non_monotonic_clock");
        return;
      }
      shown.set(end, { ...timing, paintedMs });
    }
  }
  function scheduleScan() {
    if (pendingFrame || disposed || failure) return;
    pendingFrame = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        pendingFrame = false;
        scan();
      }),
    );
  }
  const Wrapped = new Proxy(Original, {
    construct(target, args, newTarget) {
      const node = Reflect.construct(
        target,
        args,
        newTarget,
      ) as AudioWorkletNode;
      const [context, name] = args as [AudioContext, string];
      if (name !== "matrix-law-pcm16-capture") return node;
      nodes += 1;
      if (nodes !== 1) {
        fail("multiple_captures");
        return node;
      }
      baseline = new WeakSet(document.querySelectorAll(selector));
      if (context.sampleRate !== rate) fail("unexpected_sample_rate");
      const listen = (
        event: MessageEvent<{
          type?: string;
          samples?: ArrayBuffer;
          endFrame?: number;
        }>,
      ) => {
        if (disposed || failure) return;
        if (event.data?.type === "flushed") {
          flushed = true;
          return;
        }
        if (event.data?.type !== "pcm") return;
        const bytes = event.data.samples?.byteLength;
        const frame = event.data.endFrame;
        if (
          !Number.isSafeInteger(bytes) ||
          !bytes ||
          bytes > 32_000 ||
          bytes % 2 ||
          typeof frame !== "number" ||
          !Number.isSafeInteger(frame) ||
          frame < 1 ||
          frame < sampled + bytes / 2 ||
          shortTail ||
          (lastFrame && frame < lastFrame + bytes / 2)
        ) {
          fail("pcm_timing_metadata_missing_or_invalid");
          return;
        }
        if (
          flushed ||
          context.state !== "running" ||
          document.visibilityState !== "visible"
        ) {
          fail("inactive_capture_clock");
          return;
        }
        const deliveredMs = performance.now();
        const contextTime = context.currentTime;
        if (
          !Number.isFinite(contextTime) ||
          contextTime <= 0 ||
          frame > contextTime * rate + 128
        ) {
          fail("audio_clock_unavailable");
          return;
        }
        sampled += bytes / 2;
        lastFrame = frame;
        shortTail = bytes < 32_000;
        if (sampled > 9_600_000) {
          fail("capture_limit_exceeded");
          return;
        }
        if (sampled % windowSamples === 0) {
          const endMs =
            deliveredMs - (contextTime - frame / rate) * 1000 - quantumMs;
          ends.set(sampled, { endMs, deliveredMs });
          scheduleScan();
        }
      };
      node.port.addEventListener("message", listen);
      cleanups.push(() => node.port.removeEventListener("message", listen));
      return node;
    },
  });
  window.AudioWorkletNode = Wrapped;
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden", "style", "class"],
  });
  const visibility = () => {
    if (nodes && document.visibilityState !== "visible") fail("page_hidden");
  };
  document.addEventListener("visibilitychange", visibility);
  host[key] = {
    snapshot() {
      const expected = Math.floor(sampled / windowSamples);
      const windows = [...shown]
        .sort(([a], [b]) => a - b)
        .map(([end, times]) => ({
          window_index: end / windowSamples - 1,
          end_sample: end,
          sample_end_estimate_ms: times.endMs,
          main_thread_delivery_ms: times.deliveredMs,
          visible_frame_ms: times.paintedMs,
          latency_ms: times.paintedMs - times.endMs,
        }));
      const pending = Array.from(
        { length: expected },
        (_, i) => (i + 1) * windowSamples,
      ).filter((end) => !shown.has(end));
      const complete =
        !failure &&
        nodes === 1 &&
        flushed &&
        expected > 0 &&
        pending.length === 0;
      const sorted = windows
        .map((item) => item.latency_ms)
        .sort((a, b) => a - b);
      // Never publish a passing P95 from a partial stream or omit the cold window.
      const p95 = complete
        ? sorted[Math.ceil(sorted.length * 0.95) - 1]!
        : null;
      return {
        format: "w11-browser-preview-timing-v1",
        state: failure ? "invalid" : complete ? "complete" : "in_progress",
        failure,
        sampled_samples: sampled,
        flushed,
        expected_full_windows: expected,
        pending_end_samples: pending,
        windows,
        p95_ms: p95,
        target_ms: 5000,
        minimum_acceptance_windows: 20,
        target_met: p95 === null || windows.length < 20 ? null : p95 <= 5000,
        clock_method:
          "AudioWorklet endFrame calibrated to running AudioContext.currentTime and performance.now, one 128-frame quantum subtracted; double animation frame visibility estimate",
        render_quantum_guard_ms: quantumMs,
      };
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      document.removeEventListener("visibilitychange", visibility);
      if (window.AudioWorkletNode === Wrapped)
        window.AudioWorkletNode = Original;
      delete host[key];
    },
  };
}
