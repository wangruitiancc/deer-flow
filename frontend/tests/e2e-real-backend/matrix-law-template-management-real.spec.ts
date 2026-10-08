import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

const APP = process.env.E2E_P1_URL ?? "http://127.0.0.1:2035";
if (APP !== "http://127.0.0.1:2035") throw new Error("Synthetic 2035 only");

const original =
  "\ufeff# 合成旧模板\r\n{{title}} {{case}} {{date:YYYY年MM月DD日}}\r\n<script>window.templateInjected=true</script>\r\n";

for (const width of [1280, 390]) {
  test(`real template creation, import, management and historical sharing at ${width}px`, async ({
    page,
    context,
    browser,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ colorScheme: width === 390 ? "dark" : "light" });
    const registered = await context.request.post(
      `${APP}/api/v1/auth/register`,
      {
        data: {
          email: `template-management-${randomUUID()}@example.com`,
          password: "Synthetic-Template-Management-12345",
        },
      },
    );
    expect(registered.status()).toBe(201);
    const csrf = (await context.cookies(APP)).find(
      (c) => c.name === "csrf_token",
    )?.value;
    expect(csrf).toBeTruthy();
    async function mutate(
      method: string,
      path: string,
      data: unknown,
      status = 201,
    ) {
      const response = await context.request.fetch(`${APP}${path}`, {
        method,
        headers: {
          "X-CSRF-Token": csrf!,
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
    } = await mutate("POST", "/api/law/tenants", {
      slug: `template-management-${randomUUID()}`,
      name: "合成模板管理团队",
    });
    const root = `/api/law/tenants/${tenant.id}/templates`;
    const {
      data: { matter },
    } = await mutate("POST", `/api/law/tenants/${tenant.id}/matters`, {
      kind: "consultation",
      title: "合成零散法律咨询",
    });
    const thread = randomUUID();
    await mutate(
      "POST",
      "/api/threads",
      { thread_id: thread, metadata: {} },
      200,
    );
    await mutate(
      "POST",
      `/api/law/tenants/${tenant.id}/matters/${matter.id}/threads`,
      {
        thread_id: thread,
        purpose: "matter-chat",
      },
    );
    async function read(path: string) {
      const response = await context.request.get(`${APP}${path}`);
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    }
    async function verifyBody(id: string, version: number, body: string) {
      const result = await read(`${root}/${id}/versions/${version}`);
      expect(Buffer.from(result.content)).toEqual(Buffer.from(body));
      expect(result.version.byte_size).toBe(Buffer.byteLength(body));
      expect(result.version.content_sha256).toBe(
        createHash("sha256").update(body).digest("hex"),
      );
    }
    const requests: { method: string; path: string; data: unknown }[] = [];
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        path.startsWith("/api/") &&
        ["POST", "PATCH"].includes(request.method())
      )
        requests.push({
          method: request.method(),
          path,
          data: request.postDataJSON(),
        });
    });
    await page.goto(`/workspace/chats/${thread}`);
    await expect(
      page.getByPlaceholder(
        /请描述当前法律问题或工作任务|Describe the current legal question or task/,
      ),
    ).toBeVisible();
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("button", { name: "用模板起草", exact: true }).click();
    await page.getByRole("button", { name: "自定义模板", exact: true }).click();
    await page.getByRole("button", { name: "管理模板", exact: true }).click();
    const manager = page.getByRole("dialog", {
      name: "管理自定义模板",
      exact: true,
    });
    await expect(manager.getByLabel("管理对象").locator("option")).toHaveCount(
      1,
    );
    await manager
      .getByRole("button", { name: "新建空白模板", exact: true })
      .click();
    const create = page.getByRole("dialog", {
      name: "新建空白模板",
      exact: true,
    });
    await create.getByLabel("模板名称").fill("合成空白模板");
    await expect(create.getByLabel("可见范围", { exact: true })).toHaveValue(
      "private",
    );
    await expect(
      create.getByRole("button", { name: "确认新建", exact: true }),
    ).toBeDisabled();
    expect(requests.filter((r) => r.path === root)).toHaveLength(0);
    await create.getByRole("checkbox").check();
    await create.getByRole("button", { name: "确认新建", exact: true }).click();
    await expect(create.getByText(/已新建模板第 1 版/)).toBeVisible();
    const blank = (await read(root)).items.find(
      (item: { name: string }) => item.name === "合成空白模板",
    );
    expect(blank.visibility).toBe("private");
    await verifyBody(blank.id, 1, "");
    await create.getByRole("button", { name: "返回管理" }).click();
    // Use the same native dialog's source switch, never a second editor.
    await manager
      .getByRole("button", { name: "导入旧模板", exact: true })
      .click();
    const importer = page.getByRole("dialog", {
      name: "导入旧模板",
      exact: true,
    });
    await importer.getByLabel(/旧模板文件/).setInputFiles({
      name: "合成旧模板.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(original),
    });
    await importer.getByLabel("新模板名称").fill("合成导入模板");
    await expect(
      importer.getByRole("button", { name: "确认导入新模板" }),
    ).toBeDisabled();
    expect(requests.filter((r) => r.path === root)).toHaveLength(1);
    await importer.getByRole("checkbox").check();
    await importer.getByRole("button", { name: "确认导入新模板" }).click();
    await expect(importer.getByText(/已导入为新模板第 1 版/)).toBeVisible();
    const imported = (await read(root)).items.find(
      (item: { name: string }) => item.name === "合成导入模板",
    );
    await verifyBody(imported.id, 1, original);
    const second = original + "\r\n第二版合成修改，不应随第一版共享。\r\n";
    await mutate(
      "PATCH",
      `${root}/${imported.id}`,
      { expected_version: 1, content: second },
      200,
    );
    await importer
      .getByRole("button", { name: "自定义模板", exact: true })
      .click();
    await page.getByRole("button", { name: "管理模板", exact: true }).click();
    await manager.getByLabel("管理对象").selectOption(imported.id);
    await manager.getByLabel("新名称").fill("合成已改名模板");
    await manager.getByRole("checkbox").check();
    await manager.getByRole("button", { name: "确认执行" }).click();
    await expect(manager.getByText(/已确认本次操作提交/)).toBeVisible();
    await expect(
      manager.getByRole("option", { name: /合成已改名模板/ }),
    ).toBeAttached();
    await manager.getByLabel("管理对象").selectOption(imported.id);
    await manager.getByLabel("操作", { exact: true }).selectOption("archive");
    await manager.getByRole("checkbox").check();
    await manager.getByRole("button", { name: "确认执行" }).click();
    await expect(manager.getByText(/已确认本次操作提交/)).toBeVisible();
    expect((await read(`${root}/${imported.id}`)).template.status).toBe(
      "archived",
    );
    expect(
      (await read(root)).items.map((item: { id: string }) => item.id),
    ).not.toContain(imported.id);
    await manager.getByLabel("目录范围").selectOption("archived");
    await manager.getByLabel("管理对象").selectOption(imported.id);
    await expect(manager.getByLabel("操作", { exact: true })).toHaveValue(
      "restore",
    );
    await manager.getByRole("checkbox").check();
    await manager.getByRole("button", { name: "确认执行" }).click();
    await expect(manager.getByText(/已确认本次操作提交/)).toBeVisible();
    const restored = (await read(`${root}/${imported.id}`)).template;
    expect(restored).toMatchObject({
      name: "合成已改名模板",
      status: "active",
      visibility: "private",
      version: 5,
      current_version_number: 2,
    });
    await verifyBody(imported.id, 1, original);
    await verifyBody(imported.id, 2, second);
    await manager.getByLabel("目录范围").selectOption("active");
    await manager.getByLabel("管理对象").selectOption(imported.id);
    await manager
      .getByRole("button", { name: "选版发布组织副本", exact: true })
      .click();
    const publish = page.getByRole("dialog", {
      name: "发布组织模板副本",
      exact: true,
    });
    await publish.getByLabel("要共享的正文版本").selectOption("1");
    await publish.getByRole("button", { name: "读取所选版本预览" }).click();
    await expect(publish.getByLabel("待共享正文")).toContainText("合成旧模板");
    await expect(
      publish.getByLabel("待共享正文").locator("script"),
    ).toHaveCount(0);
    expect(await page.evaluate(() => "templateInjected" in window)).toBe(false);
    await publish.getByLabel("组织副本名称").fill("合成组织历史副本");
    await expect(
      publish.getByRole("button", { name: "确认发布副本" }),
    ).toBeDisabled();
    await publish.getByRole("checkbox").check();
    await expect(publish.getByLabel("待共享版本")).toBeInViewport({ ratio: 1 });
    await page.screenshot({
      path: info.outputPath("real-template-share-confirmation.png"),
      animations: "disabled",
    });
    await publish.getByRole("button", { name: "确认发布副本" }).click();
    await expect(publish.getByText(/已发布组织副本并核对/)).toBeVisible();
    const shared = (await read(root)).items.find(
      (item: { name: string }) => item.name === "合成组织历史副本",
    );
    expect(shared).toMatchObject({
      visibility: "shared",
      current_version_number: 1,
      version: 1,
    });
    expect(shared.id).not.toBe(imported.id);
    await verifyBody(shared.id, 1, original);
    expect((await read(`${root}/${shared.id}/versions`)).items).toHaveLength(1);
    expect((await read(`${root}/${imported.id}`)).template).toEqual(restored);
    expect((await read(`${root}/${imported.id}/versions`)).items).toHaveLength(
      2,
    );
    // Organization sharing is not public or cross-tenant sharing.
    const outsider = await browser.newContext();
    try {
      expect(
        (
          await outsider.request.post(`${APP}/api/v1/auth/register`, {
            data: {
              email: `template-outsider-${randomUUID()}@example.com`,
              password: "Synthetic-Template-Outsider-12345",
            },
          })
        ).status(),
      ).toBe(201);
      for (const id of [blank.id, imported.id, shared.id])
        expect(
          (
            await outsider.request.get(`${APP}${root}/${id}/versions/1`)
          ).status(),
        ).toBe(404);
    } finally {
      await outsider.close();
    }
    expect(
      requests.filter((r) => /\/uploads|\/runs(?:\/|$)/.test(r.path)),
    ).toEqual([]);
    expect(
      requests
        .filter((r) => r.method === "POST" && r.path === root)
        .map((r) => r.data),
    ).toEqual([
      { name: "合成空白模板", content: "", visibility: "private" },
      { name: "合成导入模板", content: original, visibility: "private" },
    ]);
    expect(
      requests.filter((r) => r.method === "PATCH").map((r) => r.data),
    ).toEqual([
      { expected_version: 2, name: "合成已改名模板" },
      { expected_version: 3, status: "archived" },
      { expected_version: 4, status: "active" },
    ]);
    const stored = await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    );
    for (const value of [
      imported.id,
      shared.id,
      original,
      "合成导入模板",
      "合成组织历史副本",
    ])
      expect(stored).not.toContain(value);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: info.outputPath("real-template-share-completed.png"),
      animations: "disabled",
    });
  });
}
