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
  useThread: rs.fn(),
}));

import { Dialog } from "@/components/ui/dialog";
import { CustomTemplateCreate } from "@/components/workspace/law/custom-template-create";
import { useThread } from "@/components/workspace/messages/context";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import { sha256Hex } from "@/core/law/api";
import type { TrustedMatterContext } from "@/core/law/types";

const tenant = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const version = "33333333-3333-4333-8333-333333333333";
const scope = {
  tenant_id: tenant,
  matter_id: "matter",
  mapping_id: "mapping",
  thread_id: "thread",
  membership_id: id,
  tenant_role: "member",
} as TrustedMatterContext;
const clients: QueryClient[] = [];
let writes: RequestInit[];
let reads: number;
let lost: boolean;
let corrupt: boolean;
let conflict: boolean;
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <Dialog open>
        <CustomTemplateCreate
          threadId="thread"
          sourceSelector={null}
          onBack={() => undefined}
          onClose={() => undefined}
        />
      </Dialog>
    </QueryClientProvider>,
  );
}
function fill() {
  fireEvent.change(screen.getByLabelText("模板名称"), {
    target: { value: "新空白模板" },
  });
}
function submit() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认新建" }));
}
beforeEach(async () => {
  writes = [];
  reads = 0;
  lost = false;
  corrupt = false;
  conflict = false;
  const hash = await sha256Hex(new Blob([""]));
  rs.mocked(useThread).mockReturnValue({
    thread: { isLoading: false },
    isMock: false,
  } as ReturnType<typeof useThread>);
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
      if (conflict) return new Response("conflict", { status: 409 });
      if (lost) {
        lost = false;
        return new Response("lost", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          data: { template_id: id, version: 1, current_version_number: 1 },
        }),
      );
    }
    reads++;
    return new Response(
      JSON.stringify({
        data: {
          content: corrupt ? "bad" : "",
          version: {
            id: version,
            template_id: id,
            version_number: 1,
            byte_size: 0,
            content_sha256: hash,
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
describe("blank template create form", () => {
  it("defaults private, waits for confirmation and verifies empty first version", async () => {
    mount();
    fill();
    expect(screen.getByLabelText<HTMLSelectElement>("可见范围").value).toBe(
      "private",
    );
    expect(
      screen.getByRole("button", { name: "确认新建" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(writes).toHaveLength(0);
    expect(reads).toBe(0);
    submit();
    await screen.findByText(/已新建模板第 1 版/);
    expect(JSON.parse(writes[0]!.body as string)).toEqual({
      name: "新空白模板",
      visibility: "private",
      content: "",
    });
    expect(reads).toBe(1);
    expect(screen.queryByRole("button", { name: "确认新建" })).toBeNull();
  });
  it("clears confirmation on name and visibility changes", () => {
    rs.mocked(useLawThreadContext).mockReturnValue({
      data: { ...scope, tenant_role: "admin" },
      isError: false,
    } as ReturnType<typeof useLawThreadContext>);
    mount();
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("模板名称"), {
      target: { value: "另一个名字" },
    });
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("可见范围"), {
      target: { value: "shared" },
    });
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(writes).toHaveLength(0);
  });
  it("creates shared only after current admin authorization", async () => {
    const admin = { ...scope, tenant_role: "admin" as const };
    rs.mocked(useLawThreadContext).mockReturnValue({
      data: admin,
      isError: false,
    } as ReturnType<typeof useLawThreadContext>);
    rs.mocked(getMatterContextByThread).mockResolvedValue(admin);
    mount();
    fill();
    fireEvent.change(screen.getByLabelText("可见范围"), {
      target: { value: "shared" },
    });
    submit();
    await screen.findByText(/已新建模板第 1 版/);
    expect(JSON.parse(writes[0]!.body as string)).toEqual({
      name: "新空白模板",
      content: "",
      visibility: "shared",
    });
  });
  it("rejects an ordinary member's forced shared selection", () => {
    mount();
    fill();
    fireEvent.change(screen.getByLabelText("可见范围"), {
      target: { value: "shared" },
    });
    submit();
    expect(
      screen.getByRole("button", { name: "确认新建" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(writes).toHaveLength(0);
  });
  it.each([
    { ...scope, tenant_role: "auditor" as const },
    { ...scope, mapping_id: "changed" },
  ])("rejects changed authority before POST: %j", async (fresh) => {
    mount();
    fill();
    rs.mocked(getMatterContextByThread).mockResolvedValue(fresh);
    submit();
    await screen.findByText(/项目归属或模板权限已变化/);
    expect(writes).toHaveLength(0);
  });
  it("rejects an archived project", async () => {
    mount();
    fill();
    rs.mocked(getMatter).mockResolvedValue({ status: "archived" } as Awaited<
      ReturnType<typeof getMatter>
    >);
    submit();
    await screen.findByText(/项目归属或模板权限已变化/);
    expect(writes).toHaveLength(0);
  });
  it("retries a lost create response with identical key and payload", async () => {
    mount();
    fill();
    lost = true;
    submit();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "确认新建" }));
    await screen.findByText(/已新建模板第 1 版/);
    expect(writes).toHaveLength(2);
    expect(writes[0]!.body).toBe(writes[1]!.body);
    expect(new Headers(writes[0]!.headers).get("Idempotency-Key")).toBe(
      new Headers(writes[1]!.headers).get("Idempotency-Key"),
    );
    expect(getMatterContextByThread).toHaveBeenCalledTimes(2);
  });
  it("does not claim success when protected readback is corrupt", async () => {
    mount();
    fill();
    corrupt = true;
    submit();
    await screen.findByRole("alert");
    expect(screen.queryByText(/已新建模板第 1 版/)).toBeNull();
    expect(writes).toHaveLength(1);
    corrupt = false;
    fireEvent.click(screen.getByRole("button", { name: "确认新建" }));
    await screen.findByText(/已新建模板第 1 版/);
    expect(new Headers(writes[0]!.headers).get("Idempotency-Key")).toBe(
      new Headers(writes[1]!.headers).get("Idempotency-Key"),
    );
  });
  it("preserves input on name conflict without overwriting", async () => {
    mount();
    fill();
    conflict = true;
    submit();
    await screen.findByRole("alert");
    expect(screen.getByLabelText<HTMLInputElement>("模板名称").value).toBe(
      "新空白模板",
    );
    expect(writes).toHaveLength(1);
  });
  it("cancels late creation after unmount", async () => {
    const view = mount();
    fill();
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
  it("does not create while a run is active", () => {
    rs.mocked(useThread).mockReturnValue({
      thread: { isLoading: true },
      isMock: false,
    } as ReturnType<typeof useThread>);
    mount();
    expect(
      screen.getByRole("button", { name: "确认新建" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(writes).toHaveLength(0);
  });
});
