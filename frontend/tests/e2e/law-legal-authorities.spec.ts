import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { type LegalAuthorities } from "../../src/core/law/legal-authorities";

import { mockLangGraphAPI } from "./utils/mock-api";

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/legal-authorities.json", import.meta.url),
    "utf8",
  ),
) as LegalAuthorities;
const citationSource = fixture.sources.find(
  (source) => source.kind === "project_citation",
)!;
const filename = "consultation.law-authorities.json";
const filepath = `/mnt/user-data/outputs/${filename}`;
const thread = "00000000-0000-0000-0000-000000000094";
const initial = JSON.stringify(fixture, null, 2);
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const artifact = {
  id: "authorities-saved",
  tenant_id: "tenant-test",
  matter_id: "matter-test",
  title: "合成已保存法律依据",
  kind: "legal_research",
  status: "active",
  current_version_number: 1,
  version: 1,
};
const version = {
  id: "authorities-version",
  project_artifact_id: artifact.id,
  tenant_id: artifact.tenant_id,
  matter_id: artifact.matter_id,
  version_number: 1,
  original_filename: filename,
  media_type: "application/json",
  review_status: "unreviewed",
  source_provenance: "client_asserted",
  byte_size: Buffer.byteLength(initial),
  sha256: digest(initial),
  source_thread_id: thread,
  source_artifact_path: filepath,
  created_at: "2026-09-06T00:00:00Z",
};

for (const mode of ["invalid", "range"] as const) {
  test(`legal authorities refuse unsafe preview: ${mode}`, async ({ page }) => {
    const body =
      mode === "invalid"
        ? initial.replace('"unreviewed"', '"approved"')
        : initial + " ".repeat(1024 * 1024);
    let fullReads = 0;
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, json: { detail: "Unmocked endpoint" } }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: thread,
          title: "合成边界验收",
          artifacts: [filepath],
          messages: [{ type: "ai", id: "answer", content: "合成文件" }],
        },
      ],
    });
    await page.route("**/api/law/**", (route) =>
      route.fulfill({
        json: {
          data: {
            context: {
              user_id: "default",
              tenant_id: "tenant-test",
              matter_id: "matter-test",
              matter_role: "owner",
              thread_id: thread,
            },
          },
          meta: {},
        },
      }),
    );
    await page.route("**/api/threads/*/artifacts/**", (route) => {
      expect(route.request().method()).toBe("GET");
      if (mode === "range" && route.request().headers().range) {
        const bytes = Buffer.from(body);
        return route.fulfill({
          status: 206,
          body: bytes.subarray(0, 1048576),
          contentType: "application/json",
          headers: {
            "Content-Range": `bytes 0-1048575/${bytes.length}`,
            ETag: `"${digest(body)}"`,
          },
        });
      }
      fullReads++;
      return route.fulfill({
        body,
        contentType: "application/json",
        headers: { ETag: `"${digest(body)}"` },
      });
    });
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByText(filename, { exact: true }).click();
    const region = page.getByRole("region", { name: "法律依据", exact: true });
    if (mode === "invalid") {
      await expect(
        page.getByRole("alert").filter({ hasText: "法律依据文件无效" }),
      ).toBeVisible();
      await expect(region).toHaveCount(0);
      await page.getByRole("radio", { name: "Code", exact: true }).click();
      await expect(page.locator(".cm-content")).toContainText('"approved"');
    } else {
      await expect(
        page.getByRole("button", { name: "Load full file", exact: true }),
      ).toBeVisible();
      expect(fullReads).toBe(0);
      await expect(region).toHaveCount(0);
      await page
        .getByRole("button", { name: "Load full file", exact: true })
        .click();
      await expect(
        region.getByRole("heading", { name: fixture.title }),
      ).toBeVisible();
      expect(fullReads).toBe(1);
    }
  });
}

