import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { type LegalAuthorities } from "../../src/core/law/legal-authorities";
import { LEGACY_AUTHORITIES_HANDOFF_PROMPT } from "../../src/core/law/legal-authorities-import";

const APP = process.env.E2E_P1_URL ?? "http://127.0.0.1:2035";
if (APP !== "http://127.0.0.1:2035")
  throw new Error("Synthetic authorities acceptance permits 2035 only");
const GATEWAY = "matrix-law-project-artifacts-gateway-1";
const filename = "synthetic.law-authorities.json";
const path = `/mnt/user-data/outputs/${filename}`;
const original = {
  code: "合成旧法律",
  article: "第一条",
  origin: "manual",
  addedAt: "unknown",
  source: "javascript:inert-old-reference",
  text: null,
};
const oldContent =
  "\ufeff[\r\n" +
  JSON.stringify(original) +
  "," +
  JSON.stringify({ ...original, text: "合成历史原文，不是有效法条。" }) +
  "\r\n]";
const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");

for (const width of [1280, 390]) {
  test(`real authorities import staging, editing, scanned versions and history at ${width}px`, async ({
    page,
    context,
    browser,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({
      colorScheme: width === 390 ? "dark" : "light",
      reducedMotion: "reduce",
    });
    const registration = await context.request.post(
      `${APP}/api/v1/auth/register`,
      {
        data: {
          email: `authorities-${randomUUID()}@example.com`,
          password: "Synthetic-Authorities-Acceptance-12345",
        },
      },
    );
    expect(registration.status()).toBe(201);
    const user = (await registration.json()) as { id: string };
    const csrf = (await context.cookies(APP)).find(
      (cookie) => cookie.name === "csrf_token",
    )!.value;
    const headers = () => ({
      "X-CSRF-Token": csrf,
      Origin: APP,
      "Idempotency-Key": randomUUID(),
    });
    async function post(url: string, data: object, status = 201) {
      const result = await context.request.post(`${APP}${url}`, {
        headers: headers(),
        data,
      });
      expect(result.status()).toBe(status);
      return result.json();
    }
    const {
      data: { tenant },
    } = await post("/api/law/tenants", {
      slug: `authorities-${randomUUID()}`,
      name: "合成法律依据团队",
    });
    const {
      data: { matter },
    } = await post(`/api/law/tenants/${tenant.id}/matters`, {
      kind: "consultation",
      title: "合成单次法律咨询",
    });
    const prefix = `/api/law/tenants/${tenant.id}/matters/${matter.id}`;
    const thread = randomUUID();
    await post("/api/threads", { thread_id: thread, metadata: {} }, 200);
    await post(`${prefix}/threads`, {
      thread_id: thread,
      purpose: "matter-chat",
    });
    const forbidden: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() !== "GET" &&
        /\/(uploads|runs)(\/|$)/.test(new URL(request.url()).pathname)
      )
        forbidden.push(request.url());
    });
    const catalog = await context.request.get(
      `${APP}/api/law/common-law-catalog?limit=10`,
    );
    expect(catalog.status()).toBe(200);
    expect((await catalog.json()).data.items).toHaveLength(10);
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
    await importer
      .getByLabel(/选择旧项目/)
      .setInputFiles({
        name: "law-refs.json",
        mimeType: "application/json",
        buffer: Buffer.from(oldContent),
      });
    await expect(
      importer.getByText(/2 条记录 · 1 条缺正文 · 1 条同名/),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await importer.getByRole("link", { name: "下载转换依据" }).click();
    const bytes = readFileSync(await (await download).path());
    const document = JSON.parse(bytes.toString("utf8")) as LegalAuthorities;
    expect(document.entries[0]).toMatchObject({
      text: null,
      text_kind: "reference_only",
      legacy_origin: { original },
    });
    expect(document.entries).toHaveLength(2);
    const reportDownload = page.waitForEvent("download");
    await importer.getByRole("link", { name: "下载完整迁移报告" }).click();
    const report = JSON.parse(
      readFileSync(await (await reportDownload).path(), "utf8"),
    ) as {
      original_file_text: string;
      source_file_sha256: string;
      output_sha256: string;
    };
    expect(report.original_file_text).toBe(oldContent);
    expect(report.source_file_sha256).toBe(digest(oldContent));
    expect(report.output_sha256).toBe(digest(bytes));
    await importer.getByRole("checkbox").check();
    await importer.getByRole("button", { name: "放入当前会话草稿" }).click();
    await expect(importer).toBeHidden();
    await expect(page.locator("textarea")).toHaveValue(
      LEGACY_AUTHORITIES_HANDOFF_PROMPT,
    );
    await expect(
      page.locator("form").getByText(/^转换依据-.*\.law-authorities.json$/),
    ).toBeVisible();
    expect(forbidden).toEqual([]);

    // No model or fake generation: seed only the exact downloaded synthetic fixture.
    // Subsequent native editing, promotion, scanning and protected history are real APIs.
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        GATEWAY,
        "/app/backend/.venv/bin/python",
        "-c",
        "import os,sys; from uuid import UUID; from deerflow.config.paths import get_paths; from matrix_law_extension.services.legal_authorities import parse_legal_authorities; assert os.environ.get('AUTH_JWT_SECRET')=='synthetic-p1-jwt-secret-not-for-production'; user=str(UUID(sys.argv[1])); thread=str(UUID(sys.argv[2])); body=sys.stdin.buffer.read(); parse_legal_authorities(body); directory=get_paths().sandbox_outputs_dir(thread,user_id=user); directory.mkdir(parents=True,exist_ok=True); target=directory/'synthetic.law-authorities.json'; assert not target.exists(); target.write_bytes(body)",
        user.id,
        thread,
      ],
      { input: bytes },
    );
    await post(
      `/api/threads/${thread}/state`,
      {
        values: {
          title: "合成法律依据保存验证",
          artifacts: [path],
          messages: [
            {
              type: "ai",
              id: randomUUID(),
              content: "文件由合成测试播种，不是模型生成。",
            },
          ],
        },
      },
      200,
    );
    await page.reload();
    await page.getByTestId("artifact-trigger").click();
    await page.getByRole("tab", { name: "本会话文件" }).click();
    await page.getByText(filename, { exact: true }).click();
    const region = page.getByRole("region", { name: "法律依据", exact: true });
    await expect(region).toBeVisible();
    const save = page.getByRole("dialog", {
      name: "保存到当前法律项目",
      exact: true,
    });
    async function promote(id?: string) {
      await page
        .getByRole("button", { name: "保存到项目", exact: true })
        .click();
      await expect(save.getByLabel("成果类型")).toHaveValue("legal_research");
      if (id) await save.getByLabel("保存位置").selectOption(id);
      else await save.getByLabel("成果名称").fill("合成旧收藏已保存");
      await save.getByRole("button", { name: "保存未审核版本" }).click();
      await expect(save).toBeHidden();
    }
    await promote();
    const items = (
      await (
        await context.request.get(`${APP}${prefix}/project-artifacts`)
      ).json()
    ).data.items as Array<{ id: string }>;
    expect(items).toHaveLength(1);
    const item = items[0]!;
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await region
      .getByRole("button", { name: /合成旧法律 第一条/ })
      .first()
      .click();
    await region.getByRole("button", { name: "编辑依据", exact: true }).click();
    const editor = page.getByRole("dialog", {
      name: "编辑法律依据",
      exact: true,
    });
    await editor
      .getByLabel("收录理由", { exact: true })
      .fill("人工保留引用待核验，不补正文。");
    await editor.getByRole("checkbox").check();
    await editor.getByRole("button", { name: "应用到草稿" }).click();
    await expect(editor).toBeHidden();
    const fileSaved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        response.url().includes("/artifacts/"),
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await fileSaved).status()).toBe(200);
    await promote(item.id);
    const versions = (
      await (
        await context.request.get(
          `${APP}${prefix}/project-artifacts/${item.id}/versions`,
        )
      ).json()
    ).data.items as Array<{
      id: string;
      version_number: number;
      review_status: string;
    }>;
    expect(versions).toHaveLength(2);
    expect(
      versions.every((version) => version.review_status === "unreviewed"),
    ).toBe(true);
    const first = versions.find((version) => version.version_number === 1)!;
    const second = versions.find((version) => version.version_number === 2)!;
    const firstUrl = `${APP}${prefix}/project-artifacts/${item.id}/versions/${first.id}/content`;
    const old = await context.request.get(firstUrl);
    expect(old.status()).toBe(200);
    expect(await old.body()).toEqual(bytes);
    const current = await context.request.get(
      `${APP}${prefix}/project-artifacts/${item.id}/versions/${second.id}/content`,
    );
    expect(current.status()).toBe(200);
    const latest = JSON.parse(
      (await current.body()).toString("utf8"),
    ) as LegalAuthorities;
    expect(latest.entries[0]).toMatchObject({
      text: null,
      inclusion_reason: "人工保留引用待核验，不补正文。",
      legacy_origin: { original },
    });
    expect(latest.sources).toEqual(document.sources);
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: /合成旧收藏已保存/ }).click();
    await page.getByLabel("历史版本").selectOption(first.id);
    await region
      .getByRole("button", { name: /合成旧法律 第一条/ })
      .first()
      .click();
    await expect(
      region.getByText("仅引用（正文缺失）", { exact: true }),
    ).toBeVisible();
    await expect(
      region.getByRole("button", { name: "编辑依据", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("real-authorities-history.png"),
      animations: "disabled",
    });
    const outsider = await browser.newContext();
    try {
      expect(
        (
          await outsider.request.post(`${APP}/api/v1/auth/register`, {
            data: {
              email: `outsider-${randomUUID()}@example.com`,
              password: "Synthetic-Authorities-Outsider-12345",
            },
          })
        ).status(),
      ).toBe(201);
      expect((await outsider.request.get(firstUrl)).status()).toBe(404);
    } finally {
      await outsider.close();
    }
    expect(forbidden).toEqual([]);
  });
}
