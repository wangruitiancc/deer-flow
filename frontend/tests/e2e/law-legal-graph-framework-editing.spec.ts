import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { type LegalGraph } from "../../src/core/law/legal-graph";

import { mockLangGraphAPI } from "./utils/mock-api";

const content = readFileSync(
  new URL(
    "../../../backend/extensions/sources/matrix-law-extension/matrix_law_extension/contracts/legal_graph_presentation.example.json",
    import.meta.url,
  ),
  "utf8",
);
const filepath = "/mnt/user-data/outputs/framework.law-graph.json";
const thread = "00000000-0000-0000-0000-000000000093";

for (const width of [390, 1440]) {
  test(`case frameworks edit only the native draft and recheck matter changes at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({
      colorScheme: width === 390 ? "light" : "dark",
      reducedMotion: "reduce",
    });
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, json: { detail: "Synthetic only" } }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: thread,
          title: "合成案件框架编辑",
          artifacts: [filepath],
          messages: [
            { type: "ai", id: "answer", content: "合成候选，不是法律结论。" },
          ],
        },
      ],
    });
    let matterVersion = 1;
    let stored = content;
    let writes = 0;
    const sha = () => createHash("sha256").update(stored).digest("hex");
    await page.route("**/api/law/**", (route) => {
      const url = route.request().url();
      const data = url.includes("/context/by-thread/")
        ? {
            context: {
              user_id: "default",
              tenant_id: "tenant-test",
              matter_id: "matter-test",
              matter_role: "owner",
              mapping_id: "mapping",
              context_version: 1,
              thread_id: thread,
            },
          }
        : url.endsWith("/matters/matter-test")
          ? {
              matter: {
                id: "matter-test",
                tenant_id: "tenant-test",
                title: "合成案件框架编辑",
                status: "active",
                version: matterVersion,
                cause: matterVersion === 1 ? null : "合成登记变更",
                stage: "analysis",
              },
            }
          : { items: [] };
      return route.fulfill({ json: { data, meta: {} } });
    });
    await page.route("**/api/threads/*/artifacts/**", (route) => {
      if (route.request().method() === "PUT") {
        const value = route.request().postDataJSON() as {
          content: string;
          expected_sha256: string;
        };
        expect(value.expected_sha256).toBe(sha());
        stored = value.content;
        writes++;
        return route.fulfill({
          json: {
            path: filepath,
            size: Buffer.byteLength(stored),
            sha256: sha(),
          },
        });
      }
      return route.fulfill({
        body: stored,
        contentType: "application/json",
        headers: { ETag: `"${sha()}"` },
      });
    });
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByRole("tab", { name: "案情图谱", exact: true }).click();
    await page
      .getByRole("button", {
        name: "framework.law-graph.json 本会话图谱",
        exact: true,
      })
      .click();
    const graph = page.getByRole("region", { name: "案情图谱" });
    await expect(graph.getByLabel("AI 编排主题")).toHaveValue("proof-view");
    await expect(graph.getByLabel("图谱布局方式")).toHaveValue("analysis");
    await expect(graph.getByText(/当前 4 个节点 \/ 3 条关系/)).toBeVisible();
    await expect(graph.getByLabel("AI 配色图例")).toContainText(
      "本案支持与相反材料",
    );
    if (width === 1440) {
      await expect(graph.locator('svg circle[fill="#a855f7"]')).toHaveCount(2);
      await expect(graph.locator('svg circle[fill="#2563eb"]')).toHaveCount(2);
    }
    await graph.screenshot({
      path: info.outputPath("ai-presentation.png"),
      animations: "disabled",
    });
    await graph.getByText("手动调整与专业筛选", { exact: true }).click();
    await graph.getByLabel("本案案由或罪名框架").selectOption("frame-b");
    await expect(graph.getByLabel("AI 编排主题")).toHaveValue("");
    await expect(graph.getByText(/当前 8 个节点 \/ 7 条关系/)).toBeVisible();
    await graph
      .getByRole("button", { name: "查看完整图谱", exact: true })
      .click();
    await expect(graph.getByText(/当前 10 个节点 \/ 10 条关系/)).toBeVisible();
    await graph
      .getByRole("button", { name: "框架与依据", exact: true })
      .click();
    await expect(
      graph
        .getByRole("complementary", { name: "法律分析框架" })
        .getByRole("heading", { name: "候选案由 A · 候选分析 A" }),
    ).toBeVisible();
    await expect(
      graph.getByRole("button", { name: "管理分析框架" }),
    ).toHaveCount(0);
    await graph.getByRole("button", { name: "关闭框架详情" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await graph
      .getByRole("button", { name: "管理分析框架", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "管理法律分析框架" });
    await expect(dialog.getByText(/当前案件：合成案件框架编辑/)).toBeVisible();
    await dialog
      .getByLabel("框架名称 1", { exact: true })
      .fill("修订后的候选路径");
    await dialog
      .getByLabel("框架 1 专业关系", { exact: true })
      .selectOption(["issue-link-a", "element-link-a", "fact-a"]);
    await dialog.screenshot({
      path: info.outputPath("framework-editor.png"),
      animations: "disabled",
    });
    const checkbox = dialog.getByRole("checkbox", {
      name: "已对照本案详情核对本轮候选框架及适用范围",
    });
    await checkbox.check();
    matterVersion = 2;
    await dialog.getByRole("button", { name: "应用分析框架到草稿" }).click();
    await expect(dialog.getByRole("alert")).toContainText("案件信息又发生变化");
    await expect(checkbox).not.toBeChecked();
    expect(writes).toBe(0);
    await dialog.screenshot({
      path: info.outputPath("framework-baseline-change.png"),
      animations: "disabled",
    });
    await checkbox.check();
    await dialog.getByRole("button", { name: "应用分析框架到草稿" }).click();
    await expect(dialog).toBeHidden();
    expect(writes).toBe(0);
    await expect(graph.getByLabel("本案案由或罪名框架")).toContainText(
      "修订后的候选路径",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Artifact saved", { exact: true }),
    ).toBeVisible();
    expect(writes).toBe(1);
    const updated = JSON.parse(stored) as LegalGraph;
    const original = JSON.parse(content) as LegalGraph;
    expect(updated.analysis?.matter_version).toBe(2);
    expect(updated.analysis?.registered_cause).toBe("合成登记变更");
    expect(updated.analysis?.frameworks?.[0]?.id).toBe("frame-a");
    expect(updated.analysis?.frameworks?.[0]?.label).toBe("修订后的候选路径");
    expect(updated.nodes).toEqual(original.nodes);
    expect(updated.sources).toEqual(original.sources);
    expect(updated.presentation).toEqual(original.presentation);
    expect(
      updated.edges
        .filter((edge) => edge.legal?.framework_ids?.includes("frame-a"))
        .map((edge) => edge.id),
    ).toEqual(["issue-link-a", "element-link-a", "fact-a"]);
    expect(
      updated.edges
        .filter((edge) => edge.legal?.framework_ids?.includes("frame-b"))
        .map((edge) => edge.id),
    ).toEqual(
      original.edges
        .filter((edge) => edge.legal?.framework_ids?.includes("frame-b"))
        .map((edge) => edge.id),
    );
    await page.reload();
    await expect(graph.getByLabel("AI 编排主题")).toHaveValue("proof-view");
    await expect(graph.getByText(/当前 4 个节点 \/ 3 条关系/)).toBeVisible();
    await expect(graph.getByLabel("本案案由或罪名框架")).toContainText(
      "修订后的候选路径",
    );
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", width);
  });
}
