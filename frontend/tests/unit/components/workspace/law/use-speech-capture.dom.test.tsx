import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

rs.mock("@/core/auth/session-lifecycle", () => ({
  registerAuthSessionCleanup: rs.fn(() => () => undefined),
}));
rs.mock("@/core/law", () => ({
  cancelMatterSpeechCapture: rs.fn(),
  createMatterSpeechCapture: rs.fn(),
  finishMatterSpeechCapture: rs.fn(),
  getMatterSpeechCapture: rs.fn(),
  getMatterSpeechCapturePreview: rs.fn(async () => null),
  listMatterSpeechCaptureChunks: rs.fn(async () => ({ items: [] })),
  listMatterSpeechCaptures: rs.fn(),
  uploadMatterSpeechCaptureChunk: rs.fn(),
}));
rs.mock("@/core/law/speech-capture-outbox", () => ({
  acknowledgeSpeechPcmChunk: rs.fn(),
  acquireSpeechCaptureLock: rs.fn(),
  adoptServerSpeechCapture: rs.fn(),
  clearLocalSpeechMatter: rs.fn(async () => undefined),
  clearLocalSpeechIdentity: rs.fn(async () => undefined),
  createLocalSpeechCapture: rs.fn(),
  deleteLocalSpeechCapture: rs.fn(async () => undefined),
  getLocalSpeechCapture: rs.fn(),
  isLocalSpeechCaptureStorageUnavailable: rs.fn(() => false),
  LOCAL_SPEECH_CAPTURE_STORAGE_UNAVAILABLE: "storage unavailable",
  listLocalSpeechCaptures: rs.fn(),
  localSpeechIdentityScope: rs.fn(async () => "fixture-scope"),
  localSpeechCapturesForMatter: rs.fn(() => []),
  persistSpeechPcmChunk: rs.fn(),
  readPendingSpeechPcmChunks: rs.fn(async () => []),
  speechCaptureStorageAvailable: rs.fn(() => true),
  updateLocalSpeechCapture: rs.fn(async () => undefined),
  verifySpeechCaptureStorage: rs.fn(async () => undefined),
}));

import { useSpeechCapture } from "@/components/workspace/law/use-speech-capture";
import * as api from "@/core/law";
import { LEGACY_SPEECH_CAPTURE_LIMITS } from "@/core/law/speech-capture-limits";
import * as outbox from "@/core/law/speech-capture-outbox";
import type { SpeechCaptureSession } from "@/core/law/types";

const remote: SpeechCaptureSession = {
  id: "capture-device-one",
  tenant_id: "tenant",
  matter_id: "matter",
  created_by_membership_id: "member",
  title: "公开测试录音",
  original_filename: "capture.wav",
  media_type: "audio/wav",
  capture_protocol: "pcm_s16le_v1",
  limits: LEGACY_SPEECH_CAPTURE_LIMITS,
  status: "open",
  next_sequence_number: 3,
  total_byte_size: 96000,
  total_samples: 48000,
  final_sequence_number: null,
  final_total_samples: null,
  preview_revision: 0,
  expires_at: "2099-10-12T00:00:00Z",
  cleanup_pending: false,
  evidence_item_id: null,
  evidence_version_id: null,
  transcription_task_id: null,
  source_sha256: null,
  error_code: null,
  created_at: "2026-10-12T00:00:00Z",
  updated_at: "2026-10-12T00:00:00Z",
};
const fresh = {
  ...remote,
  next_sequence_number: 5,
  total_byte_size: 160000,
  total_samples: 80000,
};
const completed = { ...fresh, status: "completed" as const };
const local: outbox.LocalSpeechCaptureSession = {
  localId: "adopted",
  idempotencyKey: "recover",
  captureId: remote.id,
  tenantId: "tenant",
  matterId: "matter",
  title: remote.title,
  totalSamples: fresh.total_samples,
  nextSequenceNumber: 5,
  serverNextSequenceNumber: 5,
  pendingBytes: 0,
  lastSampleCount: 16000,
  audioTrackSettings: null,
  status: "interrupted",
  endReason: "interrupted",
  updatedAt: 0,
};
const release = rs.fn();
const getUserMedia = rs.fn();
const onCompleted = rs.fn();
const props = {
  tenantId: "tenant",
  matterId: "matter",
  userId: "user",
  membershipId: "member",
  available: true,
  onCompleted,
};
const originalContext = Object.getOwnPropertyDescriptor(
  globalThis,
  "AudioContext",
);
const originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
const originalMedia = Object.getOwnPropertyDescriptor(
  navigator,
  "mediaDevices",
);

