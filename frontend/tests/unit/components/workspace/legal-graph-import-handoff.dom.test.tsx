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
  default: () => () => <div>本地图谱预览</div>,
}));
rs.mock("sonner", () => ({ toast: { success: rs.fn() } }));
rs.mock("@/components/workspace/artifacts/context", () => ({
  useArtifacts: rs.fn(),
}));
rs.mock("@/components/workspace/messages/context", () => ({
  useThread: rs.fn(),
}));
rs.mock("@/core/law", () => ({
  useLawThreadContext: rs.fn(),
  useLawMatter: rs.fn(),
  getMatterContextByThread: rs.fn(),
}));
rs.mock("@/core/uploads/api", () => ({ getUploadLimits: rs.fn() }));

import {
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { useArtifacts } from "@/components/workspace/artifacts/context";
import { LegalGraphImportHandoff } from "@/components/workspace/law/legal-graph-import-handoff";
import { useThread } from "@/components/workspace/messages/context";
import {
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import {
  LEGACY_GRAPH_HANDOFF_PROMPT,
  convertLegacyGraph,
} from "@/core/law/legal-graph-import";
import type { TrustedMatterContext } from "@/core/law/types";
import { getUploadLimits } from "@/core/uploads/api";

const scope = {
  tenant_id: "tenant",
  matter_id: "matter",
  matter_role: "owner",
  thread_id: "thread",
} as TrustedMatterContext;
const content = JSON.stringify({
  caseId: "PRIVATE-OLD-CASE",
  updatedAt: "",
  nodes: [{ id: "PRIVATE-NODE", label: "合成甲方", type: "party" }],
  edges: [],
});
const closePanel = rs.fn();
const clients: QueryClient[] = [];
let composer: ReturnType<typeof usePromptInputController>;
function Probe() {
  composer = usePromptInputController();
  return (
    <input
      aria-label="已有输入"
      value={composer.textInput.value}
      onChange={(event) => composer.textInput.setInput(event.target.value)}
    />
  );
}
async function mount(initialInput = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <PromptInputProvider initialInput={initialInput}>
        <Probe />
        <LegalGraphImportHandoff threadId="thread" />
      </PromptInputProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "转换旧图谱" }));
  fireEvent.change(screen.getByLabelText(/选择旧项目/), {
    target: { files: [new File([content], "PRIVATE-FILENAME.json")] },
  });
  await screen.findByRole("link", { name: "下载转换图谱" });
  return view;
}
const stage = () =>
  fireEvent.click(screen.getByRole("button", { name: "放入当前会话草稿" }));
function deferContext() {
  let resolve!: (value: TrustedMatterContext) => void;
  rs.mocked(getMatterContextByThread).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  return resolve;
}
beforeEach(() => {
  rs.clearAllMocks();
  rs.mocked(useArtifacts).mockReturnValue({
    setOpen: closePanel,
  } as unknown as ReturnType<typeof useArtifacts>);
  rs.mocked(useThread).mockReturnValue({
    thread: { isLoading: false },
    isMock: false,
  } as ReturnType<typeof useThread>);
  rs.mocked(useLawThreadContext).mockReturnValue({
    data: scope,
    isError: false,
  } as ReturnType<typeof useLawThreadContext>);
  rs.mocked(useLawMatter).mockReturnValue({
    data: { status: "active", title: "当前合成项目" },
    isError: false,
  } as ReturnType<typeof useLawMatter>);
  rs.mocked(getMatterContextByThread).mockResolvedValue(scope);
  rs.mocked(getUploadLimits).mockResolvedValue({
    max_files: 10,
    max_file_size: 10_000_000,
    max_total_size: 20_000_000,
  });
  rs.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
  rs.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  rs.restoreAllMocks();
});

