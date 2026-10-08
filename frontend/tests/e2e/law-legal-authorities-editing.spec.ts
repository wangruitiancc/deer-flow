import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test, type Locator } from "@playwright/test";

import { type LegalAuthorities } from "../../src/core/law/legal-authorities";

import { mockLangGraphAPI } from "./utils/mock-api";

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/legal-authorities.json", import.meta.url),
    "utf8",
  ),
) as LegalAuthorities;
const initial = JSON.stringify(fixture, null, 2);
const filename = "collection.law-authorities.json";
const filepath = `/mnt/user-data/outputs/${filename}`;
const thread = "00000000-0000-0000-0000-000000000095";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

for (const width of [320, 390, 768, 1024, 1280, 1440]) {
  test(`organizes authority drafts and keeps saved removal history at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({
      width,
      height:
        width === 390 ? 600 : width === 1280 ? 540 : width < 700 ? 844 : 900,
    });
    await page.emulateMedia({
      colorScheme: width === 320 || width === 1024 ? "dark" : "light",
      reducedMotion: "reduce",
    });
    let stored = initial;
    let puts = 0;
    const history = [initial];
    const forbidden: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() !== "GET" &&
        /\/(uploads|runs)(\/|\?|$)/.test(request.url())
      )
        forbidden.push(request.url());
    });
    const artifact = () => ({
      id: "collection",
      title: "合成依据集合",
      tenant_id: "tenant-test",
      matter_id: "matter-test",
      kind: "legal_research",
      status: "active",
      current_version_number: history.length,
      version: history.length,
    });
    const version = (index: number) => ({
      id: `v${index + 1}`,
      project_artifact_id: "collection",
      tenant_id: "tenant-test",
      matter_id: "matter-test",
      version_number: index + 1,
      original_filename: filename,
      media_type: "application/json",
      review_status: "unreviewed",
      source_provenance: "client_asserted",
      byte_size: Buffer.byteLength(history[index]!),
      sha256: sha(history[index]!),
      source_thread_id: thread,
      source_artifact_path: filepath,
      created_at: "2026-09-06T00:00:00Z",
    });
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, json: { detail: "Unmocked endpoint" } }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: thread,
          title: "合成法律依据整理",
          artifacts: [filepath],
          messages: [
            { type: "ai", id: "answer", content: "合成测试，非实际法律意见。" },
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
        expect(input.expected_sha256).toBe(sha(stored));
        stored = input.content;
        puts++;
        return route.fulfill({
          json: {
            path: filepath,
            sha256: sha(stored),
            size: Buffer.byteLength(stored),
          },
        });
      }
      return route.fulfill({
        body: stored,
        contentType: "application/json",
        headers: { ETag: `"${sha(stored)}"` },
      });
    });
    await page.route("**/api/law/**", (route) => {
      const url = route.request().url();
      const match = /\/versions\/v([0-9]+)\/content$/.exec(url);
      if (match)
        return route.fulfill({
          body: history[Number(match[1]) - 1]!,
          contentType: "application/json",
        });
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
        data = { matter: { title: "合成法律顾问主题", status: "active" } };
      else if (
        url.endsWith("/project-artifacts") ||
        url.endsWith("/project-artifacts/collection/versions")
      ) {
        if (route.request().method() === "POST") {
          const multipart = route.request().postDataBuffer()!.toString("utf8");
          expect(multipart).toContain(stored);
          history.push(stored);
          return route.fulfill({
            status: 201,
            json: {
              data: {
                artifact: artifact(),
                artifact_version: version(history.length - 1),
              },
              meta: {},
            },
          });
        }
        data = url.endsWith("/versions")
          ? { items: history.map((_text, index) => version(index)).reverse() }
          : { items: [artifact()] };
      }
      return route.fulfill({ json: { data, meta: {} } });
    });
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByText(filename, { exact: true }).click();
    const region = page.getByRole("region", { name: "法律依据", exact: true });
    await expect(
      region.getByRole("button", { name: "手工添加", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await region.getByRole("button", { name: "手工添加", exact: true }).click();
    let dialog = page.getByRole("dialog", {
      name: "手工添加法律依据",
      exact: true,
    });
    await dialog.getByLabel("法律名称", { exact: true }).fill("手工合成依据");
    await dialog
      .getByLabel("条文或摘要内容")
      .fill("手工摘录 <script>保持普通文本</script>");
    await dialog.getByLabel("出处说明（可留空）").fill("测试文件中的手工文字");
    await dialog.getByText("日期与时点（缺失请留空，不默认今天）").click();
    await dialog.getByLabel("施行日期（年 / 年月 / 年月日）").fill("2024-02");
    await dialog.getByLabel("施行日期的依据").fill("材料只有年月");
    await dialog
      .getByLabel("收录理由", { exact: true })
      .fill("人工选择用于合成顾问主题");
    const apply = async (modal: Locator) => {
      const confirmation = modal.getByRole("checkbox");
      await confirmation.focus();
      await confirmation.press("Space");
      await expect(confirmation).toBeChecked();
      await expect(modal.getByRole("heading")).toBeInViewport({ ratio: 1 });
      await expect(
        modal.getByRole("button", { name: "取消", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await expect(
        modal.getByRole("button", { name: "应用到草稿", exact: true }),
      ).toBeInViewport({ ratio: 1 });
      await confirmation.press("Tab");
      await expect(
        modal.getByRole("button", { name: "取消", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        modal.getByRole("button", { name: "应用到草稿", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(modal).not.toBeVisible();
      await expect(region).toBeVisible();
    };
    await page.screenshot({
      path: info.outputPath("authority-form.png"),
      animations: "disabled",
    });
    await apply(dialog);
    expect(puts).toBe(0);
    expect(history).toHaveLength(1);
    await expect(
      page.getByRole("button", { name: "保存到项目", exact: true }),
    ).toBeDisabled();
    await region
      .getByRole("button", { name: "从来源收录", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "从已有来源收录", exact: true });
    await dialog.getByLabel("选择已记录来源").selectOption("legacy-1");
    await dialog.getByRole("button", { name: "使用来源文字" }).click();
    await dialog
      .getByLabel("法律名称", { exact: true })
      .fill("从旧来源收藏的依据");
    await apply(dialog);
    await region.getByRole("button", { name: /合成示例法 第一条/ }).click();
    await region.getByRole("button", { name: "编辑依据", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "编辑法律依据", exact: true });
    await dialog
      .getByLabel("适用性分析（非条文原文）")
      .fill("补充的合成适用性分析，不修改来源");
    await apply(dialog);
    const save = async (expected: number) => {
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await expect.poll(() => puts).toBe(expected);
      await page
        .getByRole("button", { name: "保存到项目", exact: true })
        .click();
      const modal = page.getByRole("dialog", {
        name: "保存到当前法律项目",
        exact: true,
      });
      await modal.getByLabel("保存位置").selectOption("collection");
      await modal
        .getByRole("button", { name: "保存未审核版本", exact: true })
        .click();
      await expect(modal).not.toBeVisible();
      expect(history).toHaveLength(expected + 1);
    };
    await save(1);
    const collected = JSON.parse(stored) as LegalAuthorities;
    expect(collected.entries).toHaveLength(4);
    expect(collected.entries[2]!.effective_date).toEqual({
      value: "2024-02",
      basis: "材料只有年月",
    });
    expect(collected.entries[3]).toMatchObject({
      origin: "favorite",
      source_ids: ["legacy-1"],
    });
    expect(collected.sources.slice(0, 4)).toEqual(fixture.sources);
    await region.getByRole("button", { name: /合成示例法 第一条/ }).click();
    await region.getByRole("button", { name: "移除依据", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "移除法律依据", exact: true });
    await dialog
      .getByLabel("移除原因", { exact: true })
      .fill("该时点暂不适用，待进一步核实");
    await apply(dialog);
    await save(2);
    await region.getByRole("button", { name: /合成示例法 第一条/ }).click();
    await region.getByRole("button", { name: "恢复收录", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "恢复法律依据", exact: true });
    await expect(dialog.getByText(/历史中仅保留已经保存的版本/)).toBeVisible();
    await apply(dialog);
    await save(3);
    expect(
      (JSON.parse(history[2]!) as LegalAuthorities).entries[0],
    ).toMatchObject({
      id: "entry-1",
      state: "removed",
      removal_reason: "该时点暂不适用，待进一步核实",
    });
    expect(
      (JSON.parse(history[3]!) as LegalAuthorities).entries[0],
    ).toMatchObject({ id: "entry-1", state: "active", removal_reason: null });
    expect(history[0]).toBe(initial);
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: /合成依据集合/ }).click();
    await expect(
      region.getByRole("button", { name: "手工添加", exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("历史版本").selectOption("v3");
    await region.getByRole("button", { name: /合成示例法 第一条/ }).click();
    await expect(
      region.getByText("该时点暂不适用，待进一步核实", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("authority-removal-history.png"),
      animations: "disabled",
    });
    await page.getByLabel("历史版本").selectOption("v1");
    await expect(
      region.getByRole("button", { name: /手工合成依据/ }),
    ).toHaveCount(0);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
    expect(forbidden).toEqual([]);
    expect(
      await page.evaluate(() =>
        JSON.stringify([
          Object.values(localStorage),
          Object.values(sessionStorage),
        ]),
      ),
    ).not.toMatch(/手工合成依据|从旧来源收藏的依据|该时点暂不适用/);
  });
}
