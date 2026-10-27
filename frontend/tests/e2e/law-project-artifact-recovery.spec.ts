import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const threadId = "00000000-0000-0000-0000-000000000073";
const text = "# 合成文书恢复测试\n\n此内容仅用于浏览器交付流程验证。";
const digest = createHash("sha256").update(text).digest("hex");
// This is a valid ZIP containing a synthetic text sentinel, not a generated
// DOCX/PDF or evidence of backend document conversion quality.
const exportBundle = Buffer.from(
  "UEsDBBQAAAAAAA6QW13GK/9cHwAAAB8AAAAUAAAAc3ludGhldGljLWV4cG9ydC50eHRzeW50aGV0aWMgYnJvd3NlciBkb3dubG9hZCBvbmx5UEsBAhQDFAAAAAAADpBbXcYr/1wfAAAAHwAAABQAAAAAAAAAAAAAAIABAAAAAHN5bnRoZXRpYy1leHBvcnQudHh0UEsFBgAAAAABAAEAQgAAAFEAAAAAAA==",
  "base64",
);

for (const { failedRead, width } of [
  { failedRead: "sources", width: 1280 },
  { failedRead: "content", width: 390 },
] as const) {
  test(`recovers ${failedRead} and continues review/export at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/**", (route) =>
      route.fulfill({ status: 404, json: { detail: "Unmocked" } }),
    );
    mockLangGraphAPI(page, {
      threads: [
        {
          thread_id: threadId,
          title: "合成交付会话",
          artifacts: [],
          messages: [],
        },
      ],
    });
    let recovered = false;
    let approved = false;
    let denyExport = false;
    let denySources = false;
    let sourceReads = 0;
    let reviewWrites = 0;
    const artifact = {
      id: "saved-document",
      tenant_id: "tenant-test",
      matter_id: "matter-test",
      kind: "document",
      title: "合成交付文书",
      status: "active",
      current_version_number: 1,
      version: 1,
    };
    const version = {
      id: "v1",
      tenant_id: artifact.tenant_id,
      matter_id: artifact.matter_id,
      project_artifact_id: artifact.id,
      version_number: 1,
      source_thread_id: threadId,
      source_artifact_path: "/mnt/user-data/outputs/synthetic.md",
      source_revision_sha256: digest,
      source_provenance: "client_asserted",
      original_filename: "synthetic.md",
      media_type: "text/markdown",
      byte_size: Buffer.byteLength(text),
      sha256: digest,
      created_at: "2026-10-27T00:00:00Z",
    };
    const review = {
      id: "review-1",
      project_artifact_version_id: "v1",
      sequence_number: 1,
      decision: "approved",
      version_sha256: digest,
      review_note: "仅合成流程检查，不是法律质量意见。",
      reviewed_by_membership_id: "lawyer-test",
      created_at: "2026-10-27T00:00:00Z",
    };
    await page.route("**/api/law/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      let data: unknown = { items: [] };
      if (pathname.endsWith(`/context/by-thread/${threadId}`)) {
        data = {
          context: {
            user_id: "default",
            tenant_id: artifact.tenant_id,
            matter_id: artifact.matter_id,
            matter_role: "lawyer",
            thread_id: threadId,
          },
        };
      } else if (pathname.endsWith("/matters/matter-test")) {
        data = {
          matter: {
            id: artifact.matter_id,
            tenant_id: artifact.tenant_id,
            title: "合成案件",
          },
        };
      } else if (pathname.endsWith("/project-artifacts")) {
        data = { items: [artifact] };
      } else if (pathname.endsWith("/versions")) {
        data = {
          items: [
            {
              ...version,
              review_status: approved ? "approved" : "unreviewed",
              latest_review: approved ? review : null,
            },
          ],
        };
      } else if (pathname.endsWith("/content")) {
        if (!recovered && failedRead === "content") {
          await route.fulfill({
            status: 503,
            json: {
              error: {
                code: "TEMPORARILY_UNAVAILABLE",
                message: "合成正文暂时不可用",
              },
            },
          });
        } else
          await route.fulfill({ contentType: "text/markdown", body: text });
        return;
      } else if (pathname.endsWith("/sources")) {
        sourceReads++;
        if (denySources || (!recovered && failedRead === "sources")) {
          await route.fulfill({
            status: denySources ? 403 : 503,
            json: {
              error: {
                code: "SOURCE_UNAVAILABLE",
                message: "合成来源读取失败",
              },
            },
          });
          return;
        }
        data = {
          artifact_id: artifact.id,
          version_id: version.id,
          version_number: 1,
          source_provenance: "client_asserted",
          source_state: "bound",
          source_manifest: { citations: [], authorities: [] },
          source_manifest_sha256: "b".repeat(64),
          version_sha256: digest,
        };
      } else if (pathname.endsWith("/reviews")) {
        if (route.request().method() === "POST") {
          reviewWrites++;
          expect(route.request().postDataJSON()).toEqual({
            decision: "approved",
            review_note: review.review_note,
          });
          expect(route.request().headers()["idempotency-key"]).toBeTruthy();
          approved = true;
          data = { review, review_status: "approved" };
        } else data = { items: approved ? [review] : [] };
      } else if (/\/exports\/(docx|pdf)$/.test(pathname)) {
        expect(approved).toBe(true);
        if (denyExport)
          await route.fulfill({
            status: 403,
            json: {
              error: { code: "ACCESS_DENIED", message: "合成导出权限已撤销" },
            },
          });
        else
          await route.fulfill({
            contentType: "application/zip",
            body: exportBundle,
          });
        return;
      }
      await route.fulfill({
        json: { data, meta: { request_id: "synthetic-recovery" } },
      });
    });

    await page.goto(`/workspace/chats/${threadId}`);
    await page.getByRole("tab", { name: "文书撰写", exact: true }).click();
    await page.getByRole("button", { name: "合成交付文书" }).click();
    await expect(
      page.getByRole("button", { name: "审核此版本" }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: /导出 DOCX/ })).toHaveCount(
      0,
    );
    expect(reviewWrites).toBe(0);
    recovered = true;
    const retry = page.getByRole("button", {
      name: failedRead === "sources" ? "重新读取来源" : "重新读取正文",
    });
    await expect(retry).toBeVisible();
    if (failedRead === "sources") {
      // An explicit retry must still honor a fresh authorization failure.
      denySources = true;
      const prior = sourceReads;
      await retry.click();
      await expect.poll(() => sourceReads).toBeGreaterThan(prior);
      await expect(retry).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "审核此版本" }),
      ).toBeDisabled();
      expect(reviewWrites).toBe(0);
      denySources = false;
    }
    await retry.click();
    await expect(
      page.getByRole("heading", { name: "合成文书恢复测试" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "审核此版本" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "审核此版本" }).click();
    await page
      .getByRole("textbox", { name: "审核意见" })
      .fill(review.review_note);
    await page.getByRole("button", { name: "审核通过", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "审核第 1 版", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByText("律师已审核通过", { exact: false }),
    ).toBeVisible();
    expect(reviewWrites).toBe(1);
    for (const format of ["DOCX", "PDF"]) {
      const downloadEvent = page.waitForEvent("download");
      await page
        .getByRole("button", { name: `导出 ${format} + 来源回执`, exact: true })
        .click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toBe(
        `artifact-v1-${format.toLowerCase()}-export.zip`,
      );
      expect(await readFile(await download.path())).toEqual(exportBundle);
    }
    denyExport = true;
    await page
      .getByRole("button", { name: "导出 DOCX + 来源回执", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: "合成导出权限已撤销" }),
    ).toBeVisible();
    expect(reviewWrites).toBe(1);
  });
}
