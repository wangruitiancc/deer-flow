import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const threadId = "00000000-0000-0000-0000-000000000071";
const filepath = "/mnt/user-data/outputs/legal-note.md";
const content = "# 合同审核笔记\n\n这是界面测试合成材料，不包含真实案件内容。";
const sha256 = createHash("sha256").update(content).digest("hex");

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
]) {
  test(`saves a complete native artifact as an unreviewed project note at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({
      colorScheme: viewport.width < 600 ? "dark" : "light",
    });
    await page.route("**/api/**", (route) =>
      route.fulfill({
        status: 404,
        json: { detail: "Unmocked test endpoint" },
      }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: threadId,
          title: "合同审核咨询",
          artifacts: [filepath],
          messages: [
            {
              type: "ai",
              id: "synthetic-answer",
              content: "审核笔记已生成，请查看右侧成果。",
            },
          ],
        },
      ],
    });
    let saved = false;
    let multipart = "";
    let completeReads = 0;
    await page.route("**/api/law/**", async (route) => {
      const url = route.request().url();
      let data: unknown = { items: [] };
      if (url.includes("/context/by-thread/"))
        data = {
          context: {
            user_id: "default",
            tenant_id: "tenant-test",
            matter_id: "matter-test",
            matter_role: "owner",
            thread_id: threadId,
          },
        };
      else if (url.endsWith("/matters/matter-test"))
        data = { matter: { title: "合同审核咨询" } };
      else if (
        url.endsWith("/project-artifacts") &&
        route.request().method() === "POST"
      ) {
        multipart = route.request().postData() ?? "";
        saved = true;
        data = {
          artifact: { id: "artifact-test" },
          artifact_version: { version_number: 1 },
        };
      }
      await route.fulfill({ json: { data, meta: { request_id: "ui-test" } } });
    });
    await page.route("**/api/threads/*/artifacts/**", async (route) => {
      if (route.request().url().includes("download=true")) {
        completeReads++;
        expect(route.request().headers().range).toBeUndefined();
      }
      await route.fulfill({
        body: content,
        contentType: "text/markdown",
        headers: { ETag: `"${sha256}"` },
      });
    });
    await page.goto(`/workspace/chats/${threadId}`);
    await page.getByRole("button", { name: /artifacts/i }).click();
    await page.getByText("legal-note.md", { exact: true }).click();
    const saveAction = page.getByRole("button", {
      name: "保存到项目",
      exact: true,
    });
    await expect(saveAction).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("project-artifact-toolbar.png"),
      animations: "disabled",
    });
    await saveAction.click();
    const dialog = page.getByRole("dialog", {
      name: "保存到当前法律项目",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "保存未审核版本" }),
    ).toBeEnabled();
    await dialog.getByLabel("成果名称").fill("合同审核笔记");
    await dialog.getByLabel("成果类型").selectOption("note");
    await expect(dialog).toHaveCSS("opacity", "1");
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: testInfo.outputPath("project-artifact-save.png"),
      fullPage: true,
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(dialog).toBeHidden();
    expect(saved).toBe(true);
    expect(completeReads).toBe(1);
    expect(multipart).toContain(content);
    expect(multipart).toContain('name="source_revision_sha256"');
    expect(multipart).toContain(sha256);
    expect(multipart).not.toContain('name="review_status"');
  });
}
