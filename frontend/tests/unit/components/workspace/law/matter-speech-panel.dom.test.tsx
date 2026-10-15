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
  useCreateLawSpeechCitation: rs.fn(),
  useCreateLawSpeechTranscription: rs.fn(),
  useLawEvidence: rs.fn(),
  useLawEvidenceVersions: rs.fn(),
  useLawCaseWorkbench: rs.fn(() => ({ data: undefined })),
  useLawCaseWorkbenchEvents: rs.fn(),
  useLawSpeechTranscription: rs.fn(),
  useLawSpeechCitations: rs.fn(),
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
  useCreateLawSpeechCitation,
  useCreateLawSpeechTranscription,
  useLawEvidence,
  useLawEvidenceVersions,
  useLawSpeechTranscription,
  useLawSpeechCitations,
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
beforeEach(() => {
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
  rs.mocked(useLawSpeechCitations).mockReturnValue({
    data: [],
  } as unknown as ReturnType<typeof useLawSpeechCitations>);
  rs.mocked(useCreateLawSpeechCitation).mockReturnValue({
    mutateAsync: mutationAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateLawSpeechCitation>);
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
    capture_protocol: "pcm_s16le_v1",
    total_samples: 0,
    final_sequence_number: null,
    final_total_samples: null,
    preview_revision: 0,
    transcription_task_id: null,
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
    capture_protocol: "pcm_s16le_v1",
    total_samples: 0,
    final_sequence_number: null,
    final_total_samples: null,
    preview_revision: 0,
    transcription_task_id: null,
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
    capture_protocol: "pcm_s16le_v1",
    total_samples: 0,
    final_sequence_number: null,
    final_total_samples: null,
    preview_revision: 0,
    transcription_task_id: null,
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
    capture_protocol: "pcm_s16le_v1",
    total_samples: 0,
    final_sequence_number: null,
    final_total_samples: null,
    preview_revision: 0,
    transcription_task_id: null,
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
});

describe("matter speech panel", () => {
  it("keeps media upload and transcription controls hidden while the local model is disabled", () => {
    render(
      <MatterSpeechPanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        userId="user-1"
        membershipId="member-1"
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
        userId="user-1"
        membershipId="member-1"
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

  it("explains that queued speech work is deferred during a matter data-exit freeze", async () => {
    available = true;
    const deferredTask = {
      ...task,
      status: "processing" as const,
      processing_deferred_reason: "tenant_data_exit_frozen" as const,
    };
    rs.mocked(useLawSpeechTranscriptions).mockReturnValue({
      data: {
        items: [deferredTask],
        transcription_available: true,
        supported_media_types: ["audio/wav"],
      },
      isFetching: false,
      isError: false,
      refetch,
    } as unknown as ReturnType<typeof useLawSpeechTranscriptions>);
    rs.mocked(useLawSpeechTranscription).mockReturnValue({
      data: { task: deferredTask, versions: [], events: [] },
      isError: false,
    } as unknown as ReturnType<typeof useLawSpeechTranscription>);

    render(
      <MatterSpeechPanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        userId="user-1"
        membershipId="member-1"
      />,
    );

    expect(
      await screen.findByText(
        /案件正在进行数据退出冻结，语音识别暂缓；解除冻结后工作进程会自动恢复。/,
      ),
    ).toBeTruthy();
  });

  it("explains that queued speech work is paused when the matter write gate is unavailable", async () => {
    available = true;
    const deferredTask = {
      ...task,
      status: "processing" as const,
      processing_deferred_reason: "write_gate_unavailable" as const,
    };
    rs.mocked(useLawSpeechTranscriptions).mockReturnValue({
      data: {
        items: [deferredTask],
        transcription_available: true,
        supported_media_types: ["audio/wav"],
      },
      isFetching: false,
      isError: false,
      refetch,
    } as unknown as ReturnType<typeof useLawSpeechTranscriptions>);
    rs.mocked(useLawSpeechTranscription).mockReturnValue({
      data: { task: deferredTask, versions: [], events: [] },
      isError: false,
    } as unknown as ReturnType<typeof useLawSpeechTranscription>);

    render(
      <MatterSpeechPanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        userId="user-1"
        membershipId="member-1"
      />,
    );

    expect(
      await screen.findByText(
        /当前无法确认案件写入门禁，语音识别已暂停；服务恢复后会重新检查。/,
      ),
    ).toBeTruthy();
  });

  it("shows a terminal explanation when the speech requester loses access during processing", async () => {
    available = true;
    const revokedTask = {
      ...task,
      status: "failed" as const,
      error_code: "speech_requester_revoked",
    };
    rs.mocked(useLawSpeechTranscriptions).mockReturnValue({
      data: {
        items: [revokedTask],
        transcription_available: true,
        supported_media_types: ["audio/wav"],
      },
      isFetching: false,
      isError: false,
      refetch,
    } as unknown as ReturnType<typeof useLawSpeechTranscriptions>);
    rs.mocked(useLawSpeechTranscription).mockReturnValue({
      data: { task: revokedTask, versions: [], events: [] },
      isError: false,
    } as unknown as ReturnType<typeof useLawSpeechTranscription>);

    render(
      <MatterSpeechPanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        userId="user-1"
        membershipId="member-1"
      />,
    );

    expect(
      await screen.findByText(
        /本地识别失败（speech_requester_revoked）。请检查模型配置后重试。/,
      ),
    ).toBeTruthy();
  });

  it("preserves a dirty transcript draft across refreshes and exposes a newer version conflict", async () => {
    available = true;
    const reviewTask = {
      ...task,
      status: "awaiting_review" as const,
      current_version_number: 1,
    };
    const makeVersion = (id: string, versionNumber: number, text: string) => ({
      id,
      task_id: reviewTask.id,
      version_number: versionNumber,
      origin: "asr" as const,
      source_sha256: reviewTask.source_sha256,
      transcript: {
        schemaVersion: 1,
        offsetUnit: "utf16" as const,
        text,
        durationMs: 2_000,
        reviewStatus: "unreviewed" as const,
        approxAlignment: true,
        warnings: ["合成估算警告"],
        segments: [
          {
            text,
            charStart: 0,
            charEnd: text.length,
            startMs: 0,
            endMs: 2_000,
            speakerId: null,
          },
        ],
        speakers: [],
      },
      actor_membership_id: "member-1",
      created_at: "2026-10-03T00:00:00Z",
    });
    const firstVersion = makeVersion("speech-version-1", 1, "机器初稿。");
    let currentDetail = {
      task: reviewTask,
      versions: [firstVersion],
      events: [],
    };
    rs.mocked(useLawSpeechTranscriptions).mockReturnValue({
      data: {
        items: [reviewTask],
        transcription_available: true,
        supported_media_types: ["audio/wav"],
        live_capture_available: false,
        live_capture_media_types: [],
      },
      isFetching: false,
      isError: false,
      refetch,
    } as unknown as ReturnType<typeof useLawSpeechTranscriptions>);
    rs.mocked(useLawSpeechTranscription).mockImplementation(
      () =>
        ({ data: currentDetail, isError: false }) as unknown as ReturnType<
          typeof useLawSpeechTranscription
        >,
    );

    const props = {
      tenantId: "tenant-1",
      matterId: "matter-1",
      matterRole: "owner" as const,
      userId: "user-1",
      membershipId: "member-1",
    };
    const view = render(<MatterSpeechPanel {...props} />);
    const segmentEditor = await screen.findByLabelText("校对片段 1");
    fireEvent.change(segmentEditor, {
      target: { value: "尚未保存的律师草稿。" },
    });
    expect(screen.getByText(/时间位置为估算值/)).toBeTruthy();
    expect(screen.getByText(/模型提示：合成估算警告/)).toBeTruthy();

    currentDetail = {
      ...currentDetail,
      versions: [
        { ...firstVersion, transcript: { ...firstVersion.transcript } },
      ],
    };
    view.rerender(<MatterSpeechPanel {...props} />);
    await waitFor(() =>
      expect(screen.getByLabelText("校对片段 1")).toHaveProperty(
        "value",
        "尚未保存的律师草稿。",
      ),
    );

    const secondVersion = makeVersion(
      "speech-version-2",
      2,
      "服务器产生的新版本。",
    );
    currentDetail = {
      task: { ...reviewTask, current_version_number: 2 },
      versions: [firstVersion, secondVersion],
      events: [],
    };
    view.rerender(<MatterSpeechPanel {...props} />);
    expect(await screen.findByText(/当前未保存草稿已保留/)).toBeTruthy();
    expect(screen.getByLabelText("校对片段 1")).toHaveProperty(
      "value",
      "尚未保存的律师草稿。",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "放弃草稿并载入版本 2" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("校对片段 1")).toHaveProperty(
        "value",
        "服务器产生的新版本。",
      ),
    );
    expect(screen.getByText(/时间位置为估算值/)).toBeTruthy();
    expect(screen.getByText(/模型提示：合成估算警告/)).toBeTruthy();
  });

  it("keeps trailing text read-only until editing and invalidates review after speaker or tail edits", async () => {
    rs.mocked(useLawEvidence).mockReturnValue({
      data: [evidenceItem],
      refetch: evidenceRefetch,
    } as unknown as ReturnType<typeof useLawEvidence>);
    const reviewTask = {
      ...task,
      status: "awaiting_review" as const,
      current_version_number: 1,
    };
    rs.mocked(useLawSpeechTranscriptions).mockReturnValue({
      data: {
        items: [reviewTask],
        transcription_available: true,
        supported_media_types: ["audio/wav"],
        live_capture_available: false,
      },
      refetch,
    } as unknown as ReturnType<typeof useLawSpeechTranscriptions>);
    rs.mocked(useLawSpeechTranscription).mockReturnValue({
      data: {
        task: reviewTask,
        versions: [
          {
            id: "guard-v1",
            task_id: task.id,
            version_number: 1,
            origin: "asr",
            source_sha256: task.source_sha256,
            transcript: {
              schemaVersion: 1,
              offsetUnit: "utf16",
              text: "甲尾部",
              durationMs: 2000,
              reviewStatus: "unreviewed",
              approxAlignment: true,
              warnings: [],
              segments: [
                {
                  text: "甲",
                  charStart: 0,
                  charEnd: 1,
                  startMs: 0,
                  endMs: 2000,
                  speakerId: "spk_0",
                },
              ],
              speakers: [{ id: "spk_0", label: "说话人1" }],
            },
            actor_membership_id: "member-1",
            created_at: task.created_at,
          },
        ],
        events: [],
      },
      isError: false,
    } as unknown as ReturnType<typeof useLawSpeechTranscription>);
    render(
      <MatterSpeechPanel
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        userId="user-1"
        membershipId="member-1"
        workspace
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /转写记录/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /合成录音.*待律师校对/ }),
    );
    expect(await screen.findByLabelText("未分配片段的文字")).toHaveProperty(
      "textContent",
      "未分配到识别片段的尾部文字尾部",
    );
    expect(
      screen.queryByRole("textbox", { name: "未分配到识别片段的尾部文字" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "编辑文字与时间" }));
    const textReview = screen.getByLabelText("文字已复核");
    const timeReview = screen.getByLabelText("时间范围已复核");
    const save = screen.getByRole("button", { name: "保存为律师校对版本" });
    for (const [label, value] of [
      ["说话人 1 名称", "律师自定标签"],
      ["未分配到识别片段的尾部文字", "修改后的尾部"],
    ]) {
      fireEvent.click(textReview);
      fireEvent.click(timeReview);
      expect(save).toHaveProperty("disabled", false);
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
      expect(textReview).toHaveProperty("checked", false);
      expect(timeReview).toHaveProperty("checked", false);
      expect(save).toHaveProperty("disabled", true);
    }
  });

  it("preserves each task draft while moving between records in the split workspace", async () => {
    const taskA = {
      ...task,
      status: "awaiting_review" as const,
      current_version_number: 1,
    };
    const taskB = {
      ...taskA,
      id: "speech-task-2",
      evidence_item_id: "evidence-2",
    };
    rs.mocked(useLawEvidence).mockReturnValue({
      data: [
        evidenceItem,
        { ...evidenceItem, id: "evidence-2", title: "02-合成录音" },
      ],
      refetch: evidenceRefetch,
    } as unknown as ReturnType<typeof useLawEvidence>);
    rs.mocked(useLawSpeechTranscriptions).mockReturnValue({
      data: {
        items: [taskA, taskB],
        transcription_available: true,
        supported_media_types: ["audio/wav"],
        live_capture_available: false,
      },
      refetch,
    } as unknown as ReturnType<typeof useLawSpeechTranscriptions>);
    rs.mocked(useLawSpeechTranscription).mockImplementation(
      (_tenant, _matter, id) => {
        const selected = id === taskB.id ? taskB : taskA;
        const text = id === taskB.id ? "乙机器稿" : "甲机器稿";
        return {
          data: id
            ? {
                task: selected,
                versions: [
                  {
                    id: `${selected.id}-v1`,
                    task_id: selected.id,
                    version_number: 1,
                    origin: "asr",
                    source_sha256: selected.source_sha256,
                    transcript: {
                      schemaVersion: 1,
                      offsetUnit: "utf16",
                      text,
                      durationMs: 2000,
                      reviewStatus: "unreviewed",
                      approxAlignment: true,
                      warnings: [],
                      segments: [
                        {
                          text,
                          charStart: 0,
                          charEnd: text.length,
                          startMs: 0,
                          endMs: 2000,
                        },
                      ],
                      speakers: [],
                    },
                    actor_membership_id: "member-1",
                    created_at: task.created_at,
                  },
                ],
                events: [],
              }
            : undefined,
          isError: false,
        } as unknown as ReturnType<typeof useLawSpeechTranscription>;
      },
    );
    render(
      <MatterSpeechPanel
        workspace
        tenantId="tenant-1"
        matterId="matter-1"
        matterRole="owner"
        userId="user-1"
        membershipId="member-1"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /转写记录/ }));
    fireEvent.click(
      screen.getByRole("button", { name: /^合成录音 待律师校对/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "编辑文字与时间" }));
    fireEvent.change(await screen.findByLabelText("校对片段 1"), {
      target: { value: "甲未保存草稿" },
    });
    fireEvent.click(screen.getByRole("button", { name: "返回转写记录" }));
    fireEvent.click(screen.getByRole("button", { name: /^02-合成录音/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑文字与时间" }));
    expect(await screen.findByLabelText("校对片段 1")).toHaveProperty(
      "value",
      "乙机器稿",
    );
    fireEvent.click(screen.getByRole("button", { name: "返回转写记录" }));
    fireEvent.click(
      screen.getByRole("button", { name: /^合成录音 待律师校对/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "编辑文字与时间" }));
    expect(await screen.findByLabelText("校对片段 1")).toHaveProperty(
      "value",
      "甲未保存草稿",
    );
  });

  it("keeps microphone capture disabled when the browser lacks durable recovery support", () => {
    available = true;
    liveCaptureAvailable = true;
    liveCaptureTypes = ["audio/wav"];
    rs.mocked(useLawSpeechTranscriptions).mockReturnValue({
      data: {
        items: [],
        transcription_available: true,
        supported_media_types: ["audio/wav"],
        live_capture_available: true,
        live_capture_media_types: ["audio/wav"],
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
        userId="user-1"
        membershipId="member-1"
      />,
    );

    expect(
      screen.getByText(/当前浏览器无法建立受支持的 16 kHz 录音能力/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /开始麦克风录音/ })).toBeNull();
  });
});
