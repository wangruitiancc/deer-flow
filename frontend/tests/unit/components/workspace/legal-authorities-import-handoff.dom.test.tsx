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
  default: () => () => <div>本地依据预览</div>,
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
  getMatter: rs.fn(),
}));
rs.mock("@/core/uploads/api", () => ({ getUploadLimits: rs.fn() }));

import {
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { useArtifacts } from "@/components/workspace/artifacts/context";
import { LegalAuthoritiesImportHandoff } from "@/components/workspace/law/legal-authorities-import-handoff";
import { useThread } from "@/components/workspace/messages/context";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import {
  convertLegacyLawRefs,
  LEGACY_AUTHORITIES_HANDOFF_PROMPT,
} from "@/core/law/legal-authorities-import";
import { type Matter, type TrustedMatterContext } from "@/core/law/types";
import { getUploadLimits } from "@/core/uploads/api";

const scope = {
  user_id: "user",
  tenant_id: "tenant",
  membership_id: "membership",
  matter_id: "matter",
  matter_member_id: "member",
  matter_role: "owner",
  thread_id: "thread",
  mapping_id: "mapping",
  context_version: 1,
  policy_version: "1",
} as TrustedMatterContext;
const project = {
  id: "matter",
  tenant_id: "tenant",
  title: "合成法律顾问",
  status: "active",
} as Matter;
const original = {
  code: "PRIVATE-法律",
  article: "第一条",
  origin: "manual",
  addedAt: "unknown",
  source: "javascript:PRIVATE",
};
const content =
  "\ufeff[\r\n" +
  JSON.stringify(original) +
  "," +
  JSON.stringify({ ...original, text: "" }) +
  "\r\n]";
const closePanel = rs.fn();
const revokeUrl = rs.fn();
const clients: QueryClient[] = [];
let composer: ReturnType<typeof usePromptInputController>;
function Probe() {
  composer = usePromptInputController();
  return (
    <input
      aria-label="已有输入"
      value={composer.textInput.value}
      onChange={(e) => composer.textInput.setInput(e.target.value)}
    />
  );
}
function choose(file = new File([content], "PRIVATE.json")) {
  fireEvent.change(screen.getByLabelText(/选择旧项目/), {
    target: { files: [file] },
  });
}
async function mount(initialInput = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const tree = () => (
    <QueryClientProvider client={client}>
      <PromptInputProvider initialInput={initialInput}>
        <Probe />
        <LegalAuthoritiesImportHandoff threadId="thread" />
      </PromptInputProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  fireEvent.click(screen.getByRole("button", { name: "导入旧法条收藏" }));
  choose();
  await screen.findByRole("link", { name: "下载转换依据" });
  return { ...view, refresh: () => view.rerender(tree()) };
}
function stage() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "放入当前会话草稿" }));
}
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
    data: project,
    isError: false,
  } as ReturnType<typeof useLawMatter>);
  rs.mocked(getMatterContextByThread).mockResolvedValue(scope);
  rs.mocked(getMatter).mockResolvedValue(project);
  rs.mocked(getUploadLimits).mockResolvedValue({
    max_files: 10,
    max_file_size: 10_000_000,
    max_total_size: 20_000_000,
  });
  rs.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic");
  rs.spyOn(URL, "revokeObjectURL").mockImplementation(revokeUrl);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  rs.restoreAllMocks();
});

