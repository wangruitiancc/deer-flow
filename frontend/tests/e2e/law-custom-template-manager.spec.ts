import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const thread = "00000000-0000-4000-8000-000000000131";
const tenant = "00000000-0000-4000-8000-000000000132";
const template = "00000000-0000-4000-8000-000000000133";

for (const width of [320, 768, 1024, 1440]) {
  test(`renames, archives and restores metadata explicitly at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 600 : 900 });
    await page.emulateMedia({
      reducedMotion: "reduce",
      colorScheme: width < 1024 ? "dark" : "light",
    });
    const errors: string[] = [];
    const writes: unknown[] = [];
    let bodyReads = 0;
    let runsOrUploads = 0;
    const record = {
      id: template,
      tenant_id: tenant,
      owner_membership_id: template,
      name: "合成旧模板",
      visibility: "private",
      status: "active",
      version: 1,
      current_version_number: 2,
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
          title: "模板管理合成测试",
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
      else if (/\/versions\/\d+$/.test(url.pathname)) bodyReads++;
      else if (route.request().method() === "PATCH") {
        const change = route.request().postDataJSON() as {
          expected_version: number;
          name?: string;
          status?: string;
        };
        expect(change.expected_version).toBe(record.version);
        expect(route.request().headers()["idempotency-key"]).toBeTruthy();
        writes.push(change);
        if (change.name) record.name = change.name;
        if (change.status) record.status = change.status;
        record.version++;
        data = {
          template_id: template,
          version: record.version,
          current_version_number: 2,
        };
      } else if (url.pathname.endsWith(`/templates/${template}`))
        data = { template: { ...record } };
      else if (url.pathname.endsWith("/templates"))
        data = {
          items:
            record.status === "active" ||
            url.searchParams.get("include_archived") === "true"
              ? [{ ...record }]
              : [],
        };
      await route.fulfill({ json: { data } });
    });
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("button", { name: "用模板起草", exact: true }).click();
    await page.getByRole("button", { name: "自定义模板", exact: true }).click();
    await page.getByRole("button", { name: "管理模板", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "管理自定义模板",
      exact: true,
    });
    await dialog.getByLabel("管理对象").selectOption(template);
    await dialog.getByLabel("新名称").fill("合成已改名模板");
    const submit = dialog.getByRole("button", { name: "确认执行" });
    await expect(submit).toBeDisabled();
    expect(writes).toHaveLength(0);
    await dialog.getByRole("checkbox").check();
    await submit.click();
    await expect(dialog.getByText(/已确认本次操作提交/)).toBeVisible();
    await expect(
      dialog.getByRole("option", { name: /合成已改名模板/ }),
    ).toBeAttached();
    await dialog.getByLabel("管理对象").selectOption(template);
    await dialog.getByLabel("操作", { exact: true }).selectOption("archive");
    await expect(submit).toBeDisabled();
    await dialog.getByRole("checkbox").check();
    await expect(
      dialog.getByRole("heading", { name: "管理自定义模板" }),
    ).toBeInViewport({ ratio: 1 });
    await expect(submit).toBeInViewport({ ratio: 1 });
    await expect(
      dialog.getByLabel("待确认操作", { exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByLabel("待确认操作", { exact: true })).toHaveText(
      "归档：合成已改名模板",
    );
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: info.outputPath("template-manager-confirmation.png"),
      animations: "disabled",
    });
    await submit.click();
    await expect(dialog.getByText(/已确认本次操作提交/)).toBeVisible();
    await dialog.getByLabel("目录范围").selectOption("archived");
    await dialog.getByLabel("管理对象").selectOption(template);
    await expect(dialog.getByLabel("操作", { exact: true })).toHaveValue(
      "restore",
    );
    await dialog.getByRole("checkbox").check();
    await submit.click();
    await expect(dialog.getByText(/已确认本次操作提交/)).toBeVisible();
    expect(writes).toEqual([
      { expected_version: 1, name: "合成已改名模板" },
      { expected_version: 2, status: "archived" },
      { expected_version: 3, status: "active" },
    ]);
    expect(record.current_version_number).toBe(2);
    expect(bodyReads).toBe(0);
    expect(runsOrUploads).toBe(0);
    expect(errors).toEqual([]);
    const stored = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    expect(stored).not.toContain("合成已改名模板");
    await page.screenshot({
      path: info.outputPath("template-manager-restored.png"),
      animations: "disabled",
    });
  });
}
