import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const thread = "00000000-0000-4000-8000-000000000151";
const tenant = "00000000-0000-4000-8000-000000000152";
const template = "00000000-0000-4000-8000-000000000153";
const sha = createHash("sha256").update("").digest("hex");

for (const width of [320, 768, 1024, 1440]) {
  for (const visibility of ["private", "shared"] as const) {
    test(`creates an empty ${visibility} template at ${width}px without an Agent run`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: width === 320 ? 600 : 900 });
      await page.emulateMedia({
        reducedMotion: "reduce",
        colorScheme: width < 1024 ? "dark" : "light",
      });
      const errors: string[] = [];
      const writes: unknown[] = [];
      let reads = 0;
      let runsOrUploads = 0;
      const record = {
        id: template,
        tenant_id: tenant,
        owner_membership_id: template,
        name: "合成空白模板",
        visibility,
        status: "active",
        version: 1,
        current_version_number: 1,
      };
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
            title: "空白模板合成测试",
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
              tenant_role: visibility === "shared" ? "admin" : "member",
              matter_id: "matter",
              matter_role: "lawyer",
              mapping_id: "mapping",
              thread_id: thread,
            },
          };
        else if (url.pathname.endsWith("/matters/matter"))
          data = { matter: { title: "零散法律咨询", status: "active" } };
        else if (route.request().method() === "POST") {
          expect(url.pathname.endsWith("/templates")).toBe(true);
          expect(route.request().headers()["idempotency-key"]).toBeTruthy();
          writes.push(route.request().postDataJSON());
          data = {
            template_id: template,
            version: 1,
            current_version_number: 1,
          };
        } else if (url.pathname.endsWith(`/templates/${template}/versions/1`)) {
          reads++;
          data = {
            content: "",
            version: {
              id: template,
              template_id: template,
              version_number: 1,
              byte_size: 0,
              content_sha256: sha,
            },
          };
        } else if (url.pathname.endsWith(`/templates/${template}`))
          data = { template: { ...record } };
        else if (url.pathname.endsWith("/templates"))
          data = { items: writes.length ? [{ ...record }] : [] };
        await route.fulfill({ json: { data } });
      });
      await page.goto(`/workspace/chats/${thread}`);
      await page.getByTestId("artifact-trigger").click();
      await page
        .getByRole("button", { name: "用模板起草", exact: true })
        .click();
      await page
        .getByRole("button", { name: "自定义模板", exact: true })
        .click();
      await page.getByRole("button", { name: "管理模板", exact: true }).click();
      await page
        .getByRole("button", { name: "新建空白模板", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "新建空白模板",
        exact: true,
      });
      const submit = dialog.getByRole("button", {
        name: "确认新建",
        exact: true,
      });
      await expect(dialog.getByLabel("可见范围", { exact: true })).toHaveValue(
        "private",
      );
      await expect(submit).toBeDisabled();
      await dialog.getByLabel("模板名称").fill("合成空白模板");
      if (visibility === "shared")
        await dialog
          .getByLabel("可见范围", { exact: true })
          .selectOption("shared");
      else
        await expect(
          dialog.getByRole("option", { name: /组织模板/ }),
        ).toBeDisabled();
      expect(writes).toHaveLength(0);
      expect(reads).toBe(0);
      await expect(submit).toBeDisabled();
      await dialog.getByRole("checkbox").check();
      await expect(submit).toBeInViewport({ ratio: 1 });
      await expect(
        dialog.getByRole("heading", { name: "新建空白模板" }),
      ).toBeInViewport({ ratio: 1 });
      await expect(dialog.getByLabel("待新建模板")).toBeInViewport({
        ratio: 1,
      });
      await expect(dialog.getByLabel("待新建模板")).toContainText(
        visibility === "shared" ? "组织" : "个人",
      );
      const bounds = await dialog.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: info.outputPath("template-create-confirmation.png"),
        animations: "disabled",
      });
      await submit.click();
      await expect(dialog.getByText(/已新建模板第 1 版/)).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "确认新建" }),
      ).toHaveCount(0);
      expect(writes).toEqual([
        { name: "合成空白模板", content: "", visibility },
      ]);
      expect(reads).toBe(1);
      await dialog.getByRole("button", { name: "返回管理" }).click();
      const manager = page.getByRole("dialog", {
        name: "管理自定义模板",
        exact: true,
      });
      await expect(
        manager.getByRole("option", { name: /合成空白模板/ }),
      ).toBeAttached();
      await manager.getByLabel("管理对象").selectOption(template);
      await expect(manager.getByText(/已选：合成空白模板/)).toBeVisible();
      expect(runsOrUploads).toBe(0);
      const stored = await page.evaluate(() =>
        JSON.stringify([
          Object.entries(localStorage),
          Object.entries(sessionStorage),
        ]),
      );
      expect(stored).not.toContain(template);
      expect(stored).not.toContain("合成空白模板");
      expect(errors).toEqual([]);
      await page.screenshot({
        path: info.outputPath("template-create-catalog.png"),
        animations: "disabled",
      });
    });
  }
}
