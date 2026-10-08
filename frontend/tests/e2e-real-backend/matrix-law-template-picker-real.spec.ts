import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

const APP = process.env.E2E_P1_URL ?? "http://127.0.0.1:2035";
if (APP !== "http://127.0.0.1:2035") throw new Error("Synthetic 2035 only");

for (const width of [1280, 390]) {
  test(`stages legal templates without submitting or overwriting at ${width}px`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
    await page.emulateMedia({ colorScheme: width === 390 ? "dark" : "light" });
    expect(
      (await context.request.get(`${APP}/api/law/template-catalog`)).status(),
    ).toBe(401);
    expect(
      (
        await context.request.post(`${APP}/api/v1/auth/register`, {
          data: {
            email: `p1-template-browser-${randomUUID()}@example.com`,
            password: "Synthetic-Browser-P1-12345",
          },
        })
      ).status(),
    ).toBe(201);
    const csrf =
      (await context.cookies(APP)).find(
        (cookie) => cookie.name === "csrf_token",
      )?.value ?? "";
    async function post(path: string, data: unknown, status: number) {
      const response = await context.request.post(`${APP}${path}`, {
        headers: {
          "X-CSRF-Token": csrf,
          "Idempotency-Key": randomUUID(),
          Origin: APP,
        },
        data,
      });
      expect(response.status()).toBe(status);
      return response.json();
    }
    const {
      data: { tenant },
    } = await post(
      "/api/law/tenants",
      { slug: `template-${randomUUID()}`, name: "合成模板验证团队" },
      201,
    );
    const {
      data: { matter },
    } = await post(
      `/api/law/tenants/${tenant.id}/matters`,
      { kind: "consultation", title: "合成单次法律咨询" },
      201,
    );
    const id = randomUUID();
    await post("/api/threads", { thread_id: id, metadata: {} }, 200);
    await post(
      `/api/law/tenants/${tenant.id}/matters/${matter.id}/threads`,
      { thread_id: id, purpose: "matter-chat" },
      201,
    );
    const catalog = await context.request.get(
      `${APP}/api/law/template-catalog`,
    );
    expect(catalog.status()).toBe(200);
    expect((await catalog.json()).templates).toHaveLength(6);
    // The legal product intentionally does not expose its general Skill control plane.
    expect((await context.request.get(`${APP}/api/skills`)).status()).toBe(404);
    let submitted = 0;
    let uploaded = 0;
    let templateBodiesRead = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        /\/runs(?:\/stream)?(?:\?|$)/.test(request.url())
      )
        submitted++;
      if (request.method() === "POST" && request.url().includes("/uploads"))
        uploaded++;
      if (
        request.method() === "GET" &&
        /\/templates\/[^/]+\/versions\/\d+(?:\?|$)/.test(request.url())
      )
        templateBodiesRead++;
    });
    await page.goto(`/workspace/chats/${id}`);
    const input = page.getByPlaceholder(
      /请描述当前法律问题或工作任务|Describe the current legal question or task/,
    );
    await expect(input).toBeVisible();
    await input.fill("现有咨询草稿必须保留");
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("button", { name: "用模板起草", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "用模板起草",
      exact: true,
    });
    await expect(dialog.getByLabel("模板类型").locator("option")).toHaveCount(
      7,
    );
    await dialog.getByLabel("模板类型").selectOption("contract-review");
    await dialog.getByRole("button", { name: "放入当前会话草稿" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "输入框已有草稿或附件",
    );
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    // Mobile uses the native artifacts drawer; return to the composer first.
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("现有咨询草稿必须保留");
    await input.fill("");
    if (width < 1024) {
      await expect(
        page.getByRole("button", { name: "用模板起草", exact: true }),
      ).not.toBeVisible();
      await page.getByTestId("artifact-trigger").click();
    }
    await page.getByRole("button", { name: "用模板起草", exact: true }).click();
    await dialog.getByLabel("模板类型").selectOption("contract-review");
    await dialog.getByLabel("草稿标题").fill("合成合同审查草稿");
    await page.screenshot({
      path: info.outputPath("template-picker.png"),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "放入当前会话草稿" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue(/law_create_template_draft/);
    const prompt = await input.inputValue();
    expect(prompt).toContain('"template_id":"contract-review"');
    expect(prompt).not.toContain(tenant.id);
    expect(prompt).not.toContain(matter.id);
    expect(prompt).not.toContain("/matrix-law-templates");
    expect(submitted).toBe(0);
    await page.screenshot({
      path: info.outputPath("template-staged.png"),
      animations: "disabled",
    });
    // Real API fixtures; no network interception or model call. The historical
    // selection must use the deployed metadata API without fetching its body.
    await input.fill("");
    const templateRoot = `/api/law/tenants/${tenant.id}/templates`;
    const {
      data: { template_id: customId },
    } = await post(
      templateRoot,
      {
        name: "合成自定义历史模板",
        content: "\ufeff# 第一版\r\n{{title}}\r\n",
      },
      201,
    );
    const appended = await context.request.patch(
      `${APP}${templateRoot}/${customId}`,
      {
        headers: {
          "X-CSRF-Token": csrf,
          "Idempotency-Key": randomUUID(),
          Origin: APP,
        },
        data: { expected_version: 1, content: "# 第二版\n{{date}}\n" },
      },
    );
    expect(appended.status()).toBe(200);
    // Staging closes the native results panel on desktop as well as mobile.
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("button", { name: "用模板起草", exact: true }).click();
    await dialog
      .getByRole("button", { name: "自定义模板", exact: true })
      .click();
    const customDialog = page.getByRole("dialog", { name: "打开自定义模板" });
    await expect(
      customDialog.getByLabel("自定义模板").locator("option"),
    ).toHaveCount(2);
    await customDialog.getByLabel("自定义模板").selectOption(customId);
    await expect(
      customDialog.getByLabel("正文版本").locator("option"),
    ).toHaveCount(3);
    await expect(customDialog.getByLabel("正文版本")).toHaveValue("");
    await customDialog.getByLabel("正文版本").selectOption("1");
    await page.screenshot({
      path: info.outputPath("custom-template-picker.png"),
      animations: "disabled",
    });
    await customDialog
      .getByRole("button", { name: "放入当前会话草稿" })
      .click();
    await expect(customDialog).not.toBeVisible();
    await expect(input).toHaveValue(/law_open_custom_template/);
    await expect(
      page.getByText("模板选择.json", { exact: true }),
    ).toBeVisible();
    expect(await input.inputValue()).not.toContain(customId);
    expect(submitted).toBe(0);
    expect(uploaded).toBe(0);
    expect(templateBodiesRead).toBe(0);
    await page.screenshot({
      path: info.outputPath("custom-template-staged.png"),
      animations: "disabled",
    });
  });
}
