import { describe, expect, it } from "@rstest/core";

import {
  LEGACY_SPEECH_CAPTURE_LIMITS,
  validateSpeechCaptureLimits,
} from "@/core/law/speech-capture-limits";

describe("server PCM capture budgets", () => {
  it("accepts a lower operator duration and byte budget without extending it", () => {
    const limits = validateSpeechCaptureLimits({
      ...LEGACY_SPEECH_CAPTURE_LIMITS,
      max_samples: 32001,
      max_total_bytes: 64046,
    });
    expect(limits.max_samples).toBe(32001);
    expect(Object.isFrozen(limits)).toBe(true);
  });
  it("rejects missing budgets and expansion beyond the first-round ceiling", () => {
    expect(() => validateSpeechCaptureLimits(undefined)).toThrow();
    expect(() =>
      validateSpeechCaptureLimits({
        ...LEGACY_SPEECH_CAPTURE_LIMITS,
        max_samples: 9600001,
      }),
    ).toThrow();
    expect(() =>
      validateSpeechCaptureLimits({
        ...LEGACY_SPEECH_CAPTURE_LIMITS,
        max_active_captures_per_deployment: 2,
      }),
    ).toThrow();
    expect(() =>
      validateSpeechCaptureLimits({
        ...LEGACY_SPEECH_CAPTURE_LIMITS,
        max_samples: "32000",
      }),
    ).toThrow();
  });
  it("reserves the WAV header and rejects conflicting cache quotas", () => {
    expect(() =>
      validateSpeechCaptureLimits({
        ...LEGACY_SPEECH_CAPTURE_LIMITS,
        max_samples: 16000,
        max_total_bytes: 32043,
      }),
    ).toThrow();
    expect(() =>
      validateSpeechCaptureLimits({
        ...LEGACY_SPEECH_CAPTURE_LIMITS,
        max_pending_bytes_per_origin: 1,
      }),
    ).toThrow();
  });
});
