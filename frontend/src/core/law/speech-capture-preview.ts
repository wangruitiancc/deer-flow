import type {
  SpeechCapturePreviewReceipt,
  SpeechCapturePreviewWindow,
} from "./types";

export interface SpeechCapturePreviewState {
  revision: number;
  windows: SpeechCapturePreviewWindow[];
}

// Accept the revision-merged, non-overlapping windows, not a time watermark:
// a later result does not prove earlier windows were recognized.
export function recognizedSpeechCaptureSamples(
  windows: readonly SpeechCapturePreviewWindow[],
): number {
  return windows.reduce(
    (total, window) =>
      total + (window.transcript ? window.end_sample - window.start_sample : 0),
    0,
  );
}

export function mergeSpeechCapturePreview(
  current: SpeechCapturePreviewState,
  update: SpeechCapturePreviewReceipt | null,
): SpeechCapturePreviewState {
  if (!update || update.revision < current.revision) return current;

  const windows = new Map(
    current.windows.map((item) => [item.window_id, item]),
  );
  for (const item of update.items) {
    const existing = windows.get(item.window_id);
    if (!existing || item.revision >= existing.revision)
      windows.set(item.window_id, item);
  }

  return {
    revision: update.revision,
    windows: [...windows.values()].sort(
      (left, right) =>
        left.window_index - right.window_index ||
        left.window_id.localeCompare(right.window_id),
    ),
  };
}
