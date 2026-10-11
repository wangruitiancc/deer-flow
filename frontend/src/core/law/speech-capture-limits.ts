import type { SpeechCaptureLimits } from "./types";

// Read-only fallback for old encrypted local sessions. New server sessions must
// supply their own budgets; a missing/invalid server contract closes capture.
export const LEGACY_SPEECH_CAPTURE_LIMITS: Readonly<SpeechCaptureLimits> =
  Object.freeze({
    sample_rate: 16000,
    channels: 1,
    chunk_samples: 16000,
    chunk_bytes: 32000,
    max_samples: 9600000,
    max_total_bytes: 50 * 1024 * 1024,
    max_pending_bytes_per_session: 32 * 1024 * 1024,
    max_pending_bytes_per_origin: 64 * 1024 * 1024,
    max_uncommitted_chunks: 4,
    max_active_captures_per_member: 1,
    max_active_captures_per_deployment: 1,
    preview_window_samples: 80000,
    preview_poll_interval_ms: 1000,
  });

export function validateSpeechCaptureLimits(
  value: unknown,
): SpeechCaptureLimits {
  if (!value || typeof value !== "object")
    throw new Error("服务器未提供有效录音限额；麦克风录音已关闭。");
  const input = value as Record<string, unknown>;
  const output: Record<string, number> = {};
  for (const [name, ceiling] of Object.entries(LEGACY_SPEECH_CAPTURE_LIMITS)) {
    const actual = input[name];
    if (
      typeof actual !== "number" ||
      !Number.isSafeInteger(actual) ||
      actual < 1 ||
      actual > ceiling
    )
      throw new Error("服务器录音限额无效；麦克风录音已关闭。");
    output[name] = actual;
  }
  for (const name of [
    "sample_rate",
    "channels",
    "chunk_samples",
    "chunk_bytes",
    "max_active_captures_per_member",
    "max_active_captures_per_deployment",
    "preview_window_samples",
    "preview_poll_interval_ms",
  ] as const) {
    if (output[name] !== LEGACY_SPEECH_CAPTURE_LIMITS[name])
      throw new Error("服务器录音协议不受支持；麦克风录音已关闭。");
  }
  if (
    output.max_samples! * 2 + 44 > output.max_total_bytes! ||
    output.max_pending_bytes_per_session! > output.max_pending_bytes_per_origin!
  )
    throw new Error("服务器录音限额不一致；麦克风录音已关闭。");
  return Object.freeze(output) as unknown as SpeechCaptureLimits;
}
