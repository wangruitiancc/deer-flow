import { createHash } from "node:crypto";

import { expect, test, type Route } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const tenantId = "10000000-0000-4000-8000-000000000021";
const matterId = "30000000-0000-4000-8000-000000000021";
const threadId = "50000000-0000-4000-8000-000000000021";
const membershipId = "20000000-0000-4000-8000-000000000021";
const captureId = "40000000-0000-4000-8000-000000000021";
const evidenceId = "60000000-0000-4000-8000-000000000021";
const versionId = "70000000-0000-4000-8000-000000000021";
const taskId = "80000000-0000-4000-8000-000000000021";
const now = "2026-10-06T00:00:00Z";

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["microphone"],
});

function response(data: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ data, meta: { request_id: "speech-browser-test" } }),
  };
}

test("records synthetic browser audio and uploads digest-confirmed chunks before scan and transcription", async ({
  page,
}) => {
  const basePath = `/api/law/tenants/${tenantId}/matters/${matterId}`;
  const capturePath = `${basePath}/speech-transcriptions/live-captures`;
  const evidenceItem = {
    id: evidenceId,
    tenant_id: tenantId,
    matter_id: matterId,
    kind: "evidence",
    title: "合成浏览器录音",
    status: "active",
    created_by_membership_id: membershipId,
    version: 1,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
  const evidenceVersion = {
    id: versionId,
    tenant_id: tenantId,
    matter_id: matterId,
    evidence_item_id: evidenceId,
    version_number: 1,
    origin: "live_capture",
    source_version_id: null,
    original_filename: "live-recording.webm",
    media_type: "audio/webm",
    byte_size: 0,
    sha256: "a".repeat(64),
    created_by_membership_id: membershipId,
    created_at: now,
    scan_status: "clean",
    scanned_at: now,
  };
  const taskRecord = {
    id: taskId,
    tenant_id: tenantId,
    matter_id: matterId,
    evidence_item_id: evidenceId,
    evidence_version_id: versionId,
    source_sha256: evidenceVersion.sha256,
    media_type: "audio/webm",
    requested_by_membership_id: membershipId,
    status: "queued",
    attempts: 0,
    current_version_number: 0,
    model_id: null,
    error_code: null,
    cancel_requested: false,
    created_at: now,
    updated_at: now,
  };
  const chunks: Array<{ sequence: number; bytes: number; digest: string }> = [];
  const events: string[] = [];
  let recordingFinished = false;
  let evidenceItems: (typeof evidenceItem)[] = [];

  await page.context().grantPermissions(["microphone"]);
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 404, json: { detail: "Unmocked test endpoint" } }),
  );
  mockLangGraphAPI(page, {
    threads: [
      {
        thread_id: threadId,
        title: "合成庭审录音",
        artifacts: [],
        messages: [
          {
            type: "ai",
            id: "synthetic-hearing-thread",
            content: "仅用于浏览器采集链路测试。",
          },
        ],
      },
    ],
  });
  await page.route("**/api/law/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path.includes("/context/by-thread/")) {
      return route.fulfill(
        response({
          context: {
            user_id: "default",
            tenant_id: tenantId,
            matter_id: matterId,
            matter_role: "owner",
            membership_id: membershipId,
            thread_id: threadId,
          },
        }),
      );
    }
    if (path.endsWith(`/matters/${matterId}`)) {
      return route.fulfill(response({ matter: { title: "合成庭审录音" } }));
    }
    if (path === `${basePath}/evidence`) {
      return route.fulfill(response({ items: evidenceItems }));
    }
    if (path === `${basePath}/evidence/${evidenceId}/versions`) {
      return route.fulfill(response({ items: [evidenceVersion] }));
    }
    if (path === `${basePath}/speech-transcriptions` && method === "GET") {
      return route.fulfill(
        response({
          items: recordingFinished ? [taskRecord] : [],
          transcription_available: true,
          supported_media_types: ["audio/webm"],
          live_capture_available: true,
          live_capture_media_types: ["audio/webm"],
        }),
      );
    }
    if (path === capturePath && method === "POST") {
      events.push("create");
      return route.fulfill(
        response({
          id: captureId,
          tenant_id: tenantId,
          matter_id: matterId,
          created_by_membership_id: membershipId,
          title: "合成浏览器录音",
          original_filename: "live-recording.webm",
          media_type: "audio/webm",
          status: "open",
          next_sequence_number: 0,
          total_byte_size: 0,
          expires_at: "2026-10-06T01:00:00Z",
          cleanup_pending: false,
          evidence_item_id: null,
          evidence_version_id: null,
          source_sha256: null,
          error_code: null,
          created_at: now,
          updated_at: now,
          max_chunk_bytes: 65_536,
          max_total_bytes: 52_428_800,
          transcription_available: true,
        }),
      );
    }
    const chunkMatch = /\/live-captures\/[^/]+\/chunks\/(\d+)$/.exec(path);
    if (chunkMatch && method === "PUT") {
      const sequence = Number(chunkMatch[1]);
      const body = request.postDataBuffer() ?? Buffer.alloc(0);
      const digest = createHash("sha256").update(body).digest("hex");
      const submittedDigest = request.headers()["x-chunk-sha256"] ?? "";
      if (body.byteLength === 0 || digest !== submittedDigest) {
        return route.fulfill(
          response({ detail: "chunk_integrity_failed" }, 422),
        );
      }
      chunks.push({ sequence, bytes: body.byteLength, digest });
      events.push(`chunk:${sequence}`);
      return route.fulfill(
        response({
          capture_id: captureId,
          accepted_sequence_number: sequence,
          next_sequence_number: sequence + 1,
          chunk_sha256: digest,
        }),
      );
    }
    if (path === `${capturePath}/${captureId}/finish` && method === "POST") {
      const body = request.postDataJSON() as { final_sequence_number: number };
      expect(chunks.length).toBeGreaterThan(0);
      expect(body.final_sequence_number).toBe(chunks.at(-1)?.sequence);
      events.push("finish");
      recordingFinished = true;
      evidenceItems = [evidenceItem];
      return route.fulfill(
        response({
          id: captureId,
          tenant_id: tenantId,
          matter_id: matterId,
          created_by_membership_id: membershipId,
          title: "合成浏览器录音",
          original_filename: "live-recording.webm",
          media_type: "audio/webm",
          status: "completed",
          next_sequence_number: chunks.length,
          total_byte_size: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
          expires_at: "2026-10-06T01:00:00Z",
          cleanup_pending: false,
          evidence_item_id: evidenceId,
          evidence_version_id: versionId,
          source_sha256: evidenceVersion.sha256,
          error_code: null,
          created_at: now,
          updated_at: now,
          evidence_item: evidenceItem,
          evidence_version: evidenceVersion,
        }),
      );
    }
    if (path === `${basePath}/speech-transcriptions` && method === "POST") {
      expect(recordingFinished).toBe(true);
      expect(url.searchParams.get("evidence_item_id")).toBe(evidenceId);
      expect(url.searchParams.get("evidence_version_id")).toBe(versionId);
      events.push("transcription");
      return route.fulfill(response(taskRecord));
    }
    if (path === `${basePath}/speech-transcriptions/${taskId}`) {
      return route.fulfill(
        response({ task: taskRecord, versions: [], events: [] }),
      );
    }

    return route.fulfill(response({ items: [] }));
  });

  await page.goto(`/workspace/chats/${threadId}`);
  await page.getByRole("button", { name: /artifacts/i }).click();
  await expect(
    page.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  await page.getByLabel("录音名称").fill("合成浏览器录音");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(page.getByText("正在录音并上传已完成分片")).toBeVisible();
  await expect
    .poll(() => chunks.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: /停止并保存/ }).click();
  await expect
    .poll(() => events.includes("transcription"), { timeout: 10_000 })
    .toBe(true);

  expect(chunks.every((chunk) => chunk.bytes > 0)).toBe(true);
  expect(chunks.map((chunk) => chunk.sequence)).toEqual(
    chunks.map((_, index) => index),
  );
  expect(events.at(-2)).toBe("finish");
  expect(events.at(-1)).toBe("transcription");
  await expect(
    page.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
});
