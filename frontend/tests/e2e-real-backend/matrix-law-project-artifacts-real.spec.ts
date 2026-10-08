import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";

import { expect, test, type BrowserContext } from "@playwright/test";

const APP = process.env.E2E_P1_URL ?? "http://127.0.0.1:2035";
if (!["http://127.0.0.1:2035", "http://127.0.0.1:2036"].includes(APP)) {
  throw new Error("P1 tests only allow the isolated local verification ports");
}
const GATEWAY = APP.endsWith(":2036")
  ? "matrix-law-local-p1-gateway-1"
  : "matrix-law-project-artifacts-gateway-1";
const FILE = "/mnt/user-data/outputs/browser-note.md";
const CONTENT = "# 浏览器真实保存\n\n第一版合成咨询笔记，不是客户材料。";

async function headers(context: BrowserContext) {
  const csrf = (await context.cookies(APP)).find(
    (cookie) => cookie.name === "csrf_token",
  );
  return {
    "X-CSRF-Token": csrf?.value ?? "",
    "Idempotency-Key": randomUUID(),
    Origin: APP,
  };
}

// Only fixture bytes are seeded inside the isolated container. All subsequent
// browser reads, saves, history and download requests go to the real Gateway.
function seedFile(userId: string, threadId: string, content: string) {
  execFileSync("docker", [
    "exec",
    GATEWAY,
    "/app/backend/.venv/bin/python",
    "-c",
    "import sys; from deerflow.config.paths import get_paths; p=get_paths().sandbox_outputs_dir(sys.argv[2], user_id=sys.argv[1]); p.mkdir(parents=True, exist_ok=True); (p/'browser-note.md').write_text(sys.argv[3], encoding='utf-8')",
    userId,
    threadId,
    content,
  ]);
}

