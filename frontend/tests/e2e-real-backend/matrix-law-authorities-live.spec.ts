import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { parseLegalAuthorities } from "../../src/core/law/legal-authorities";
import { LEGACY_AUTHORITIES_HANDOFF_PROMPT } from "../../src/core/law/legal-authorities-import";

import {
  assertAuthoritiesImportEvidence,
  type AuthoritiesMessage,
} from "./authorities-import-evidence";
import { createAuthoritiesLiveFixture } from "./authorities-live-fixture";

const APP = "http://127.0.0.1:2035";
const resultFile = process.env.MATRIX_LAW_LIVE_RESULT ?? "";
const baseline = path.resolve("../../matrix-law-deerflow/.baseline");
const fixtureSize = process.env.MATRIX_LAW_LIVE_AUTHORITIES_CASE ?? "small";
if (
  !["small", "large"].includes(fixtureSize) ||
  process.env.MATRIX_LAW_LIVE_AUTHORITIES !== "1" ||
  !path.resolve(resultFile).startsWith(`${baseline}/g4-live-graph-`) ||
  path.basename(resultFile) !== "authorities-ui-result.json"
)
  throw new Error("Use --execute-model --with-authorities-ui orchestrator");

type Run = { run_id: string; status: string };
type Uploaded = {
  filename: string;
  virtual_path: string;
  artifact_url: string;
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test(`legacy authorities ${fixtureSize} UI, normal Send, exact real-model delivery and scanned project history`, async ({
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
  async function bytes(url: string) {
    const target = new URL(url, APP);
    expect(target.origin).toBe(APP);
    const response = await context.request.get(target.href);
    expect(response.status()).toBe(200);
    return response.body();
  }
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
  await post(
    "/api/v1/auth/register",
    {
      email: `authorities-live-${randomUUID()}@example.com`,
      password: "Synthetic-Authorities-Live-12345",
    },
    201,
  );
  const tenant = (
    await post(
      "/api/law/tenants",
      { slug: `authorities-live-${randomUUID()}`, name: "合成法律依据验收" },
      201,
    )
  ).data.tenant as { id: string };
  const matter = (
    await post(
      `/api/law/tenants/${tenant.id}/matters`,
      { kind: "consultation", title: "合成单次咨询（非客户数据）" },
      201,
    )
  ).data.matter as { id: string };
  const prefix = `/api/law/tenants/${tenant.id}/matters/${matter.id}`;
  const thread = randomUUID();
  await post("/api/threads", { thread_id: thread, metadata: {} }, 200);
  await post(
    `${prefix}/threads`,
    { thread_id: thread, purpose: "authorities-live-acceptance" },
    201,
  );
  const runPath = `/api/threads/${thread}/runs`;
  const runs = async (): Promise<Run[]> => get(runPath);
  let finished = false;
  try {
    const { original, legacy, count } = createAuthoritiesLiveFixture(
      fixtureSize as "small" | "large",
    );
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page
      .getByRole("button", { name: "导入旧法条收藏", exact: true })
      .click();
    const importer = page.getByRole("dialog", {
      name: "导入旧法条收藏",
      exact: true,
    });
    await importer.getByLabel(/选择旧项目/).setInputFiles({
      name: "law-refs.json",
      mimeType: "application/json",
      buffer: Buffer.from(legacy),
    });
    await expect(
      importer.getByText(
        new RegExp(`${count} 条记录 · 1 条缺正文 · ${count - 1} 条同名`),
      ),
    ).toBeVisible();
    const downloads: Buffer[] = [];
    for (const name of ["下载转换依据", "下载完整迁移报告"]) {
      const pending = page.waitForEvent("download");
      await importer.getByRole("link", { name }).click();
      downloads.push(readFileSync(await (await pending).path()));
    }
    const expected = await parseLegalAuthorities(
      downloads[0]!.toString("utf8"),
    );
    expect(expected.entries).toHaveLength(count);
    expect(expected.entries[0]).toMatchObject({
      text: null,
      text_kind: "reference_only",
      legacy_origin: { original },
    });
    const report = JSON.parse(downloads[1]!.toString("utf8")) as {
      original_file_text: string;
      source_file_sha256: string;
      output_sha256: string;
    };
    expect(report.original_file_text).toBe(legacy);
    expect(report.source_file_sha256).toBe(sha(Buffer.from(legacy)));
    expect(report.output_sha256).toBe(sha(downloads[0]!));
    if (fixtureSize === "large") {
      for (const content of downloads)
        expect(content.byteLength).toBeGreaterThan(80 * 1024);
      expect(
        expected.entries[count - 1]?.legacy_origin?.original.text,
      ).toContain(`合成尾部${count - 1}`);
    }
    console.log(
      JSON.stringify({
        stage: "authorities_fixture",
        fixture: fixtureSize,
        source_bytes: Buffer.byteLength(legacy),
        output_bytes: downloads.map((item) => item.byteLength),
        entries_count: count,
      }),
    );
    await importer.getByRole("checkbox").check();
    await importer.getByRole("button", { name: "放入当前会话草稿" }).click();
    await expect(importer).toBeHidden();
    const input = page.getByPlaceholder(
      /请描述当前法律问题或工作任务|Describe the current legal question or task/,
    );
    await expect(input).toHaveValue(LEGACY_AUTHORITIES_HANDOFF_PROMPT);
    await expect(
      page.getByRole("button", { name: "Remove attachment" }),
    ).toHaveCount(2);
    expect(await runs()).toHaveLength(0);
    const pendingUpload = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === `/api/threads/${thread}/uploads`,
    );
    // Exactly the product's prepared prompt/files, no test-authored rescue or output seeding.
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    const uploadResponse = await pendingUpload;
    expect(uploadResponse.status()).toBe(200);
    const uploaded = (await uploadResponse.json()).files as Uploaded[];
    expect(uploaded).toHaveLength(2);
    const authorityUploads = uploaded.filter((item) =>
      item.filename.endsWith(".law-authorities.json"),
    );
    const reportUploads = uploaded.filter((item) =>
      item.filename.endsWith(".import-report.json"),
    );
    expect(authorityUploads).toHaveLength(1);
    expect(reportUploads).toHaveLength(1);
    for (const item of uploaded) {
      const index = item.filename.endsWith(".law-authorities.json") ? 0 : 1;
      expect(await bytes(item.artifact_url)).toEqual(downloads[index]);
    }
    await expect
      .poll(async () => (await runs()).length, { timeout: 30_000 })
      .toBe(1);
    const runId = (await runs())[0]!.run_id;
    console.log(
      JSON.stringify({
        stage: "authorities_run_started",
        thread_id: thread,
        run_id: runId,
      }),
    );
    await expect
      .poll(async () => (await get(`${runPath}/${runId}`)).status, {
        timeout: 300_000,
        intervals: [2000],
      })
      .toBe("success");
    const state = (await get(`/api/threads/${thread}/state`)).values as {
      messages: AuthoritiesMessage[];
      artifacts: string[];
    };
    for (const item of uploaded) {
      expect(await bytes(item.artifact_url)).toEqual(
        downloads[item.filename.endsWith(".law-authorities.json") ? 0 : 1],
      );
    }
    const outputPaths: string[] = [];
    for (const [index, suffix] of [
      ".law-authorities.json",
      ".import-report.json",
    ].entries()) {
      const outputs = state.artifacts.filter(
        (p) => p.startsWith("/mnt/user-data/outputs/") && p.endsWith(suffix),
      );
      expect(outputs).toHaveLength(1);
      outputPaths.push(outputs[0]!);
      expect(
        await bytes(
          `/api/threads/${thread}/artifacts${outputs[0]}?download=true`,
        ),
      ).toEqual(downloads[index]);
    }
    assertAuthoritiesImportEvidence(
      state.messages,
      {
        authorities_path: authorityUploads[0]!.virtual_path,
        report_path: reportUploads[0]!.virtual_path,
      },
      {
        outputs: outputPaths.map((output, index) => ({
          kind: index === 0 ? "authorities" : "report",
          path: output,
          byte_size: downloads[index]!.byteLength,
          sha256: sha(downloads[index]!),
        })),
        source_file_sha256: sha(Buffer.from(legacy)),
        source_bytes: Buffer.byteLength(legacy),
        validation: { valid: true, entries_count: count, sources_count: count },
        missing_body_count: 1,
        duplicate_name_article_count: count - 1,
        current_validity: "unverified",
        review_status: "unreviewed",
        verification_performed: false,
        saved_to_project: false,
      },
    );
    const delivery = (await get(
      `${runPath}/${runId}/events?event_types=run.delivery`,
    )) as {
      content: { satisfied: boolean; by_tool: { present_files?: string[] } };
    }[];
    expect(delivery).toHaveLength(1);
    expect(delivery[0]!.content.satisfied).toBe(true);
    for (const p of outputPaths)
      expect(delivery[0]!.content.by_tool.present_files).toContain(p);
    expect((await get(`${prefix}/project-artifacts`)).data.items).toHaveLength(
      0,
    );
    if (!(await page.getByRole("tab", { name: "本会话文件" }).isVisible()))
      await page.getByTestId("artifact-trigger").click();
    await page.getByRole("tab", { name: "本会话文件" }).click();
    for (const output of outputPaths)
      await expect(
        page
          .getByRole("tabpanel", { name: "本会话文件" })
          .getByText(path.basename(output), { exact: true }),
      ).toBeVisible();
    await page
      .getByRole("tabpanel", { name: "本会话文件" })
      .getByText(path.basename(outputPaths[0]!), { exact: true })
      .click();
    const region = page.getByRole("region", { name: "法律依据", exact: true });
    if (downloads[0]!.byteLength > 1024 * 1024) {
      // Native range preview is intentionally not parsed as a complete legal document.
      await expect(
        page.getByRole("button", {
          name: /Load full file|加载完整文件/,
          exact: true,
        }),
      ).toBeVisible();
      await expect(region).toHaveCount(0);
      await page
        .getByRole("button", {
          name: /Load full file|加载完整文件/,
          exact: true,
        })
        .click();
    }
    await expect(region).toBeVisible();
    await region
      .getByRole("button", { name: /合成历史法律 第一条/ })
      .first()
      .click();
    await expect(
      region.getByText("仅引用（正文缺失）", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    const save = page.getByRole("dialog", {
      name: "保存到当前法律项目",
      exact: true,
    });
    await expect(save.getByLabel("成果类型")).toHaveValue("legal_research");
    await save.getByLabel("成果名称").fill("合成旧收藏模型交付（未审核）");
    await save.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(save).toBeHidden();
    const items = (await get(`${prefix}/project-artifacts`)).data.items as {
      id: string;
    }[];
    expect(items).toHaveLength(1);
    const versions = (
      await get(`${prefix}/project-artifacts/${items[0]!.id}/versions`)
    ).data.items as { id: string; review_status: string }[];
    expect(versions).toHaveLength(1);
    expect(versions[0]!.review_status).toBe("unreviewed");
    expect(
      await bytes(
        `${prefix}/project-artifacts/${items[0]!.id}/versions/${versions[0]!.id}/content`,
      ),
    ).toEqual(downloads[0]);
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: /合成旧收藏模型交付/ }).click();
    await expect(region).toBeVisible();
    await region
      .getByRole("button", { name: /合成历史法律 第一条/ })
      .first()
      .click();
    await expect(
      region.getByText("仅引用（正文缺失）", { exact: true }),
    ).toBeVisible();
    await expect(
      region.getByRole("button", { name: "编辑依据", exact: true }),
    ).toHaveCount(0);
    expect(await runs()).toHaveLength(1);
    expect(pageErrors).toEqual([]);
    await page.screenshot({
      path: info.outputPath("authorities-live-saved.png"),
      animations: "disabled",
    });
    // The full report is a separate explicit project save, never an automatic side effect.
    await page.getByRole("tab", { name: "本会话文件" }).click();
    await page
      .getByRole("tabpanel", { name: "本会话文件" })
      .getByRole("combobox")
      .click();
    await page
      .getByRole("option", {
        name: path.basename(outputPaths[1]!),
        exact: true,
      })
      .click();
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    await save.getByLabel("成果名称").fill("合成旧收藏完整迁移报告（未审核）");
    await save.getByLabel("成果类型").selectOption("legal_research");
    await save.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(save).toBeHidden();
    const allItems = (await get(`${prefix}/project-artifacts`)).data.items as {
      id: string;
    }[];
    expect(allItems).toHaveLength(2);
    const reportItem = allItems.find((item) => item.id !== items[0]!.id)!;
    const reportVersions = (
      await get(`${prefix}/project-artifacts/${reportItem.id}/versions`)
    ).data.items as {
      id: string;
      review_status: string;
      version_number: number;
    }[];
    expect(reportVersions).toHaveLength(1);
    expect(reportVersions[0]).toMatchObject({
      review_status: "unreviewed",
      version_number: 1,
    });
    const reportContent = `${prefix}/project-artifacts/${reportItem.id}/versions/${reportVersions[0]!.id}/content`;
    expect(await bytes(reportContent)).toEqual(downloads[1]);
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: /合成旧收藏完整迁移报告/ }).click();
    await expect(page.getByLabel("历史版本")).toHaveValue(
      reportVersions[0]!.id,
    );
    await expect(page.getByText(/只读快照 · 未审核/)).toBeVisible();
    const pendingReportDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载此版本", exact: true }).click();
    expect(readFileSync(await (await pendingReportDownload).path())).toEqual(
      downloads[1],
    );
    // The first saved authority is still immutable after the report operation.
    expect(
      await bytes(
        `${prefix}/project-artifacts/${items[0]!.id}/versions/${versions[0]!.id}/content`,
      ),
    ).toEqual(downloads[0]);
    expect(await runs()).toHaveLength(1);
    expect(pageErrors).toEqual([]);
    await page.screenshot({
      path: info.outputPath("authorities-report-live-saved.png"),
      animations: "disabled",
    });
    writeFileSync(
      resultFile,
      JSON.stringify({
        result: "passed",
        fixture: fixtureSize,
        thread_id: thread,
        run_id: runId,
        artifact_id: items[0]!.id,
        report_artifact_id: reportItem.id,
        source_bytes: Buffer.byteLength(legacy),
        output_bytes: downloads.map((item) => item.byteLength),
        entries_count: count,
        source_sha256: sha(Buffer.from(legacy)),
        authorities_sha256: sha(downloads[0]!),
        report_sha256: sha(downloads[1]!),
        output_paths: outputPaths,
        scope:
          "one synthetic desktop import/normal Send/real model/exact files/native delivery/both explicit scanned project saves/history/download; no official legal verification or full project migration",
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
