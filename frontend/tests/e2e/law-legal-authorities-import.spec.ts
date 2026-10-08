import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import {
  LEGACY_AUTHORITIES_HANDOFF_PROMPT,
  convertLegacyLawRefs,
} from "../../src/core/law/legal-authorities-import";

import { mockLangGraphAPI } from "./utils/mock-api";

const thread = "00000000-0000-4000-8000-000000000153";
const source =
  "\ufeff[\r\n" +
  JSON.stringify({
    code: "合成私密法律",
    article: "第一条",
    origin: "manual",
    addedAt: "原时间待核验",
    source: "javascript:alert('private-old-path')",
  }) +
  ",\r\n" +
  JSON.stringify({
    code: "合成私密法律",
    article: "第一条",
    text: "<script>PRIVATE-SOURCE</script>合成原文",
    origin: "favorite",
    addedAt: "unknown",
  }) +
  "\r\n]";

for (const [width, height] of [
  [320, 800],
  [768, 800],
  [1024, 800],
  [1440, 800],
  [390, 600],
  [1280, 540],
]) {
  test(`previews and stages complete legal references at ${width}x${height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: width!, height: height! });
    await page.emulateMedia({
      colorScheme: width! < 1024 ? "dark" : "light",
      reducedMotion: "reduce",
    });
    const forbidden: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      // Native SDK uses POST for these two read-only queries.
      const nativeRead =
        request.method() === "POST" &&
        (path === "/api/langgraph/threads/search" ||
          path === `/api/langgraph/threads/${thread}/history`);
      if (
        request.method() !== "GET" &&
        !nativeRead &&
        /\/api\/(law|threads|langgraph)\//.test(request.url())
      )
        forbidden.push(request.url());
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
          title: "合成旧收藏导入",
          messages: [
            { type: "ai", id: "fixture", content: "请打开项目成果。" },
          ],
        },
      ],
    });
    const scope = {
      user_id: "default",
      tenant_id: "tenant",
      membership_id: "membership",
      tenant_role: "owner",
      matter_id: "matter",
      matter_member_id: "member",
      matter_role: "owner",
      thread_id: thread,
      mapping_id: "mapping",
      context_version: 1,
      policy_version: "1",
    };
    await page.route("**/api/law/**", (route) => {
      const url = route.request().url();
      let data: unknown = { items: [] };
      if (url.includes("/context/by-thread/")) data = { context: scope };
      else if (url.endsWith("/matters/matter"))
        data = {
          matter: {
            id: "matter",
            tenant_id: "tenant",
            title: "合成顾问服务主题",
            status: "active",
          },
        };
      return route.fulfill({ json: { data, meta: {} } });
    });
    await page.route("**/api/threads/*/uploads/limits", (route) =>
      route.fulfill({
        json: {
          max_files: 10,
          max_file_size: 10_000_000,
          max_total_size: 20_000_000,
        },
      }),
    );
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await expect(
      page.getByRole("button", { name: "导入旧法条收藏" }),
    ).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "导入旧法条收藏" }).click();
    const dialog = page.getByRole("dialog", {
      name: "导入旧法条收藏",
      exact: true,
    });
    const file = dialog.getByLabel(/选择旧项目/);
    await file.setInputFiles({
      name: "PRIVATE-FILENAME.json",
      mimeType: "application/json",
      buffer: Buffer.from(source),
    });
    await expect(
      dialog.getByText(/2 条记录 · 1 条缺正文 · 1 条同名/),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "放入当前会话草稿" }),
    ).toBeDisabled();
    const converted = await convertLegacyLawRefs(
      new TextEncoder().encode(source),
      {
        title: "旧法条收藏（待核验）",
        question: "旧收藏迁移；法律适用问题待明确。",
      },
    );
    for (const [name, expected] of [
      ["下载转换依据", converted.content],
      ["下载完整迁移报告", JSON.stringify(converted.report, null, 2)],
    ]) {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        dialog.getByRole("link", { name, exact: true }).click(),
      ]);
      expect(await readFile(await download.path(), "utf-8")).toBe(expected);
    }
    await dialog
      .getByText("完整原始文件与对应报告（含私人信息）", { exact: true })
      .click();
    await expect(dialog.locator('a[href^="javascript:"]')).toHaveCount(0);
    const region = dialog.getByRole("region", {
      name: "法律依据",
      exact: true,
    });
    await expect(region).toBeAttached();
    await region
      .getByRole("button", { name: /合成私密法律 第一条/ })
      .first()
      .click();
    await expect(
      region.getByText("仅引用（正文缺失）", { exact: true }),
    ).toBeVisible();
    await dialog.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    await expect(dialog.getByRole("checkbox")).toBeChecked();
    await expect(
      dialog.getByRole("heading", { name: "导入旧法条收藏" }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByText("目标法律项目：合成顾问服务主题 · 当前会话"),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByRole("button", { name: "关闭预览" }),
    ).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByRole("button", { name: "放入当前会话草稿" }),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("law-refs-import.png"),
      animations: "disabled",
    });
    expect(forbidden).toEqual([]);
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "放入当前会话草稿" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(page.locator("textarea")).toHaveValue(
      LEGACY_AUTHORITIES_HANDOFF_PROMPT,
    );
    await expect(
      page.locator("form").getByText(/^转换依据-.*\.law-authorities.json$/),
    ).toBeVisible();
    await expect(
      page.locator("form").getByText(/^法条迁移报告-.*\.import-report.json$/),
    ).toBeVisible();
    expect(forbidden).toEqual([]);
    const storage = await page.evaluate(() =>
      JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
    );
    for (const privateValue of [
      "PRIVATE-FILENAME",
      "PRIVATE-SOURCE",
      "合成私密法律",
      "private-old-path",
      "合成顾问服务主题",
    ])
      expect(storage).not.toContain(privateValue);
    await page.screenshot({
      path: info.outputPath("law-refs-staged.png"),
      animations: "disabled",
    });
  });
}
