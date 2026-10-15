import { afterEach, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const capture = rs.hoisted(() => ({
  complete: null as null | ((session: object) => void),
}));
rs.mock("@/components/workspace/law/use-speech-capture", () => ({
  useSpeechCapture: ({
    onCompleted,
  }: {
    onCompleted: (session: object) => void;
  }) => {
    capture.complete = onCompleted;
    return {
      state: "idle",
      captureActive: false,
      supported: false,
      title: "",
      capturedSamples: 0,
      localSavedSamples: 0,
      serverConfirmedSamples: 0,
      recognizedSamples: 0,
      previewWindows: [],
      serverRecoverable: [],
      stop: rs.fn(),
      cancel: rs.fn(),
    };
  },
}));
rs.mock("@/core/law", () => {
  const mutation = () => ({ isPending: false, mutateAsync: rs.fn() });
  const task = (id: string) => ({
    id,
    evidence_item_id: `e-${id}`,
    evidence_version_id: `e-${id}-v1`,
    source_sha256: "a".repeat(64),
    status: "awaiting_review",
    current_version_number: 1,
    created_at: "2026-10-15T00:00:00Z",
    media_type: "audio/wav",
  });
  return {
    useLawEvidence: () => ({
      data: [
        { id: "e-A", title: "A录音", status: "active" },
        { id: "e-B", title: "B录音", status: "active" },
      ],
      refetch: rs.fn(),
    }),
    useLawEvidenceVersions: () => ({ data: [] }),
    useLawSpeechTranscriptions: () => ({
      data: {
        items: [task("A"), task("B")],
        transcription_available: true,
        supported_media_types: ["audio/wav"],
        live_capture_available: false,
      },
      refetch: rs.fn(),
    }),
    useLawSpeechTranscription: (
      _tenant: string,
      _matter: string,
      id: string | null,
    ) => ({
      data: id
        ? {
            task: task(id),
            versions: [
              {
                id: `${id}-v1`,
                version_number: 1,
                origin: "asr",
                transcript: {
                  schemaVersion: 1,
                  offsetUnit: "utf16",
                  text: `${id}稿`,
                  durationMs: 1000,
                  reviewStatus: "unreviewed",
                  approxAlignment: true,
                  warnings: [],
                  speakers: [],
                  segments: [
                    {
                      text: `${id}稿`,
                      charStart: 0,
                      charEnd: 2,
                      startMs: 0,
                      endMs: 1000,
                    },
                  ],
                },
              },
            ],
            events: [],
          }
        : undefined,
    }),
    useLawCaseWorkbench: () => ({ data: undefined }),
    useLawCaseWorkbenchEvents: rs.fn(),
    useLawSpeechCitations: () => ({ data: [] }),
    useUploadLawEvidence: mutation,
    useCreateLawSpeechTranscription: mutation,
    useCancelLawSpeechTranscription: mutation,
    useReviewLawSpeechTranscription: mutation,
    useCreateLawSpeechCitation: mutation,
    fetchEvidenceContent: async () => new Blob(["synthetic audio"]),
  };
});

import { MatterSpeechPanel } from "@/components/workspace/law/matter-speech-panel";

afterEach(cleanup);
function mount() {
  return render(
    <MatterSpeechPanel
      tenantId="tenant"
      matterId="matter"
      userId="user"
      membershipId="member"
      matterRole="owner"
      workspace
    />,
  );
}
function completeB() {
  act(() =>
    capture.complete?.({
      transcription_task_id: "B",
      evidence_item_id: "e-B",
      evidence_version_id: "e-B-v1",
    }),
  );
}
describe("capture completion navigation", () => {
  it("does not steal the file-upload view when an earlier capture completes", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^文件转写$/ }));
    completeB();
    expect(
      screen
        .getByRole("button", { name: /^文件转写$/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.getByLabelText("音视频原件")).toBeDefined();
  });
  it("preserves the active transcript editor and its dirty draft on capture completion", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /转写记录/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /A录音.*待律师校对/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "编辑文字与时间" }));
    const editor = await screen.findByLabelText("校对片段 1");
    fireEvent.change(editor, { target: { value: "A未保存草稿" } });
    completeB();
    expect(screen.getByLabelText("校对片段 1")).toBe(editor);
    expect(editor).toHaveProperty("value", "A未保存草稿");
  });
});
