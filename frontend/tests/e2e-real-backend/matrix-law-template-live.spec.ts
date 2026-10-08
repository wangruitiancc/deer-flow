import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const APP = "http://127.0.0.1:2035";
const resultFile = process.env.MATRIX_LAW_LIVE_RESULT ?? "";
const canonical = path.resolve("../../matrix-law-deerflow");
if (
  process.env.MATRIX_LAW_LIVE_TEMPLATE !== "1" ||
  !path
    .resolve(resultFile)
    .startsWith(`${canonical}/.baseline/g4-live-graph-`) ||
  path.basename(resultFile) !== "template-ui-result.json"
)
  throw new Error("Use --execute-model --with-template-ui orchestrator");

type Run = { run_id: string; status: string };
type Message = {
  type: string;
  status?: string;
  content?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string }[];
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("template picker, ordinary Send, real model, native file and scanned project version", async ({
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
    const r = await context.request.post(`${APP}${url}`, {
      data,
      headers: await headers(),
    });
    expect(r.status()).toBe(status);
    return r.json();
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await post(
    "/api/v1/auth/register",
    {
      email: `p1-template-live-${randomUUID()}@example.com`,
      password: "Synthetic-Template-Live-12345",
    },
    201,
  );
  const tenant = (
    await post(
      "/api/law/tenants",
      { slug: `template-live-${randomUUID()}`, name: "合成模板链路验收" },
      201,
    )
  ).data.tenant as { id: string };
  const matter = (
    await post(
      `/api/law/tenants/${tenant.id}/matters`,
      { kind: "consultation", title: "合成合同审查（非客户材料）" },
      201,
    )
  ).data.matter as { id: string };
  const prefix = `/api/law/tenants/${tenant.id}/matters/${matter.id}`;
  const thread = randomUUID();
  await post("/api/threads", { thread_id: thread, metadata: {} }, 200);
  await post(
    `${prefix}/threads`,
    { thread_id: thread, purpose: "template-live-acceptance" },
    201,
  );
  const runPath = `/api/threads/${thread}/runs`;
  async function runs(): Promise<Run[]> {
    const r = await context.request.get(`${APP}${runPath}`);
    expect(r.status()).toBe(200);
    return r.json();
  }
  let finished = false;
  try {
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("button", { name: "用模板起草", exact: true }).click();
    const picker = page.getByRole("dialog", {
      name: "用模板起草",
      exact: true,
    });
    await picker.getByLabel("模板类型").selectOption("contract-review");
    const title = "合成合同审查模板（待填写）";
    await picker.getByLabel("草稿标题").fill(title);
    await picker.getByRole("button", { name: "放入当前会话草稿" }).click();
    await expect(picker).not.toBeVisible();
    const input = page.getByPlaceholder(
      /请描述当前法律问题或工作任务|Describe the current legal question or task/,
    );
    await expect(input).toHaveValue(/law_create_template_draft/);
    expect(await input.inputValue()).not.toContain("/matrix-law-templates");
    expect(await runs()).toHaveLength(0);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    await expect
      .poll(async () => (await runs()).length, { timeout: 30_000 })
      .toBe(1);
    const runId = (await runs())[0]!.run_id;
    console.log(
      JSON.stringify({
        stage: "template_ui_run_started",
        thread_id: thread,
        run_id: runId,
      }),
    );
    await expect
      .poll(
        async () => {
          const r = await context.request.get(`${APP}${runPath}/${runId}`);
          expect(r.status()).toBe(200);
          const run = (await r.json()) as Run;
          return ["pending", "running"].includes(run.status)
            ? "active"
            : run.status;
        },
        { timeout: 300_000, intervals: [2000] },
      )
      .toBe("success");
    const stateResponse = await context.request.get(
      `${APP}/api/threads/${thread}/state`,
    );
    expect(stateResponse.status()).toBe(200);
    const state = (await stateResponse.json()).values as {
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
        calls.get(m.tool_call_id ?? "")?.name === "law_create_template_draft",
    );
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0]!.content ?? "{}") as {
      status: string;
      data: {
        path: string;
        template_id: string;
        template_sha256: string;
        content_sha256: string;
        saved_to_project: boolean;
      };
    };
    expect(receipt.status).toBe("ok");
    expect(receipt.data.template_id).toBe("contract-review");
    expect(receipt.data.saved_to_project).toBe(false);
    const outputPath = receipt.data.path;
    expect(outputPath).toMatch(
      /^\/mnt\/user-data\/outputs\/draft-[0-9a-f]{32}\.md$/,
    );
    expect(state.artifacts).toContain(outputPath);
    expect(
      [...calls.values()].some((c) =>
        ["write_file", "str_replace"].includes(c.name),
      ),
    ).toBe(false);
    const source = readFileSync(
      path.join(
        canonical,
        "skills/public/matrix-law-templates/assets/contract-review.md",
      ),
    );
    const values: Record<string, string> = {
      title,
      case: "当前法律项目",
      date: "待填写",
      time: "待填写",
    };
    const expected = Buffer.from(
      source
        .toString("utf8")
        .replace(
          /{{(title|case|date|time)}}/g,
          (_match, key: string) => values[key]!,
        ),
    );
    const response = await context.request.get(
      `${APP}/api/threads/${thread}/artifacts${outputPath}?download=true`,
    );
    expect(response.status()).toBe(200);
    const bytes = await response.body();
    expect(bytes).toEqual(expected);
    expect(receipt.data.template_sha256).toBe(sha(source));
    expect(receipt.data.content_sha256).toBe(sha(bytes));
    const events = await context.request.get(
      `${APP}${runPath}/${runId}/events?event_types=run.delivery`,
    );
    expect(events.status()).toBe(200);
    const delivery = (await events.json()) as {
      content: {
        satisfied: boolean;
        matched_paths: string[];
        by_tool: { present_files?: string[] };
      };
    }[];
    expect(delivery).toHaveLength(1);
    expect(delivery[0]!.content.satisfied).toBe(true);
    expect(delivery[0]!.content.matched_paths).toContain(outputPath);
    expect(delivery[0]!.content.by_tool.present_files).toContain(outputPath);
    if (!(await page.getByRole("tab", { name: "本会话文件" }).isVisible()))
      await page.getByTestId("artifact-trigger").click();
    await page.getByRole("tab", { name: "本会话文件" }).click();
    if (
      !(await page
        .getByRole("button", { name: "保存到项目", exact: true })
        .isVisible())
    )
      await page
        .getByRole("tabpanel", { name: "本会话文件" })
        .getByText(path.basename(outputPath), { exact: true })
        .click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    const save = page.getByRole("dialog", {
      name: "保存到当前法律项目",
      exact: true,
    });
    await save.getByLabel("成果名称").fill(title);
    await save.getByLabel("成果类型").selectOption("document");
    await save.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(save).not.toBeVisible();
    const list = await context.request.get(`${APP}${prefix}/project-artifacts`);
    expect(list.status()).toBe(200);
    const items = (await list.json()).data.items as { id: string }[];
    expect(items).toHaveLength(1);
    const versionsResponse = await context.request.get(
      `${APP}${prefix}/project-artifacts/${items[0]!.id}/versions`,
    );
    const versions = (await versionsResponse.json()).data.items as {
      id: string;
      review_status: string;
    }[];
    expect(versions).toHaveLength(1);
    expect(versions[0]!.review_status).toBe("unreviewed");
    const restored = await context.request.get(
      `${APP}${prefix}/project-artifacts/${items[0]!.id}/versions/${versions[0]!.id}/content`,
    );
    expect(restored.status()).toBe(200);
    expect(await restored.body()).toEqual(bytes);
    expect(
      readFileSync(
        path.join(
          canonical,
          "skills/public/matrix-law-templates/assets/contract-review.md",
        ),
      ),
    ).toEqual(source);
    await page.screenshot({
      path: info.outputPath("template-live-saved.png"),
      animations: "disabled",
    });
    writeFileSync(
      resultFile,
      JSON.stringify({
        result: "passed",
        thread_id: thread,
        run_id: runId,
        artifact_id: items[0]!.id,
        source_sha256: sha(source),
        output_sha256: sha(bytes),
        scope:
          "one synthetic contract-review template through actual picker/Send/model/native file/scanned project save; not tenant custom templates or legal quality",
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
