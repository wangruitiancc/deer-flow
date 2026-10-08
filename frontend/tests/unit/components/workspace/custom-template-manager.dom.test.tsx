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
import { CustomTemplateManager } from "@/components/workspace/law/custom-template-manager";
import {
  getMatter,
  getMatterContextByThread,
  useLawMatter,
  useLawThreadContext,
} from "@/core/law";
import type { CustomTemplate } from "@/core/law/custom-templates";
import type { TrustedMatterContext } from "@/core/law/types";

const tenant = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const initial: CustomTemplate = {
  id,
  tenant_id: tenant,
  owner_membership_id: id,
  visibility: "private",
  status: "active",
  name: "旧模板",
  version: 3,
  current_version_number: 2,
};
const scope = {
  tenant_id: tenant,
  matter_id: "matter",
  mapping_id: "mapping",
  thread_id: "thread",
  membership_id: id,
  tenant_role: "member",
} as TrustedMatterContext;
const clients: QueryClient[] = [];
let record: CustomTemplate;
let writes: RequestInit[];
let loseResponse: boolean;
let conflict: boolean;
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <Dialog open>
        <CustomTemplateManager
          threadId="thread"
          sourceSelector={null}
          onClose={() => undefined}
        />
      </Dialog>
    </QueryClientProvider>,
  );
}
async function choose() {
  await screen.findByRole("option", { name: /旧模板/ });
  fireEvent.change(screen.getByLabelText("管理对象"), {
    target: { value: id },
  });
}
function confirm() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
}
beforeEach(() => {
  record = { ...initial };
  writes = [];
  loseResponse = false;
  conflict = false;
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
    if (init?.method === "PATCH") {
      writes.push(init);
      if (conflict) return new Response("conflict", { status: 409 });
      const change = JSON.parse(init.body as string) as {
        name?: string;
        status?: "active" | "archived";
      };
      record = {
        ...record,
        ...(change.name ? { name: change.name } : {}),
        ...(change.status ? { status: change.status } : {}),
        version: 4,
      };
      if (loseResponse) {
        loseResponse = false;
        return new Response("lost", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          data: { template_id: id, version: 4, current_version_number: 2 },
        }),
      );
    }
    return new Response(
      JSON.stringify({
        data: path.includes("?")
          ? { items: [{ ...record }] }
          : { template: { ...record } },
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
describe("template metadata manager", () => {
  it("requires explicit confirmation for rename without reading/writing body", async () => {
    mount();
    await choose();
    fireEvent.change(screen.getByLabelText("新名称"), {
      target: { value: "改名" },
    });
    expect(
      screen.getByRole("button", { name: "确认执行" }).hasAttribute("disabled"),
    ).toBe(true);
    confirm();
    await screen.findByText(/已确认本次操作提交/);
    expect(JSON.parse(writes[0]!.body as string)).toEqual({
      expected_version: 3,
      name: "改名",
    });
    expect(record.current_version_number).toBe(2);
  });
  it("archives only after confirming the recoverable impact", async () => {
    mount();
    await choose();
    fireEvent.change(screen.getByLabelText("操作"), {
      target: { value: "archive" },
    });
    expect(screen.getByText(/历史版本和已有成果保留/)).toBeTruthy();
    expect(writes).toHaveLength(0);
    confirm();
    await screen.findByText(/已确认本次操作提交/);
    expect(record.status).toBe("archived");
  });
  it("can restore from archived metadata while preserving a same-name conflict", async () => {
    record.status = "archived";
    conflict = true;
    mount();
    fireEvent.change(screen.getByLabelText("目录范围"), {
      target: { value: "archived" },
    });
    await choose();
    confirm();
    await screen.findByRole("alert");
    expect(record.status).toBe("archived");
    expect(JSON.parse(writes[0]!.body as string)).toEqual({
      expected_version: 3,
      status: "active",
    });
  });
  it("does not silently adopt a fresh version on first submission", async () => {
    mount();
    await choose();
    record.version = 4;
    fireEvent.change(screen.getByLabelText("新名称"), {
      target: { value: "改名" },
    });
    confirm();
    await screen.findByRole("alert");
    expect(writes).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("模板已有更新");
  });
  it("reauthorizes and replays the same key after a committed but lost archive response", async () => {
    mount();
    await choose();
    loseResponse = true;
    fireEvent.change(screen.getByLabelText("操作"), {
      target: { value: "archive" },
    });
    confirm();
    await screen.findByRole("alert");
    expect(record.status).toBe("archived");
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    await screen.findByText(/已确认本次操作提交/);
    expect(writes).toHaveLength(2);
    expect(writes[0]!.body).toBe(writes[1]!.body);
    expect(new Headers(writes[0]!.headers).get("Idempotency-Key")).toBe(
      new Headers(writes[1]!.headers).get("Idempotency-Key"),
    );
    expect(getMatterContextByThread).toHaveBeenCalledTimes(2);
  });
  it("rejects revocation before any write", async () => {
    mount();
    await choose();
    rs.mocked(getMatterContextByThread).mockResolvedValue({
      ...scope,
      tenant_role: "auditor",
    });
    fireEvent.change(screen.getByLabelText("新名称"), {
      target: { value: "改名" },
    });
    confirm();
    await screen.findByRole("alert");
    expect(writes).toHaveLength(0);
  });
  it("cancels a pending authorization when unmounted", async () => {
    const view = mount();
    await choose();
    let release!: (value: TrustedMatterContext) => void;
    rs.mocked(getMatterContextByThread).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    fireEvent.change(screen.getByLabelText("新名称"), {
      target: { value: "改名" },
    });
    confirm();
    await waitFor(() => expect(getMatterContextByThread).toHaveBeenCalled());
    view.unmount();
    release(scope);
    await Promise.resolve();
    await Promise.resolve();
    expect(writes).toHaveLength(0);
  });
});
