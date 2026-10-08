import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const APP = "http://127.0.0.1:2035";
const resultFile = process.env.MATRIX_LAW_LIVE_RESULT ?? "";
const canonical = path.resolve("../../matrix-law-deerflow");
const drafting = process.env.MATRIX_LAW_LIVE_CUSTOM_TEMPLATE_MODE === "draft";
const resultName = drafting
  ? "custom-template-draft-ui-result.json"
  : "custom-template-ui-result.json";
if (
  process.env.MATRIX_LAW_LIVE_CUSTOM_TEMPLATE !== "1" ||
  !path
    .resolve(resultFile)
    .startsWith(`${canonical}/.baseline/g4-live-graph-`) ||
  !["copy", "draft"].includes(
    process.env.MATRIX_LAW_LIVE_CUSTOM_TEMPLATE_MODE ?? "copy",
  ) ||
  path.basename(resultFile) !== resultName
)
  throw new Error("Use --execute-model --with-custom-template-ui orchestrator");

type Run = { run_id: string; status: string };
type Message = {
  type: string;
  status?: string;
  content?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string }[];
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test(`legacy UI import, historical selection, Send/model, ${drafting ? "rendered draft" : "exact copy"}, native editor and explicit saves`, async ({
  page,
  context,
}, info) => {
  async function headers() {
    return {
      Origin: APP,
      "X-CSRF-Token":
        (await context.cookies(APP)).find((c) => c.name === "csrf_token")
          ?.value ?? "",
      "Idempotency-Key": randomUUID(),
    };
  }
  async function post(url: string, data: object, status: number) {
    const response = await context.request.post(`${APP}${url}`, {
      data,
      headers: await headers(),
    });
    expect(response.status()).toBe(status);
    return response.json();
  }
  async function get(url: string) {
    const response = await context.request.get(`${APP}${url}`);
    expect(response.status()).toBe(200);
    return response.json();
  }
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await post(
    "/api/v1/auth/register",
    {
      email: `p1-custom-live-${randomUUID()}@example.com`,
      password: "Synthetic-Custom-Template-Live-12345",
    },
    201,
  );
  const tenant = (
    await post(
      "/api/law/tenants",
      {
        slug: `custom-live-${randomUUID()}`,
        name: "合成自定义模板链路验收",
      },
      201,
    )
  ).data.tenant as { id: string };
  const matter = (
    await post(
      `/api/law/tenants/${tenant.id}/matters`,
      {
        kind: "consultation",
        title: "合成独立法律咨询（非客户材料）",
      },
      201,
    )
  ).data.matter as { id: string };
  const prefix = `/api/law/tenants/${tenant.id}/matters/${matter.id}`;
  const templates = `/api/law/tenants/${tenant.id}/templates`;
  const first =
    "\ufeff# 合成模板历史第一版\r\n\r\n标题：{{title}}\r\n日期：{{date:YYYY年MM月DD日}}\r\n字面路径：/mnt/user-data/outputs/literal.md\r\n" +
    (drafting
      ? "项目：{{case}}\r\n时间：{{time}}\r\n精确到秒：{{time:HH时mm分ss秒}}\r\n未知字段：{{unknown}}\r\n"
      : "");
  const expectedDraft =
    "\ufeff# 合成模板历史第一版\r\n\r\n标题：合成填值标题 {{case}}\r\n日期：2024年02月29日\r\n字面路径：/mnt/user-data/outputs/literal.md\r\n项目：合成顾问服务主题\r\n时间：03:04\r\n精确到秒：待填写\r\n未知字段：{{unknown}}\r\n";
  const expectedTool = drafting
    ? "law_create_custom_template_draft"
    : "law_open_custom_template";
  const second = "# 合成模板第二版\n\n这是不同历史版本，不应被自动选择。\n";
  const thread = randomUUID();
  await post("/api/threads", { thread_id: thread, metadata: {} }, 200);
  await post(
    `${prefix}/threads`,
    { thread_id: thread, purpose: "custom-template-live-acceptance" },
    201,
  );
  const runPath = `/api/threads/${thread}/runs`;
  async function runs(): Promise<Run[]> {
    return get(runPath);
  }
  let finished = false;
  try {
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("button", { name: "用模板起草", exact: true }).click();
    await page
      .getByRole("dialog", { name: "用模板起草", exact: true })
      .getByRole("button", { name: "导入旧模板", exact: true })
      .click();
    const importer = page.getByRole("dialog", {
      name: "导入旧模板",
      exact: true,
    });
    await importer.getByLabel(/旧模板文件/).setInputFiles({
      name: "合成历史模板.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(first),
    });
    await importer.getByLabel("新模板名称").fill("合成历史模板");
    await expect(
      importer.getByRole("button", { name: "确认导入新模板" }),
    ).toBeDisabled();
    await importer.getByRole("checkbox").check();
    await importer.getByRole("button", { name: "确认导入新模板" }).click();
    await expect(importer.getByText(/已导入为新模板第 1 版/)).toBeVisible();
    const imported = (await get(templates)).data.items as {
      id: string;
      name: string;
    }[];
    expect(imported).toHaveLength(1);
    const template = imported[0]!.id;
    expect(imported[0]!.name).toBe("合成历史模板");
    expect(
      Buffer.from(
        (await get(`${templates}/${template}/versions/1`)).data.content,
      ),
    ).toEqual(Buffer.from(first));
    const updated = await context.request.patch(
      `${APP}${templates}/${template}`,
      {
        data: { expected_version: 1, content: second },
        headers: await headers(),
      },
    );
    expect(updated.status()).toBe(200);
    await importer
      .getByRole("button", { name: "自定义模板", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "打开自定义模板",
      exact: true,
    });
    await picker.getByLabel("自定义模板").selectOption(template);
    await expect(picker.getByLabel("正文版本").locator("option")).toHaveCount(
      3,
    );
    await picker.getByLabel("正文版本").selectOption("1");
    if (drafting) {
      await picker.getByLabel("打开方式").selectOption("draft");
      await picker.getByLabel("文书标题").fill("合成填值标题 {{case}}");
      await picker.getByLabel("项目显示名称").fill("合成顾问服务主题");
      await picker.getByLabel("草稿创建日期").fill("2024-02-29");
      await picker.getByLabel("草稿创建时间").fill("03:04");
      await expect(
        picker.getByRole("heading", { name: "打开自定义模板" }),
      ).toBeInViewport({ ratio: 1 });
    }
    await picker.getByRole("button", { name: "放入当前会话草稿" }).click();
    await expect(picker).not.toBeVisible();
    const input = page.getByPlaceholder(
      /请描述当前法律问题或工作任务|Describe the current legal question or task/,
    );
    await expect(input).toHaveValue(new RegExp(expectedTool));
    await expect(
      page.getByText("模板选择.json", { exact: true }),
    ).toBeVisible();
    expect(await input.inputValue()).not.toContain(template);
    expect(await input.inputValue()).not.toContain("合成填值标题");
    expect(await input.inputValue()).not.toContain("2024-02-29");
    expect(await runs()).toHaveLength(0);
    // Submit exactly the product's staged selection; no test-authored rescue prompt.
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect
      .poll(async () => (await runs()).length, { timeout: 30_000 })
      .toBe(1);
    const runId = (await runs())[0]!.run_id;
    console.log(
      JSON.stringify({
        stage: "custom_template_run_started",
        thread_id: thread,
        run_id: runId,
      }),
    );
    await expect
      .poll(
        async () => {
          const run = (await get(`${runPath}/${runId}`)) as Run;
          return ["pending", "running"].includes(run.status)
            ? "active"
            : run.status;
        },
        { timeout: 300_000, intervals: [2000] },
      )
      .toBe("success");
    const state = (await get(`/api/threads/${thread}/state`)).values as {
      messages: Message[];
      artifacts: string[];
    };
    const calls = new Map(
      state.messages.flatMap((m) => m.tool_calls ?? []).map((c) => [c.id, c]),
    );
    const receipts = state.messages.filter(
      (m) =>
        m.type === "tool" &&
        m.status !== "error" &&
        calls.get(m.tool_call_id ?? "")?.name === expectedTool,
    );
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0]!.content ?? "{}") as {
      status: string;
      data: {
        path: string;
        template_id: string;
        version_number: number;
        template_sha256: string;
        content_sha256: string;
        variables_preserved: boolean;
        variables_rendered?: boolean;
        renderer?: string;
        saved_to_template: boolean;
        saved_to_project: boolean;
      };
    };
    expect(receipt.status).toBe("ok");
    expect(receipt.data).toMatchObject({
      template_id: template,
      version_number: 1,
      variables_preserved: !drafting,
      saved_to_template: false,
      saved_to_project: false,
    });
    if (drafting)
      expect(receipt.data).toMatchObject({
        variables_rendered: true,
        renderer: "legacy-placeholder-v1",
      });
    const templateCalls = [...calls.values()].filter((call) =>
      [
        "law_open_custom_template",
        "law_create_custom_template_draft",
        "law_create_template_draft",
      ].includes(call.name),
    );
    expect(templateCalls.map((call) => call.name)).toEqual([expectedTool]);
    const outputPath = receipt.data.path;
    expect(outputPath).toMatch(
      /^\/mnt\/user-data\/outputs\/draft-[0-9a-f]{32}\.md$/,
    );
    expect(state.artifacts).toContain(outputPath);
    expect([...calls.values()].some((c) => c.name === "read_file")).toBe(true);
    expect(
      [...calls.values()].some((c) =>
        ["write_file", "str_replace"].includes(c.name),
      ),
    ).toBe(false);
    async function output() {
      const response = await context.request.get(
        `${APP}/api/threads/${thread}/artifacts${outputPath}?download=true`,
      );
      expect(response.status()).toBe(200);
      return response.body();
    }
    const originalBytes = Buffer.from(first, "utf8");
    const generatedBytes = Buffer.from(
      drafting ? expectedDraft : first,
      "utf8",
    );
    expect(await output()).toEqual(generatedBytes);
    expect(receipt.data.template_sha256).toBe(sha(originalBytes));
    expect(receipt.data.content_sha256).toBe(sha(generatedBytes));
    const deliveries = (await get(
      `${runPath}/${runId}/events?event_types=run.delivery`,
    )) as {
      content: {
        satisfied: boolean;
        matched_paths: string[];
        by_tool: { present_files?: string[] };
      };
    }[];
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.content.satisfied).toBe(true);
    expect(deliveries[0]!.content.matched_paths).toContain(outputPath);
    expect(deliveries[0]!.content.by_tool.present_files).toContain(outputPath);
    expect(
      (await get(`${templates}/${template}/versions`)).data.items,
    ).toHaveLength(2);
    expect((await get(`${prefix}/project-artifacts`)).data.items).toHaveLength(
      0,
    );
    if (!(await page.getByRole("tab", { name: "本会话文件" }).isVisible()))
      await page.getByTestId("artifact-trigger").click();
    await page.getByRole("tab", { name: "本会话文件" }).click();
    if (
      !(await page
        .getByRole("button", { name: "保存为模板", exact: true })
        .isVisible())
    )
      await page
        .getByRole("tabpanel", { name: "本会话文件" })
        .getByText(path.basename(outputPath), { exact: true })
        .click();
    await expect(
      page.getByRole("heading", { name: "合成模板历史第一版", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("custom-template-exact-copy.png"),
      animations: "disabled",
    });

    const edited =
      "# 合成模板人工编辑版\n\n保留占位：{{title}} {{date:YYYY年MM月DD日}}\n\n人工核对说明：仅合成内容，尚未审核。\n";
    await page.getByRole("button", { name: /^(Edit|编辑)$/ }).click();
    const editor = page.locator('.cm-content[contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.click();
    await editor.press("ControlOrMeta+A");
    await page.keyboard.insertText(edited);
    await expect(
      page.getByRole("button", { name: "保存为模板", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: /^(Save|保存)$/ }).click();
    await expect
      .poll(async () => sha(await output()))
      .toBe(sha(Buffer.from(edited)));
    await page
      .getByRole("button", { name: /^(Exit editing|退出编辑)$/ })
      .click();
    // Native exit preserves source mode. Its existing two radio controls are
    // source then preview; explicitly select preview before asserting headings.
    await expect(page.getByRole("radio")).toHaveCount(2);
    await page.getByRole("radio").nth(1).click();
    await expect(
      page.getByRole("heading", { name: "合成模板人工编辑版", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "保存为模板", exact: true }).click();
    const saveTemplate = page.getByRole("dialog", {
      name: "保存为模板",
      exact: true,
    });
    await saveTemplate.getByLabel("保存位置").selectOption(template);
    await saveTemplate.getByRole("button", { name: "保存模板版本" }).click();
    await expect(saveTemplate).not.toBeVisible();
    const versions = (await get(`${templates}/${template}/versions`)).data
      .items as { version_number: number }[];
    expect(versions).toHaveLength(3);
    for (const [number, expected] of [
      [1, first],
      [2, second],
      [3, edited],
    ] as const) {
      const saved = (await get(`${templates}/${template}/versions/${number}`))
        .data as { content: string; version: { content_sha256: string } };
      expect(Buffer.from(saved.content)).toEqual(Buffer.from(expected));
      expect(saved.version.content_sha256).toBe(sha(Buffer.from(expected)));
    }
    // Same native file can explicitly create a separate personal template.
    await page.getByRole("button", { name: "保存为模板", exact: true }).click();
    await saveTemplate.getByLabel("保存位置").selectOption("new");
    await saveTemplate.getByLabel("模板名称").fill("合成另存个人模板");
    await saveTemplate.getByRole("button", { name: "保存模板版本" }).click();
    await expect(saveTemplate).not.toBeVisible();
    const items = (await get(templates)).data.items as {
      id: string;
      name: string;
      visibility: string;
    }[];
    expect(items).toHaveLength(2);
    const copied = items.find((item) => item.name === "合成另存个人模板")!;
    expect(copied.visibility).toBe("private");
    expect(
      (await get(`${templates}/${copied.id}/versions/1`)).data.content,
    ).toBe(edited);
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    const saveProject = page.getByRole("dialog", {
      name: "保存到当前法律项目",
      exact: true,
    });
    await saveProject.getByLabel("成果名称").fill("合成模板编辑后成果");
    await saveProject.getByLabel("成果类型").selectOption("document");
    await saveProject.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(saveProject).not.toBeVisible();
    const artifacts = (await get(`${prefix}/project-artifacts`)).data.items as {
      id: string;
    }[];
    expect(artifacts).toHaveLength(1);
    const artifactVersions = (
      await get(`${prefix}/project-artifacts/${artifacts[0]!.id}/versions`)
    ).data.items as { id: string; review_status: string }[];
    expect(artifactVersions).toHaveLength(1);
    expect(artifactVersions[0]!.review_status).toBe("unreviewed");
    const download = await context.request.get(
      `${APP}${prefix}/project-artifacts/${artifacts[0]!.id}/versions/${artifactVersions[0]!.id}/content`,
    );
    expect(download.status()).toBe(200);
    expect(await download.body()).toEqual(Buffer.from(edited));
    expect(await runs()).toHaveLength(1);
    expect(pageErrors).toEqual([]);
    await page.screenshot({
      path: info.outputPath("custom-template-edited-saved.png"),
      animations: "disabled",
    });
    writeFileSync(
      resultFile,
      JSON.stringify({
        result: "passed",
        thread_id: thread,
        run_id: runId,
        template_id: template,
        copied_template_id: copied.id,
        artifact_id: artifacts[0]!.id,
        original_sha256: sha(originalBytes),
        generated_sha256: sha(generatedBytes),
        variables_rendered: drafting,
        edited_sha256: sha(Buffer.from(edited)),
        scope: `one synthetic legacy UI import/historical private template via picker/Send/MiniMax/${drafting ? "explicit variable rendering" : "exact native copy"}/editor/template append+new/project save; not mobile model matrix or legal quality`,
      }),
    );
    finished = true;
  } finally {
    if (!finished)
      for (const run of await runs())
        if (["pending", "running"].includes(run.status)) {
          const response = await context.request.post(
            `${APP}${runPath}/${run.run_id}/cancel?wait=true`,
            { headers: await headers() },
          );
          expect(response.status()).toBe(204);
        }
  }
});
