import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  expect,
  test,
  type BrowserContext,
  type Request,
} from "@playwright/test";

import { type LegalGraph } from "../../src/core/law/legal-graph";

const APP = process.env.E2E_P1_URL ?? "http://127.0.0.1:2035";
if (APP !== "http://127.0.0.1:2035")
  throw new Error("Graph acceptance only permits the isolated 2035 stack");
const GATEWAY = "matrix-law-project-artifacts-gateway-1";
const FILE = "/mnt/user-data/outputs/acceptance.law-graph.json";
const fixture = (
  JSON.parse(
    readFileSync(
      new URL(
        "../../../backend/extensions/sources/matrix-law-extension/matrix_law_extension/contracts/legal_graph_v1.examples.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { base: LegalGraph }
).base;
const ocrSeed = readFileSync(
  new URL(
    "../../../docker/matrix-law-project-artifacts/seed_graph_ocr.py",
    import.meta.url,
  ),
  "utf8",
);
const digest = (content: string | Buffer) =>
  createHash("sha256").update(content).digest("hex");

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
async function post(
  context: BrowserContext,
  url: string,
  data: object,
  status: number,
) {
  const response = await context.request.post(url, {
    headers: await headers(context),
    data,
  });
  expect(response.status()).toBe(status);
  return response.json();
}
async function register(context: BrowserContext) {
  return (await post(
    context,
    `${APP}/api/v1/auth/register`,
    {
      email: `graph-${randomUUID()}@example.com`,
      password: "Synthetic-Graph-Acceptance-12345",
    },
    201,
  )) as { id: string };
}

for (const width of [1280, 390]) {
  test(`real graph editing, immutable versions and access revocation at ${width}px`, async ({
    page,
    context,
    browser,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({
      colorScheme: width === 390 ? "dark" : "light",
      reducedMotion: "reduce",
    });
    const owner = await register(context);
    const tenant = (
      await post(
        context,
        `${APP}/api/law/tenants`,
        { slug: `graph-${randomUUID()}`, name: "图谱合成团队" },
        201,
      )
    ).data.tenant as { id: string };
    const tenantPath = `${APP}/api/law/tenants/${tenant.id}`;
    const matter = (
      await post(
        context,
        `${tenantPath}/matters`,
        { kind: "consultation", title: "图谱合成零散咨询" },
        201,
      )
    ).data.matter as { id: string };
    const prefix = `${tenantPath}/matters/${matter.id}`;
    // Upload/scanning/storage/citation APIs are real; OCR output alone is a
    // labeled synthetic fixture, not evidence of recognition accuracy.
    await page.setContent(
      "<p>Synthetic OCR original source for graph acceptance.</p>",
    );
    const pdf = await page.pdf();
    const upload = await context.request.post(`${prefix}/evidence`, {
      headers: { ...(await headers(context)), "X-Content-SHA256": digest(pdf) },
      multipart: {
        file: {
          name: "graph-source.pdf",
          mimeType: "application/pdf",
          buffer: pdf,
        },
        title: "合成图谱来源材料",
        byte_size: String(pdf.length),
      },
    });
    expect(upload.status()).toBe(201);
    const evidence = (await upload.json()).data as {
      evidence_item: { id: string; version: number };
      evidence_version: { id: string };
    };
    function seedOcr(marker: "original" | "rerun") {
      return JSON.parse(
        execFileSync(
          "docker",
          [
            "exec",
            "-i",
            GATEWAY,
            "/app/backend/.venv/bin/python",
            "-",
            owner.id,
            tenant.id,
            matter.id,
            evidence.evidence_item.id,
            evidence.evidence_version.id,
            marker,
          ],
          { input: ocrSeed, encoding: "utf8" },
        ),
      ) as {
        result_id: string;
        block_id: string;
        quote: string;
      };
    }
    const ocr = seedOcr("original");
    const citationPath = `${prefix}/evidence/${evidence.evidence_item.id}/versions/${evidence.evidence_version.id}/citations`;
    const citation = (
      await post(
        context,
        citationPath,
        {
          ocr_result_id: ocr.result_id,
          physical_page_number: 1,
          start_block_id: ocr.block_id,
          start_offset: 0,
          end_offset: ocr.quote.length,
        },
        201,
      )
    ).data.citation as { id: string };
    const citationUrl = `${citationPath}/${citation.id}`;
    const graph = structuredClone(fixture);
    graph.sources[0] = {
      id: graph.sources[0]!.id,
      kind: "citation",
      citation_id: citation.id,
      evidence_item_id: evidence.evidence_item.id,
      evidence_version_id: evidence.evidence_version.id,
    };
    const legacySource = {
      id: "old-source",
      kind: "legacy_unmapped" as const,
      reference: "synthetic-old-contract.pdf",
      quote: "合成旧摘录（需人工核对）",
    };
    graph.sources.push(legacySource);
    graph.nodes[1]!.source_ids.push(legacySource.id);
    graph.edges[0]!.source_ids.push(legacySource.id);
    const original = JSON.stringify(graph);
    const thread = randomUUID();
    await post(
      context,
      `${APP}/api/threads`,
      { thread_id: thread, metadata: {} },
      200,
    );
    await post(
      context,
      `${prefix}/threads`,
      { thread_id: thread, purpose: "graph-acceptance" },
      201,
    );
    await post(
      context,
      `${APP}/api/threads/${thread}/state`,
      {
        values: {
          title: "合成图谱编辑",
          artifacts: [FILE],
          messages: [
            {
              type: "ai",
              id: randomUUID(),
              content: "图谱初始文件由验收播种，不代表模型生成。",
            },
          ],
        },
      },
      200,
    );
    // Fixture only: no model call, no access to any real user's sandbox.
    execFileSync("docker", [
      "exec",
      GATEWAY,
      "/app/backend/.venv/bin/python",
      "-c",
      "import sys; from deerflow.config.paths import get_paths; p=get_paths().sandbox_outputs_dir(sys.argv[2], user_id=sys.argv[1]); p.mkdir(parents=True, exist_ok=True); (p/'acceptance.law-graph.json').write_text(sys.argv[3], encoding='utf-8')",
      owner.id,
      thread,
      original,
    ]);
    const fileUrl = `${APP}/api/threads/${thread}/artifacts${FILE}`;
    const otherThread = randomUUID();
    await post(
      context,
      `${APP}/api/threads`,
      { thread_id: otherThread, metadata: {} },
      200,
    );
    await post(
      context,
      `${prefix}/threads`,
      { thread_id: otherThread, purpose: "handoff-isolation" },
      201,
    );
    await post(
      context,
      `${APP}/api/threads/${otherThread}/state`,
      { values: { title: "附件隔离合成会话" } },
      200,
    );
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: "转换旧图谱" }).click();
    const importDialog = page.getByRole("dialog", { name: "转换旧版案情图谱" });
    const legacyContent = JSON.stringify({
      caseId: "synthetic-legacy-only",
      updatedAt: "2026-08-01T00:00:00Z",
      lastAngle: "合成角度",
      nodes: [
        { id: "甲", label: "合成旧甲方", type: "party", category: "person" },
        { id: "签约:1", label: "合成旧签约", type: "event", date: "2026-08" },
      ],
      edges: [
        {
          id: "person:0:甲-签约",
          source: "甲",
          target: "签约:1",
          type: "签约",
          category: "person",
          confidence: "EXTRACTED",
          angleId: "custom:合成角度",
          sourceRef: "javascript:do-not-execute",
          sourceQuote: "合成旧图谱原文（未核验）",
        },
      ],
    });
    const importWrites: string[] = [];
    const trackImportWrite = (request: Request) => {
      if (
        request.url().includes("/api/") &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())
      )
        importWrites.push(request.url());
    };
    page.on("request", trackImportWrite);
    await importDialog.getByLabel(/选择旧项目/).setInputFiles({
      name: "graph.json",
      mimeType: "application/json",
      buffer: Buffer.from(legacyContent),
    });
    await expect(importDialog.getByText(/1 个待映射旧来源/)).toBeVisible();
    await expect(
      importDialog.getByRole("heading", { name: "旧版案情图谱（待核验）" }),
    ).toBeVisible();
    const graphDownload = page.waitForEvent("download");
    await importDialog.getByRole("link", { name: "下载转换图谱" }).click();
    const convertedBytes = readFileSync(await (await graphDownload).path());
    const converted = JSON.parse(convertedBytes.toString("utf8")) as LegalGraph;
    expect(
      execFileSync(
        "docker",
        [
          "exec",
          "-i",
          GATEWAY,
          "/app/backend/.venv/bin/python",
          "-c",
          "import sys; from matrix_law_extension.services.legal_graph import parse_legal_graph; graph = parse_legal_graph(sys.stdin.buffer.read()); print(len(graph.nodes), len(graph.edges))",
        ],
        { input: convertedBytes, encoding: "utf8" },
      ).trim(),
    ).toBe("2 1");
    expect(converted.sources[0]).toMatchObject({
      kind: "legacy_unmapped",
      reference: "javascript:do-not-execute",
    });
    expect(converted.nodes[1]?.date).toEqual({
      value: "2026-08",
      origin: "legacy_inferred",
    });
    const reportDownload = page.waitForEvent("download");
    await importDialog.getByRole("link", { name: "下载完整迁移报告" }).click();
    const report = JSON.parse(
      readFileSync(await (await reportDownload).path(), "utf8"),
    );
    expect(report.source_sha256).toBe(digest(legacyContent));
    expect(report.source_filename).toBe("graph.json");
    expect(report.graph_sha256).toBe(digest(convertedBytes));
    expect(report.nodeIds[0]).toEqual({ oldId: "甲", newId: "n1" });
    await importDialog.getByRole("button", { name: "节点与关系" }).click();
    await importDialog
      .getByRole("button", { name: /合成旧甲方 → 签约/ })
      .click();
    await expect(
      importDialog.getByText("旧来源待映射（未核验）"),
    ).toBeVisible();
    await expect(importDialog.locator('a[href^="javascript:"]')).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("legacy-conversion-preview.png"),
      animations: "disabled",
    });
    await importDialog
      .getByRole("button", { name: "放入当前会话草稿" })
      .click();
    await expect(importDialog).toHaveCount(0);
    const composer = page.locator("textarea").first();
    await expect(composer).toHaveValue(/^\/matrix-law-graph /);
    await expect(
      page.getByRole("button", { name: "Remove attachment" }),
    ).toHaveCount(2);
    await expect(
      page.getByText(/^转换图谱-.*\.law-graph\.json$/).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/^迁移报告-.*\.import-report\.json$/).first(),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("legacy-native-composer.png"),
      animations: "disabled",
    });
    expect(importWrites).toEqual([]);
    page.off("request", trackImportWrite);
    await page.getByRole("button", { name: "Close toast" }).click();
    // Actual client-side sidebar navigation must discard attachments, not
    // carry them into another thread. The static text draft may be restored.
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    async function navigateThread(id: string) {
      const link = page.locator(`a[href="/workspace/chats/${id}"]`).first();
      if (!(await link.isVisible()))
        await page.locator('[data-sidebar="trigger"]:visible').first().click();
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/workspace/chats/${id}$`));
      if (width === 390) {
        await page.keyboard.press("Escape");
        await expect(
          page.locator('[data-sidebar="sidebar"][data-mobile="true"]'),
        ).toHaveCount(0);
      }
    }
    await navigateThread(otherThread);
    await expect(
      page.getByRole("button", { name: "Remove attachment" }),
    ).toHaveCount(0);
    await expect(composer).toHaveValue("");
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await navigateThread(thread);
    await expect(
      page.getByRole("button", { name: "Remove attachment" }),
    ).toHaveCount(0);
    await composer.fill("");
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("tab", { name: "本会话文件" }).click();
    await page.getByText("acceptance.law-graph.json", { exact: true }).click();
    const region = page.getByRole("region", { name: "案情图谱" });
    await expect(region).toBeVisible();
    await region.getByRole("button", { name: "节点与关系" }).click();
    await region.getByRole("button", { name: /合成签约事件 事件/ }).click();
    await region.getByRole("button", { name: "核验并查看引用" }).click();
    await expect(region.getByText(ocr.quote, { exact: true })).toBeVisible();
    await expect(region.getByText(/来源可用.*当前 OCR 版本/)).toBeVisible();
    await region.getByRole("button", { name: "关系画布", exact: true }).click();
    await expect(
      region.getByRole("button", { name: "放大图谱" }),
    ).toBeEnabled();
    for (const height of width === 1280 ? [720, 540] : [600]) {
      await page.setViewportSize({ width, height });
      const canvas = region.getByRole("img");
      const details = region.getByRole("complementary", { name: "图谱详情" });
      await expect
        .poll(async () => {
          const canvasBox = await canvas.boundingBox();
          const detailBox = await details.boundingBox();
          return canvasBox && detailBox
            ? canvasBox.y + canvasBox.height - detailBox.y
            : Infinity;
        })
        .toBeLessThanOrEqual(1);
      await region
        .getByText(ocr.quote, { exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        region.getByText(ocr.quote, { exact: true }),
      ).toBeInViewport();
      await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
      await page.screenshot({
        path: info.outputPath(`real-graph-citation-${width}x${height}.png`),
        animations: "disabled",
      });
    }
    await page.setViewportSize({ width, height: 900 });
    await region.getByRole("button", { name: "节点与关系" }).click();
    const rerun = seedOcr("rerun");
    await region.getByRole("button", { name: "核验并查看引用" }).click();
    await expect(region.getByText(/历史 OCR 版本/)).toBeVisible();
    await expect(region.getByText(ocr.quote, { exact: true })).toBeVisible();
    await expect(region.getByText(rerun.quote, { exact: true })).toHaveCount(0);
    await post(
      context,
      `${prefix}/evidence/${evidence.evidence_item.id}/archive`,
      {
        expected_version: evidence.evidence_item.version,
      },
      200,
    );
    const historicalSource = await context.request.get(citationUrl);
    expect(historicalSource.status()).toBe(200);
    expect((await historicalSource.json()).data.citation).toMatchObject({
      source_state: "archived",
      ocr_result_state: "superseded",
      quote_text: ocr.quote,
    });
    await region.getByRole("button", { name: "核验并查看引用" }).click();
    await expect(region.getByRole("status")).toContainText("原材料已归档");
    await expect(region.getByText(/不会随 OCR 重跑改写/)).toBeVisible();
    await expect(region.getByText(ocr.quote, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    const saveDialog = page.getByRole("dialog", {
      name: "保存到当前法律项目",
      exact: true,
    });
    await expect(saveDialog.getByLabel("成果类型")).toHaveValue(
      "knowledge_graph",
    );
    await saveDialog.getByLabel("成果名称").fill("真实链路合成图谱");
    await saveDialog.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(saveDialog).toBeHidden();
    const artifact = (
      await (await context.request.get(`${prefix}/project-artifacts`)).json()
    ).data.items[0] as { id: string };
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await region.getByRole("button", { name: "节点与关系" }).click();
    await region.getByRole("button", { name: /合成签约事件 事件/ }).click();
    await region.getByRole("button", { name: "关联项目引用" }).click();
    const mapping = page.getByRole("dialog", {
      name: "将旧来源关联到项目引用",
    });
    await expect(mapping.getByText(/影响 1 个节点、1 条关系/)).toBeVisible();
    await mapping
      .getByLabel("当前项目材料")
      .selectOption(evidence.evidence_item.id);
    await mapping
      .getByLabel("证据版本")
      .selectOption(evidence.evidence_version.id);
    await mapping.getByLabel("已有引用").selectOption(citation.id);
    await expect(
      mapping.getByRole("button", { name: "确认关联到图谱草稿" }),
    ).toBeDisabled();
    await mapping.getByRole("button", { name: "读取受保护原文" }).click();
    await expect(mapping.getByText(ocr.quote, { exact: true })).toBeVisible();
    await expect(mapping.getByText(/历史 OCR 版本/)).toBeVisible();
    await mapping.getByRole("checkbox").check();
    await page.screenshot({
      path: info.outputPath("real-source-mapping.png"),
      animations: "disabled",
    });
    await mapping.getByRole("button", { name: "确认关联到图谱草稿" }).click();
    await expect(mapping).toHaveCount(0);
    expect(await (await context.request.get(fileUrl)).text()).toBe(original);
    await expect(
      region.getByText("关联前的旧来源记录（未核验）"),
    ).toBeVisible();
    await region.getByRole("button", { name: "编辑节点" }).click();
    const editor = page.getByRole("dialog", { name: "编辑节点", exact: true });
    await editor.getByLabel("节点名称").fill("合成签约事件已校对");
    await editor.getByLabel("事件日期（可留空）").fill("2024");
    await editor.getByRole("button", { name: "应用到草稿" }).click();
    await expect(
      page.getByRole("button", { name: "保存到项目", exact: true }),
    ).toBeDisabled();
    const fileSaved = page.waitForResponse(
      (response) =>
        response.url() === fileUrl && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await fileSaved).status()).toBe(200);
    await page.reload();
    const bytes = await context.request.get(fileUrl);
    expect(bytes.status()).toBe(200);
    const revised = await bytes.text();
    expect(
      (JSON.parse(revised) as LegalGraph).sources.find(
        (source) => source.id === legacySource.id,
      ),
    ).toEqual({
      id: legacySource.id,
      kind: "citation",
      citation_id: citation.id,
      evidence_item_id: evidence.evidence_item.id,
      evidence_version_id: evidence.evidence_version.id,
      legacy_origin: legacySource,
    });
    expect((JSON.parse(revised) as LegalGraph).nodes[1]?.date).toEqual({
      value: "2024",
      origin: "user",
    });
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    await saveDialog.getByLabel("保存位置").selectOption(artifact.id);
    await saveDialog.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(saveDialog).toBeHidden();
    const versionPath = `${prefix}/project-artifacts/${artifact.id}/versions`;
    const versions = (await (await context.request.get(versionPath)).json())
      .data.items as Array<{
      id: string;
      version_number: number;
      sha256: string;
      review_status: string;
    }>;
    expect(versions.length).toBe(2);
    for (const version of versions) {
      const response = await context.request.get(
        `${versionPath}/${version.id}/content`,
      );
      expect(response.status()).toBe(200);
      const expected = version.version_number === 1 ? original : revised;
      expect(await response.text()).toBe(expected);
      expect(version.sha256).toBe(digest(expected));
      expect(version.review_status).toBe("unreviewed");
    }
    const first = versions.find((version) => version.version_number === 1)!;
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: /真实链路合成图谱/ }).click();
    await region.getByRole("button", { name: "时间线", exact: true }).click();
    await expect(
      region.getByText("合成签约事件已校对", { exact: true }),
    ).toBeVisible();
    await expect(region.getByRole("button", { name: "新增节点" })).toHaveCount(
      0,
    );
    await page.getByLabel("历史版本").selectOption(first.id);
    await expect(
      region.getByText("合成签约事件已校对", { exact: true }),
    ).toHaveCount(0);
    await region.getByRole("button", { name: "时间线", exact: true }).click();
    await expect(
      region.getByText("合成签约事件", { exact: true }),
    ).toBeVisible();
    await expect(region.getByText("2024-02", { exact: true })).toBeVisible();
    await region.getByRole("button", { name: /合成签约事件/ }).click();
    await region.getByRole("button", { name: "核验并查看引用" }).click();
    await expect(region.getByRole("status")).toContainText("原材料已归档");
    await expect(region.getByText(ocr.quote, { exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("real-graph-history.png"),
      animations: "disabled",
    });

    // Direct authenticated HTTP checks exercise the same live server, not mocks.
    const invalid = structuredClone(fixture);
    invalid.nodes[0]!.source_ids = ["forged"];
    invalid.sources.push({
      id: "forged",
      kind: "citation",
      citation_id: randomUUID(),
      evidence_item_id: randomUUID(),
      evidence_version_id: randomUUID(),
      legacy_origin: {
        id: "forged",
        kind: "unverified",
        quote: "旧摘录不能授权随机引用",
      },
    });
    async function promote(content: string, expectedVersion: string) {
      return context.request.post(`${prefix}/project-artifacts`, {
        headers: {
          ...(await headers(context)),
          "X-Content-SHA256": digest(content),
        },
        multipart: {
          file: {
            name: "acceptance.law-graph.json",
            mimeType: "application/json",
            buffer: Buffer.from(content),
          },
          title: "真实链路合成图谱",
          kind: "knowledge_graph",
          byte_size: String(Buffer.byteLength(content)),
          source_thread_id: thread,
          source_artifact_path: FILE,
          source_revision_sha256: digest(content),
          project_artifact_id: artifact.id,
          expected_version: expectedVersion,
        },
      });
    }
    expect((await promote(revised, "1")).status()).toBe(409);
    expect((await promote(JSON.stringify(invalid), "2")).status()).toBe(422);
    expect(
      (await (await context.request.get(versionPath)).json()).data.items.length,
    ).toBe(2);

    await page.getByRole("tab", { name: "本会话文件" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await region.getByRole("button", { name: "修改图谱名称" }).click();
    const rename = page.getByRole("dialog", {
      name: "修改图谱名称",
      exact: true,
    });
    await rename.getByLabel("图谱名称").fill("保留本地未保存图谱草稿");
    await rename.getByRole("button", { name: "应用到草稿" }).click();
    const remoteGraph = {
      ...(JSON.parse(revised) as LegalGraph),
      title: "并发保存的合成图谱",
    };
    const remoteContent = JSON.stringify(remoteGraph);
    const concurrent = await context.request.put(fileUrl, {
      headers: await headers(context),
      data: { content: remoteContent, expected_sha256: digest(revised) },
    });
    expect(concurrent.status()).toBe(200);
    const rejected = page.waitForResponse(
      (response) =>
        response.url() === fileUrl && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await rejected).status()).toBe(412);
    await expect(
      region.getByRole("heading", { name: "保留本地未保存图谱草稿" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    expect(await (await context.request.get(fileUrl)).text()).toBe(
      remoteContent,
    );
    page.once("dialog", (confirm) => confirm.accept());
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await expect(
      region.getByRole("heading", { name: "并发保存的合成图谱" }),
    ).toBeVisible();

    const other = await browser.newContext({ baseURL: APP });
    try {
      const outsider = await register(other);
      const downloadUrl = `${versionPath}/${first.id}/content`;
      expect((await other.request.get(downloadUrl)).status()).toBe(404);
      const membership = (
        await post(
          context,
          `${tenantPath}/memberships`,
          { user_id: outsider.id, role: "member" },
          201,
        )
      ).data.membership as { id: string };
      const member = (
        await post(
          context,
          `${prefix}/members`,
          { membership_id: membership.id, role: "lawyer" },
          201,
        )
      ).data.matter_member as { id: string; version: number };
      expect((await other.request.get(downloadUrl)).status()).toBe(200);
      // Give the second user their own thread/file, never the owner's sandbox.
      const otherThread = randomUUID();
      await post(
        other,
        `${APP}/api/threads`,
        { thread_id: otherThread, metadata: {} },
        200,
      );
      await post(
        other,
        `${prefix}/threads`,
        { thread_id: otherThread, purpose: "graph-source-revocation" },
        201,
      );
      await post(
        other,
        `${APP}/api/threads/${otherThread}/state`,
        {
          values: {
            title: "合成来源撤权验收",
            artifacts: [FILE],
            messages: [
              { type: "ai", id: randomUUID(), content: "合成图谱引用验收。" },
            ],
          },
        },
        200,
      );
      execFileSync("docker", [
        "exec",
        GATEWAY,
        "/app/backend/.venv/bin/python",
        "-c",
        "import sys; from deerflow.config.paths import get_paths; p=get_paths().sandbox_outputs_dir(sys.argv[2], user_id=sys.argv[1]); p.mkdir(parents=True, exist_ok=True); (p/'acceptance.law-graph.json').write_text(sys.argv[3], encoding='utf-8')",
        outsider.id,
        otherThread,
        original,
      ]);
      const otherPage = await other.newPage();
      await otherPage.setViewportSize({ width, height: 900 });
      await otherPage.goto(`/workspace/chats/${otherThread}`);
      await otherPage.getByTestId("artifact-trigger").click();
      await otherPage
        .getByText("acceptance.law-graph.json", { exact: true })
        .click();
      const otherRegion = otherPage.getByRole("region", { name: "案情图谱" });
      await otherRegion.getByRole("button", { name: "节点与关系" }).click();
      await otherRegion
        .getByRole("button", { name: /合成签约事件 事件/ })
        .click();
      await otherRegion.getByRole("button", { name: "核验并查看引用" }).click();
      await expect(
        otherRegion.getByText(ocr.quote, { exact: true }),
      ).toBeVisible();
      const revoked = await context.request.patch(
        `${prefix}/members/${member.id}`,
        {
          headers: await headers(context),
          data: {
            role: "lawyer",
            status: "removed",
            expected_version: member.version,
          },
        },
      );
      expect(revoked.status()).toBe(200);
      const deniedCitation = otherPage.waitForResponse(
        (response) => response.url() === citationUrl,
      );
      await otherRegion.getByRole("button", { name: "核验并查看引用" }).click();
      expect((await deniedCitation).status()).toBe(404);
      await expect(
        otherRegion.getByText(ocr.quote, { exact: true }),
      ).toHaveCount(0);
      await expect(otherRegion.getByRole("alert")).toHaveText(
        "引用已不可用或无权访问，未显示缓存正文。",
      );
      await otherPage.screenshot({
        path: info.outputPath("real-graph-source-revoked.png"),
        animations: "disabled",
      });
      expect((await other.request.get(downloadUrl)).status()).toBe(404);
    } finally {
      await other.close();
    }

    // Read-only audit evidence for this synthetic artifact, no cookie/body output.
    expect(
      [artifact.id, citation.id, ...versions.map((row) => row.id)].every((id) =>
        /^[0-9a-f-]{36}$/.test(id),
      ),
    ).toBe(true);
    const ids = [artifact.id, citation.id, ...versions.map((row) => row.id)]
      .map((id) => `'${id}'`)
      .join(",");
    const audit = execFileSync(
      "docker",
      [
        "exec",
        "matrix-law-project-artifacts-postgres-1",
        "psql",
        "-U",
        "deerflow",
        "-d",
        "deerflow",
        "-Atc",
        `SELECT action || ':' || decision || ':' || count(*) FROM deerflow.law_audit_events WHERE resource_id IN (${ids}) GROUP BY action, decision`,
      ],
      { encoding: "utf8" },
    );
    expect(audit).toMatch(/project_artifact.save:allowed:2/);
    expect(audit).toMatch(/project_artifact_version.download:allowed:[1-9]/);
    expect(audit).toMatch(/project_artifact_version.download:denied:2/);
    expect(audit).toMatch(/ocr_citation.read:allowed:[1-9]/);
    expect(audit).toMatch(/ocr_citation.read:denied:1/);
  });
}
