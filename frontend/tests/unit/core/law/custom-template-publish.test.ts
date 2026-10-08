import { afterEach, describe, expect, it, rs } from "@rstest/core";

import {
  type CustomTemplate,
  publishCustomTemplateCopy,
} from "@/core/law/custom-templates";

const tenant = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const copy = "33333333-3333-4333-8333-333333333333";
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
const input = {
  tenantId: tenant,
  source,
  versionNumber: 1,
  name: "  组织副本  ",
  idempotencyKey: "same-key",
};
afterEach(() => {
  rs.restoreAllMocks();
});
describe("selected-version template publication", () => {
  it("posts just the selected version and name, never visibility mutation or private body/history", async () => {
    const fetcher = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { template_id: copy, version: 1, current_version_number: 1 },
          }),
        ),
      );
    await publishCustomTemplateCopy(input);
    expect(fetcher.mock.calls[0]![0]).toContain(`/templates/${id}/publish`);
    expect(fetcher.mock.calls[0]![1]?.method).toBe("POST");
    expect(fetcher.mock.calls[0]![1]?.cache).toBe("no-store");
    expect(
      new Headers(fetcher.mock.calls[0]![1]?.headers).get("Idempotency-Key"),
    ).toBe("same-key");
    expect(JSON.parse(fetcher.mock.calls[0]![1]?.body as string)).toEqual({
      version_number: 1,
      name: "组织副本",
    });
  });
  it.each([
    { template_id: id, version: 1, current_version_number: 1 },
    { template_id: copy, version: 2, current_version_number: 1 },
    { template_id: copy, version: 1, current_version_number: 2 },
  ])("rejects non-new-copy receipts: %j", async (data) => {
    rs.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data })),
    );
    await expect(publishCustomTemplateCopy(input)).rejects.toThrow(
      "回执不一致",
    );
  });
  it.each([
    { name: "../x" },
    { name: "\ud800" },
    { versionNumber: 0 },
    { idempotencyKey: "" },
    { source: { ...source, status: "archived" as const } },
    { tenantId: copy },
  ])("rejects invalid selection before networking: %j", async (change) => {
    const fetcher = rs.spyOn(globalThis, "fetch");
    await expect(
      publishCustomTemplateCopy({ ...input, ...change }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
