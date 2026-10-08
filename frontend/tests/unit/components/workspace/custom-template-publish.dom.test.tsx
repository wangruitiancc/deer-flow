import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

rs.mock("@/core/law", () => ({
  useLawThreadContext: rs.fn(),
  useLawMatter: rs.fn(),
  getMatter: rs.fn(),
  getMatterContextByThread: rs.fn(),
}));
rs.mock("@/components/workspace/messages/context", () => ({
  useThread: () => ({ thread: { isLoading: false }, isMock: false }),
}));

import { Dialog } from "@/components/ui/dialog";
import { CustomTemplatePublish } from "@/components/workspace/law/custom-template-publish";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import { sha256Hex } from "@/core/law/api";
import { type CustomTemplate } from "@/core/law/custom-templates";
import { type TrustedMatterContext } from "@/core/law/types";

const tenant = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const copy = "33333333-3333-4333-8333-333333333333";
const versionId = "44444444-4444-4444-8444-444444444444";
const source: CustomTemplate = {
  id,
  tenant_id: tenant,
  owner_membership_id: id,
  name: "个人模板",
  visibility: "private",
  status: "active",
  version: 3,
  current_version_number: 2,
};
const scope = {
  tenant_id: tenant,
  matter_id: "matter",
  mapping_id: "mapping",
  thread_id: "thread",
  membership_id: id,
  tenant_role: "admin",
} as TrustedMatterContext;
const content =
  "\ufeff# 合成历史第一版\r\n{{case}} <script>private()</script>\r\n";