for (const width of [1280, 390]) {
  test(`saves native files and reopens immutable project history through real services at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 720 });
    await page.emulateMedia({ colorScheme: width === 390 ? "dark" : "light" });
    const response = await context.request.post(`${APP}/api/v1/auth/register`, {
      data: {
        email: `p1-browser-${randomUUID()}@example.com`,
        password: "Synthetic-Browser-P1-12345",
      },
    });
    expect(response.status()).toBe(201);
    const user = (await response.json()) as { id: string };
    expect(typeof user.id).toBe("string");
    const createdTenant = await context.request.post(`${APP}/api/law/tenants`, {
      headers: await headers(context),
      data: { slug: `browser-${randomUUID()}`, name: "浏览器合成法律团队" },
    });
    expect(createdTenant.status()).toBe(201);
    const tenant = (await createdTenant.json()).data.tenant as { id: string };
    const matterResponse = await context.request.post(
      `${APP}/api/law/tenants/${tenant.id}/matters`,
      {
        headers: await headers(context),
        data: { kind: "consultation", title: "浏览器合成咨询项目" },
      },
    );
    expect(matterResponse.status()).toBe(201);
    const matter = (await matterResponse.json()).data.matter as { id: string };
    const prefix = `${APP}/api/law/tenants/${tenant.id}/matters/${matter.id}`;

    async function thread(title: string, artifacts: string[]) {
      const id = randomUUID();
      expect(
        (
          await context.request.post(`${APP}/api/threads`, {
            headers: await headers(context),
            data: { thread_id: id, metadata: {} },
          })
        ).status(),
      ).toBe(200);
      expect(
        (
          await context.request.post(`${prefix}/threads`, {
            headers: await headers(context),
            data: { thread_id: id, purpose: "matter-chat" },
          })
        ).status(),
      ).toBe(201);
      const state = await context.request.post(
        `${APP}/api/threads/${id}/state`,
        {
          headers: await headers(context),
          data: {
            values: {
              title,
              artifacts,
              messages: [
                {
                  type: "ai",
                  content: "这是一段合成测试会话，不代表模型生成。",
                  id: randomUUID(),
                },
              ],
            },
          },
        },
      );
      expect(state.status(), await state.text()).toBe(200);
      return id;
    }
    const source = await thread("合成文书起草", [FILE]);
    const followup = await thread("合成后续咨询", []);
    const discarded = await thread("合成待删除会话", []);
    seedFile(user.id, source, CONTENT);
    await page.goto(`/workspace/chats/${source}`);
    await expect(page).toHaveURL(new RegExp(`/workspace/chats/${source}$`));
    const addAttachments = page.getByTestId("add-attachments-button");
    await expect(addAttachments).toBeVisible();
    await addAttachments.hover();
    const uploadLimitsTooltip = page.getByRole("tooltip");
    await expect(uploadLimitsTooltip).toContainText("10");
    await expect(uploadLimitsTooltip).toContainText("2 GiB");
    await expect(uploadLimitsTooltip).toContainText("4 GiB");
    await page.getByTestId("artifact-trigger").click();
    await page.getByText("browser-note.md", { exact: true }).click();
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "保存到当前法律项目",
      exact: true,
    });
    await expect(
      dialog.getByText("目标项目：浏览器合成咨询项目"),
    ).toBeVisible();
    await dialog.getByLabel("成果名称").fill("真实链路咨询笔记");
    await dialog.getByLabel("成果类型").selectOption("note");
    await dialog.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(dialog).not.toBeVisible();
    const list = await context.request.get(`${prefix}/project-artifacts`);
    const item = (await list.json()).data.items[0] as { id: string };
    expect(item.id).toBeTruthy();

    seedFile(user.id, source, CONTENT + "\n\n第二版补充说明。");
    await page.reload();
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    await dialog.getByLabel("保存位置").selectOption(item.id);
    await dialog.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(dialog).not.toBeVisible();
    await page.goto(`/workspace/chats/${followup}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: /真实链路咨询笔记/ }).click();
    await expect(
      page.getByText("第二版补充说明。", { exact: true }),
    ).toBeVisible();
    const versions = (
      await (
        await context.request.get(
          `${prefix}/project-artifacts/${item.id}/versions`,
        )
      ).json()
    ).data.items as Array<{ id: string; version_number: number }>;
    const first = versions.find((row) => row.version_number === 1)!;
    await page.getByLabel("历史版本").selectOption(first.id);
    await expect(
      page.getByText("第二版补充说明。", { exact: true }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("heading", { name: "浏览器真实保存" }),
    ).toBeVisible();
    const downloadResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/versions/${first.id}/content`) &&
        r.request().method() === "GET",
    );
    await page.getByRole("button", { name: "下载此版本" }).click();
    const downloaded = await downloadResponse;
    expect(downloaded.status()).toBe(200);
    expect(
      createHash("sha256")
        .update(await downloaded.body())
        .digest("hex"),
    ).toBe(createHash("sha256").update(CONTENT).digest("hex"));
    await page.screenshot({
      path: testInfo.outputPath("real-project-history.png"),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "来源会话" }).click();
    await expect(page).toHaveURL(new RegExp(`/workspace/chats/${source}$`));

    await page.goto(`/workspace/chats/${discarded}`);
    await page
      .getByRole("button", { name: "Toggle Sidebar", exact: true })
      .first()
      .click();
    const deleteAction = page.getByRole("button", {
      name: new RegExp(`(?:删除会话|Delete conversation): 合成待删除会话`),
    });
    await expect(deleteAction).toBeVisible();
    await deleteAction.click();
    await page
      .getByRole("menuitem", { name: /删除会话|Delete conversation/ })
      .click();
    const deleteDialog = page.getByRole("dialog", {
      name: /删除会话|Delete conversation/,
    });
    await expect(deleteDialog).toContainText(/项目成果|project artifacts/i);
    const detachedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/threads/${discarded}/detach`),
    );
    const deletedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith(`/threads/${discarded}`),
    );
    await deleteDialog
      .getByRole("button", {
        name: /删除会话|Delete conversation/,
        exact: true,
      })
      .click();
    expect((await detachedResponse).status()).toBe(200);
    expect((await deletedResponse).status()).toBe(200);
    await expect(page).toHaveURL(
      new RegExp(`/workspace/law\\?tenant=${tenant.id}&matter=${matter.id}$`),
    );
    await expect(
      page.locator(`a[href="/workspace/chats/${discarded}"]`),
    ).toHaveCount(0);
    await expect(
      page.locator(`a[href="/workspace/chats/${source}"]`).first(),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.locator(`a[href="/workspace/chats/${source}"]`).first(),
    ).toBeVisible();
    await expect(
      page.locator(`a[href="/workspace/chats/${discarded}"]`),
    ).toHaveCount(0);
    const mappings = (
      await (await context.request.get(`${prefix}/threads`)).json()
    ).data.items as Array<{ thread_id: string; status: string }>;
    expect(
      mappings.find((mapping) => mapping.thread_id === discarded)?.status,
    ).toBe("detached");
    expect(
      (await context.request.get(`${APP}/api/threads/${discarded}`)).status(),
    ).toBe(404);
  });
}
