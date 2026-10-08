import { afterEach, describe, expect, it, rs } from "@rstest/core";

import { loadProjectArtifactSource } from "@/core/law/artifact-source";
import {
  canWriteCustomTemplate,
  CUSTOM_TEMPLATE_OPEN_PROMPT,
  customTemplateSelectionFile,
  getCustomTemplate,
  listCustomTemplates,
  listCustomTemplateVersions,
  readCustomTemplateVersion,
  saveCustomTemplate,
} from "@/core/law/custom-templates";
import type { TrustedMatterContext } from "@/core/law/types";

const tenant = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const owner = "33333333-3333-4333-8333-333333333333";
const item = {
  id,
  tenant_id: tenant,
  owner_membership_id: owner,
  name: "模板",
  status: "active" as const,
  visibility: "private" as const,
  version: 2,
  current_version_number: 1,
};
afterEach(() => {
  rs.restoreAllMocks();
});

describe("custom template transport", () => {
  it.each([{ template_id: tenant }, { version_number: 2 }, { byte_size: 4 }])(
    "rejects a wrong historical readback identity/size %j",
    async (override) => {
      rs.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              content: "abc",
              version: {
                id: owner,
                template_id: id,
                version_number: 1,
                byte_size: 3,
                content_sha256:
                  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                ...override,
              },
            },
          }),
        ),
      );
      await expect(readCustomTemplateVersion(tenant, id, 1)).rejects.toThrow(
        "不一致",
      );
    },
  );
  it("loads metadata-only version pages with scope and duplicate checks", async () => {
    const version = {
      id: owner,
      template_id: id,
      version_number: 2,
      byte_size: 3,
      content_sha256: "a".repeat(64),
    };
    const fetcher = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [version] } })),
      );
    expect(await listCustomTemplateVersions(tenant, id, 100)).toEqual([
      version,
    ]);
    expect(fetcher.mock.calls[0]![0]).toContain(
      "/versions?limit=100&offset=100",
    );
    expect(fetcher.mock.calls[0]![1]?.cache).toBe("no-store");
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { items: [{ ...version, template_id: tenant }] },
        }),
      ),
    );
    await expect(listCustomTemplateVersions(tenant, id)).rejects.toThrow(
      "范围不一致",
    );
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ data: { items: [version, version] } })),
    );
    await expect(listCustomTemplateVersions(tenant, id)).rejects.toThrow(
      "范围不一致",
    );
  });
  it("keeps private template identifiers in an ephemeral selection file, not persisted prompt text", async () => {
    const file = customTemplateSelectionFile(id, 2);
    expect(file.name).toBe("模板选择.json");
    expect(JSON.parse(await file.text())).toEqual({
      template_id: id,
      version_number: 2,
    });
    expect(CUSTOM_TEMPLATE_OPEN_PROMPT).not.toContain(id);
    expect(CUSTOM_TEMPLATE_OPEN_PROMPT).toContain("law_open_custom_template");
    expect(() => customTemplateSelectionFile("../file", 1)).toThrow();
    expect(() => customTemplateSelectionFile(id, 0)).toThrow();
  });
  it("checks scope and validates catalog responses instead of trusting arbitrary API data", async () => {
    const fetcher = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: { items: [item] } })),
      );
    expect(await listCustomTemplates(tenant)).toEqual([item]);
    expect(fetcher.mock.calls[0]![1]?.cache).toBe("no-store");
    fetcher.mockResolvedValue(
      new Response(
        JSON.stringify({ data: { template: { ...item, tenant_id: id } } }),
      ),
    );
    await expect(getCustomTemplate(tenant, id)).rejects.toThrow("范围不一致");
  });
  it("sends exact content and an optimistic version, keeping the same supplied retry key", async () => {
    const fetcher = rs.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              template_id: id,
              version: 3,
              current_version_number: 2,
            },
          }),
        ),
    );
    const input = {
      tenantId: tenant,
      target: item,
      name: item.name,
      content: "\uFEFF{{title}}\n原文",
      visibility: "private" as const,
      idempotencyKey: "same",
    };
    await saveCustomTemplate(input);
    await saveCustomTemplate(input);
    expect(JSON.parse(fetcher.mock.calls[0]![1]?.body as string)).toEqual({
      content: input.content,
      expected_version: 2,
    });
    expect(
      new Headers(fetcher.mock.calls[1]![1]?.headers).get("Idempotency-Key"),
    ).toBe("same");
  });
  it("keeps personal ownership separate from organization administrator access", () => {
    const scope = {
      tenant_id: tenant,
      membership_id: owner,
      tenant_role: "member",
    } as TrustedMatterContext;
    expect(canWriteCustomTemplate(scope, item)).toBe(true);
    expect(
      canWriteCustomTemplate(scope, { ...item, visibility: "shared" }),
    ).toBe(false);
    expect(
      canWriteCustomTemplate(
        { ...scope, tenant_role: "admin", membership_id: id },
        item,
      ),
    ).toBe(false);
    expect(
      canWriteCustomTemplate({ ...scope, tenant_role: "auditor" }, item),
    ).toBe(false);
  });
  it("rejects path names and oversized UTF-8 content before network writes", async () => {
    const fetcher = rs.spyOn(globalThis, "fetch");
    const input = {
      tenantId: tenant,
      name: "../bad",
      content: "",
      visibility: "private" as const,
      idempotencyKey: "key",
    };
    await expect(saveCustomTemplate(input)).rejects.toThrow("名称");
    await expect(
      saveCustomTemplate({
        ...input,
        name: "valid",
        content: "中".repeat(22000),
      }),
    ).rejects.toThrow("64 KiB");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("allows empty template sources explicitly, without relaxing existing project source rules", async () => {
    const fetcher = rs
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(new Blob([])));
    const source = {
      threadId: "t",
      filepath: "/mnt/user-data/outputs/blank.md",
      maxBytes: 65536,
    };
    expect(
      (await loadProjectArtifactSource({ ...source, allowEmpty: true })).file
        .size,
    ).toBe(0);
    await expect(loadProjectArtifactSource(source)).rejects.toThrow("为空");
    fetcher.mockImplementation(async () => new Response("x".repeat(65537)));
    await expect(
      loadProjectArtifactSource({ ...source, allowEmpty: true }),
    ).rejects.toThrow("65536");
  });
});