for (const width of [320, 768, 1024, 1440]) {
  test(`legal authorities native preview, editing and history at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await page.emulateMedia({
      colorScheme: width === 320 || width === 1024 ? "dark" : "light",
      reducedMotion: "reduce",
    });
    let stored = initial;
    let puts = 0;
    let citationReads = 0;
    let denied = false;
    let saved = "";
    const forbidden: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() !== "GET" &&
        /\/(runs|uploads)(\/|\?|$)/.test(request.url())
      )
        forbidden.push(request.url());
    });
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, json: { detail: "Unmocked endpoint" } }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: thread,
          title: "法律依据合成验收",
          artifacts: [filepath],
          messages: [
            { type: "ai", id: "answer", content: "合成法律依据文件。" },
          ],
        },
      ],
    });
    await page.route("**/api/threads/*/artifacts/**", (route) => {
      if (route.request().method() === "PUT") {
        const input = route.request().postDataJSON() as {
          content: string;
          expected_sha256: string;
        };
        expect(input.expected_sha256).toBe(digest(stored));
        stored = input.content;
        puts++;
        return route.fulfill({
          json: {
            path: filepath,
            sha256: digest(stored),
            size: Buffer.byteLength(stored),
          },
        });
      }
      return route.fulfill({
        body: stored,
        contentType: "application/json",
        headers: { ETag: `"${digest(stored)}"` },
      });
    });
    await page.route("**/api/law/**", (route) => {
      const url = route.request().url();
      if (url.endsWith("/versions/authorities-version/content"))
        return route.fulfill({
          body: initial,
          contentType: "application/json",
        });
      if (url.includes("/citations/")) {
        citationReads++;
        if (denied)
          return route.fulfill({
            status: 404,
            json: { detail: "Unavailable" },
          });
        return route.fulfill({
          json: {
            data: {
              citation: {
                id: citationSource.citation_id,
                evidence_item_id: citationSource.evidence_item_id,
                evidence_version_id: citationSource.evidence_version_id,
                physical_page_number: 2,
                source_state: "archived",
                ocr_result_state: "superseded",
                quote_text: "合成冻结项目引文",
              },
            },
            meta: {},
          },
        });
      }
      let data: unknown = { items: [] };
      if (url.includes("/context/by-thread/"))
        data = {
          context: {
            user_id: "default",
            tenant_id: "tenant-test",
            matter_id: "matter-test",
            matter_role: "owner",
            thread_id: thread,
          },
        };
      else if (url.endsWith("/matters/matter-test"))
        data = {
          matter: {
            id: "matter-test",
            title: "合成单次法律咨询",
            status: "active",
          },
        };
      else if (url.endsWith("/project-artifacts")) {
        if (route.request().method() === "POST") {
          saved = route.request().postDataBuffer()!.toString("utf8");
          expect(saved).toContain("legal_research");
          expect(saved).toContain(stored);
          return route.fulfill({
            status: 201,
            json: {
              data: {
                artifact,
                artifact_version: { ...version, version_number: 2 },
              },
              meta: {},
            },
          });
        }
        data = { items: [artifact] };
      } else if (url.endsWith("/versions")) data = { items: [version] };
      return route.fulfill({ json: { data, meta: {} } });
    });
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByText(filename, { exact: true }).click();
    const region = page.getByRole("region", { name: "法律依据", exact: true });
    await expect(
      region.getByRole("heading", { name: fixture.title }),
    ).toBeVisible();
    const entry = region.getByRole("button", { name: /合成示例法 第一条/ });
    await entry.focus();
    await page.keyboard.press("Enter");
    await expect(entry).toHaveAttribute("aria-expanded", "true");
    await expect(region.getByText("2024-02", { exact: true })).toBeVisible();
    expect(citationReads).toBe(0);
    await region.getByRole("button", { name: "查看网页捕获 · web-1" }).click();
    await expect(
      region.getByText("完整性：自述完整（未独立核验）"),
    ).toBeVisible();
    await expect(region.getByRole("link")).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    await region
      .getByRole("button", { name: "查看项目材料引用 · citation-1" })
      .click();
    await expect(region.getByText("合成冻结项目引文")).toBeVisible();
    await expect(region.getByText(/原材料已归档.*历史 OCR 版本/)).toBeVisible();
    await page.screenshot({
      path: info.outputPath("authorities-source.png"),
      animations: "disabled",
    });
    denied = true;
    await region
      .getByRole("button", { name: "收起项目材料引用 · citation-1" })
      .click();
    await region
      .getByRole("button", { name: "查看项目材料引用 · citation-1" })
      .click();
    await expect(region.getByRole("alert")).toContainText(
      "引用不可用或无权访问",
    );
    await expect(region.getByText("合成冻结项目引文")).toHaveCount(0);
    await region.getByLabel("依据收录状态").selectOption("removed");
    await expect(
      region.getByRole("button", { name: /已移除示例法/ }),
    ).toBeVisible();
    await expect(entry).toHaveCount(0);
    await region.getByLabel("搜索法律依据").fill("不存在");
    await expect(region.getByText("没有符合筛选条件的依据。")).toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("radio", { name: "Code", exact: true }).click();
    const editor = page.locator(".cm-content[contenteditable=true]");
    await expect(editor).toBeVisible();
    const edited = initial.replace(fixture.title, "合成咨询 · 原生编辑后");
    await editor.fill(edited);
    await expect(
      page.getByRole("button", { name: "保存到项目", exact: true }),
    ).toBeDisabled();
    expect(puts).toBe(0);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => puts).toBe(1);
    expect(stored).toBe(edited);
    await page.getByRole("radio", { name: "Preview", exact: true }).click();
    await expect(
      region.getByRole("heading", { name: "合成咨询 · 原生编辑后" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "保存到当前法律项目" });
    await expect(dialog.getByLabel("成果类型")).toHaveValue("legal_research");
    await dialog.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(dialog).not.toBeVisible();
    expect(saved).toContain(edited);
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: /合成已保存法律依据/ }).click();
    await expect(
      region.getByRole("heading", { name: fixture.title }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    await expect(region).toHaveJSProperty(
      "scrollWidth",
      await region.evaluate((el) => el.clientWidth),
    );
    await page.screenshot({
      path: info.outputPath("authorities-history.png"),
      animations: "disabled",
    });
    expect(forbidden).toEqual([]);
    expect(
      await page.evaluate(() =>
        JSON.stringify([
          Object.values(localStorage),
          Object.values(sessionStorage),
        ]),
      ),
    ).not.toMatch(/合成示例法|web-1|citation-1|合成冻结项目引文/);
  });
}
