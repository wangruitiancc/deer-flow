import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("@/core/law", () => ({
  cancelMatterSpeechCapture: rs.fn(),
  createMatterSpeechCapture: rs.fn(),
  finishMatterSpeechCapture: rs.fn(),
  fetchEvidenceContent: rs.fn(async () => new Blob(["synthetic audio"])),
  getMatterSpeechCapture: rs.fn(),
  uploadMatterSpeechCaptureChunk: rs.fn(),
  useCancelLawSpeechTranscription: rs.fn(),
  useCreateLawSpeechTranscription: rs.fn(),
  useLawEvidence: rs.fn(),
  useLawEvidenceVersions: rs.fn(),
  useLawSpeechTranscription: rs.fn(),
  useLawSpeechTranscriptions: rs.fn(),
  useReviewLawSpeechTranscription: rs.fn(),
  useUploadLawEvidence: rs.fn(),
}));

import { MatterSpeechPanel } from "@/components/workspace/law/matter-speech-panel";
import {
  cancelMatterSpeechCapture,
  createMatterSpeechCapture,
  finishMatterSpeechCapture,
  getMatterSpeechCapture,
  uploadMatterSpeechCaptureChunk,
  useCancelLawSpeechTranscription,
  useCreateLawSpeechTranscription,
  useLawEvidence,
  useLawEvidenceVersions,
  useLawSpeechTranscription,
  useLawSpeechTranscriptions,
  useReviewLawSpeechTranscription,
  useUploadLawEvidence,
} from "@/core/law";
import type {
  EvidenceItem,
  EvidenceVersion,
  SpeechTranscriptionTask,
} from "@/core/law/types";

const evidenceItem: EvidenceItem = {
  id: "evidence-1",
  tenant_id: "tenant-1",
  matter_id: "matter-1",
  kind: "evidence",
  title: "合成录音",
  status: "active",
  created_by_membership_id: "member-1",
  version: 1,
  created_at: "2026-10-03T00:00:00Z",
  updated_at: "2026-10-03T00:00:00Z",
  archived_at: null,
};

const evidenceVersion: EvidenceVersion = {
  id: "evidence-version-1",
  tenant_id: "tenant-1",
  matter_id: "matter-1",
  evidence_item_id: evidenceItem.id,
  version_number: 1,
  origin: "upload",
  source_version_id: null,
  original_filename: "synthetic.wav",
  media_type: "audio/wav",
  byte_size: 32,
  sha256: "a".repeat(64),
  created_by_membership_id: "member-1",
  created_at: "2026-10-03T00:00:00Z",
  scan_status: "clean",
  scanned_at: "2026-10-03T00:00:00Z",
};

const task: SpeechTranscriptionTask = {
  id: "speech-task-1",
  tenant_id: "tenant-1",
  matter_id: "matter-1",
  evidence_item_id: evidenceItem.id,
  evidence_version_id: evidenceVersion.id,
  source_sha256: evidenceVersion.sha256,
  media_type: "audio/wav",
  requested_by_membership_id: "member-1",
  status: "queued",
  attempts: 0,
  current_version_number: 0,
  model_id: null,
  error_code: null,
  cancel_requested: false,
  created_at: "2026-10-03T00:00:00Z",
  updated_at: "2026-10-03T00:00:00Z",
};

const mutationAsync = rs.fn(async () => task);
const refetch = rs.fn();
const evidenceRefetch = rs.fn(async () => undefined);
let available = false;
let evidenceItems: EvidenceItem[] = [];
let liveCaptureAvailable = false;
let liveCaptureTypes: string[] = [];
let recorderConstructor: typeof MediaRecorder | undefined;
let mediaDevicesDescriptor: PropertyDescriptor | undefined;

class TestMediaRecorder extends EventTarget {
  static isTypeSupported = (type: string) => type === "audio/webm";
  state: RecordingState = "inactive";
  mimeType = "audio/webm";

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {
    super();
  }

  start() {
    this.state = "recording";
  }

  pause() {
    this.state = "paused";
  }