const clients: QueryClient[] = [];
let writes: RequestInit[];
let reads: number[];
let digest: string;
let record: CustomTemplate;
let loseResponse: boolean;
let corruptCopy: boolean;
let conflict: boolean;
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <Dialog open>
        <CustomTemplatePublish
          threadId="thread"
          source={source}
          sourceSelector={null}
          onBack={() => undefined}
          onClose={() => undefined}
        />
      </Dialog>
    </QueryClientProvider>,
  );
}
async function selectPreview() {
  await screen.findByRole("option", { name: /第 1 版/ });
  fireEvent.change(screen.getByLabelText("要共享的正文版本"), {
    target: { value: "1" },
  });
  expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
  expect(reads).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "读取所选版本预览" }));
  await screen.findByLabelText("待共享正文");
  fireEvent.change(screen.getByLabelText("组织副本名称"), {
    target: { value: "组织新副本" },
  });
}
function submit() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认发布副本" }));
}
beforeEach(async () => {
  writes = [];
  reads = [];
  record = { ...source };
  loseResponse = false;
  corruptCopy = false;
  conflict = false;
  digest = await sha256Hex(new Blob([content]));
  rs.mocked(useLawThreadContext).mockReturnValue({
    data: scope,
    isError: false,
  } as ReturnType<typeof useLawThreadContext>);
  rs.mocked(useLawMatter).mockReturnValue({
    data: { title: "咨询", status: "active" },
    isError: false,
  } as ReturnType<typeof useLawMatter>);
  rs.mocked(getMatterContextByThread).mockResolvedValue(scope);
  rs.mocked(getMatter).mockResolvedValue({ status: "active" } as Awaited<
    ReturnType<typeof getMatter>
  >);
  rs.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const path =
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const meta = (number: number, target = id) => ({
      id: versionId,
      template_id: target,
      version_number: number,
      content_sha256: digest,
      byte_size: new TextEncoder().encode(content).byteLength,
    });
    let data: unknown;
    if (init?.method === "POST") {
      writes.push(init);
      if (conflict) return new Response("conflict", { status: 409 });
      if (loseResponse) {
        loseResponse = false;
        return new Response("lost", { status: 503 });
      }
      data = { template_id: copy, version: 1, current_version_number: 1 };
    } else if (/\/versions\/\d+$/.test(path)) {
      const number = Number(path.split("/").at(-1));
      reads.push(number);
      data = {
        version: meta(number, path.includes(copy) ? copy : id),
        content: path.includes(copy) && corruptCopy ? "changed" : content,
      };
    } else if (path.includes("/versions?"))
      data = { items: [meta(2), meta(1)] };
    else data = { template: { ...record } };
    return new Response(JSON.stringify({ data }));
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  rs.restoreAllMocks();
  rs.clearAllMocks();
});
describe("explicit organization template copy", () => {
  it("previews raw historical bytes, confirms and publishes only the chosen version", async () => {
    mount();
    await selectPreview();
    expect(screen.getByLabelText("待共享正文").textContent).toBe(content);
    expect(document.querySelector("script")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "确认发布副本" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(writes).toHaveLength(0);
    submit();
    await screen.findByText(/已发布组织副本并核对/);
    expect(reads).toEqual([1, 1, 1]);
    expect(JSON.parse(writes[0]!.body as string)).toEqual({
      version_number: 1,
      name: "组织新副本",
    });
    expect(record).toEqual(source);
  });
  it("clears confirmation on rename and preview on selected version change", async () => {
    mount();
    await selectPreview();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("组织副本名称"), {
      target: { value: "另一个名字" },
    });
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    fireEvent.change(screen.getByLabelText("要共享的正文版本"), {
      target: { value: "2" },
    });
    expect(screen.queryByLabelText("待共享正文")).toBeNull();
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
    expect(writes).toHaveLength(0);
  });
  it("denies shared publication to an ordinary member", async () => {
    rs.mocked(useLawThreadContext).mockReturnValue({
      data: { ...scope, tenant_role: "member" },
      isError: false,
    } as ReturnType<typeof useLawThreadContext>);
    mount();
    expect(
      screen
        .getByRole("button", { name: "确认发布副本" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("rejects revocation after preview without POST", async () => {
    mount();
    await selectPreview();
    rs.mocked(getMatterContextByThread).mockResolvedValue({
      ...scope,
      tenant_role: "member",
    });
    submit();
    await screen.findByText("项目、源模板或共享权限已变化。");
    expect(writes).toHaveLength(0);
    expect(screen.queryByLabelText("待共享正文")).toBeNull();
  });
  it("rechecks permissions after the protected source read before publishing", async () => {
    mount();
    await selectPreview();
    rs.mocked(getMatterContextByThread)
      .mockResolvedValueOnce(scope)
      .mockResolvedValueOnce({ ...scope, tenant_role: "member" });
    submit();
    await screen.findByText("项目、源模板或共享权限已变化。");
    expect(reads).toEqual([1, 1]);
    expect(writes).toHaveLength(0);
    expect(screen.queryByLabelText("待共享正文")).toBeNull();
  });
  it("rejects an archived source after preview", async () => {
    mount();
    await selectPreview();
    record = { ...record, status: "archived" };
    submit();
    await screen.findByText("项目、源模板或共享权限已变化。");
    expect(writes).toHaveLength(0);
  });
  it("rejects a new catalog revision instead of silently changing the selection", async () => {
    mount();
    await selectPreview();
    record = { ...record, version: 4 };
    submit();
    await screen.findByText(/源模板目录已有更新/);
    expect(writes).toHaveLength(0);
  });
  it("retries an uncertain publication with the same key and body after reauthorization", async () => {
    mount();
    await selectPreview();
    loseResponse = true;
    submit();
    await screen.findByText(/保存结果未确认/);
    const calls = rs.mocked(getMatterContextByThread).mock.calls.length;
    record = { ...record, version: 4 };
    fireEvent.click(screen.getByRole("button", { name: "确认发布副本" }));
    await screen.findByText(/已发布组织副本并核对/);
    expect(writes).toHaveLength(2);
    expect(writes[1]!.body).toBe(writes[0]!.body);
    expect(new Headers(writes[1]!.headers).get("Idempotency-Key")).toBe(
      new Headers(writes[0]!.headers).get("Idempotency-Key"),
    );
    expect(
      rs.mocked(getMatterContextByThread).mock.calls.length,
    ).toBeGreaterThan(calls);
  });
  it("does not report success when the protected copy readback is corrupt", async () => {
    mount();
    await selectPreview();
    corruptCopy = true;
    submit();
    await screen.findByText(/模板历史正文范围、字节或摘要不一致/);
    expect(screen.queryByText(/已发布组织副本并核对/)).toBeNull();
    expect(writes).toHaveLength(1);
  });
  it("retains the form on name conflict without attempting overwrite", async () => {
    mount();
    await selectPreview();
    conflict = true;
    submit();
    await screen.findByText(/模板已变化或名称冲突/);
    expect(screen.getByLabelText<HTMLInputElement>("组织副本名称").value).toBe(
      "组织新副本",
    );
    expect(writes).toHaveLength(1);
  });
  it("does not publish after unmount during reauthorization", async () => {
    const view = mount();
    await selectPreview();
    let resolve!: (value: TrustedMatterContext) => void;
    rs.mocked(getMatterContextByThread).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    submit();
    await waitFor(() => expect(resolve).toBeDefined());
    view.unmount();
    resolve(scope);
    await new Promise((done) => setTimeout(done, 0));
    expect(writes).toHaveLength(0);
  });
});
