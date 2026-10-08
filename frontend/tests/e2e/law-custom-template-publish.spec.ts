import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const thread = "00000000-0000-4000-8000-000000000141";
const tenant = "00000000-0000-4000-8000-000000000142";
const template = "00000000-0000-4000-8000-000000000143";
const copy = "00000000-0000-4000-8000-000000000144";
const versionId = "00000000-0000-4000-8000-000000000145";
const sourceBody =
  "\ufeff# 合成第一版\r\n{{case}}\r\n<script>window.templateInjected=true</script>\r\n";
const sha = createHash("sha256").update(sourceBody).digest("hex");

for (const width of [320, 768, 1024, 1440]) {
  test(`publishes only a previewed historical template copy at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 600 : 900 });
    await page.emulateMedia({
      reducedMotion: "reduce",
      colorScheme: width < 1024 ? "dark" : "light",
    });
    const errors: string[] = [];
    const reads: string[] = [];
    const writes: unknown[] = [];
    let runsOrUploads = 0;
    const source = {
      id: template,
      tenant_id: tenant,
      owner_membership_id: template,
      name: "合成个人模板",
      visibility: "private",
      status: "active",
      version: 3,
      current_version_number: 2,
    };
    const original = JSON.stringify(source);
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
          title: "模板共享合成测试",
          messages: [
            { type: "ai", id: "fixture", content: "请使用右侧模板入口。" },
          ],
        },
      ],
    });
    await page.route("**/api/law/**", async (route) => {
      const url = new URL(route.request().url());
      const meta = (number: number, target = template) => ({
        id: versionId,
        template_id: target,
        version_number: number,
        content_sha256: sha,
        byte_size: Buffer.byteLength(sourceBody),
      });
      let data: unknown = { items: [] };
      if (url.pathname.includes("/context/by-thread/"))
        data = {
          context: {
            user_id: "default",
            tenant_id: tenant,
            membership_id: template,
            tenant_role: "admin",
            matter_id: "matter",
            matter_role: "lawyer",
            mapping_id: "mapping",
            thread_id: thread,
          },
        };
      else if (url.pathname.endsWith("/matters/matter"))
        data = { matter: { title: "法律顾问咨询", status: "active" } };
      else if (route.request().method() === "POST") {
        expect(url.pathname.endsWith(`/templates/${template}/publish`)).toBe(
          true,
        );
        expect(route.request().headers()["idempotency-key"]).toBeTruthy();
        writes.push(route.request().postDataJSON());
        data = { template_id: copy, version: 1, current_version_number: 1 };
      } else if (/\/versions\/\d+$/.test(url.pathname)) {
        reads.push(url.pathname);
        expect(url.pathname.endsWith("/versions/1")).toBe(true);
        data = {
          content: sourceBody,
          version: meta(1, url.pathname.includes(copy) ? copy : template),
        };
      } else if (url.pathname.endsWith("/versions"))
        data = { items: [meta(2), meta(1)] };
      else if (url.pathname.endsWith(`/templates/${template}`))
        data = { template: { ...source } };
      else if (url.pathname.endsWith("/templates"))
        data = { items: [{ ...source }] };
      await route.fulfill({ json: { data } });
    });
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("button", { name: "用模板起草", exact: true }).click();
    await page.getByRole("button", { name: "自定义模板", exact: true }).click();
    await page.getByRole("button", { name: "管理模板", exact: true }).click();
    await page.getByLabel("管理对象").selectOption(template);
    await page
      .getByRole("button", { name: "选版发布组织副本", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "发布组织模板副本",
      exact: true,
    });
    const submit = dialog.getByRole("button", {
      name: "确认发布副本",
      exact: true,
    });
    await dialog.getByLabel("要共享的正文版本").selectOption("1");
    expect(reads).toEqual([]);
    await expect(dialog.getByRole("checkbox")).toBeDisabled();
    await dialog.getByRole("button", { name: "读取所选版本预览" }).click();
    await expect(dialog.getByLabel("待共享正文")).toContainText("合成第一版");
    await expect(dialog.getByLabel("待共享正文").locator("script")).toHaveCount(
      0,
    );
    expect(await page.evaluate(() => "templateInjected" in window)).toBe(false);
    await dialog.getByLabel("组织副本名称").fill("合成共享副本");
    await expect(submit).toBeDisabled();
    expect(writes).toHaveLength(0);
    await dialog.getByRole("checkbox").check();
    await expect(submit).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByRole("heading", { name: "发布组织模板副本" }),
    ).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByLabel("待共享版本")).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByLabel("待共享版本")).toContainText("第 1 版");
    await expect(dialog.getByLabel("待共享版本")).toContainText(
      "组织副本：合成共享副本",
    );
    for (const line of await dialog
      .getByLabel("待共享版本")
      .locator("span")
      .all()) {
      await expect(line).toBeInViewport({ ratio: 1 });
      expect(
        await line.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath("template-publish-confirmation.png"),
      animations: "disabled",
    });
    await submit.click();
    await expect(dialog.getByText(/已发布组织副本并核对/)).toBeVisible();
    expect(writes).toEqual([{ version_number: 1, name: "合成共享副本" }]);
    expect(reads).toHaveLength(3);
    expect(reads[2]).toContain(`/templates/${copy}/versions/1`);
    expect(JSON.stringify(source)).toBe(original);
    expect(runsOrUploads).toBe(0);
    const stored = await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    );
    for (const privateValue of [
      template,
      "合成个人模板",
      "合成共享副本",
      "合成第一版",
    ])
      expect(stored).not.toContain(privateValue);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath("template-publish-completed.png"),
      animations: "disabled",
    });
  });
}
