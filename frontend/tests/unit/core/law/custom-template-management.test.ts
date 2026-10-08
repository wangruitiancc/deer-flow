import { afterEach, describe, expect, it, rs } from "@rstest/core";

import {
  canManageCustomTemplate,
  changeCustomTemplateMetadata,
  type CustomTemplate,
  listCustomTemplates,
} from "@/core/law/custom-templates";
import type { TrustedMatterContext } from "@/core/law/types";

const tenant = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const target: CustomTemplate = {
  id,
  tenant_id: tenant,
  owner_membership_id: id,
  visibility: "private",
  status: "active",
  name: "模板",
  version: 3,
  current_version_number: 2,
};
const scope = {
  tenant_id: tenant,
  membership_id: id,
  tenant_role: "member",
} as TrustedMatterContext;
afterEach(() => {
  rs.restoreAllMocks();
});
describe("template metadata management transport", () => {
  it("requests archived metadata explicitly without changing normal picker queries", async () => {
    const fetcher = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [target] } })),
      );
    await listCustomTemplates(tenant, 100, undefined, true);
    expect(fetcher.mock.calls[0]![0]).toContain(
      "offset=100&include_archived=true",
    );
    expect(fetcher.mock.calls[0]![1]?.cache).toBe("no-store");
  });
  it.each([{ name: "新名" }, { status: "archived" as const }])(
    "changes only metadata with pinned revision: %j",
    async (change) => {
      const fetcher = rs.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                template_id: id,
                version: 4,
                current_version_number: 2,
              },
            }),
          ),
      );
      await changeCustomTemplateMetadata({
        tenantId: tenant,
        target,
        change,
        idempotencyKey: "same",
      });
      expect(JSON.parse(fetcher.mock.calls[0]![1]?.body as string)).toEqual({
        expected_version: 3,
        ...change,
      });
      expect(
        new Headers(fetcher.mock.calls[0]![1]?.headers).get("Idempotency-Key"),
      ).toBe("same");
    },
  );
  it("allows the same owner to restore archived metadata but not another admin to manage private data", () => {
    expect(
      canManageCustomTemplate(scope, { ...target, status: "archived" }),
    ).toBe(true);
    expect(
      canManageCustomTemplate(
        { ...scope, membership_id: tenant, tenant_role: "admin" },
        target,
      ),
    ).toBe(false);
    expect(
      canManageCustomTemplate(scope, { ...target, visibility: "shared" }),
    ).toBe(false);
    expect(
      canManageCustomTemplate(
        { ...scope, tenant_role: "admin" },
        { ...target, visibility: "shared", status: "archived" },
      ),
    ).toBe(true);
  });
  it.each([
    { name: "../x" },
    { name: "\ud800" },
    { name: "" },
    { name: "new", content: "body" },
    { name: "new", status: "archived" },
    { status: "active" },
  ])("rejects invalid/mixed changes before a write %j", async (change) => {
    const fetcher = rs.spyOn(globalThis, "fetch");
    await expect(
      changeCustomTemplateMetadata({
        tenantId: tenant,
        target,
        change: change as { name: string },
        idempotencyKey: "key",
      }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a receipt that claims body version advancement", async () => {
    rs.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { template_id: id, version: 4, current_version_number: 3 },
        }),
      ),
    );
    await expect(
      changeCustomTemplateMetadata({
        tenantId: tenant,
        target,
        change: { name: "new" },
        idempotencyKey: "key",
      }),
    ).rejects.toThrow("回执");
  });
});
