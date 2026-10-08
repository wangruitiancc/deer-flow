import { afterEach, beforeEach, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("sonner", () => ({ toast: { success: rs.fn() } }));
rs.mock("@/components/workspace/artifacts/context", () => ({
  useArtifacts: () => ({ setOpen: rs.fn() }),
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
rs.mock("@/core/law/templates", { spy: true });
rs.mock("@/core/law/custom-templates", { spy: true });
rs.mock("@/core/uploads", { spy: true });

import {
  PromptInputProvider,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";
import { LegalTemplatePicker } from "@/components/workspace/law/legal-template-picker";
import { useThread } from "@/components/workspace/messages/context";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import { CUSTOM_TEMPLATE_DRAFT_PROMPT } from "@/core/law/custom-template-draft";
import {
  CUSTOM_TEMPLATE_OPEN_PROMPT,
  getCustomTemplate,
  listCustomTemplates,
  listCustomTemplateVersions,
} from "@/core/law/custom-templates";
import { loadLegalTemplateCatalog } from "@/core/law/templates";
import { getUploadLimits } from "@/core/uploads";

const scope = {
  user_id: "synthetic",
  tenant_id: "tenant",
  matter_id: "matter",
  mapping_id: "binding",
  thread_id: "thread",
  matter_role: "owner",
};
const catalog = {
  schema_version: 1 as const,
  available: true,
  skill_name: "matrix-law-templates" as const,
  templates: [
    {
      id: "meeting-notes",
      title: "会见笔录",
      artifact_kind: "note" as const,
      source_sha256: "a".repeat(64),
    },
  ],
};
const clients: QueryClient[] = [];
const custom = {
  id: "00000000-0000-4000-8000-000000000091",
  tenant_id: scope.tenant_id,
  owner_membership_id: "owner",
  name: "PRIVATE TEMPLATE",
  visibility: "shared" as const,
  status: "active" as const,
  version: 3,
  current_version_number: 2,
};
const history = [2, 1].map((version_number) => ({
  id: "version-" + version_number,
  template_id: custom.id,
  version_number,
  byte_size: 30,
  content_sha256: "a".repeat(64),
}));
let composer: ReturnType<typeof usePromptInputController>;
function Probe() {
  composer = usePromptInputController();
  return (
    <input
      aria-label="会话输入"
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
        <LegalTemplatePicker threadId="thread" />
      </PromptInputProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "用模板起草" }));
  return view;
}
async function choose() {
  fireEvent.change(await screen.findByLabelText("模板类型"), {
    target: { value: "meeting-notes" },
  });
}
const stage = () =>
  fireEvent.click(screen.getByRole("button", { name: "放入当前会话草稿" }));
beforeEach(() => {
  rs.clearAllMocks();
  rs.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-template");
  rs.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  rs.mocked(useThread).mockReturnValue({
    thread: { isLoading: false },
    isMock: false,
  } as never);
  rs.mocked(useLawThreadContext).mockReturnValue({
    data: scope,
    isError: false,
  } as never);
  rs.mocked(useLawMatter).mockReturnValue({
    data: { title: "合成法律咨询", status: "active" },
    isError: false,
  } as never);
  rs.mocked(getMatterContextByThread).mockResolvedValue(scope as never);
  rs.mocked(getMatter).mockResolvedValue({ status: "active" } as never);
  rs.mocked(loadLegalTemplateCatalog).mockResolvedValue(catalog);
  rs.mocked(listCustomTemplates).mockResolvedValue([custom]);
  rs.mocked(listCustomTemplateVersions).mockResolvedValue(history);
  rs.mocked(getCustomTemplate).mockResolvedValue(custom);
  rs.mocked(getUploadLimits).mockResolvedValue({
    max_files: 10,
    max_file_size: 100000,
    max_total_size: 1000000,
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  rs.restoreAllMocks();
});

it("stages a normal editable draft after fresh checks, without submitting or attaching", async () => {
  await mount();
  await choose();
  stage();
  await waitFor(() =>
    expect(composer.textInput.value).toContain("law_create_template_draft"),
  );
  expect(composer.textInput.value).toContain('"template_id":"meeting-notes"');
  expect(composer.textInput.value).not.toContain('"tenant_id"');
  expect(composer.attachments.files).toHaveLength(0);
  expect(getMatterContextByThread).toHaveBeenCalledTimes(1);
  expect(loadLegalTemplateCatalog).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("never overwrites an existing composer draft", async () => {
  await mount("保留原稿");
  await choose();
  stage();
  expect(await screen.findByText(/输入框已有草稿或附件/)).toBeTruthy();
  expect(composer.textInput.value).toBe("保留原稿");
  expect(getMatterContextByThread).not.toHaveBeenCalled();
});

it("never overwrites existing attachments", async () => {
  await mount();
  await choose();
  act(() =>
    composer.attachments.add([
      new File(["synthetic"], "existing.txt", { type: "text/plain" }),
    ]),
  );
  stage();
  expect(await screen.findByText(/输入框已有草稿或附件/)).toBeTruthy();
  expect(composer.attachments.files).toHaveLength(1);
  expect(composer.textInput.value).toBe("");
});

it("rejects revoked roles at final authorization", async () => {
  rs.mocked(getMatterContextByThread).mockResolvedValue({
    ...scope,
    matter_role: "viewer",
  } as never);
  await mount();
  await choose();
  stage();
  expect(await screen.findByText(/项目归属或权限已变化/)).toBeTruthy();
  expect(composer.textInput.value).toBe("");
});

it("rejects a template removed between opening and confirmation", async () => {
  await mount();
  await choose();
  rs.mocked(loadLegalTemplateCatalog).mockResolvedValue({
    ...catalog,
    templates: [],
  });
  stage();
  expect(await screen.findByText(/所选模板已不可用/)).toBeTruthy();
  expect(composer.textInput.value).toBe("");
});

it("closing while authorization is pending cannot later change the composer", async () => {
  let resolve!: (value: never) => void;
  rs.mocked(getMatterContextByThread).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount();
  await choose();
  stage();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await act(async () => {
    resolve(scope as never);
  });
  expect(composer.textInput.value).toBe("");
});

it("keeps text typed while authorization is pending", async () => {
  let resolve!: (value: never) => void;
  rs.mocked(getMatterContextByThread).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount();
  await choose();
  stage();
  act(() => composer.textInput.setInput("稍后输入的文字"));
  await act(async () => {
    resolve(scope as never);
  });
  expect(await screen.findByText(/输入框已有草稿或附件/)).toBeTruthy();
  expect(composer.textInput.value).toBe("稍后输入的文字");
});

it("exposes a retryable unavailable state when the deployment catalog fails", async () => {
  rs.mocked(loadLegalTemplateCatalog).mockRejectedValue(
    new Error("unavailable"),
  );
  await mount();
  expect(await screen.findByText(/无法使用法律模板/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "重新读取" })).toBeTruthy();
  expect(composer.textInput.value).toBe("");
});

async function chooseCustom() {
  fireEvent.click(screen.getByRole("button", { name: "自定义模板" }));
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "PRIVATE TEMPLATE · 组织" }),
    ).toBeTruthy(),
  );
  fireEvent.change(screen.getByLabelText("自定义模板"), {
    target: { value: custom.id },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "第 1 版 · 30 字节" }),
    ).toBeTruthy(),
  );
  fireEvent.change(screen.getByLabelText("正文版本"), {
    target: { value: "1" },
  });
}

