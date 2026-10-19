import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const content = readFileSync(
  new URL(
    "../../../backend/extensions/sources/matrix-law-extension/matrix_law_extension/contracts/legal_graph_professional.example.json",
    import.meta.url,
  ),
  "utf8",
);
const filepath = "/mnt/user-data/outputs/professional.law-graph.json";
const thread = "00000000-0000-0000-0000-000000000092";

test("professional frameworks and relationship lenses remain separate and read-only", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const errors: string[] = [];
    Reflect.set(window, "__syntheticGraphWorkerErrors", errors);
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      private active = true;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name === "legal-graph-layout")
          this.addEventListener("error", (event) => {
            if (this.active) errors.push(event.message);
          });
      }
      override terminate() {
        this.active = false;
        super.terminate();
      }
    };
  });
  let writes = 0;
  page.on("request", (request) => {
    if (request.url().includes("/artifacts/") && request.method() === "PUT")
      writes++;
  });
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, json: { detail: "Synthetic test only" } }),
  );
  mockLangGraphAPI(page, {
    threads: [
      {
        thread_id: thread,
        title: "合成法律框架验收",
        artifacts: [filepath],
        messages: [
          { type: "ai", id: "answer", content: "仅工程验收的候选框架。" },
        ],
      },
    ],
  });
  await page.route("**/api/law/**", (route) => {
    const url = route.request().url();
    const data = url.includes("/context/by-thread/")
      ? {
          context: {
            user_id: "default",
            tenant_id: "tenant-test",
            matter_id: "matter-test",
            matter_role: "owner",
            thread_id: thread,
          },
        }
      : url.endsWith("/matters/matter-test")
        ? {
            matter: {
              title: "合成法律框架验收",
              status: "active",
              version: 1,
              cause: null,
            },
          }
        : { items: [] };
    return route.fulfill({ json: { data, meta: {} } });
  });
  await page.route("**/api/threads/*/artifacts/**", (route) =>
    route.fulfill({
      body: content,
      contentType: "application/json",
      headers: {
        ETag: `"${createHash("sha256").update(content).digest("hex")}"`,
      },
    }),
  );
  await page.goto(`/workspace/chats/${thread}`);
  await page.getByRole("tab", { name: "案情图谱", exact: true }).click();
  await page
    .getByRole("button", { name: /professional.law-graph.json/ })
    .click();
  const graph = page.getByRole("region", { name: "案情图谱" });
  await expect(graph).toBeVisible();
  await graph.getByRole("button", { name: "关系画布", exact: true }).click();
  await expect(graph.getByRole("button", { name: "放大图谱" })).toBeEnabled();
  await expect(
    graph.getByText("布局线程不可用，已切换为分帧布局。"),
  ).toHaveCount(0);
  await graph.getByLabel("本案案由或罪名框架").selectOption("frame-a");
  await expect(graph.locator('[data-node-id="element-a"]')).toBeVisible();
  await expect(graph.locator('[data-node-id="element-b"]')).toHaveCount(0);
  await graph.getByLabel("本案案由或罪名框架").selectOption("frame-b");
  await expect(graph.locator('[data-node-id="element-b"]')).toBeVisible();
  await expect(graph.locator('[data-node-id="element-a"]')).toHaveCount(0);
  await graph.getByLabel("本案案由或罪名框架").selectOption("all");
  await graph.getByRole("button", { name: "证据与证明", exact: true }).click();
  await expect(
    graph.getByText("当前 3 个节点 / 2 条关系 · 全图"),
  ).toBeVisible();
  await graph.getByRole("button", { name: "节点与关系", exact: true }).click();
  await graph
    .getByRole("button", { name: /合成相反材料 → 存在相反陈述/ })
    .click();
  await expect(
    graph
      .getByRole("complementary", { name: "图谱详情" })
      .getByText(/当事人主张/),
  ).toBeVisible();
  await graph.getByRole("button", { name: "全部关系", exact: true }).click();
  await graph.getByRole("button", { name: "关闭详情" }).click();
  await graph.getByRole("button", { name: /待核查切入点/ }).click();
  await expect(
    graph
      .getByRole("complementary", { name: "待核查切入点" })
      .getByText("两份合成材料对同一行为的陈述是否一致？"),
  ).toBeVisible();
  await graph.getByRole("button", { name: /待核查切入点/ }).click();
  await graph.getByRole("button", { name: "关系画布", exact: true }).click();
  await graph.getByLabel("图谱布局方式").selectOption("analysis");
  await expect(graph.getByRole("button", { name: "放大图谱" })).toBeEnabled();
  await graph.screenshot({
    path: info.outputPath("professional-graph.png"),
    animations: "disabled",
  });
  await graph.getByRole("button", { name: "图谱设置", exact: true }).click();
  await graph.screenshot({
    path: info.outputPath("professional-graph-settings.png"),
    animations: "disabled",
  });
  expect(
    await page.evaluate(() =>
      Reflect.get(window, "__syntheticGraphWorkerErrors"),
    ),
  ).toEqual([]);
  await expect(
    graph.getByText("布局线程不可用，已切换为分帧布局。"),
  ).toHaveCount(0);
  expect(writes).toBe(0);
});
