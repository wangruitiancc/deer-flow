import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("next/dynamic", () => ({
  default:
    () =>
    ({ filepath }: { filepath: string }) => (
      <input aria-label={`编辑 ${filepath}`} defaultValue="初始草稿" />
    ),
}));
rs.mock("@/components/workspace/law/legal-template-picker", () => ({
  LegalTemplatePicker: () => null,
}));
rs.mock("@/components/workspace/law/matter-speech-panel", () => ({
  MatterSpeechPanel: ({
    onActivityChange,
  }: {
    onActivityChange?: (activity: {
      recording: boolean;
      seconds: number;
      label: string;
      stop: () => void;
    }) => void;
  }) => (
    <>
      <input aria-label="录音工作状态替身" defaultValue="未开始" />
      <button
        onClick={() =>
          onActivityChange?.({
            recording: true,
            seconds: 12,
            label: "录音中",
            stop: () => undefined,
          })
        }
      >
        模拟录音活动
      </button>
    </>
  ),
}));
rs.mock("next/navigation", () => ({ useRouter: () => ({ push: rs.fn() }) }));
rs.mock("@/components/workspace/law/legal-graph-import-handoff", () => ({
  LegalGraphImportHandoff: () => null,
}));
rs.mock("@/components/workspace/law/legal-authorities-import-handoff", () => ({
  LegalAuthoritiesImportHandoff: () => null,
}));
rs.mock("@/components/workspace/law/legal-graph-starter", () => ({
  LegalGraphStarter: () => null,
}));
rs.mock("@/components/workspace/law/evidence-workbench", () => ({
  EvidenceWorkbench: () => (
    <input aria-label="校对测试材料" defaultValue="校对草稿" />
  ),
  EvidenceUploadButton: () => <button>添加材料</button>,
}));
rs.mock("@/components/workspace/artifacts/context", () => ({
  useArtifacts: () => ({
    setOpen: rs.fn(),
    select: rs.fn(),
    artifacts: ["/mnt/user-data/outputs/note.md"],
    drafts: {},
    selectedArtifact: null,
  }),
}));
rs.mock("@/components/workspace/artifacts/artifact-file-preview", () => ({
  ArtifactFilePreview: ({ content }: { content: string }) => <p>{content}</p>,
}));
rs.mock("@/core/law", () => ({
  useLawThreadContext: () => ({
    data: {
      tenant_id: "tenant",
      matter_id: "matter",
      matter_role: "lawyer",
      membership_id: "membership-lawyer",
    },
  }),
  useLawMatterMemory: () => ({
    data: { items: [], can_review: false },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: rs.fn(),
  }),
  useDecideLawMatterMemory: () => ({ mutate: rs.fn(), isPending: false }),
  useLawMatterDeadlines: () => ({
    data: [],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: rs.fn(),
  }),
  useLawMatterDeadlineRecipients: () => ({ data: [], isPending: false }),
  useLawMatterDeadlineEvents: () => ({
    data: [],
    isPending: false,
    isError: false,
  }),
  useLawMatterNotificationOutbox: () => ({
    data: [],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: rs.fn(),
  }),
  useMarkLawMatterNotificationRead: () => ({
    mutate: rs.fn(),
    isPending: false,
  }),
  useCreateLawMatterDeadline: () => ({
    mutateAsync: rs.fn(),
    isPending: false,
    isError: false,
  }),
  useConfirmLawMatterDeadline: () => ({
    mutate: rs.fn(),
    isPending: false,
    isError: false,
  }),
  useRescheduleLawMatterDeadline: () => ({
    mutate: rs.fn(),
    isPending: false,
    error: null,
  }),
  useTransitionLawMatterDeadline: () => ({
    mutate: rs.fn(),
    isPending: false,
    error: null,
  }),
  getMatter: rs.fn().mockResolvedValue({ title: "合成测试案件" }),
  listEvidence: rs
    .fn()
    .mockResolvedValue([
      { id: "evidence", title: "测试合同.pdf", status: "active" },
    ]),
  listProjectArtifacts: rs.fn(),
  listProjectArtifactReviews: rs.fn().mockResolvedValue([]),
  listProjectArtifactVersions: rs.fn(),
  useLawProjectArtifactSources: rs.fn().mockReturnValue({
    data: {
      source_state: "bound",
      source_manifest: { citations: [], authorities: [] },
    },
    isPending: false,
    isError: false,
  }),
  reviewProjectArtifactVersion: rs.fn(),
  fetchEvidenceContent: rs.fn(),
  fetchProjectArtifactContent: rs.fn(),
  fetchProjectArtifactExport: rs.fn(),
  getMatterContextByThread: rs.fn(),
}));

