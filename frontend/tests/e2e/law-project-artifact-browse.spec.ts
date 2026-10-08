import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const threadId = "00000000-0000-0000-0000-000000000072";
const texts = [
  "# 原始版本笔记\n\n这是第一版。",
  "# 更新版本笔记\n\n这是第二版。",
];
const artifact = {
  id: "saved-note",
  tenant_id: "tenant-test",
  matter_id: "matter-test",
  kind: "note",
  title: "项目咨询笔记",
  status: "active",
  current_version_number: 2,
  version: 2,
};
const versions = texts.map((content, index) => ({
  id: `v${index + 1}`,
  tenant_id: artifact.tenant_id,
  matter_id: artifact.matter_id,
  project_artifact_id: artifact.id,
  version_number: index + 1,
  source_thread_id: "deleted-source",
  source_artifact_path: "/mnt/user-data/outputs/note.md",
  source_revision_sha256: createHash("sha256").update(content).digest("hex"),
  source_provenance: "client_asserted",
  original_filename: "note.md",
  media_type: "text/markdown",
  byte_size: Buffer.byteLength(content),
  sha256: createHash("sha256").update(content).digest("hex"),
  review_status: "unreviewed",
  created_at: "2026-09-06T00:00:00Z",
}));

for (const width of [1280, 390]) {
  test(`browses project history from a thread with no temporary files at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 720 });
    await page.emulateMedia({ colorScheme: width < 600 ? "dark" : "light" });
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, json: { detail: "Unmocked" } }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: threadId,
          title: "后续咨询",
          artifacts: [],
          messages: [
            {
              id: "answer",
              type: "ai",
              content: "可以查看本项目其他会话保存的笔记。",
            },
          ],
        },
      ],
    });
    let contentReads = 0;
    let revoked = false;
    await page.route("**/api/law/**", async (route) => {
      const url = route.request().url();
      let data: unknown = { items: [] };
      if (url.endsWith(`/context/by-thread/${threadId}`))
        data = {
          context: {
            user_id: "default",
            tenant_id: artifact.tenant_id,
            matter_id: artifact.matter_id,
            matter_role: "owner",
            thread_id: threadId,
          },
        };
      else if (
        url.endsWith("/context/by-thread/deleted-source") ||
        (revoked && url.includes("/content"))
      ) {
        await route.fulfill({
          status: 404,
          json: {
            error: { code: "RESOURCE_NOT_FOUND", message: "当前无访问权限" },
          },
        });
        return;
      } else if (url.endsWith("/project-artifacts"))
        data = { items: [artifact] };
      else if (url.endsWith("/versions")) data = { items: versions };
      else if (url.endsWith("/content")) {
        contentReads++;
        const index = url.includes("/v1/") ? 0 : 1;
        await route.fulfill({
          body: texts[index],
          contentType: "text/markdown",
        });
        return;
      }
      await route.fulfill({ json: { data, meta: { request_id: "test" } } });
    });
    await page.goto(`/workspace/chats/${threadId}`);
    await page.getByRole("button", { name: /artifacts/i }).click();
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: /项目咨询笔记/ }).click();
    await expect(
      page.getByRole("heading", { name: "更新版本笔记" }),
    ).toBeVisible();
    await page.getByLabel("历史版本").selectOption("v1");
    await expect(
      page.getByRole("heading", { name: "原始版本笔记" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "更新版本笔记" }),
    ).toBeHidden();
    expect(contentReads).toBe(2);
    await page.getByRole("button", { name: "来源会话" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "来源会话已不可用" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "原始版本笔记" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("project-artifact-history.png"),
      animations: "disabled",
    });
    revoked = true;
    await page.getByRole("button", { name: "下载此版本" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "当前无访问权限" }),
    ).toBeVisible();
  });
}
