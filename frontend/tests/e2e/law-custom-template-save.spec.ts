import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const threadId = "00000000-0000-4000-8000-000000000081";
const tenant = "00000000-0000-4000-8000-000000000082";
const member = "00000000-0000-4000-8000-000000000083";
const filepath = "/mnt/user-data/outputs/legal-template.md";
const content = "# {{title}}\n\n合成法律模板：{{case}}\n\n事实日期：待填写";
const digest = createHash("sha256").update(content).digest("hex");

for (const width of [320, 768, 1024, 1440]) {
  test(`saves native Markdown as a private template at ${width}px`, async ({
    page,
  }, testInfo) => {
    const browserErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({
      colorScheme: width < 1024 ? "dark" : "light",
      reducedMotion: "reduce",
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
          title: "模板合成验收",
          artifacts: [filepath],
          messages: [
            {
              type: "ai",
              id: "synthetic-answer",
              content: "请查看右侧模板草稿。",
            },
          ],
        },
      ],
    });
    let writes = 0;
    let reads = 0;
    await page.route("**/api/law/**", async (route) => {
      const url = new URL(route.request().url());
      let data: unknown = { items: [] };
      if (url.pathname.includes("/context/by-thread/"))
        data = {
          context: {
            user_id: "default",
            tenant_id: tenant,
            membership_id: member,
            tenant_role: "member",
            matter_id: "matter",
            matter_role: "lawyer",
            mapping_id: "mapping",
            thread_id: threadId,
          },
        };
      else if (url.pathname.endsWith("/matters/matter"))
        data = { matter: { title: "模板合成验收", status: "active" } };
      else if (
        url.pathname.endsWith("/templates") &&
        route.request().method() === "POST"
      ) {
        const payload = route.request().postDataJSON() as Record<
          string,
          unknown
        >;
        expect(payload).toEqual({
          name: "合同审查通用模板",
          content,
          visibility: "private",
        });
        expect(route.request().headers()["idempotency-key"]).toBeTruthy();
        writes++;
        data = { template_id: member, version: 1, current_version_number: 1 };
      }
      await route.fulfill({
        json: { data, meta: { request_id: "synthetic-ui" } },
      });
    });
    await page.route("**/api/threads/*/artifacts/**", async (route) => {
      if (route.request().url().includes("download=true")) {
        reads++;
        expect(route.request().headers().range).toBeUndefined();
      }
      await route.fulfill({
        body: content,
        contentType: "text/markdown",
        headers: { ETag: `"${digest}"` },
      });
    });
    await page.goto(`/workspace/chats/${threadId}`);
    await page.getByRole("button", { name: /artifacts/i }).click();
    await page.getByText("legal-template.md", { exact: true }).click();
    const action = page.getByRole("button", {
      name: "保存为模板",
      exact: true,
    });
    await expect(action).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath("template-toolbar.png"),
      animations: "disabled",
    });
    await action.click();
    const dialog = page.getByRole("dialog", {
      name: "保存为模板",
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "保存模板版本" }),
    ).toBeEnabled();
    expect(writes).toBe(0);
    await dialog.getByLabel("模板名称").fill("合同审查通用模板");
    await expect(dialog.getByLabel("模板名称")).toBeFocused();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(dialog).toHaveCSS("opacity", "1");
    await page.screenshot({
      path: testInfo.outputPath("template-dialog.png"),
      animations: "disabled",
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "保存模板版本" }).click();
    await expect(dialog).toBeHidden();
    expect(writes).toBe(1);
    expect(reads).toBe(1);
    await expect(page.getByText(/已保存模板第 1 版/)).toBeVisible();
    await testInfo.attach("browser-errors", {
      body: JSON.stringify(browserErrors),
      contentType: "application/json",
    });
    await testInfo.attach("console-errors", {
      body: JSON.stringify(consoleErrors),
      contentType: "application/json",
    });
    expect(browserErrors).toEqual([]);
    expect(
      consoleErrors.filter(
        (message) => !message.includes("Failed to load resource"),
      ),
    ).toEqual([]);
  });
}