import { ProjectArtifactsPanel } from "@/components/workspace/law/project-artifacts-panel";
import { runAuthSessionCleanups } from "@/core/auth/session-lifecycle";
import {
  getMatter,
  listEvidence,
  fetchEvidenceContent,
  fetchProjectArtifactContent,
  fetchProjectArtifactExport,
  listProjectArtifacts,
  listProjectArtifactReviews,
  listProjectArtifactVersions,
  reviewProjectArtifactVersion,
  useLawProjectArtifactSources,
} from "@/core/law";
import type { ProjectArtifact, ProjectArtifactVersion } from "@/core/law/types";

const clients: QueryClient[] = [];
let revokedObjectUrls: string[] = [];
const version = {
  id: "version",
  tenant_id: "tenant",
  matter_id: "matter",
  project_artifact_id: "item",
  version_number: 1,
  media_type: "text/markdown",
  review_status: "unreviewed",
  created_at: "2026-09-06T00:00:00Z",
} as ProjectArtifactVersion;
beforeEach(() => {
  revokedObjectUrls = [];
  rs.mocked(getMatter).mockResolvedValue({ title: "合成测试案件" } as Awaited<
    ReturnType<typeof getMatter>
  >);
  rs.mocked(listEvidence).mockResolvedValue([
    { id: "evidence", title: "测试合同.pdf", status: "active" },
  ] as Awaited<ReturnType<typeof listEvidence>>);
  rs.mocked(listProjectArtifacts).mockResolvedValue([
    {
      id: "item",
      title: "已保存笔记",
      tenant_id: "tenant",
      matter_id: "matter",
      status: "active",
      kind: "document",
      current_version_number: 1,
    } as ProjectArtifact,
  ]);
  rs.mocked(listProjectArtifactVersions).mockResolvedValue([version]);
  rs.mocked(listProjectArtifactReviews).mockResolvedValue([]);
  rs.mocked(useLawProjectArtifactSources).mockReturnValue({
    data: {
      source_state: "bound",
      source_manifest: { citations: [], authorities: [] },
    },
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof useLawProjectArtifactSources>);
  rs.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
  rs.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revokedObjectUrls.push(url);
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  rs.restoreAllMocks();
});

async function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const rendered = render(
    <QueryClientProvider client={client}>
      <ProjectArtifactsPanel threadId="thread">
        <p>原生文件区</p>
      </ProjectArtifactsPanel>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: "文书撰写" }));
  fireEvent.click(await screen.findByRole("button", { name: /已保存笔记/ }));
  return rendered;
}

