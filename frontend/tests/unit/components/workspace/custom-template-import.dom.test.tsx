import { createHash } from "node:crypto";

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
import { CustomTemplateImport } from "@/components/workspace/law/custom-template-import";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import type { TrustedMatterContext } from "@/core/law/types";

const tid = "11111111-1111-4111-8111-111111111111";
const template = "22222222-2222-4222-8222-222222222222";
const scope = {
  tenant_id: tid,
  matter_id: "matter",
  mapping_id: "mapping",
  thread_id: "thread",
  membership_id: template,
  tenant_role: "member",
} as TrustedMatterContext;
const content =
  "\ufeff# {{title}}\r\n{{unknown}} <script>alert(1)</script>\r\n";
const sha = createHash("sha256").update(content).digest("hex");
const clients: QueryClient[] = [];
let writes: RequestInit[];
let failures: number;
let wrongReadback: boolean;
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <Dialog open>
        <CustomTemplateImport
          threadId="thread"
          sourceSelector={null}
          onClose={() => undefined}
        />
      </Dialog>
    </QueryClientProvider>,
  );
}
async function choose() {
  fireEvent.change(screen.getByLabelText(/旧模板文件/), {
    target: { files: [new File([content], "旧模板.markdown")] },
  });
  await screen.findByLabelText("新模板名称");
}
function submit() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认导入新模板" }));
}
beforeEach(() => {
  writes = [];
  failures = 0;
  wrongReadback = false;
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
  rs.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "POST") {
      writes.push(init);
      if (failures-- > 0) return new Response("unavailable", { status: 503 });
      return new Response(
        JSON.stringify({
          data: {
            template_id: template,
            version: 1,
            current_version_number: 1,
          },
        }),
      );
    }
    return new Response(
      JSON.stringify({
        data: {
          content,
          version: {
            id: tid,
            template_id: template,
            version_number: 1,
            byte_size: Buffer.byteLength(content),
            content_sha256: wrongReadback ? "a".repeat(64) : sha,
          },
        },
      }),
    );
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  rs.restoreAllMocks();
  rs.clearAllMocks();
});

describe("explicit legacy template import", () => {
  it("requires renewed explicit confirmation before an administrator shares imported bytes", async () => {
    const admin = { ...scope, tenant_role: "admin" } as TrustedMatterContext;
    rs.mocked(useLawThreadContext).mockReturnValue({
      data: admin,
      isError: false,
    } as ReturnType<typeof useLawThreadContext>);
    rs.mocked(getMatterContextByThread).mockResolvedValue(admin);
    mount();
    await choose();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("保存范围"), {
      target: { value: "shared" },
    });
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(writes).toHaveLength(0);
    submit();
    await screen.findByText(/已导入为新模板第 1 版/);
    expect(JSON.parse(writes[0]!.body as string).visibility).toBe("shared");
  });
  it("keeps a name collision as an explicit rejection, never changing the name or appending", async () => {
    rs.mocked(globalThis.fetch).mockImplementation(async (_url, init) => {
      if (init?.method === "POST") writes.push(init);
      return new Response("conflict", { status: 409 });
    });
    mount();
    await choose();
    submit();
    await screen.findByRole("alert");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!.body as string)).toEqual({
      name: "旧模板",
      content,
      visibility: "private",
    });
    expect(screen.getByRole("alert").textContent).toContain("名称冲突");
  });
  it("previews locally, requires confirmation, posts exact private bytes and verifies saved history", async () => {
    mount();
    await choose();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.getByText(/未识别，原样保留/)).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "确认导入新模板" })
        .hasAttribute("disabled"),
    ).toBe(true);
    submit();
    await screen.findByText(/已导入为新模板第 1 版/);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]!.body as string)).toEqual({
      name: "旧模板",
      content,
      visibility: "private",
    });
    expect(getMatterContextByThread).toHaveBeenCalledOnce();
  });
  it("clears confirmation when name or visibility changes and disallows shared for ordinary members", async () => {
    mount();
    await choose();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("新模板名称"), {
      target: { value: "另一个" },
    });
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(
      screen.getByRole("option", { name: /组织模板/ }).hasAttribute("disabled"),
    ).toBe(true);
  });
  it.each(["tenant", "role", "archived"])(
    "rejects fresh %s changes before writing",
    async (change) => {
      mount();
      await choose();
      if (change === "archived")
        rs.mocked(getMatter).mockResolvedValue({
          status: "archived",
        } as Awaited<ReturnType<typeof getMatter>>);
      else
        rs.mocked(getMatterContextByThread).mockResolvedValue({
          ...scope,
          ...(change === "tenant"
            ? { tenant_id: template }
            : { tenant_role: "auditor" }),
        } as TrustedMatterContext);
      submit();
      await screen.findByRole("alert");
      expect(writes).toHaveLength(0);
    },
  );
  it("reuses the same key after uncertain writes and does not overwrite existing templates", async () => {
    failures = 1;
    mount();
    await choose();
    submit();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "确认导入新模板" }));
    await screen.findByText(/已导入为新模板第 1 版/);
    expect(writes).toHaveLength(2);
    expect(new Headers(writes[0]!.headers).get("Idempotency-Key")).toBe(
      new Headers(writes[1]!.headers).get("Idempotency-Key"),
    );
  });
  it("does not claim success on corrupt protected readback", async () => {
    wrongReadback = true;
    mount();
    await choose();
    submit();
    await screen.findByRole("alert");
    expect(writes).toHaveLength(1);
    expect(screen.queryByText(/已导入为新模板第 1 版/)).toBeNull();
  });
  it("cancels an authorization wait on unmount without sending a late write", async () => {
    const view = mount();
    await choose();
    let finish!: (value: TrustedMatterContext) => void;
    rs.mocked(getMatterContextByThread).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    submit();
    await waitFor(() => expect(getMatterContextByThread).toHaveBeenCalled());
    view.unmount();
    finish(scope);
    await Promise.resolve();
    await Promise.resolve();
    expect(writes).toHaveLength(0);
  });
});
