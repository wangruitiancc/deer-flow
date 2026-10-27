import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const threadId = "00000000-0000-0000-0000-000000000074";
const copyPath = "/mnt/user-data/outputs/project-copy-synthetic.md";
const original = "\ufeff# 原始合成文书\r\n\r\n仅用于流程验证。\r\n";
const editedText = "修订后的合成文书，仅用于流程验证。";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

for (const width of [1280, 390]) {
  test(`edits a saved copy and reopens the appended project version at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, json: { detail: "Unmocked" } }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: threadId,
          title: "合成编辑会话",
          artifacts: [],
          messages: [],
        },
      ],
    });
    let workingText = original;
    let imports = 0;
    let puts = 0;
    let saveAttempts = 0;
    const saveKeys: string[] = [];
    const history = [original];
    const artifact = {
      id: "saved-document",
      tenant_id: "tenant-test",
      matter_id: "matter-test",
      kind: "document",
      title: "合成案件文书",
      status: "active",
      current_version_number: 1,
      version: 1,
    };
    const version = (content: string, index: number) => ({
      id: `v${index + 1}`,
      tenant_id: artifact.tenant_id,
      matter_id: artifact.matter_id,
      project_artifact_id: artifact.id,
      version_number: index + 1,
      source_thread_id: threadId,
      source_artifact_path: index
        ? copyPath
        : "/mnt/user-data/outputs/original.md",
      source_revision_sha256: sha(content),
      source_provenance: "client_asserted",
      original_filename: index ? "project-copy-synthetic.md" : "original.md",
      media_type: "text/markdown",
      byte_size: Buffer.byteLength(content),
      sha256: sha(content),
      review_status: "unreviewed",
      created_at: "2026-10-27T00:00:00Z",
    });
    await page.route("**/api/threads/*/artifacts/**", async (route) => {
      const request = route.request();
      if (new URL(request.url()).pathname.endsWith("/import-text")) {
        const input = request.postDataJSON() as {
          filename: string;
          content: string;
          source_sha256: string;
        };
        expect(input.content).toBe(original);
        expect(input.source_sha256).toBe(sha(original));
        imports++;
        await route.fulfill({
          status: 201,
          json: {
            path: copyPath,
            sha256: sha(original),
            size: Buffer.byteLength(original),
          },
        });
      } else if (request.method() === "PUT") {
        const input = request.postDataJSON() as {
          content: string;
          expected_sha256: string;
        };
        expect(input.expected_sha256).toBe(sha(workingText));
        expect(input.content).toContain(editedText);
        workingText = input.content;
        puts++;
        await route.fulfill({
          json: {
            path: copyPath,
            sha256: sha(workingText),
            size: Buffer.byteLength(workingText),
          },
        });
      } else
        await route.fulfill({
          body: workingText,
          contentType: "text/markdown",
          headers: { ETag: `"${sha(workingText)}"` },
        });
    });
    await page.route("**/api/law/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let data: unknown = { items: [] };
      if (pathname.endsWith(`/context/by-thread/${threadId}`))
        data = {
          context: {
            user_id: "default",
            tenant_id: artifact.tenant_id,
            matter_id: artifact.matter_id,
            matter_role: "lawyer",
            thread_id: threadId,
          },
        };
      else if (pathname.endsWith("/matters/matter-test"))
        data = {
          matter: {
            id: artifact.matter_id,
            title: "合成案件",
            status: "active",
          },
        };
      else if (
        pathname.endsWith("/project-artifacts") &&
        request.method() === "POST"
      ) {
        const buffer = request.postDataBuffer();
        if (!buffer) throw new Error("missing synthetic project-save body");
        const form = await new Request(request.url(), {
          method: "POST",
          headers: request.headers(),
          body: new Uint8Array(buffer).buffer,
        }).formData();
        const file = form.get("file");
        if (file === null || typeof file === "string")
          throw new Error("missing synthetic saved file");
        expect(await file.text()).toBe(workingText);
        expect(form.get("project_artifact_id")).toBe(artifact.id);
        expect(form.get("expected_version")).toBe("1");
        expect(form.get("source_revision_sha256")).toBe(sha(workingText));
        saveKeys.push(request.headers()["idempotency-key"]!);
        saveAttempts++;
        if (saveAttempts === 1) {
          await route.fulfill({
            status: 503,
            json: {
              error: {
                code: "TEMPORARILY_UNAVAILABLE",
                message: "合成保存暂时失败，请重试",
              },
            },
          });
          return;
        }
        expect(saveKeys[1]).toBe(saveKeys[0]);
        expect(saveKeys[0]).toBeTruthy();
        history.push(workingText);
        artifact.current_version_number = 2;
        artifact.version = 2;
        data = { artifact, artifact_version: version(workingText, 1) };
      } else if (pathname.endsWith("/project-artifacts"))
        data = { items: [{ ...artifact }] };
      else if (pathname.endsWith("/versions"))
        data = { items: history.map(version) };
      else if (/\/versions\/v[12]\/content$/.test(pathname)) {
        const index = pathname.includes("/v2/") ? 1 : 0;
        await route.fulfill({
          contentType: "text/markdown",
          body: history[index],
        });
        return;
      } else if (pathname.endsWith("/sources")) {
        const index = pathname.includes("/v2/") ? 1 : 0;
        data = {
          artifact_id: artifact.id,
          version_id: `v${index + 1}`,
          version_number: index + 1,
          version_sha256: sha(history[index]!),
          source_provenance: "client_asserted",
          source_manifest: { citations: [], authorities: [] },
          source_manifest_sha256: "b".repeat(64),
          source_state: "bound",
        };
      }
      await route.fulfill({
        json: { data, meta: { request_id: "synthetic-edit-save" } },
      });
    });

    await page.goto(`/workspace/chats/${threadId}`);
    await page.getByRole("tab", { name: "文书撰写", exact: true }).click();
    await page.getByRole("button", { name: "合成案件文书" }).click();
    await expect(page.getByLabel("历史版本")).toHaveValue("v1");
    await expect(
      page.getByRole("heading", { name: "原始合成文书", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "创建会话工作副本", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit", exact: true }),
    ).toBeVisible();
    expect(imports).toBe(1);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("文书可视化编辑器").fill(editedText);
    await expect(
      page.getByRole("button", { name: "保存到项目", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => puts).toBe(1);
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Exit editing", exact: true })
      .click();
    await page.getByRole("button", { name: "保存到项目", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "保存到当前法律项目",
      exact: true,
    });
    await dialog.getByLabel("保存位置").selectOption(artifact.id);
    await dialog
      .getByRole("button", { name: "保存未审核版本", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "合成保存暂时失败，请重试",
    );
    expect(history).toEqual([original]);
    await dialog
      .getByRole("button", { name: "保存未审核版本", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    expect(saveAttempts).toBe(2);
    expect(history).toEqual([original, workingText]);
    await page
      .getByRole("combobox", { name: "文书撰写当前文件", exact: true })
      .selectOption("");
    await page.getByRole("button", { name: "合成案件文书" }).click();
    await expect(page.getByLabel("历史版本")).toHaveValue("v2");
    await expect(
      page
        .locator(".law-resource-panel:not([hidden])")
        .getByText(editedText, { exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("tab", { name: "文书撰写", exact: true }).click();
    // Native files restore their selected path; return through the visible
    // resource picker rather than changing that existing resume behavior.
    await page
      .getByRole("combobox", { name: "文书撰写当前文件", exact: true })
      .selectOption("");
    await page.getByRole("button", { name: "合成案件文书" }).click();
    await expect(page.getByLabel("历史版本")).toHaveValue("v2");
    await page.getByLabel("历史版本").selectOption("v1");
    await expect(
      page.getByRole("heading", { name: "原始合成文书", exact: true }),
    ).toBeVisible();
    expect(history[0]).toBe(original);
    expect(history).toHaveLength(2);
  });
}