beforeEach(() => {
  rs.clearAllMocks();
  class TestAudioContext {
    get audioWorklet() {
      return {};
    }
  }
  Object.defineProperty(globalThis, "AudioContext", {
    value: TestAudioContext,
    configurable: true,
  });
  Object.defineProperty(navigator, "locks", {
    value: { request: rs.fn() },
    configurable: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  rs.mocked(outbox.listLocalSpeechCaptures).mockResolvedValue({
    scope: "fixture-scope",
    sessions: [],
  });
  rs.mocked(outbox.acquireSpeechCaptureLock).mockResolvedValue(release);
  rs.mocked(outbox.adoptServerSpeechCapture).mockResolvedValue({
    scope: "fixture-scope",
    session: local,
  });
  rs.mocked(api.listMatterSpeechCaptures).mockResolvedValue([remote]);
  rs.mocked(api.getMatterSpeechCapture).mockResolvedValue(fresh);
  rs.mocked(api.finishMatterSpeechCapture).mockResolvedValue(completed);
});
afterEach(() => {
  cleanup();
  for (const [object, key, descriptor] of [
    [globalThis, "AudioContext", originalContext],
    [navigator, "locks", originalLocks],
    [navigator, "mediaDevices", originalMedia],
  ] as const) {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  }
});

describe("remote-only speech capture recovery", () => {
  it("does not finish another device's active recording merely by opening the page", async () => {
    const { result } = renderHook(() => useSpeechCapture(props));
    await waitFor(() =>
      expect(result.current.serverRecoverable).toEqual([remote]),
    );
    expect(result.current.state).toBe("idle");
    expect(outbox.adoptServerSpeechCapture).not.toHaveBeenCalled();
    expect(outbox.acquireSpeechCaptureLock).not.toHaveBeenCalled();
    expect(api.finishMatterSpeechCapture).not.toHaveBeenCalled();
    expect(api.cancelMatterSpeechCapture).not.toHaveBeenCalled();
    expect(api.uploadMatterSpeechCaptureChunk).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("explicit recovery re-reads the watermark and locks double clicks without opening the microphone", async () => {
    const { result } = renderHook(() => useSpeechCapture(props));
    await waitFor(() => expect(result.current.supported).toBe(true));
    await waitFor(() =>
      expect(result.current.serverRecoverable).toHaveLength(1),
    );
    await act(async () => {
      await Promise.all([
        result.current.recoverServerCapture(remote.id),
        result.current.recoverServerCapture(remote.id),
      ]);
    });
    expect(outbox.adoptServerSpeechCapture).toHaveBeenCalledTimes(1);
    expect(outbox.adoptServerSpeechCapture).toHaveBeenCalledWith(
      "user",
      "member",
      expect.objectContaining({
        captureId: remote.id,
        totalSamples: 80000,
        nextSequenceNumber: 5,
      }),
    );
    expect(api.finishMatterSpeechCapture).toHaveBeenCalledTimes(1);
    expect(api.finishMatterSpeechCapture).toHaveBeenCalledWith(
      "tenant",
      "matter",
      remote.id,
      4,
      80000,
      "interrupted",
    );
    expect(onCompleted).toHaveBeenCalledWith(completed);
    expect(result.current.serverRecoverable).toEqual([]);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it("ignores a recovery response arriving after unmount", async () => {
    let resolve!: (value: SpeechCaptureSession) => void;
    rs.mocked(api.getMatterSpeechCapture).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result, unmount } = renderHook(() => useSpeechCapture(props));
    await waitFor(() => expect(result.current.supported).toBe(true));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.recoverServerCapture(remote.id);
    });
    await waitFor(() =>
      expect(api.getMatterSpeechCapture).toHaveBeenCalledTimes(1),
    );
    unmount();
    await act(async () => {
      resolve(fresh);
      await pending;
    });
    expect(outbox.adoptServerSpeechCapture).not.toHaveBeenCalled();
    expect(api.finishMatterSpeechCapture).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });

  it("clears sensitive state when reauthorization denies explicit recovery", async () => {
    rs.mocked(api.getMatterSpeechCapture).mockRejectedValueOnce({
      status: 403,
    });
    const { result } = renderHook(() => useSpeechCapture(props));
    await waitFor(() =>
      expect(result.current.serverRecoverable).toHaveLength(1),
    );
    await waitFor(() => expect(result.current.supported).toBe(true));
    await act(async () => result.current.recoverServerCapture(remote.id));
    expect(result.current.state).toBe("revoked");
    expect(result.current.serverRecoverable).toEqual([]);
    expect(outbox.clearLocalSpeechMatter).toHaveBeenCalledWith(
      "user",
      "member",
      "tenant",
      "matter",
    );
    expect(outbox.adoptServerSpeechCapture).not.toHaveBeenCalled();
    expect(api.finishMatterSpeechCapture).not.toHaveBeenCalled();
  });
});
