import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { type LegalGraph } from "../../src/core/law/legal-graph";

import { mockLangGraphAPI } from "./utils/mock-api";

const graph = (
  JSON.parse(
    readFileSync(
      new URL(
        "../../../backend/extensions/sources/matrix-law-extension/matrix_law_extension/contracts/legal_graph_v1.examples.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { base: unknown }
).base;
const content = JSON.stringify(graph);
const filepath = "/mnt/user-data/outputs/contract.law-graph.json";
const thread = "00000000-0000-0000-0000-000000000091";
const digest = createHash("sha256").update(content).digest("hex");
const savedArtifact = {
  id: "graph-snapshot",
  tenant_id: "tenant-test",
  matter_id: "matter-test",
  title: "合成图谱已保存",
  kind: "knowledge_graph",
  status: "active",
  current_version_number: 1,
  version: 1,
};
const savedVersion = {
  id: "graph-version",
  project_artifact_id: savedArtifact.id,
  tenant_id: "tenant-test",
  matter_id: "matter-test",
  version_number: 1,
  original_filename: "snapshot.json",
  media_type: "application/json",
  review_status: "unreviewed",
  source_provenance: "client_asserted",
  byte_size: Buffer.byteLength(content),
  sha256: digest,
  source_thread_id: thread,
  source_artifact_path: filepath,
  created_at: "2026-09-06T00:00:00Z",
};

for (const width of [320, 768, 1024, 1440]) {
  test(`native legal graph views at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 900 });
    await page.emulateMedia({
      colorScheme: width === 320 || width === 1024 ? "dark" : "light",
      reducedMotion: "reduce",
    });
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, json: { detail: "Unmocked endpoint" } }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: thread,
          title: "合成图谱验收",
          artifacts: [filepath],
          messages: [
            { type: "ai", id: "answer", content: "合成案情图谱已生成。" },
          ],
        },
      ],
    });
    await page.route("**/api/law/**", (route) => {
      const url = route.request().url();
      if (url.endsWith("/versions/graph-version/content"))
        return route.fulfill({
          body: content,
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
      else if (url.endsWith("/project-artifacts"))
        data = { items: [savedArtifact] };
      else if (url.endsWith("/versions")) data = { items: [savedVersion] };
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
    await page.getByTestId("artifact-trigger").click();
    await page.getByText("contract.law-graph.json", { exact: true }).click();
    const region = page.getByRole("region", { name: "案情图谱" });
    await expect(region).toBeVisible();
    await region.getByRole("button", { name: "关系画布", exact: true }).click();
    await expect(
      region.getByRole("button", { name: "放大图谱" }),
    ).toBeEnabled();
    const canvas = region.getByRole("img");
    const transform = canvas.locator(":scope > g");
    const initial = await transform.getAttribute("transform");
    await region.getByRole("button", { name: "放大图谱" }).click();
    await expect(transform).not.toHaveAttribute("transform", initial!);
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    const beforePan = await transform.getAttribute("transform");
    const canvasBounds = (await canvas.boundingBox())!;
    await page.mouse.move(canvasBounds.x + 10, canvasBounds.y + 10);
    await page.mouse.down();
    await page.mouse.move(canvasBounds.x + 28, canvasBounds.y + 24, {
      steps: 3,
    });
    await page.mouse.up();
    await expect(transform).not.toHaveAttribute("transform", beforePan!);
    await expect(transform).not.toHaveAttribute("transform", /NaN|Infinity/);
    await region.getByRole("button", { name: "适配全图" }).click();
    await page.screenshot({
      path: info.outputPath("graph-canvas.png"),
      animations: "disabled",
    });
    await region.getByRole("button", { name: "时间线", exact: true }).click();
    await expect(region.getByText("2024-02", { exact: true })).toBeVisible();
    await region.getByRole("button", { name: /2024-02 合成签约事件/ }).click();
    await expect(region.getByText("自报摘录（未核验）")).toBeVisible();
    await page.screenshot({
      path: info.outputPath("graph-timeline.png"),
      animations: "disabled",
    });
    if (width === 768) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(region).toBeVisible();
      await region.getByRole("button", { name: "时间线", exact: true }).click();
      await region
        .getByRole("button", { name: /2024-02 合成签约事件/ })
        .click();
    }
    await region.getByRole("button", { name: "节点与关系" }).click();
    await region.getByRole("button", { name: "关闭详情" }).click();
    await region.getByLabel("搜索图谱节点或关系").fill("不存在");
    await expect(region.getByText("没有匹配的节点或关系。")).toBeVisible();
    await expect(page.locator("body")).toHaveJSProperty(
      "scrollWidth",
      page.viewportSize()!.width,
    );
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: /合成图谱已保存/ }).click();
    await expect(region).toBeVisible();
    await expect(page.getByText(/只读快照/)).toBeVisible();
    await region.getByRole("button", { name: "时间线", exact: true }).click();
    await expect(region.getByText("2024-02", { exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("graph-history.png"),
      animations: "disabled",
    });
  });
}

for (const width of [320, 1440]) {
  test(`edits a graph through native file drafts and appends an immutable version at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({
      colorScheme: width === 320 ? "dark" : "light",
      reducedMotion: "reduce",
    });
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, json: { detail: "Unmocked endpoint" } }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: thread,
          title: "图谱编辑验收",
          artifacts: [filepath],
          messages: [{ type: "ai", id: "answer", content: "合成图谱。" }],
        },
      ],
    });
    let stored = content,
      puts = 0,
      archived: string | null = null,
      multipart = "",
      conflict = false;
    const sha = () => createHash("sha256").update(stored).digest("hex");
    await page.route("**/api/threads/*/artifacts/**", async (route) => {
      if (route.request().method() === "PUT") {
        const input = route.request().postDataJSON() as {
          content: string;
          expected_sha256: string;
        };
        expect(input.expected_sha256).toBe(sha());
        puts++;
        if (conflict)
          return route.fulfill({
            status: 412,
            json: { detail: "Changed remotely" },
          });
        stored = input.content;
        return route.fulfill({
          json: {
            path: filepath,
            sha256: sha(),
            size: Buffer.byteLength(stored),
          },
        });
      }
      return route.fulfill({
        body: stored,
        contentType: "application/json",
        headers: { ETag: `"${sha()}"` },
      });
    });
    await page.route("**/api/law/**", (route) => {
      const url = route.request().url();
      if (url.endsWith("/versions/graph-version/content"))
        return route.fulfill({
          body: content,
          contentType: "application/json",
        });
      if (url.endsWith("/versions/graph-version-2/content"))
        return route.fulfill({
          body: archived!,
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
        data = { matter: { title: "合成咨询" } };
      else if (
        url.endsWith("/project-artifacts") &&
        route.request().method() === "POST"
      ) {
        multipart = route.request().postData() ?? "";
        archived = stored;
        data = {
          artifact: { ...savedArtifact, version: 2, current_version_number: 2 },
          artifact_version: { version_number: 2 },
        };
      } else if (url.endsWith("/project-artifacts"))
        data = {
          items: [
            {
              ...savedArtifact,
              version: archived ? 2 : 1,
              current_version_number: archived ? 2 : 1,
            },
          ],
        };
      else if (url.endsWith("/versions"))
        data = {
          items: archived
            ? [
                {
                  ...savedVersion,
                  id: "graph-version-2",
                  version_number: 2,
                  sha256: createHash("sha256").update(archived).digest("hex"),
                  byte_size: Buffer.byteLength(archived),
                },
                savedVersion,
              ]
            : [savedVersion],
        };
      return route.fulfill({ json: { data, meta: {} } });
    });
    await page.goto(`/workspace/chats/${thread}`);
    await page.getByTestId("artifact-trigger").click();
    await page.getByText("contract.law-graph.json", { exact: true }).click();
    const region = page.getByRole("region", { name: "案情图谱" });
    await expect(region.getByRole("button", { name: "新增节点" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await region.getByRole("button", { name: "新增节点" }).click();
    let dialog = page.getByRole("dialog", { name: "新增节点", exact: true });
    await dialog.getByLabel("节点名称").fill("合成乙方");
    await dialog.getByLabel("节点类型").selectOption("org");
    await dialog.getByLabel("固定位置 X").fill("520");
    await dialog.getByLabel("固定位置 Y").fill("250");
    await page.screenshot({
      path: info.outputPath("graph-edit-node.png"),
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "应用到草稿" }).click();
    expect(puts).toBe(0);
    await expect(
      page.getByRole("button", { name: "保存到项目", exact: true }),
    ).toBeDisabled();
    await region.getByRole("button", { name: "节点与关系" }).click();
    await region.getByRole("button", { name: /合成签约事件 事件/ }).click();
    await region.getByRole("button", { name: "编辑节点" }).click();
    dialog = page.getByRole("dialog", { name: "编辑节点", exact: true });
    await dialog.getByLabel("事件日期（可留空）").fill("2024");
    await dialog.getByRole("button", { name: "应用到草稿" }).click();
    await region.getByRole("button", { name: "关闭详情" }).click();
    await region.getByRole("button", { name: "新增关系" }).click();
    dialog = page.getByRole("dialog", { name: "新增关系", exact: true });
    await dialog.getByLabel("关系名称").fill("待核实参与");
    await dialog
      .getByLabel("终点节点")
      .selectOption({ label: "合成签约事件 (event-1)" });
    await dialog.getByRole("button", { name: "应用到草稿" }).click();
    if (width === 1440) {
      await region
        .getByRole("button", { name: "关系画布", exact: true })
        .click();
      await expect(
        region.getByRole("button", { name: "放大图谱" }),
      ).toBeEnabled();
      const circle = region.locator('[data-node-id="party-a"] circle').nth(1);
      await expect(circle).toBeInViewport();
      await page.screenshot({
        path: info.outputPath("graph-before-drag.png"),
        animations: "disabled",
      });
      const bounds = (await circle.boundingBox())!;
      const nodeGroup = region.locator('[data-node-id="party-a"]');
      const originalPosition = await nodeGroup.getAttribute("transform");
      await page.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + bounds.width / 2 + 15,
        bounds.y + bounds.height / 2 + 10,
        { steps: 3 },
      );
      await expect(nodeGroup).not.toHaveAttribute(
        "transform",
        originalPosition!,
      );
      await region
        .getByRole("img")
        .dispatchEvent("pointercancel", { pointerId: 1 });
      await page.mouse.up();
      await expect(nodeGroup).toHaveAttribute("transform", originalPosition!);
      await page.mouse.move(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        bounds.x + bounds.width / 2 + 25,
        bounds.y + bounds.height / 2 + 20,
        { steps: 5 },
      );
      expect(puts).toBe(0);
      await page.mouse.up();
      await page.screenshot({
        path: info.outputPath("graph-after-drag.png"),
        animations: "disabled",
      });
      await expect(
        region.getByRole("button", { name: "放大图谱" }),
      ).toBeEnabled();
    }
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Artifact saved", { exact: true }),
    ).toBeVisible();
    expect(puts).toBe(1);
    const saved = JSON.parse(stored) as LegalGraph;
    expect(saved.nodes).toHaveLength(3);
    expect(saved.nodes[1]?.date).toEqual({ value: "2024", origin: "user" });
    expect(saved.nodes[2]?.position).toEqual({ x: 520, y: 250 });
    if (width === 1440)
      expect(saved.nodes[0]?.position).toEqual({
        x: expect.any(Number),
        y: expect.any(Number),
      });
    expect(saved.edges).toHaveLength(2);
    expect(saved.edges[1]?.confidence).toBe("AMBIGUOUS");
    expect(saved.sources).toEqual((graph as LegalGraph).sources);

    await page.reload();
    await expect(region).toBeVisible();
    await region.getByRole("button", { name: "节点与关系" }).click();
    await expect(
      region.getByRole("button", { name: /合成乙方 组织/ }),
    ).toBeVisible();
    await expect(region.getByRole("button", { name: "新增节点" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "保存到当前法律项目" });
    await dialog.getByLabel("保存位置").selectOption(savedArtifact.id);
    await dialog.getByRole("button", { name: "保存未审核版本" }).click();
    await expect(dialog).toBeHidden();
    expect(archived).toBe(stored);
    expect(multipart).toContain(stored);
    expect(multipart).toContain('name="expected_version"');
    expect(multipart).not.toContain('name="review_status"');
    await page.getByRole("tab", { name: "项目已保存成果" }).click();
    await page.getByRole("button", { name: /合成图谱已保存/ }).click();
    await region.getByRole("button", { name: "节点与关系" }).click();
    await expect(
      region.getByRole("button", { name: /合成乙方 组织/ }),
    ).toBeVisible();
    await expect(region.getByRole("button", { name: "新增节点" })).toHaveCount(
      0,
    );
    await page.getByLabel("版本").selectOption("graph-version");
    await expect(
      region.getByRole("button", { name: /合成乙方 组织/ }),
    ).toHaveCount(0);
    await page.getByRole("tab", { name: "本会话文件" }).click();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await region.getByRole("button", { name: "节点与关系" }).click();
    await region.getByRole("button", { name: /合成甲方 当事人/ }).click();
    page.once("dialog", (confirm) => confirm.accept());
    await region.getByRole("button", { name: "删除节点" }).click();
    await expect(
      region.getByRole("button", { name: /合成甲方 当事人/ }),
    ).toHaveCount(0);
    await expect(region.getByText("关系（0）", { exact: true })).toBeVisible();
    conflict = true;
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByText("Changed remotely", { exact: true }),
    ).toBeVisible();
    expect(stored).toBe(archived);
    await expect(
      region.getByRole("button", { name: /合成甲方 当事人/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    page.once("dialog", (confirm) => confirm.accept());
    await page
      .getByRole("button", { name: "Discard changes", exact: true })
      .click();
    await expect(
      region.getByRole("button", { name: /合成甲方 当事人/ }),
    ).toBeVisible();
    expect(puts).toBe(2);
  });
}
