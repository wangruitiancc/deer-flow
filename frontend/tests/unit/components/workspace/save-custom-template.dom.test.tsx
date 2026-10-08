import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { toast } from "sonner";

rs.mock("@/core/law", () => ({
  useLawThreadContext: rs.fn(),
  getMatter: rs.fn(),
  getMatterContextByThread: rs.fn(),
}));
rs.mock("@/core/law/artifact-source", () => ({
  isFormalProjectArtifact: (path: string) =>
    path.startsWith("/mnt/user-data/outputs/"),
  loadProjectArtifactSource: rs.fn(),
}));
rs.mock("sonner", () => ({ toast: { success: rs.fn() } }));

import { SaveCustomTemplate } from "@/components/workspace/law/save-custom-template";
import {
  getMatter,
  getMatterContextByThread,
  useLawThreadContext,
} from "@/core/law";
import { loadProjectArtifactSource } from "@/core/law/artifact-source";
import type { TrustedMatterContext } from "@/core/law/types";

const tenant = "11111111-1111-4111-8111-111111111111";
const tid = "22222222-2222-4222-8222-222222222222";
const scope = {
  tenant_id: tenant,
  matter_id: "matter",
  thread_id: "thread",
  mapping_id: "mapping",
  membership_id: tid,
  tenant_role: "member",
} as TrustedMatterContext;
const clients: QueryClient[] = [];
let writes: RequestInit[];
let failWrite = false;
function mount(blockedReason?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <SaveCustomTemplate
        threadId="thread"
        filepath="/mnt/user-data/outputs/note.md"
        expectedSha256={"a".repeat(64)}
        blockedReason={blockedReason}
      />
    </QueryClientProvider>,
  );
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "保存为模板" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "保存模板版本" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
}
beforeEach(() => {
  writes = [];
  failWrite = false;
  rs.mocked(useLawThreadContext).mockReturnValue({
    data: scope,
    isError: false,
  } as ReturnType<typeof useLawThreadContext>);
  rs.mocked(getMatterContextByThread).mockResolvedValue(scope);
  rs.mocked(getMatter).mockResolvedValue({ status: "active" } as Awaited<
    ReturnType<typeof getMatter>
  >);
  rs.mocked(loadProjectArtifactSource).mockResolvedValue({
    file: new File(["\uFEFF{{title}}\n原文"], "note.md"),
    sha256: "a".repeat(64),
  });
  rs.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (init?.method === "POST") {
      writes.push(init);
      if (failWrite) return new Response("unavailable", { status: 503 });
      return new Response(
        JSON.stringify({
          data: { template_id: tid, version: 1, current_version_number: 1 },
        }),
      );
    }
    return new Response(JSON.stringify({ data: { items: [] } }));
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  rs.restoreAllMocks();
  rs.clearAllMocks();
});

describe("save native Markdown as template", () => {
  it("does not advance the selected revision when the query refreshes in the background", async () => {
    const existing = {
      id: tid,
      tenant_id: tenant,
      owner_membership_id: tid,
      name: "已有模板",
      visibility: "private",
      status: "active",
      version: 2,
      current_version_number: 1,
    };
    rs.mocked(globalThis.fetch).mockImplementation(
      async () => new Response(JSON.stringify({ data: { items: [existing] } })),
    );
    mount();
    await open();
    fireEvent.change(screen.getByLabelText("保存位置"), {
      target: { value: tid },
    });
    clients.at(-1)!.setQueryData(["law", "custom-templates", tenant], {
      pages: [[{ ...existing, version: 3, current_version_number: 2 }]],
      pageParams: [0],
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "保存模板版本" })
          .hasAttribute("disabled"),
      ).toBe(true),
    );
    expect(screen.getByRole("status").textContent).toContain("目录已更新");
    expect(writes).toHaveLength(0);
  });
  for (const changed of [false, true]) {
    it(`checks an existing template revision before appending (changed=${changed})`, async () => {
      const existing = {
        id: tid,
        tenant_id: tenant,
        owner_membership_id: tid,
        name: "已有模板",
        visibility: "private",
        status: "active",
        version: 2,
        current_version_number: 1,
      };
      rs.mocked(globalThis.fetch).mockImplementation(async (url, init) => {
        if (init?.method === "PATCH") {
          writes.push(init);
          return new Response(
            JSON.stringify({
              data: { template_id: tid, version: 3, current_version_number: 2 },
            }),
          );
        }
        return new Response(
          JSON.stringify({
            data: (typeof url === "string"
              ? url
              : url instanceof URL
                ? url.href
                : url.url
            ).endsWith(`/${tid}`)
              ? { template: { ...existing, version: changed ? 3 : 2 } }
              : { items: [existing] },
          }),
        );
      });
      mount();
      await open();
      fireEvent.change(screen.getByLabelText("保存位置"), {
        target: { value: tid },
      });
      fireEvent.click(screen.getByRole("button", { name: "保存模板版本" }));
      if (changed) {
        await waitFor(() =>
          expect(screen.getByRole("alert").textContent).toContain(
            "模板已有更新",
          ),
        );
        expect(writes).toHaveLength(0);
      } else {
        await waitFor(() => expect(writes).toHaveLength(1));
        expect(JSON.parse(writes[0]!.body as string)).toMatchObject({
          expected_version: 2,
        });
      }
    });
  }
  it("blocks unsaved source and does not fetch template data", () => {
    mount("请先保存文件");
    expect(
      screen
        .getByRole("button", { name: "保存为模板" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("preserves BOM and template variables, reauthorizes and requires an explicit save", async () => {
    mount();
    await open();
    expect(writes).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "保存模板版本" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(JSON.parse(writes[0]!.body as string)).toMatchObject({
      content: "\uFEFF{{title}}\n原文",
      visibility: "private",
    });
    expect(getMatterContextByThread).toHaveBeenCalledTimes(2);
    expect(loadProjectArtifactSource).toHaveBeenCalledWith(
      expect.objectContaining({
        maxBytes: 65536,
        allowEmpty: true,
        expectedSha256: "a".repeat(64),
      }),
    );
  });
  it("refuses changed project scope before reading or saving a file", async () => {
    rs.mocked(getMatterContextByThread).mockResolvedValue({
      ...scope,
      mapping_id: "rebound",
    });
    mount();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "保存模板版本" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("权限已变化"),
    );
    expect(writes).toHaveLength(0);
    expect(loadProjectArtifactSource).not.toHaveBeenCalled();
  });
  it("reuses the same key after an uncertain write failure", async () => {
    failWrite = true;
    mount();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "保存模板版本" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "保存模板版本" }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(new Headers(writes[0]!.headers).get("Idempotency-Key")).toBe(
      new Headers(writes[1]!.headers).get("Idempotency-Key"),
    );
  });
  it("does not post a late file read after close", async () => {
    let release!: (
      value: Awaited<ReturnType<typeof loadProjectArtifactSource>>,
    ) => void;
    rs.mocked(loadProjectArtifactSource).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    mount();
    await open();
    fireEvent.click(screen.getByRole("button", { name: "保存模板版本" }));
    await waitFor(() => expect(loadProjectArtifactSource).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    release({ file: new File(["late"], "note.md"), sha256: "a".repeat(64) });
    await waitFor(() =>
      expect(getMatterContextByThread).toHaveBeenCalledTimes(2),
    );
    expect(writes).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
