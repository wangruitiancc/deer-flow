import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { type LegalAuthorities } from "../../src/core/law/legal-authorities";
import { convertLegacyLawRefs } from "../../src/core/law/legal-authorities-import";

import { mockLangGraphAPI } from "./utils/mock-api";

for (const width of [320, 768, 1024, 1440]) {
  test(`preserves and manually supplements bodyless legacy references at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({
      colorScheme: width === 320 || width === 1024 ? "dark" : "light",
      reducedMotion: "reduce",
    });
    const original = {
      code: "仅引用合成法",
      article: "第六十七条",
      origin: "mining",
      addedAt: "旧时间不作为法律日期",
      text: "",
      articleId: "minshisusong-64",
      source: "javascript:alert('inert-old-source')",
    };
    const converted = await convertLegacyLawRefs(
      new TextEncoder().encode(JSON.stringify([original])),
      { title: "旧收藏转换样例", question: "合成咨询，待核验" },
    );
    const filename = "legacy.law-authorities.json";
    const path = `/mnt/user-data/outputs/${filename}`;
    const thread = "00000000-0000-0000-0000-000000000096";
    let stored = converted.content;
    const sha = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    let saves = 0;
    const forbidden: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() !== "GET" &&
        /\/(runs|uploads)(\/|\?|$)/.test(request.url())
      )
        forbidden.push(request.url());
    });
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, json: { detail: "Unmocked endpoint" } }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: thread,
          title: "合成旧引用",
          artifacts: [path],
          messages: [
            { type: "ai", id: "answer", content: "仅为迁移合成测试。" },
          ],
        },
      ],
    });
    await page.route("**/api/threads/*/artifacts/**", (route) => {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as {
          content: string;
          expected_sha256: string;
        };
        expect(body.expected_sha256).toBe(sha(stored));
        stored = body.content;
        saves++;
        return route.fulfill({
          json: { path, sha256: sha(stored), size: Buffer.byteLength(stored) },
        });
      }
      return route.fulfill({
        body: stored,
        contentType: "application/json",
        headers: { ETag: `"${sha(stored)}"` },
      });
    });
    await page.route("**/api/law/**", (route) => {
      const url = route.request().url();
      let data: unknown = { items: [] };
      if (url.includes("/context/by-thread/"))
        data = {
          context: {
            user_id: "default",
            tenant_id: "tenant-test",
            matter_id: "matter-test",
            matter_role: "owner",
            thread_id: thread,
          },
        };
      else if (url.endsWith("/matters/matter-test"))
        data = { matter: { title: "合成法律顾问", status: "active" } };
      return route.fulfill({ json: { data, meta: {} } });
    });
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByText(filename, { exact: true }).click();
    const region = page.getByRole("region", { name: "法律依据", exact: true });
    const expand = () =>
      region.getByRole("button", { name: /仅引用合成法 第六十七条/ }).click();
    await expand();
    await expect(
      region.getByText("仅引用（正文缺失）", { exact: true }),
    ).toBeVisible();
    await region.getByRole("button", { name: /查看旧收藏引用记录/ }).click();
    await expect(
      region.getByText(/不是官方正文或已授权项目引用/),
    ).toBeVisible();
    await expect(region.locator('a[href^="javascript:"]')).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("legacy-missing-body.png"),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await region.getByRole("button", { name: "编辑依据", exact: true }).click();
    let dialog = page.getByRole("dialog", {
      name: "编辑法律依据",
      exact: true,
    });
    await dialog
      .getByLabel("收录理由", { exact: true })
      .fill("保留引用，等待原文核对");
    await dialog.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "应用到草稿", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(saves).toBe(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => saves).toBe(1);
    expect(
      (JSON.parse(stored) as LegalAuthorities).entries[0]!.text,
    ).toBeNull();
    await expand();
    await region.getByRole("button", { name: "编辑依据", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "编辑法律依据", exact: true });
    await dialog
      .getByRole("combobox", { name: "正文性质", exact: true })
      .selectOption("summary");
    await dialog
      .getByLabel("条文或摘要内容", { exact: true })
      .fill("人工新增摘要，非原始条文");
    await dialog.getByRole("checkbox").check();
    await dialog
      .getByRole("button", { name: "应用到草稿", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => saves).toBe(2);
    const saved = JSON.parse(stored) as LegalAuthorities;
    expect(saved.entries[0]).toMatchObject({
      text: "人工新增摘要，非原始条文",
      text_kind: "summary",
      review_status: "unreviewed",
    });
    expect(saved.entries[0]!.legacy_origin!.original).toEqual(original);
    expect(saved.sources).toEqual(converted.authorities.sources);
    expect(forbidden).toEqual([]);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    expect(
      await page.evaluate(() =>
        JSON.stringify([
          Object.values(localStorage),
          Object.values(sessionStorage),
        ]),
      ),
    ).not.toMatch(/仅引用合成法|inert-old-source|人工新增摘要/);
  });
}