  resume() {
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") return;
    const dataEvent = Object.assign(new Event("dataavailable"), {
      data: new Blob(["synthetic live audio"], { type: "audio/webm" }),
    });
    this.dispatchEvent(dataEvent);
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
}

beforeEach(() => {
  recorderConstructor = Object.getOwnPropertyDescriptor(window, "MediaRecorder")
    ?.value as typeof MediaRecorder | undefined;
  mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "mediaDevices",
  );
  available = false;
  liveCaptureAvailable = false;
  liveCaptureTypes = [];
  evidenceItems = [];
  mutationAsync.mockReset();
  mutationAsync.mockResolvedValue(task);
  refetch.mockReset();
  evidenceRefetch.mockReset();
  rs.mocked(useLawEvidence).mockReturnValue({
    data: evidenceItems,
    refetch: evidenceRefetch,
  } as unknown as ReturnType<typeof useLawEvidence>);
  rs.mocked(useLawEvidenceVersions).mockReturnValue({
    data: [evidenceVersion],
    isLoading: false,
  } as unknown as ReturnType<typeof useLawEvidenceVersions>);
  rs.mocked(useLawSpeechTranscriptions).mockReturnValue({
    data: {
      items: [],
      transcription_available: available,
      supported_media_types: available ? ["audio/wav"] : [],
      live_capture_available: liveCaptureAvailable,
      live_capture_media_types: liveCaptureTypes,
    },
    isFetching: false,
    isError: false,
    refetch,
  } as unknown as ReturnType<typeof useLawSpeechTranscriptions>);
  rs.mocked(useLawSpeechTranscription).mockReturnValue({
    data: undefined,
    isError: false,
  } as unknown as ReturnType<typeof useLawSpeechTranscription>);
  rs.mocked(useCreateLawSpeechTranscription).mockReturnValue({
    mutateAsync: mutationAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateLawSpeechTranscription>);
  rs.mocked(useCancelLawSpeechTranscription).mockReturnValue({
    mutateAsync: mutationAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCancelLawSpeechTranscription>);
  rs.mocked(useReviewLawSpeechTranscription).mockReturnValue({
    mutateAsync: mutationAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useReviewLawSpeechTranscription>);
  rs.mocked(useUploadLawEvidence).mockReturnValue({
    mutateAsync: mutationAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUploadLawEvidence>);
  rs.mocked(createMatterSpeechCapture).mockReset();
  rs.mocked(uploadMatterSpeechCaptureChunk).mockReset();
  rs.mocked(finishMatterSpeechCapture).mockReset();
  rs.mocked(getMatterSpeechCapture).mockReset();
  rs.mocked(cancelMatterSpeechCapture).mockReset();
  rs.mocked(createMatterSpeechCapture).mockResolvedValue({
    id: "capture-1",
    tenant_id: "tenant-1",
    matter_id: "matter-1",
    created_by_membership_id: "member-1",
    title: "合成实时录音",
    original_filename: "live-recording.webm",
    media_type: "audio/webm",
    status: "open",
    next_sequence_number: 0,
    total_byte_size: 0,
    expires_at: "2026-10-03T01:00:00Z",
    cleanup_pending: false,
    evidence_item_id: null,
    evidence_version_id: null,
    source_sha256: null,
    error_code: null,
    created_at: "2026-10-03T00:00:00Z",
    updated_at: "2026-10-03T00:00:00Z",
    max_chunk_bytes: 65_536,
    max_total_bytes: 52_428_800,
    transcription_available: true,
  });
  rs.mocked(uploadMatterSpeechCaptureChunk).mockResolvedValue({
    capture_id: "capture-1",
    accepted_sequence_number: 0,
    next_sequence_number: 1,
    chunk_sha256: "b".repeat(64),
  });
  rs.mocked(finishMatterSpeechCapture).mockResolvedValue({
    id: "capture-1",
    tenant_id: "tenant-1",
    matter_id: "matter-1",
    created_by_membership_id: "member-1",
    title: "合成实时录音",
    original_filename: "live-recording.webm",
    media_type: "audio/webm",
    status: "completed",
    next_sequence_number: 1,
    total_byte_size: 19,
    expires_at: "2026-10-03T01:00:00Z",
    cleanup_pending: false,
    evidence_item_id: evidenceItem.id,
    evidence_version_id: evidenceVersion.id,
    source_sha256: "b".repeat(64),
    error_code: null,
    created_at: "2026-10-03T00:00:00Z",
    updated_at: "2026-10-03T00:01:00Z",
    evidence_item: evidenceItem,
    evidence_version: { ...evidenceVersion, media_type: "audio/webm" },
  });
  rs.mocked(getMatterSpeechCapture).mockResolvedValue({
    id: "capture-1",
    tenant_id: "tenant-1",
    matter_id: "matter-1",
    created_by_membership_id: "member-1",
    title: "合成实时录音",
    original_filename: "live-recording.webm",
    media_type: "audio/webm",
    status: "open",
    next_sequence_number: 0,
    total_byte_size: 0,
    expires_at: "2026-10-03T01:00:00Z",
    cleanup_pending: false,
    evidence_item_id: null,
    evidence_version_id: null,
    source_sha256: null,
    error_code: null,
    created_at: "2026-10-03T00:00:00Z",
    updated_at: "2026-10-03T00:00:00Z",
  });
  rs.mocked(cancelMatterSpeechCapture).mockResolvedValue({
    id: "capture-1",
    tenant_id: "tenant-1",
    matter_id: "matter-1",
    created_by_membership_id: "member-1",
    title: "合成实时录音",
    original_filename: "live-recording.webm",
    media_type: "audio/webm",
    status: "cancelled",
    next_sequence_number: 0,
    total_byte_size: 0,
    expires_at: "2026-10-03T01:00:00Z",
    cleanup_pending: true,
    evidence_item_id: null,
    evidence_version_id: null,
    source_sha256: null,
    error_code: null,
    created_at: "2026-10-03T00:00:00Z",
    updated_at: "2026-10-03T00:00:00Z",
  });
});

afterEach(() => {
  cleanup();
  if (recorderConstructor) {
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: recorderConstructor,
    });
  } else {
    Reflect.deleteProperty(window, "MediaRecorder");
  }
  if (mediaDevicesDescriptor) {
    Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
  } else {
    Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

describe("matter speech panel", () => {
  it("keeps media upload and transcription controls hidden while the local model is disabled", () => {
    render(
      <MatterSpeechPanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
      />,
    );

    expect(screen.getByText(/未启用已验收的本地语音模型/)).toBeTruthy();
    expect(screen.queryByLabelText("音视频原件")).toBeNull();
    expect(screen.queryByRole("button", { name: /开始麦克风录音/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /开始本地转写/ })).toBeNull();
  });

  it("starts a task only from a clean, server-approved audio evidence version", async () => {
    available = true;
    evidenceItems = [evidenceItem];
    rs.mocked(useLawEvidence).mockReturnValue({
      data: evidenceItems,
      refetch: evidenceRefetch,
    } as unknown as ReturnType<typeof useLawEvidence>);
    rs.mocked(useLawSpeechTranscriptions).mockReturnValue({
      data: {
        items: [],
        transcription_available: true,
        supported_media_types: ["audio/wav"],
      },
      isFetching: false,
      isError: false,
      refetch,
    } as unknown as ReturnType<typeof useLawSpeechTranscriptions>);

    render(
      <MatterSpeechPanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
      />,
    );
    fireEvent.change(screen.getByLabelText("已扫描的音视频材料"), {
      target: { value: evidenceItem.id },
    });
    fireEvent.change(screen.getByLabelText("原件版本"), {
      target: { value: evidenceVersion.id },
    });
    fireEvent.click(screen.getByRole("button", { name: /开始本地转写/ }));

    await waitFor(() =>
      expect(mutationAsync).toHaveBeenCalledWith({
        evidenceItemId: evidenceItem.id,
        evidenceVersionId: evidenceVersion.id,
      }),
    );
  });

  it("uploads confirmed microphone chunks, scans the recording, then starts transcription", async () => {
    available = true;
    liveCaptureAvailable = true;
    liveCaptureTypes = ["audio/webm"];
    evidenceItems = [];
    rs.mocked(useLawEvidence).mockReturnValue({
      data: evidenceItems,
      refetch: evidenceRefetch,
    } as unknown as ReturnType<typeof useLawEvidence>);
    rs.mocked(useLawSpeechTranscriptions).mockReturnValue({
      data: {
        items: [],
        transcription_available: true,
        supported_media_types: ["audio/webm"],
        live_capture_available: true,
        live_capture_media_types: ["audio/webm"],
      },
      isFetching: false,
      isError: false,
      refetch,
    } as unknown as ReturnType<typeof useLawSpeechTranscriptions>);
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: TestMediaRecorder,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: rs.fn(async () => ({
          getTracks: () => [{ stop: rs.fn() }],
        })),
      },
    });
    render(
      <MatterSpeechPanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /开始麦克风录音/ }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: /开始麦克风录音/ }));
    await waitFor(() => expect(createMatterSpeechCapture).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /停止并保存/ }));

    await waitFor(() =>
      expect(uploadMatterSpeechCaptureChunk).toHaveBeenCalledWith(
        "tenant-1",
        "matter-1",
        "capture-1",
        0,
        expect.any(Blob),
        expect.stringMatching(/^[0-9a-f]{64}$/),
      ),
    );
    await waitFor(() =>
      expect(finishMatterSpeechCapture).toHaveBeenCalledWith(
        "tenant-1",
        "matter-1",
        "capture-1",
        0,
      ),
    );
    await waitFor(() =>
      expect(mutationAsync).toHaveBeenCalledWith({
        evidenceItemId: evidenceItem.id,
        evidenceVersionId: evidenceVersion.id,
      }),
    );
  });
});
