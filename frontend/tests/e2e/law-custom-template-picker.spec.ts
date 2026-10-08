import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const thread = "00000000-0000-4000-8000-000000000101";
const tenant = "00000000-0000-4000-8000-000000000102";
const template = "00000000-0000-4000-8000-000000000103";
const owner = "00000000-0000-4000-8000-000000000104";

for (const width of [320, 768, 1024, 1440]) {
  for (const mode of ["copy", "draft"]) {
    test(`stages a private-free ${mode} prompt and native template selection attachment at ${width}px`, async ({
      page,
    }, info) => {
      const errors: string[] = [];
      let mutations = 0;
      const lawReads: string[] = [];
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
          mutations++;
      });
      await page.setViewportSize({ width, height: width === 320 ? 600 : 900 });
      await page.emulateMedia({
        colorScheme: width < 1024 ? "dark" : "light",
        reducedMotion: "reduce",
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
            title: "模板选择合成测试",
            messages: [
              {
                type: "ai",
                id: "fixture-message",
                content: "请使用右侧模板入口。",
              },
            ],
          },
        ],
      });
      const item = {
        id: template,
        tenant_id: tenant,
        owner_membership_id: owner,
        name: "合成合同模板",
        visibility: "private",
        status: "active",
        version: 3,
        current_version_number: 2,
      };
      await page.route("**/api/law/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        lawReads.push(path);
        expect(route.request().method()).toBe("GET");
        let data: unknown = { items: [] };
        if (path.endsWith("template-catalog")) {
          await route.fulfill({
            json: {
              schema_version: 1,
              available: true,
              skill_name: "matrix-law-templates",
              templates: [
                {
                  id: "contract-review",
                  title: "合同审查",
                  artifact_kind: "document",
                },
              ],
            },
          });
          return;
        }
        if (path.includes("/context/by-thread/"))
          data = {
            context: {
              user_id: "default",
              tenant_id: tenant,
              membership_id: owner,
              tenant_role: "member",
              matter_id: "matter",
              matter_role: "lawyer",
              mapping_id: "mapping",
              thread_id: thread,
            },
          };
        else if (path.endsWith("/matters/matter"))
          data = { matter: { title: "合成咨询", status: "active" } };
        else if (path.endsWith("/templates")) data = { items: [item] };
        else if (path.endsWith(`/templates/${template}`))
          data = { template: item };
        else if (path.endsWith("/versions"))
          data = {
            items: [2, 1].map((version_number) => ({
              id: owner,
              template_id: template,
              version_number,
              byte_size: 100,
              content_sha256: "a".repeat(64),
            })),
          };
        await route.fulfill({
          json: { data, meta: { request_id: "synthetic-picker" } },
        });
      });
      await page.goto(`/workspace/chats/${thread}`);
      await page.getByRole("button", { name: /artifacts/i }).click();
      await page.getByRole("button", { name: "用模板起草" }).click();
      await page
        .getByRole("button", { name: "自定义模板", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "打开自定义模板" });
      await dialog.getByLabel("自定义模板").selectOption(template);
      await expect(
        dialog.getByRole("option", { name: "第 1 版 · 100 字节" }),
      ).toBeAttached();
      await dialog.getByLabel("正文版本").selectOption("1");
      await expect(dialog.getByLabel("打开方式")).toHaveValue("copy");
      if (mode === "draft") {
        await dialog.getByLabel("打开方式").selectOption("draft");
        await dialog.getByRole("button", { name: "放入当前会话草稿" }).click();
        await expect(dialog.getByLabel("文书标题")).toHaveAttribute(
          "aria-invalid",
          "true",
        );
        await expect(dialog.getByRole("alert")).toHaveCount(2);
        await dialog.getByLabel("文书标题").fill("合成私密填值标题");
        await dialog.getByLabel("项目显示名称").fill("合成私密顾问主题");
        await dialog.getByLabel("草稿创建日期").fill("2024-02-29");
        await dialog.getByLabel("草稿创建时间").fill("03:04");
        await expect(dialog.getByRole("alert")).toHaveCount(0);
      }
      await dialog.getByLabel("正文版本").focus();
      await expect(dialog.getByLabel("正文版本")).toBeFocused();
      await expect(
        dialog.getByRole("heading", { name: "打开自定义模板" }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        dialog.getByRole("button", { name: "取消", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        dialog.getByRole("button", { name: "放入当前会话草稿" }),
      ).toBeInViewport({ ratio: 1 });
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath("custom-template-dialog.png"),
        animations: "disabled",
      });
      expect(mutations).toBe(0);
      await dialog.getByRole("button", { name: "放入当前会话草稿" }).click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByText("模板选择.json", { exact: true }),
      ).toBeVisible();
      const composer = page.locator("textarea");
      await expect(composer).toHaveValue(
        mode === "draft"
          ? /law_create_custom_template_draft/
          : /law_open_custom_template/,
      );
      expect(await composer.inputValue()).not.toContain(template);
      expect(mutations).toBe(0);
      expect(lawReads.some((path) => /\/versions\/\d+$/.test(path))).toBe(
        false,
      );
      const persisted = await page.evaluate(() =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
        }),
      );
      expect(persisted).not.toContain(template);
      expect(persisted).not.toContain("合成合同模板");
      expect(persisted).not.toContain("合成私密填值标题");
      expect(persisted).not.toContain("合成私密顾问主题");
      expect(await composer.inputValue()).not.toContain("2024-02-29");
      await page.screenshot({
        path: info.outputPath("custom-template-staged.png"),
        animations: "disabled",
      });
      expect(errors).toEqual([]);
    });
  }
}