it("stages a pinned historical template selection through native attachments, without private prompt data or a run", async () => {
  await mount();
  await chooseCustom();
  stage();
  await waitFor(() => expect(composer.attachments.files).toHaveLength(1));
  expect(composer.textInput.value).toBe(CUSTOM_TEMPLATE_OPEN_PROMPT);
  expect(composer.textInput.value).not.toContain(custom.id);
  expect(composer.textInput.value).not.toContain(custom.name);
  expect(JSON.parse(await composer.attachments.files[0]!.file!.text())).toEqual(
    { template_id: custom.id, version_number: 1 },
  );
  expect(getCustomTemplate).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});

function fillCustomValues() {
  fireEvent.change(screen.getByLabelText("打开方式"), {
    target: { value: "draft" },
  });
  fireEvent.change(screen.getByLabelText("文书标题"), {
    target: { value: "私密填值标题" },
  });
  fireEvent.change(screen.getByLabelText("项目显示名称"), {
    target: { value: "私密顾问主题" },
  });
}

it("stages explicit draft values with unknown dates only in the native attachment", async () => {
  await mount();
  await chooseCustom();
  fillCustomValues();
  stage();
  await waitFor(() => expect(composer.attachments.files).toHaveLength(1));
  expect(composer.textInput.value).toBe(CUSTOM_TEMPLATE_DRAFT_PROMPT);
  expect(JSON.parse(await composer.attachments.files[0]!.file!.text())).toEqual(
    {
      template_id: custom.id,
      version_number: 1,
      variables: {
        title: "私密填值标题",
        project_label: "私密顾问主题",
        creation_date: "待填写",
        creation_time: "待填写",
      },
    },
  );
  expect(composer.textInput.value).not.toContain("私密");
  expect(getCustomTemplate).toHaveBeenCalledTimes(1);
});

it("announces field errors and rejects invalid civil dates before final network checks", async () => {
  await mount();
  await chooseCustom();
  fireEvent.change(screen.getByLabelText("打开方式"), {
    target: { value: "draft" },
  });
  stage();
  expect(screen.getByLabelText("文书标题").getAttribute("aria-invalid")).toBe(
    "true",
  );
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  fillCustomValues();
  fireEvent.change(screen.getByLabelText("草稿创建日期"), {
    target: { value: "2023-02-29" },
  });
  stage();
  expect(screen.getByRole("alert").textContent).toContain("有效日期");
  expect(getCustomTemplate).not.toHaveBeenCalled();
  expect(composer.attachments.files).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("草稿创建日期"), {
    target: { value: "2024-02-29" },
  });
  fireEvent.change(screen.getByLabelText("草稿创建时间"), {
    target: { value: "03:04" },
  });
  stage();
  await waitFor(() => expect(composer.attachments.files).toHaveLength(1));
  expect(
    JSON.parse(await composer.attachments.files[0]!.file!.text()).variables
      .creation_time,
  ).toBe("03:04");
});