describe("native composer legacy graph handoff", () => {
  it("stages two native Files and static instructions without uploading or exposing old identifiers in the draft", async () => {
    const fetch = rs.spyOn(globalThis, "fetch");
    await mount();
    stage();
    await waitFor(() => expect(composer.attachments.files).toHaveLength(2));
    expect(composer.textInput.value).toBe(LEGACY_GRAPH_HANDOFF_PROMPT);
    expect(composer.textInput.value).not.toContain("PRIVATE");
    expect(closePanel).toHaveBeenCalledWith(false);
    const [graph, report] = composer.attachments.files;
    expect(graph!.filename).toMatch(/^转换图谱-.*\.law-graph\.json$/);
    expect(report!.filename).toMatch(/^迁移报告-.*\.import-report\.json$/);
    expect(graph!.file).toBeInstanceOf(File);
    expect(await graph!.file!.text()).toBe(
      JSON.stringify(
        convertLegacyGraph(content, "旧版案情图谱（待核验）").graph,
        null,
        2,
      ),
    );
    expect(await report!.file!.text()).toContain(
      '"source_filename": "PRIVATE-FILENAME.json"',
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each(["保留已有草稿", "   "])(
    "preserves existing input %s without any request",
    async (initialInput) => {
      await mount(initialInput);
      stage();
      expect((await screen.findByRole("alert")).textContent).toContain(
        "未覆盖",
      );
      expect(composer.textInput.value).toBe(initialInput);
      expect(composer.attachments.files).toHaveLength(0);
      expect(getMatterContextByThread).not.toHaveBeenCalled();
    },
  );
  it("preserves existing attachments", async () => {
    await mount();
    act(() => composer.attachments.add([new File(["keep"], "keep.txt")]));
    stage();
    expect((await screen.findByRole("alert")).textContent).toContain("未覆盖");
    expect(composer.attachments.files.map((file) => file.filename)).toEqual([
      "keep.txt",
    ]);
    expect(getUploadLimits).not.toHaveBeenCalled();
  });
  it.each([
    { ...scope, matter_id: "other" },
    { ...scope, matter_role: "viewer" },
    { ...scope, thread_id: "other" },
  ])("rejects changed authoritative scope %j", async (fresh) => {
    rs.mocked(getMatterContextByThread).mockResolvedValue(
      fresh as TrustedMatterContext,
    );
    await mount();
    stage();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "权限已变化",
    );
    expect(composer.attachments.files).toHaveLength(0);
    expect(composer.textInput.value).toBe("");
  });
  it("does not partially add the pair when server limits permit only one file", async () => {
    rs.mocked(getUploadLimits).mockResolvedValue({
      max_files: 1,
      max_file_size: 10_000_000,
      max_total_size: 20_000_000,
    });
    await mount();
    stage();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "未添加任何文件",
    );
    expect(composer.attachments.files).toHaveLength(0);
  });
  it("preserves text entered while fresh authorization is pending", async () => {
    const resolve = deferContext();
    await mount();
    stage();
    expect(
      screen
        .getByRole("button", { name: "正在核验会话…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("已有输入"), {
      target: { value: "新草稿" },
    });
    await act(async () => resolve(scope));
    expect((await screen.findByRole("alert")).textContent).toContain("未覆盖");
    expect(composer.textInput.value).toBe("新草稿");
    expect(composer.attachments.files).toHaveLength(0);
  });
  it.each(["close", "unmount"])(
    "ignores a late response after %s and aborts the scope request",
    async (action) => {
      const resolve = deferContext();
      const view = await mount();
      stage();
      const signal = rs.mocked(getMatterContextByThread).mock.calls[0]![1]!;
      if (action === "close")
        fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
      else view.unmount();
      expect(signal.aborted).toBe(true);
      await act(async () => resolve(scope));
      expect(closePanel).not.toHaveBeenCalled();
      expect(composer.attachments.files).toHaveLength(0);
    },
  );
  it("reports failed upload-limit reads without adding files", async () => {
    rs.mocked(getUploadLimits).mockRejectedValue(new Error("附件限制查询失败"));
    await mount();
    stage();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "附件限制查询失败",
    );
    expect(composer.attachments.files).toHaveLength(0);
  });
  it("disables handoff while an agent run is active", async () => {
    rs.mocked(useThread).mockReturnValue({
      thread: { isLoading: true },
      isMock: false,
    } as ReturnType<typeof useThread>);
    await mount();
    expect(
      screen
        .getByRole("button", { name: "放入当前会话草稿" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText("请先等待当前运行结束。")).toBeDefined();
    expect(getMatterContextByThread).not.toHaveBeenCalled();
  });
});
