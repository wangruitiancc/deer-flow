import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { parseLegalGraph } from "../../src/core/law/legal-graph";

const APP = "http://127.0.0.1:2035";
const resultFile = process.env.MATRIX_LAW_LIVE_RESULT ?? "";
const baseline = path.resolve("../../matrix-law-deerflow/.baseline");
if (
  process.env.MATRIX_LAW_LIVE_GRAPH !== "1" ||
  !path.resolve(resultFile).startsWith(`${baseline}/g4-live-graph-`) ||
  path.basename(resultFile) !== "legacy-ui-result.json"
)
  throw new Error(
    "Use the synthetic-only Python --execute-model --with-legacy-ui orchestrator",
  );

type Run = { run_id: string; status: string };
type Uploaded = {
  filename: string;
  virtual_path: string;
  artifact_url: string;
};
type Message = {
  type: string;
  name?: string;
  status?: string;
  content?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string; args: { path?: string } }[];
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("native legacy graph upload, real model, right artifact and scanned project save", async ({
  page,
  context,
}, info) => {
  async function headers() {
    return {
      Origin: APP,
      "X-CSRF-Token":
        (await context.cookies(APP)).find(
          (cookie) => cookie.name === "csrf_token",
        )?.value ?? "",
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
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await post(
    "/api/v1/auth/register",
    {
      email: `legacy-live-${randomUUID()}@example.com`,
      password: "Synthetic-Legacy-Acceptance-12345",
    },
    201,
  );
  const tenant = (
    await post(
      "/api/law/tenants",
      { slug: `legacy-${randomUUID()}`, name: "合成图谱迁移验收" },
      201,
    )
  ).data.tenant as { id: string };
  const matter = (
    await post(
      `/api/law/tenants/${tenant.id}/matters`,
      { kind: "consultation", title: "合成旧图谱导入（非客户材料）" },
      201,
    )
  ).data.matter as { id: string };
  const prefix = `/api/law/tenants/${tenant.id}/matters/${matter.id}`;
  const thread = randomUUID();
  await post("/api/threads", { thread_id: thread, metadata: {} }, 200);
  await post(
    `${prefix}/threads`,
    { thread_id: thread, purpose: "legacy-live-acceptance" },
    201,
  );
  const runPath = `/api/threads/${thread}/runs`;
  async function runs(): Promise<Run[]> {
    const response = await context.request.get(`${APP}${runPath}`);
    expect(response.status()).toBe(200);
    return response.json() as Promise<Run[]>;
  }
  let finished = false;
  try {
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: "转换旧图谱" }).click();
    const dialog = page.getByRole("dialog", { name: "转换旧版案情图谱" });
    const legacy = JSON.stringify({
      caseId: "synthetic-old-case-not-current-authority",
      updatedAt: "2026-08-01T00:00:00Z",
      lastAngle: "person",
      nodes: [
        {
          id: "旧甲",
          label: "合成甲公司",
          type: "party",
          category: "person",
          x: 50,
          y: 80,
        },
        { id: "旧乙", label: "合成乙公司", type: "party", category: "person" },
        {
          id: "旧签约",
          label: "合成服务合同签约",
          type: "event",
          category: "timeline",
          date: "2026-08",
        },
      ],
      edges: [
        {
          id: "person:0:甲-签约",
          source: "旧甲",
          target: "旧签约",
          type: "签约",
          category: "person",
          confidence: "EXTRACTED",
          sourceRef: "synthetic-old-contract.pdf",
          sourceQuote: "合成甲公司与合成乙公司于2026年8月签订服务合同。",
          angleId: "person",
        },
        {
          id: "person:1:乙-签约",
          source: "旧乙",
          target: "旧签约",
          type: "签约",
          category: "person",
          confidence: "EXTRACTED",
          sourceRef: "synthetic-old-contract.pdf",
          sourceQuote: "合成甲公司与合成乙公司于2026年8月签订服务合同。",
          angleId: "person",
        },
      ],
    });
    await dialog.getByLabel(/选择旧项目/).setInputFiles({
      name: "synthetic-old-graph.json",
      mimeType: "application/json",
      buffer: Buffer.from(legacy),
    });
    const downloads: Buffer[] = [];
    for (const name of ["下载转换图谱", "下载完整迁移报告"]) {
      const pending = page.waitForEvent("download");
      await dialog.getByRole("link", { name }).click();
      downloads.push(readFileSync(await (await pending).path()));
    }
    const candidate = parseLegalGraph(downloads[0]!.toString("utf8"));
    await dialog.getByRole("button", { name: "放入当前会话草稿" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Remove attachment" }),
    ).toHaveCount(2);
    await page.getByRole("button", { name: "Close toast" }).click();
    expect(await runs()).toHaveLength(0);
    const pendingUpload = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/threads/${thread}/uploads`,
    );
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    const uploadResponse = await pendingUpload;
    expect(uploadResponse.status()).toBe(200);
    const uploaded = (await uploadResponse.json()).files as Uploaded[];
    expect(uploaded).toHaveLength(2);
    for (let index = 0; index < uploaded.length; index++) {
      const url = new URL(uploaded[index]!.artifact_url, APP);
      expect(url.origin).toBe(APP);
      const response = await context.request.get(url.href);
      expect(response.status()).toBe(200);
      expect(await response.body()).toEqual(downloads[index]);
    }
    await expect
      .poll(async () => (await runs()).length, { timeout: 30_000 })
      .toBe(1);
    const runId = (await runs())[0]!.run_id;
    await expect
      .poll(
        async () => {
          const response = await context.request.get(
            `${APP}${runPath}/${runId}`,
          );
          const run = (await response.json()) as Run;
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
    const state = (await stateResponse.json()).values as {
      messages: Message[];
      artifacts: string[];
    };
    const calls = state.messages.flatMap((message) => message.tool_calls ?? []);
    const toolNames = state.messages
      .filter((message) => message.type === "tool")
      .map((message) => message.name);
    for (const name of [
      "read_file",
      "write_file",
      "law_validate_graph",
      "present_files",
    ])
      expect(toolNames).toContain(name);
    expect(toolNames).not.toContain("law_create_citation");
    for (let index = 0; index < uploaded.length; index++) {
      const item = uploaded[index]!;
      const reads = calls.filter(
        (call) =>
          call.name === "read_file" && call.args.path === item.virtual_path,
      );
      expect(reads.length).toBeGreaterThan(0);
      const marker =
        index === 0
          ? "matrix-law.legal-graph"
          : "matrix-law.legacy-import-report";
      expect(
        state.messages.some(
          (message) =>
            message.type === "tool" &&
            reads.some((call) => call.id === message.tool_call_id) &&
            message.status !== "error" &&
            message.content?.includes(marker),
        ),
      ).toBe(true);
      const originalAfterRun = await context.request.get(
        new URL(item.artifact_url, APP).href,
      );
      expect(originalAfterRun.status()).toBe(200);
      expect(await originalAfterRun.body()).toEqual(downloads[index]);
    }
    expect(
      state.messages.some(
        (message) =>
          message.type === "tool" &&
          message.name === "law_validate_graph" &&
          (JSON.parse(message.content ?? "{}") as { status?: string })
            .status === "ok",
      ),
    ).toBe(true);
    for (const call of calls.filter((call) => call.name === "write_file"))
      expect(call.args.path?.startsWith("/mnt/user-data/outputs/")).toBe(true);
    const outputs = state.artifacts.filter(
      (file) =>
        file.startsWith("/mnt/user-data/outputs/") &&
        file.endsWith(".law-graph.json"),
    );
    expect(outputs).toHaveLength(1);
    const outputPath = outputs[0]!;
    const outputResponse = await context.request.get(
      `${APP}/api/threads/${thread}/artifacts${outputPath}?download=true`,
    );
    expect(outputResponse.status()).toBe(200);
    const bytes = await outputResponse.body();
    const output = parseLegalGraph(bytes.toString("utf8"));
    expect(output.nodes).toEqual(candidate.nodes);
    expect(output.edges).toEqual(candidate.edges);
    expect(output.sources).toEqual(candidate.sources);
    expect(
      output.sources.every((source) => source.kind === "legacy_unmapped"),
    ).toBe(true);
    expect(output.nodes.find((node) => node.type === "event")?.date).toEqual({
      value: "2026-08",
      origin: "legacy_inferred",
    });
    // The real response must be rendered by the native artifact panel.
    if (!(await page.getByRole("tab", { name: "本会话文件" }).isVisible()))
      await page.getByTestId("artifact-trigger").click();
    await page.getByRole("tab", { name: "本会话文件" }).click();
    if (!(await page.getByRole("region", { name: "案情图谱" }).isVisible()))
      await page
        .getByText(path.basename(outputPath), { exact: true })
        .first()
        .click();
    await expect(page.getByRole("region", { name: "案情图谱" })).toBeVisible();
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    const save = page.getByRole("dialog", {
      name: "保存到当前法律项目",
      exact: true,
    });
    await expect(save.getByLabel("成果类型")).toHaveValue("knowledge_graph");
    await save.getByLabel("成果名称").fill("合成旧图谱导入成果（未审核）");
    await save.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(save).toHaveCount(0);
    const list = await context.request.get(`${APP}${prefix}/project-artifacts`);
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
    await page.screenshot({
      path: info.outputPath("legacy-live-saved.png"),
      animations: "disabled",
    });
    writeFileSync(
      resultFile,
      JSON.stringify({
        result: "passed",
        thread_id: thread,
        run_id: runId,
        artifact_id: items[0]!.id,
        sha256: sha(bytes),
        uploaded_sha256: downloads.map(sha),
        tools: [...new Set(toolNames)].sort(),
        nodes: output.nodes.length,
        edges: output.edges.length,
        scope:
          "real native browser upload/model/artifact/scanned save of synthetic legacy graph; sources deliberately unmapped, not legal quality or source-mapping acceptance",
      }),
    );
    finished = true;
  } finally {
    if (!finished)
      for (const run of await runs())
        if (["pending", "running"].includes(run.status))
          await context.request.post(`${APP}${runPath}/${run.run_id}/cancel`, {
            headers: await headers(),
          });
  }
});
