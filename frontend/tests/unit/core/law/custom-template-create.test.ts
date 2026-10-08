import { afterEach, describe, expect, it, rs } from "@rstest/core";

import { sha256Hex } from "@/core/law/api";
import { createBlankCustomTemplate } from "@/core/law/custom-template-create";

const tenant = "11111111-1111-4111-8111-111111111111";
const template = "22222222-2222-4222-8222-222222222222";
const version = "33333333-3333-4333-8333-333333333333";
const input = {
  tenantId: tenant,
  name: "空白模板",
  visibility: "private" as const,
  idempotencyKey: "same-key",
};
afterEach(() => {
  rs.restoreAllMocks();
});
describe("blank template creation", () => {
  it("creates exact empty content then verifies the protected first version without forwarding extra fields", async () => {
    const sha = await sha256Hex(new Blob([""]));
    const fetcher = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              template_id: template,
              version: 1,
              current_version_number: 1,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              content: "",
              version: {
                id: version,
                template_id: template,
                version_number: 1,
                content_sha256: sha,
                byte_size: 0,
              },
            },
          }),
        ),
      );
    const extraInput = {
      ...input,
      content: "must not send",
      target: { id: template },
    };
    await createBlankCustomTemplate(extraInput);
    expect(fetcher.mock.calls[0]![1]?.method).toBe("POST");
    expect(JSON.parse(fetcher.mock.calls[0]![1]?.body as string)).toEqual({
      name: "空白模板",
      content: "",
      visibility: "private",
    });
    expect(
      new Headers(fetcher.mock.calls[0]![1]?.headers).get("Idempotency-Key"),
    ).toBe("same-key");
    expect(fetcher.mock.calls[1]![0]).toContain(
      `/templates/${template}/versions/1`,
    );
  });
  it.each([
    { version: 2, current_version_number: 1 },
    { version: 1, current_version_number: 2 },
  ])("rejects non-new first-version receipts %j", async (fields) => {
    const fetcher = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { template_id: template, ...fields } }),
        ),
      );
    await expect(createBlankCustomTemplate(input)).rejects.toThrow(
      "不是模板第一版",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects a correctly hashed but nonempty first version", async () => {
    const sha = await sha256Hex(new Blob([" "]));
    rs.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              template_id: template,
              version: 1,
              current_version_number: 1,
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              content: " ",
              version: {
                id: version,
                template_id: template,
                version_number: 1,
                content_sha256: sha,
                byte_size: 1,
              },
            },
          }),
        ),
      );
    await expect(createBlankCustomTemplate(input)).rejects.toThrow(
      "不是空白正文",
    );
  });
  it.each(["../escape", "", "\ud800"])(
    'rejects invalid names "%s" before writing',
    async (name) => {
      const fetcher = rs.spyOn(globalThis, "fetch");
      await expect(
        createBlankCustomTemplate({ ...input, name }),
      ).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