describe("project artifact preview lifetime", () => {
  it("returns a capture to its function even after that tab was closed on another function", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    const onActivity = rs.fn();
    render(
      <QueryClientProvider client={client}>
        <ProjectArtifactsPanel
          threadId="thread"
          onSpeechActivityChange={onActivity}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "录音 / 实时转写" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "模拟录音活动" }),
    );
    const activity = onActivity.mock.calls.at(-1)?.[0] as {
      returnToCapture: () => void;
    };
    expect(typeof activity.returnToCapture).toBe("function");
    fireEvent.click(screen.getByRole("tab", { name: "案情图谱" }));
    fireEvent.click(
      screen.getByRole("button", { name: "关闭录音 / 实时转写页签" }),
    );
    expect(screen.queryByRole("tab", { name: /录音 \/ 实时转写/ })).toBeNull();
    act(() => activity.returnToCapture());
    expect(
      screen
        .getByRole("tab", { name: /录音 \/ 实时转写/ })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: "模拟录音活动" })).toBeDefined();
  });

  it("exposes the project evidence and OCR workspace in the conversation panel", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <ProjectArtifactsPanel threadId="thread">
          <p>原生文件区</p>
        </ProjectArtifactsPanel>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /测试合同/ }));
    expect(
      await screen.findByRole("textbox", { name: "校对测试材料" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "校对测试材料" }), {
      target: { value: "保留的修改" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "案情图谱" }));
    expect(screen.queryByRole("textbox", { name: "校对测试材料" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "文档校对" }));
    const kept = screen.getByRole("textbox", { name: "校对测试材料" });
    if (!(kept instanceof HTMLInputElement)) throw new Error("Expected input");
    expect(kept.value).toBe("保留的修改");
  });

  it("keeps native file edits across overview switches and does not label all case material as conversation sources", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <ProjectArtifactsPanel threadId="thread" />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByText("本会话上传附件 · 是否用于分析以对话为准"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "文书撰写" }));
    fireEvent.click(screen.getByRole("button", { name: /note.md 本会话文件/ }));
    const input = await screen.findByRole("textbox", {
      name: "编辑 /mnt/user-data/outputs/note.md",
    });
    fireEvent.change(input, { target: { value: "正在编辑" } });
    fireEvent.click(screen.getByRole("tab", { name: "文档校对" }));
    fireEvent.click(screen.getByRole("tab", { name: "文书撰写" }));
    const kept = screen.getByRole("textbox");
    if (!(kept instanceof HTMLInputElement)) throw new Error("Expected input");
    expect(kept.value).toBe("正在编辑");
  });

  it("retains a mounted speech workspace when switching and closing its functional tab", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    clients.push(client);
    render(
      <QueryClientProvider client={client}>
        <ProjectArtifactsPanel threadId="thread" />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "录音 / 实时转写" }));
    const controller = screen.getByLabelText("录音工作状态替身");
    fireEvent.change(controller, { target: { value: "录音仍在进行" } });
    fireEvent.click(screen.getByRole("tab", { name: "文档校对" }));
    fireEvent.click(screen.getByRole("tab", { name: "录音 / 实时转写" }));
    expect(screen.getByLabelText("录音工作状态替身")).toBe(controller);
    fireEvent.click(
      screen.getByRole("button", { name: "关闭录音 / 实时转写页签" }),
    );
    expect(controller.isConnected).toBe(true);
    expect(controller).toHaveProperty("value", "录音仍在进行");
  });

  it("releases content URLs and aborts requests when closing the saved version view", async () => {
    rs.mocked(fetchProjectArtifactContent).mockResolvedValue(
      new Blob(["冻结笔记"]),
    );
    const revokeUrl = rs.spyOn(URL, "revokeObjectURL");
    const view = await open();
    await screen.findByText("冻结笔记");
    const signal = rs
      .mocked(fetchProjectArtifactContent)
      .mock.calls.at(-1)![1]!;
    view.unmount();
    expect(signal.aborted).toBe(true);
    expect(revokeUrl).toHaveBeenCalledWith("blob:synthetic");
  });

  it("never creates an object URL for a response that arrives after unmount", async () => {
    const createUrl = rs.spyOn(URL, "createObjectURL");
    let resolve!: (blob: Blob) => void;
    rs.mocked(fetchProjectArtifactContent).mockReturnValue(
      new Promise<Blob>((done) => {
        resolve = done;
      }),
    );
    const view = await open();
    await screen.findByText("正在核验并扫描所选版本…");
    view.unmount();
    resolve(new Blob(["过期响应"]));
    await waitFor(() =>
      expect(
        rs.mocked(fetchProjectArtifactContent).mock.calls.at(-1)![1]!.aborted,
      ).toBe(true),
    );
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("records a lawyer review against the selected immutable version", async () => {
    rs.mocked(fetchProjectArtifactContent).mockResolvedValue(
      new Blob(["冻结笔记"]),
    );
    rs.mocked(reviewProjectArtifactVersion).mockResolvedValue({
      review: {
        id: "review",
        project_artifact_version_id: "version",
        sequence_number: 1,
        version_sha256: "a".repeat(64),
        decision: "approved",
        review_note: "主体与金额已核对",
        reviewed_by_membership_id: "lawyer",
        created_at: "2026-09-06T01:00:00Z",
      },
      review_status: "approved",
    });
    const view = await open();
    await screen.findByText("冻结笔记");
    fireEvent.click(await screen.findByRole("button", { name: "审核此版本" }));
    fireEvent.change(screen.getByRole("textbox", { name: "审核意见" }), {
      target: { value: "主体与金额已核对" },
    });
    fireEvent.click(screen.getByRole("button", { name: "审核通过" }));
    await waitFor(() =>
      expect(reviewProjectArtifactVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant",
          matterId: "matter",
          artifactId: "item",
          versionId: "version",
          decision: "approved",
          reviewNote: "主体与金额已核对",
          idempotencyKey: expect.any(String),
        }),
      ),
    );
    expect(view.container).toBeTruthy();
  });

  it("plays and positions a fixed speech citation from the saved-version source receipt", async () => {
    const speechCitation = {
      kind: "speech_transcript",
      source_kind: "speech_transcript",
      citation_id: "speech-citation-1",
      recording_name: "庭审录音-合成.wav",
      task_id: "speech-task-1",
      evidence_item_id: "recording-item-1",
      evidence_version_id: "recording-version-1",
      transcript_version_id: "transcript-version-1",
      audio_locator: { kind: "audio_time", start_ms: 12_000, end_ms: 14_500 },
      source_sha256: "a".repeat(64),
      quote_sha256: "b".repeat(64),
    };
    rs.mocked(useLawProjectArtifactSources).mockReturnValue({
      data: {
        source_state: "bound",
        source_manifest: { citations: [speechCitation], authorities: [] },
      },
      isPending: false,
      isError: false,
    } as unknown as ReturnType<typeof useLawProjectArtifactSources>);
    rs.mocked(fetchProjectArtifactContent).mockResolvedValue(
      new Blob(["# 引用成果\n"], { type: "text/markdown" }),
    );
    rs.mocked(fetchEvidenceContent).mockResolvedValue(
      new Blob(["synthetic audio"], { type: "audio/wav" }),
    );

    await open();
    expect(
      await screen.findByText(
        /录音来源 · 庭审录音-合成\.wav · 12\.0 秒–14\.5 秒/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/固定转写版本 transcript-version-1/)).toBeTruthy();
    expect(screen.queryByText(/第 undefined 页/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "定位录音 12.0 秒 至 14.5 秒",
      }),
    );

    const audio = await screen.findByLabelText("固定版本录音来源播放器");
    if (!(audio instanceof HTMLAudioElement))
      throw new Error("Expected the protected speech audio player");
    await waitFor(() =>
      expect(fetchEvidenceContent).toHaveBeenCalledWith(
        "tenant",
        "matter",
        "recording-item-1",
        "recording-version-1",
        expect.any(AbortSignal),
      ),
    );
    Object.defineProperty(audio, "readyState", {
      configurable: true,
      value: 1,
    });
    Object.defineProperty(audio, "currentTime", {
      configurable: true,
      writable: true,
      value: 0,
    });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(12);

    await runAuthSessionCleanups();
    await waitFor(() =>
      expect(screen.queryByLabelText("固定版本录音来源播放器")).toBeNull(),
    );
    expect(revokedObjectUrls).toContain("blob:synthetic");
  });

  for (const kind of [
    "document",
    "contract_review",
    "note",
    "timeline",
    "transcript",
  ] as const) {
    it(`offers DOCX and PDF receipt bundles for an approved ${kind}`, async () => {
      rs.mocked(listProjectArtifacts).mockResolvedValue([
        {
          id: "item",
          title: "已保存笔记",
          tenant_id: "tenant",
          matter_id: "matter",
          status: "active",
          kind,
          current_version_number: 1,
        } as ProjectArtifact,
      ]);
      rs.mocked(listProjectArtifactVersions).mockResolvedValue([
        { ...version, review_status: "approved" },
      ]);
      rs.mocked(fetchProjectArtifactContent).mockResolvedValue(
        new Blob(["已审核文书"]),
      );
      rs.mocked(fetchProjectArtifactExport).mockResolvedValue(
        new Blob(["PK\u0003\u0004synthetic zip"]),
      );
      await open();
      await screen.findByText("已审核文书");
      const docx = await screen.findByRole("button", {
        name: "导出 DOCX + 来源回执",
      });
      expect(
        screen.getByRole("button", { name: "导出 PDF + 来源回执" }),
      ).toBeTruthy();
      fireEvent.click(docx);
      await waitFor(() =>
        expect(fetchProjectArtifactExport).toHaveBeenCalledWith(
          expect.objectContaining({ id: "version" }),
          "docx",
          expect.any(AbortSignal),
        ),
      );
    });
  }
});
