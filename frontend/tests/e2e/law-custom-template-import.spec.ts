import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const thread = "00000000-0000-4000-8000-000000000121";
const tenant = "00000000-0000-4000-8000-000000000122";
const template = "00000000-0000-4000-8000-000000000123";
const content =
  "\ufeff# {{title}}\r\n\r\n项目：{{case}}\r\n时间：{{date:YYYY年MM月DD日}}\r\n未知：{{unknown}}\r\n<script>window.importExecuted=true</script>\r\n";
const digest = createHash("sha256").update(content).digest("hex");

for (const width of [320, 768, 1024, 1440]) {
  test(`imports an exact legacy template after explicit confirmation at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 600 : 900 });
    await page.emulateMedia({
      reducedMotion: "reduce",
      colorScheme: width < 1024 ? "dark" : "light",
    });
    const errors: string[] = [];
    const writes: unknown[] = [];
    let contentReads = 0;
    let runsOrUploads = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        !message.text().includes("Failed to load resource")
      )
        errors.push(message.text());
    });
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        /\/uploads$|\/runs\/stream/.test(new URL(request.url()).pathname)
      )
        runsOrUploads++;
    });
    await page.route("**/api/**", (route) =>
      route.fulfill({
        status: 404,
        json: { detail: "Unmocked fixture endpoint" },
      }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: thread,
          title: "模板导入合成测试",
          messages: [
            { type: "ai", id: "fixture", content: "请使用右侧模板入口。" },
          ],
        },
      ],
    });
    await page.route("**/api/law/**", async (route) => {
      const url = new URL(route.request().url());
      let data: unknown = { items: [] };
      if (url.pathname.includes("/context/by-thread/"))
        data = {
          context: {
            user_id: "default",
            tenant_id: tenant,
            membership_id: template,
            tenant_role: "member",
            matter_id: "matter",
            matter_role: "lawyer",
            mapping_id: "mapping",
            thread_id: thread,
          },
        };
      else if (url.pathname.endsWith("/matters/matter"))
        data = { matter: { title: "法律顾问咨询", status: "active" } };
      else if (
        url.pathname.endsWith("/templates") &&
        route.request().method() === "POST"
      ) {
        writes.push(route.request().postDataJSON());
        expect(route.request().headers()["idempotency-key"]).toBeTruthy();
        data = { template_id: template, version: 1, current_version_number: 1 };
      } else if (url.pathname.endsWith(`/templates/${template}/versions/1`)) {
        contentReads++;
        data = {
          content,
          version: {
            id: tenant,
            template_id: template,
            version_number: 1,
            byte_size: Buffer.byteLength(content),
            content_sha256: digest,
          },
        };
      }
      await route.fulfill({ json: { data } });
    });
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("button", { name: "用模板起草", exact: true }).click();
    await page.getByRole("button", { name: "导入旧模板", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "导入旧模板",
      exact: true,
    });
    await dialog.getByLabel(/旧模板文件/).setInputFiles({
      name: "合成旧模板.markdown",
      mimeType: "text/markdown",
      buffer: Buffer.from(content),
    });
    await expect(dialog.getByText(digest, { exact: false })).toBeVisible();
    expect(writes).toHaveLength(0);
    expect(contentReads).toBe(0);
    await dialog
      .getByText("查看原文（仅文本，不执行链接或指令）", { exact: true })
      .click();
    await expect(dialog.locator("pre")).toContainText("<script>");
    expect(await page.evaluate(() => "importExecuted" in window)).toBe(false);
    await dialog.getByLabel("新模板名称").fill("导入的通用模板");
    const save = dialog.getByRole("button", { name: "确认导入新模板" });
    await expect(save).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await expect(save).toBeEnabled();
    await expect(
      dialog.getByRole("heading", { name: "导入旧模板" }),
    ).toBeInViewport({ ratio: 1 });
    await expect(save).toBeInViewport({ ratio: 1 });
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    for (const button of await dialog
      .getByRole("group", { name: "模板来源" })
      .getByRole("button")
      .all()) {
      await expect(button).toBeInViewport({ ratio: 1 });
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        bounds!.x + bounds!.width,
      );
      expect(
        await button.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
    const stored = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    expect(stored).not.toContain("合成旧模板");
    expect(stored).not.toContain(content);
    expect(stored).not.toContain(digest);
    await page.screenshot({
      path: info.outputPath("template-import-confirmation.png"),
      animations: "disabled",
    });
    await save.click();
    await expect(dialog.getByText(/已导入为新模板第 1 版/)).toBeVisible();
    expect(writes).toEqual([
      { name: "导入的通用模板", content, visibility: "private" },
    ]);
    expect(contentReads).toBe(1);
    expect(runsOrUploads).toBe(0);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath("template-import-saved.png"),
      animations: "disabled",
    });
  });
}