describe("legacy law references native handoff", () => {
  it("does not open before project readiness and opens after the scoped project arrives", () => {
    const client = new QueryClient();
    clients.push(client);
    const tree = () => (
      <QueryClientProvider client={client}>
        <PromptInputProvider>
          <LegalAuthoritiesImportHandoff threadId="thread" />
        </PromptInputProvider>
      </QueryClientProvider>
    );
    rs.mocked(useLawMatter).mockReturnValue({
      data: undefined,
      isError: false,
    } as ReturnType<typeof useLawMatter>);
    const view = render(tree());
    fireEvent.click(screen.getByRole("button", { name: "导入旧法条收藏" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    rs.mocked(useLawMatter).mockReturnValue({
      data: project,
      isError: false,
    } as ReturnType<typeof useLawMatter>);
    view.rerender(tree());
    fireEvent.click(screen.getByRole("button", { name: "导入旧法条收藏" }));
    expect(
      screen.getByRole("dialog", { name: "导入旧法条收藏" }),
    ).toBeDefined();
  });
  it("requires explicit confirmation, stages exact complete files and keeps private data out of composer text", async () => {
    const fetch = rs.spyOn(globalThis, "fetch");
    await mount();
    expect(
      screen
        .getByRole("button", { name: "放入当前会话草稿" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(getMatterContextByThread).not.toHaveBeenCalled();
    expect(screen.getByText(/2 条记录 · 2 条缺正文 · 1 条同名/)).toBeDefined();
    stage();
    await waitFor(() => expect(composer.attachments.files).toHaveLength(2));
    const converted = await convertLegacyLawRefs(
      new TextEncoder().encode(content),
      {
        title: "旧法条收藏（待核验）",
        question: "旧收藏迁移；法律适用问题待明确。",
      },
    );
    const [output, report] = composer.attachments.files;
    expect(output!.filename).toMatch(/^转换依据-.*\.law-authorities.json$/);
    expect(report!.filename).toMatch(/^法条迁移报告-.*\.import-report.json$/);
    expect(await output!.file!.text()).toBe(converted.content);
    expect(JSON.parse(await report!.file!.text())).toEqual(converted.report);
    expect(composer.textInput.value).toBe(LEGACY_AUTHORITIES_HANDOFF_PROMPT);
    expect(composer.textInput.value).not.toContain("PRIVATE");
    expect(fetch).not.toHaveBeenCalled();
    expect(closePanel).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each(["已有草稿", "   "])("does not replace text %s", async (text) => {
    await mount(text);
    stage();
    expect((await screen.findByRole("alert")).textContent).toContain("未覆盖");
    expect(composer.textInput.value).toBe(text);
    expect(composer.attachments.files).toHaveLength(0);
    expect(getMatter).not.toHaveBeenCalled();
  });
  it("does not replace attachments", async () => {
    await mount();
    act(() => composer.attachments.add([new File(["keep"], "keep.txt")]));
    stage();
    expect((await screen.findByRole("alert")).textContent).toContain("未覆盖");
    expect(composer.attachments.files.map((f) => f.filename)).toEqual([
      "keep.txt",
    ]);
    expect(getMatter).not.toHaveBeenCalled();
  });
  it.each([
    "thread_id",
    "tenant_id",
    "matter_id",
    "user_id",
    "membership_id",
    "matter_member_id",
    "mapping_id",
    "policy_version",
  ] as const)("rejects a changed %s", async (field) => {
    rs.mocked(getMatterContextByThread).mockResolvedValue({
      ...scope,
      [field]: "changed",
    });
    await mount();
    stage();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "权限已变化",
    );
    expect(composer.attachments.files).toHaveLength(0);
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
  });
  it.each([
    { ...scope, matter_role: "viewer" },
    { ...scope, context_version: 2 },
  ])("rejects revoked or revised context", async (fresh) => {
    rs.mocked(getMatterContextByThread).mockResolvedValue(
      fresh as TrustedMatterContext,
    );
    await mount();
    stage();
    await screen.findByRole("alert");
    expect(composer.attachments.files).toHaveLength(0);
  });
  it.each([
    { ...project, status: "archived" },
    { ...project, id: "other" },
    { ...project, tenant_id: "other" },
  ])("rejects unavailable or mismatched project", async (fresh) => {
    rs.mocked(getMatter).mockResolvedValue(fresh as Matter);
    await mount();
    stage();
    await screen.findByRole("alert");
    expect(composer.attachments.files).toHaveLength(0);
  });
  it("rejects the entire pair if only one attachment is allowed", async () => {
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
  it("reports failed limits without staging", async () => {
    rs.mocked(getUploadLimits).mockRejectedValue(new Error("限制读取失败"));
    await mount();
    stage();
    await screen.findByRole("alert");
    expect(composer.attachments.files).toHaveLength(0);
  });
  it("retains input added during authorization", async () => {
    const resolve = deferContext();
    await mount();
    stage();
    fireEvent.change(screen.getByLabelText("已有输入"), {
      target: { value: "新输入" },
    });
    await act(async () => resolve(scope));
    await screen.findByRole("alert");
    expect(composer.textInput.value).toBe("新输入");
    expect(composer.attachments.files).toHaveLength(0);
  });
  it.each(["close", "unmount", "mapping"])(
    "aborts late authorization after %s",
    async (action) => {
      const resolve = deferContext();
      const view = await mount();
      stage();
      const signal = rs.mocked(getMatterContextByThread).mock.calls[0]![1]!;
      if (action === "close")
        fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
      else if (action === "unmount") view.unmount();
      else {
        rs.mocked(useLawThreadContext).mockReturnValue({
          data: { ...scope, mapping_id: "new" },
          isError: false,
        } as ReturnType<typeof useLawThreadContext>);
        view.refresh();
      }
      expect(signal.aborted).toBe(true);
      await act(async () => resolve(scope));
      expect(closePanel).not.toHaveBeenCalled();
      expect(composer.attachments.files).toHaveLength(0);
    },
  );
  it("blocks staging if a run starts during authorization", async () => {
    const resolve = deferContext();
    const view = await mount();
    stage();
    rs.mocked(useThread).mockReturnValue({
      thread: { isLoading: true },
      isMock: false,
    } as ReturnType<typeof useThread>);
    view.refresh();
    await act(async () => resolve(scope));
    await screen.findByRole("alert");
    expect(composer.attachments.files).toHaveLength(0);
  });
  it("resets confirmation and revokes local downloads after file replacement", async () => {
    await mount();
    fireEvent.click(screen.getByRole("checkbox"));
    choose(new File(["[]"], "empty.json"));
    await screen.findByText(/0 条记录 · 0 条缺正文/);
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(revokeUrl).toHaveBeenCalledTimes(2);
  });
  it("rejects oversize before reading, malformed JSON and invalid UTF-8 without old preview", async () => {
    await mount();
    const huge = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "huge.json");
    const read = rs.spyOn(huge, "arrayBuffer");
    choose(huge);
    await screen.findByRole("alert");
    expect(read).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "下载转换依据" })).toBeNull();
    choose(new File(["{}"], "bad.json"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("数组"),
    );
    choose(new File([new Uint8Array([255])], "bad.json"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("UTF-8"),
    );
  });
  it.each(["replace", "close", "unmount"])(
    "ignores late file read after %s",
    async (action) => {
      const view = await mount();
      let resolve!: (value: ArrayBuffer) => void;
      const file = new File([content], "late.json");
      rs.spyOn(file, "arrayBuffer").mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      choose(file);
      if (action === "replace") choose(new File(["{}"], "invalid.json"));
      else if (action === "close")
        fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
      else view.unmount();
      await act(async () => resolve(new TextEncoder().encode(content).buffer));
      expect(screen.queryByRole("link", { name: "下载转换依据" })).toBeNull();
      expect(composer.attachments.files).toHaveLength(0);
    },
  );
});