it("switching back to exact copy never leaks hidden form values into its selection", async () => {
  await mount();
  await chooseCustom();
  fillCustomValues();
  fireEvent.change(screen.getByLabelText("打开方式"), {
    target: { value: "copy" },
  });
  expect(screen.queryByLabelText("文书标题")).toBeNull();
  stage();
  await waitFor(() => expect(composer.attachments.files).toHaveLength(1));
  expect(JSON.parse(await composer.attachments.files[0]!.file!.text())).toEqual(
    { template_id: custom.id, version_number: 1 },
  );
  expect(composer.textInput.value).toBe(CUSTOM_TEMPLATE_OPEN_PROMPT);
});

it("disables value edits during validation and cancellation cannot stage late private values", async () => {
  let resolve!: (value: typeof custom) => void;
  rs.mocked(getCustomTemplate).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount();
  await chooseCustom();
  fillCustomValues();
  stage();
  expect(screen.getByLabelText("文书标题").closest("fieldset")?.disabled).toBe(
    true,
  );
  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "打开方式" })
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await act(async () => {
    resolve(custom);
  });
  expect(composer.attachments.files).toHaveLength(0);
  expect(composer.textInput.value).toBe("");
});

it("rechecks current permission for rendering instead of treating the selection as authority", async () => {
  await mount();
  await chooseCustom();
  fillCustomValues();
  rs.mocked(getMatterContextByThread).mockResolvedValue({
    ...scope,
    matter_role: "viewer",
  } as never);
  stage();
  expect(await screen.findByText(/项目归属或权限已变化/)).toBeTruthy();
  expect(composer.attachments.files).toHaveLength(0);
});

it("does not replace existing text with a template selection", async () => {
  await mount("保留文字");
  await chooseCustom();
  stage();
  expect(await screen.findByText(/输入框已有草稿或附件/)).toBeTruthy();
  expect(composer.attachments.files).toHaveLength(0);
  expect(getCustomTemplate).not.toHaveBeenCalled();
});

it("preserves attachments added while template authorization is pending", async () => {
  let resolve!: (value: typeof custom) => void;
  rs.mocked(getCustomTemplate).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount();
  await chooseCustom();
  stage();
  act(() => {
    composer.attachments.add([
      new File(["keep"], "保留.txt", { type: "text/plain" }),
    ]);
  });
  await act(async () => {
    resolve(custom);
  });
  expect(await screen.findByText(/输入框已有草稿或附件/)).toBeTruthy();
  expect(composer.attachments.files.map((file) => file.filename)).toEqual([
    "保留.txt",
  ]);
  expect(composer.textInput.value).toBe("");
});

it("rejects an archived or changed template instead of silently picking latest", async () => {
  await mount();
  await chooseCustom();
  rs.mocked(getCustomTemplate).mockResolvedValue({ ...custom, version: 4 });
  stage();
  expect(await screen.findByText(/未改选其他版本/)).toBeTruthy();
  expect(composer.attachments.files).toHaveLength(0);
});

it("rejects final permission revocation before adding a file", async () => {
  await mount();
  await chooseCustom();
  rs.mocked(getMatterContextByThread).mockResolvedValue({
    ...scope,
    matter_role: "viewer",
  } as never);
  stage();
  expect(await screen.findByText(/项目归属或权限已变化/)).toBeTruthy();
  expect(composer.attachments.files).toHaveLength(0);
});

it("switching template sources cancels late authorization", async () => {
  let resolve!: (value: typeof custom) => void;
  rs.mocked(getCustomTemplate).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount();
  await chooseCustom();
  stage();
  fireEvent.click(screen.getByRole("button", { name: "内置模板" }));
  await act(async () => {
    resolve(custom);
  });
  expect(composer.textInput.value).toBe("");
  expect(composer.attachments.files).toHaveLength(0);
});

it("blocks a selection exceeding native attachment limits", async () => {
  rs.mocked(getUploadLimits).mockResolvedValue({
    max_files: 1,
    max_file_size: 1,
    max_total_size: 1,
  });
  await mount();
  await chooseCustom();
  stage();
  expect(await screen.findByText(/超过当前附件限制/)).toBeTruthy();
  expect(composer.attachments.files).toHaveLength(0);
});

it("requires explicit selection again after a background catalog revision", async () => {
  await mount();
  await chooseCustom();
  act(() => {
    clients.at(-1)!.setQueryData(["law", "custom-templates", scope.tenant_id], {
      pages: [[{ ...custom, version: 4 }]],
      pageParams: [0],
    });
  });
  expect(await screen.findByText(/目录已变化/)).toBeTruthy();
  expect(
    screen.getByRole<HTMLButtonElement>("button", {
      name: "放入当前会话草稿",
    }).disabled,
  ).toBe(true);
  expect(composer.attachments.files).toHaveLength(0);
});
