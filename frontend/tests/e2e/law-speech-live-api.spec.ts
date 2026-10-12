import { createHash, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { expect, test, type Page, type Route } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const apiBase = process.env.W11_LIVE_API_BASE;
const tenantId = process.env.W11_LIVE_TENANT_ID;
const matterId = process.env.W11_LIVE_MATTER_ID;
const apiUserId = process.env.W11_LIVE_USER_ID;
const threadId = "50000000-0000-4000-8000-000000000091";
const membershipId = "20000000-0000-4000-8000-000000000091";
const realAsr = process.env.W11_LIVE_API_REAL_ASR === "1";

function reportCaptureOutcome(browserName: string, outcome: "recorded" | "unsupported"): void {
  const path = process.env.W11_LIVE_API_OUTCOME_FILE;
  if (path) appendFileSync(path, `${JSON.stringify({ browserName, outcome })}\n`, "utf8");
}

function readSpeechOutboxCounts(page: Page): Promise<{ sessions: number; chunks: number }> {
  return page.evaluate(
    () =>
      new Promise<{ sessions: number; chunks: number }>((resolve, reject) => {
        const request = indexedDB.open("matrix-law-speech-capture-outbox-v1");
        request.onerror = () => reject(request.error ?? new Error("cannot inspect speech outbox"));
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("sessions") || !database.objectStoreNames.contains("chunks")) {
            database.close();
            resolve({ sessions: 0, chunks: 0 });
            return;
          }
          const transaction = database.transaction(["sessions", "chunks"], "readonly");
          const sessions = transaction.objectStore("sessions").getAll();
          const chunks = transaction.objectStore("chunks").getAll();
          let sessionCount = 0;
          let chunkCount = 0;
          sessions.onsuccess = () => {
            sessionCount = sessions.result.length;
          };
          chunks.onsuccess = () => {
            chunkCount = chunks.result.length;
          };
          transaction.onerror = () => reject(transaction.error ?? new Error("cannot read speech outbox"));
          transaction.oncomplete = () => {
            database.close();
            resolve({ sessions: sessionCount, chunks: chunkCount });
          };
        };
      }),
  );
}

test("live HTTP capture succeeds or browser startup fails closed", async ({ page, browserName }) => {
  test.skip(!apiBase || !tenantId || !matterId || !apiUserId, "requires the isolated W11 live API pytest harness");
  test.setTimeout(110_000);
  const matterBase = `/api/law/tenants/${tenantId}/matters/${matterId}`;
  const speechPath = `${matterBase}/speech-transcriptions`;
  const forwarded: string[] = [];
  let liveTaskId: string | null = null;
  let liveTaskDetailReads = 0;
  let speechCitationId: string | null = null;
  let suppressCapturePreview = false;
  let caseWorkbenchEventsStarted = false;
  let firstChunkUploadPaused = false;
  let offlineChunkRetryAttempts = 0;
  let firstChunkAcceptedByApi = false;
  let failFirstChunkUploadOffline = false;
  let releaseFirstChunkUpload!: () => void;
  const firstChunkUploadGate = new Promise<void>((resolve) => {
    releaseFirstChunkUpload = resolve;
  });
  let heldChunkAckReachedApi = false;
  let heldOldPreviewReachedApi = false;
  let heldOldPreviewReleased = false;
  let heldOldPreviewRevision = 0;
  let newerPreviewRevisionSeen = false;
  let secondWindowChunkHeld = false;
  let secondWindowChunkReleased = false;
  let heldChunkAckReleased = false;
  let firstCaptureFinishSeen = false;
  let firstCaptureFinishSeenWhileAckHeld = false;
  let releaseHeldChunkAck!: () => void;
  let releaseHeldOldPreview!: () => void;
  const heldOldPreviewGate = new Promise<void>((resolve) => {
    releaseHeldOldPreview = resolve;
  });
  let releaseSecondWindowChunk!: () => void;
  const secondWindowChunkGate = new Promise<void>((resolve) => {
    releaseSecondWindowChunk = resolve;
  });
  const heldChunkAckGate = new Promise<void>((resolve) => {
    releaseHeldChunkAck = resolve;
  });
  await page.addInitScript(() => {
    let online = true;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => online,
    });
    (window as typeof window & { __w11SetOnline?: (value: boolean) => void }).__w11SetOnline = (
      value: boolean,
    ) => {
      online = value;
      window.dispatchEvent(new Event(value ? "online" : "offline"));
    };
    const target = window as typeof window & { __w11GetUserMediaCalls?: number };
    target.__w11GetUserMediaCalls = 0;
    const devices = navigator.mediaDevices;
    const original = devices.getUserMedia.bind(devices);
    Object.defineProperty(devices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        const target = window as typeof window & {
          __w11AudioTracks?: MediaStreamTrack[][];
          __w11GetUserMediaCalls?: number;
        };
        target.__w11GetUserMediaCalls = (target.__w11GetUserMediaCalls ?? 0) + 1;
        const stream = await original(constraints);
        target.__w11AudioTracks ??= [];
        target.__w11AudioTracks.push(stream.getTracks());
        return stream;
      },
    });
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/case-workbench/events"))
      caseWorkbenchEventsStarted = true;
  });
  await page.context().route("**/api/**", (route) =>
    route.fulfill({ status: 404, json: { detail: "Unmocked live API browser endpoint" } }),
  );
  mockLangGraphAPI(page, {
    threads: [
      {
        thread_id: threadId,
        title: "Synthetic live API capture",
        artifacts: [],
        messages: [{ type: "ai", id: "w11-live-api-thread", content: "Synthetic browser/API acceptance only." }],
      },
    ],
  });

  await page.context().route("**/api/law/**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/context/by-thread/")) {
      return route.fulfill({
        status: 200,
        json: {
          data: {
            context: {
              user_id: "default",
              tenant_id: tenantId,
              matter_id: matterId,
              matter_role: "owner",
              membership_id: membershipId,
              thread_id: threadId,
            },
          },
        },
      });
    }
    if (url.pathname.endsWith(`/matters/${matterId}`)) {
      return route.fulfill({ status: 200, json: { data: { matter: { title: "Synthetic browser/API matter" } } } });
    }
    return route.fulfill({ status: 200, json: { data: { items: [] } } });
  });

  // Register after the general test route so only these real speech/evidence calls reach FastAPI.
  await page.context().route("**/api/law/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      suppressCapturePreview &&
      url.pathname.includes("/live-captures/") &&
      url.pathname.endsWith("/preview")
    ) {
      return route.fulfill({ status: 204, body: "" });
    }
    const shouldForward =
      url.pathname === speechPath ||
      url.pathname.startsWith(`${speechPath}/`) ||
      url.pathname === `${matterBase}/evidence` ||
      url.pathname.startsWith(`${matterBase}/evidence/`) ||
      url.pathname === `${matterBase}/case-workbench` ||
      url.pathname.startsWith(`${matterBase}/case-workbench/`);
    if (!shouldForward) return route.fallback();

    const headers: Record<string, string> = {
      ...request.headers(),
      "x-test-user-id": apiUserId!,
    };
    delete headers.host;
    delete headers.cookie;
    delete headers.authorization;
    const chunkMatch = new RegExp(`^${speechPath}/live-captures/[0-9a-f-]{36}/chunks/(\\d+)$`).exec(
      url.pathname,
    );
    if (request.method() === "PUT" && chunkMatch?.[1] === "0") {
      if (!firstChunkUploadPaused) {
        firstChunkUploadPaused = true;
        await firstChunkUploadGate;
        if (failFirstChunkUploadOffline) return route.abort("internetdisconnected");
      } else if (failFirstChunkUploadOffline) {
        offlineChunkRetryAttempts += 1;
        return route.abort("internetdisconnected");
      }
    }
    if (request.method() === "PUT" && chunkMatch?.[1] === "5" && !secondWindowChunkReleased) {
      secondWindowChunkHeld = true;
      await secondWindowChunkGate;
      secondWindowChunkReleased = true;
    }
    const finishPath = `${speechPath}/live-captures/`;
    if (request.method() === "POST" && url.pathname.includes(finishPath) && url.pathname.endsWith("/finish")) {
      firstCaptureFinishSeen = true;
      if (heldChunkAckReachedApi && !heldChunkAckReleased) firstCaptureFinishSeenWhileAckHeld = true;
    }
    if (url.pathname.endsWith("/case-workbench/events")) {
      forwarded.push(`${request.method()} ${url.pathname}`);
      return route.continue({
        url: `${apiBase}${url.pathname}${url.search}`,
        headers,
      });
    }
    const response = await route.fetch({
      url: `${apiBase}${url.pathname}${url.search}`,
      method: request.method(),
      headers,
      ...(request.postDataBuffer() ? { data: request.postDataBuffer()! } : {}),
    });
    if (request.method() === "PUT" && chunkMatch?.[1] === "0" && response.status() < 300)
      firstChunkAcceptedByApi = true;
    if (request.method() === "GET" && url.pathname.endsWith("/preview") && response.status() === 200) {
      const body = (await response.json()) as {
        data?: {
          revision?: number;
          items?: Array<{
            transcript?: { modelId?: string; provisional?: boolean; reviewStatus?: string; text?: string };
          }>;
        };
      };
      const items = body.data?.items ?? [];
      if (realAsr && items.length > 0) {
        for (const item of items) {
          expect(item.transcript?.modelId).toBe("sherpa-onnx-paraformer-zh-2023-09-14");
          expect(item.transcript?.provisional).toBe(true);
          expect(item.transcript?.reviewStatus).toBe("unreviewed");
          expect(item.transcript?.text?.trim().length ?? 0).toBeGreaterThan(0);
        }
      }
      const revision = body.data?.revision ?? 0;
      if (items.length > 0 && !heldOldPreviewReachedApi) {
        heldOldPreviewRevision = revision;
        heldOldPreviewReachedApi = true;
        await heldOldPreviewGate;
        heldOldPreviewReleased = true;
      } else if (heldOldPreviewReachedApi && revision > heldOldPreviewRevision) {
        newerPreviewRevisionSeen = true;
      }
    }
    if (request.method() === "PUT" && chunkMatch?.[1] === "10" && !heldChunkAckReachedApi) {
      expect(response.status()).toBe(201);
      heldChunkAckReachedApi = true;
      await heldChunkAckGate;
      heldChunkAckReleased = true;
    }
    const taskMatch = new RegExp(`^${speechPath}/([0-9a-f-]{36})$`).exec(url.pathname);
    if (request.method() === "GET" && taskMatch) {
      liveTaskId = taskMatch[1] ?? null;
      liveTaskDetailReads += 1;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/citations")) {
      const body = (await response.json()) as {
        data?: { citation?: { id?: string } };
      };
      speechCitationId = body.data?.citation?.id ?? null;
    }
    forwarded.push(`${request.method()} ${url.pathname}`);
    return route.fulfill({ response });
  });

  await page.goto(`/workspace/chats/${threadId}`);
  await expect(page.getByRole("heading", { name: "庭审录音与语音转写" })).toBeVisible();
  await expect(page.getByRole("button", { name: /开始麦克风录音/ })).toBeVisible();
  await page.getByLabel("录音名称").fill("隔离 HTTP 真实路由合成录音");
  const captureProgress = page.getByText(/正在采集；本机保存、服务器确认和识别进度分开显示/);
  const audioStartupFailure = page.getByText(
    /浏览器未能及时启动音频上下文|当前浏览器或麦克风不支持所需的音频录音设置/,
  );
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect
    .poll(
      async () => {
        if (await captureProgress.isVisible()) return "recording";
        if (await audioStartupFailure.isVisible()) return "audio_context_unavailable";
        return "starting";
      },
      { timeout: 15_000 },
    )
    .not.toBe("starting");
  if (browserName !== "chromium" && (await audioStartupFailure.isVisible())) {
    await expect(page.getByRole("button", { name: "上传并扫描" })).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { __w11AudioTracks?: MediaStreamTrack[][] })
            .__w11AudioTracks?.flat().length ?? 0,
      ),
    ).toBe(0);
    expect(forwarded.some((item) => item === `POST ${speechPath}/live-captures`)).toBe(false);
    expect(
      forwarded.some(
        (item) =>
          item.includes(`${speechPath}/live-captures/`) &&
          (item.includes("/chunks/") || item.endsWith("/finish")),
      ),
    ).toBe(false);
    expect(await readSpeechOutboxCounts(page)).toEqual({ sessions: 0, chunks: 0 });
    await page.close();
    reportCaptureOutcome(browserName, "unsupported");
    return;
  }
  await expect(captureProgress).toBeVisible();
  await expect.poll(() => firstChunkUploadPaused, { timeout: 20_000 }).toBe(true);
  try {
    failFirstChunkUploadOffline = true;
    await page.evaluate(() =>
      (window as typeof window & { __w11SetOnline?: (value: boolean) => void }).__w11SetOnline?.(false),
    );
    releaseFirstChunkUpload();
    await expect(page.getByText("网络不可用；采集内容保留在加密本机暂存中")).toBeVisible({
      timeout: 10_000,
    });
    await expect.poll(async () => (await readSpeechOutboxCounts(page)).chunks).toBeGreaterThan(0);
    expect(firstChunkAcceptedByApi).toBe(false);
    expect(firstCaptureFinishSeen).toBe(false);
    await page.waitForTimeout(300);
    expect(offlineChunkRetryAttempts).toBe(0);
  } finally {
    releaseFirstChunkUpload();
  }
  failFirstChunkUploadOffline = false;
  await page.evaluate(() =>
    (window as typeof window & { __w11SetOnline?: (value: boolean) => void }).__w11SetOnline?.(true),
  );
  await expect.poll(() => firstChunkAcceptedByApi, { timeout: 20_000 }).toBe(true);
  const previewWindows = page.getByLabel("录音临时识别预览").locator(":scope > div");
  if (realAsr) {
    await expect.poll(() => previewWindows.count(), { timeout: 45_000 }).toBeGreaterThan(0);
  } else {
    await expect(page.getByText("隔离 HTTP 实时预览")).toBeVisible({ timeout: 45_000 });
  }
  await expect.poll(() => heldOldPreviewReachedApi, { timeout: 20_000 }).toBe(true);
  try {
    await expect.poll(() => heldOldPreviewRevision, { timeout: 5_000 }).toBe(1);
    await expect.poll(() => secondWindowChunkHeld, { timeout: 10_000 }).toBe(true);

    // Keep one unacknowledged local chunk while a second tab opens. It must
    // respect the active tab's per-identity Web Lock and perform no write.
    const secondPage = await page.context().newPage();
    let secondTabCaptureWrites = 0;
    secondPage.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (
        path.includes(`${speechPath}/live-captures/`) &&
        ((request.method() === "PUT" && path.includes("/chunks/")) ||
          (request.method() === "POST" && path.endsWith("/finish")))
      )
        secondTabCaptureWrites += 1;
    });
    mockLangGraphAPI(secondPage, {
      threads: [
        {
          thread_id: threadId,
          title: "Synthetic live API capture",
          artifacts: [],
          messages: [{ type: "ai", id: "w11-live-api-thread-second-tab", content: "Synthetic browser/API acceptance only." }],
        },
      ],
    });
    await secondPage.goto(page.url());
    await expect(
      secondPage.getByRole("heading", { name: "庭审录音与语音转写" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        secondPage.evaluate(
          () =>
            (window as typeof window & { __w11GetUserMediaCalls?: number })
              .__w11GetUserMediaCalls ?? 0,
        ),
      )
      .toBe(0);
    await expect
      .poll(async () => (await readSpeechOutboxCounts(secondPage)).chunks)
      .toBeGreaterThan(0);
    await secondPage.waitForTimeout(1_200);
    expect(secondTabCaptureWrites).toBe(0);
    await secondPage.close();

    releaseSecondWindowChunk();
    await expect(previewWindows).toHaveCount(1, { timeout: 10_000 });
    await expect.poll(() => newerPreviewRevisionSeen, { timeout: 30_000 }).toBe(true);
    await expect(previewWindows).toHaveCount(2, { timeout: 5_000 });
    releaseHeldOldPreview();
    await expect.poll(() => heldOldPreviewReleased, { timeout: 5_000 }).toBe(true);
    await expect(previewWindows).toHaveCount(2);
    await expect.poll(() => heldChunkAckReachedApi, { timeout: 20_000 }).toBe(true);
    await expect(page.getByRole("button", { name: "停止并保存" })).toBeVisible();
    await page.getByRole("button", { name: "停止并保存" }).click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as typeof window & { __w11AudioTracks?: MediaStreamTrack[][] }
              ).__w11AudioTracks?.[0]?.every((track) => track.readyState === "ended") ?? false,
          ),
        { timeout: 5_000 },
      )
      .toBe(true);
    await page.waitForTimeout(500);
    expect(firstCaptureFinishSeen).toBe(false);
    expect((await readSpeechOutboxCounts(page)).chunks).toBeGreaterThan(0);
  } finally {
    releaseHeldOldPreview();
    releaseSecondWindowChunk();
    releaseHeldChunkAck();
  }
  await expect.poll(() => firstCaptureFinishSeen, { timeout: 20_000 }).toBe(true);
  expect(firstCaptureFinishSeenWhileAckHeld).toBe(false);
  const reviewSegment = page.getByLabel("校对片段 1", { exact: true });
  if (realAsr) {
    await expect(reviewSegment).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => reviewSegment.inputValue(), { timeout: 10_000 }).not.toBe("");
  } else {
    await expect(page.getByText("隔离 HTTP 正式机器稿")).toBeVisible({ timeout: 60_000 });
    await expect(reviewSegment).toHaveValue(/隔离 HTTP 正式机器稿/);
  }
  await reviewSegment.fill("律师未提交的真实 API 草稿。");
  expect(liveTaskId).toMatch(/^[0-9a-f-]{36}$/);
  const sameIdentityRoute = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "default",
        email: "default@test.local",
        system_role: "user",
        needs_setup: false,
      }),
    });
  await page.route("**/api/v1/auth/me", sameIdentityRoute);
  const refreshVisiblePage = async () => {
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      window.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      window.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
      Reflect.deleteProperty(document, "visibilityState");
    });
  };
  const readsBeforeSameVersionRefresh = liveTaskDetailReads;
  await refreshVisiblePage();
  await expect.poll(() => liveTaskDetailReads, { timeout: 15_000 }).toBeGreaterThan(readsBeforeSameVersionRefresh);
  await expect(reviewSegment).toHaveValue("律师未提交的真实 API 草稿。");
  await expect(page.locator('[role="alert"]').filter({ hasText: "该转写已有新版本" })).toHaveCount(0);

  const concurrentText = "另一位律师提交的新版本。";
  const concurrentReview = await page.request.post(`${apiBase}${speechPath}/${liveTaskId}/review`, {
    headers: { "x-test-user-id": apiUserId! },
    data: {
      expected_version: 1,
      text: concurrentText,
      segments: [
        {
          text: concurrentText,
          charStart: 0,
          charEnd: concurrentText.length,
          startMs: 0,
          endMs: 1_000,
          speakerId: null,
        },
      ],
      speakers: [],
      reviewed_text: true,
      reviewed_time_ranges: true,
    },
  });
  expect(concurrentReview.status()).toBe(200);
  const readsBeforeConcurrentVersionRefresh = liveTaskDetailReads;
  await refreshVisiblePage();
  await expect.poll(() => liveTaskDetailReads, { timeout: 15_000 }).toBeGreaterThan(readsBeforeConcurrentVersionRefresh);
  await expect(
    page.locator('[role="alert"]').filter({ hasText: "该转写已有新版本" }),
  ).toContainText("该转写已有新版本；当前未保存草稿已保留。");
  await expect(reviewSegment).toHaveValue("律师未提交的真实 API 草稿。");
  await page.unroute("**/api/v1/auth/me", sameIdentityRoute);
  await page.getByLabel("我已逐段核对转写文字和匿名说话人标签。").check();
  await page.getByLabel(/我已对照原音频核对并修正每段时间范围/).check();
  await page.getByRole("button", { name: "保存为律师校对版本" }).click();
  await expect(
    page.getByRole("heading", { name: "固定版本录音引用" }),
  ).toBeVisible({ timeout: 20_000 });
  const citationText = page.getByLabel("选择要引用的已复核转写文字");
  await expect(citationText).toHaveValue("律师未提交的真实 API 草稿。");
  expect(await citationText.inputValue()).not.toContain("隔离 HTTP 实时预览");
  await citationText.click();
  await citationText.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await expect
    .poll(() =>
      citationText.evaluate((element) => {
        const input = element as HTMLTextAreaElement;
        return input.selectionEnd - input.selectionStart;
      }),
    )
    .toBeGreaterThan(0);
  const createCitationButton = page.getByRole("button", {
    name: "创建所选文字的时间引用",
  });
  await expect(createCitationButton).toBeEnabled({ timeout: 5_000 });
  await createCitationButton.click();
  await expect(page.getByLabel("已创建的录音引用")).toContainText("律师未提交的真实 API 草稿。", {
    timeout: 20_000,
  });
  expect(liveTaskId).toMatch(/^[0-9a-f-]{36}$/);
  expect(speechCitationId).toMatch(/^[0-9a-f-]{36}$/);

  const transcriptArtifact = Buffer.from(
    `合成庭审录音校对稿：律师未提交的真实 API 草稿。 [[citation:${speechCitationId}]]`,
    "utf8",
  );
  const artifactSha256 = createHash("sha256").update(transcriptArtifact).digest("hex");
  const artifactResponse = await page.request.post(`${apiBase}${matterBase}/project-artifacts`, {
    headers: {
      "x-test-user-id": apiUserId!,
      "idempotency-key": randomUUID(),
      "x-content-sha256": artifactSha256,
    },
    multipart: {
      file: {
        name: "w11-synthetic-transcript.md",
        mimeType: "text/markdown",
        buffer: transcriptArtifact,
      },
      title: "W11 synthetic transcript delivery",
      kind: "transcript",
      byte_size: String(transcriptArtifact.byteLength),
      source_thread_id: threadId,
      source_artifact_path: "/mnt/user-data/outputs/w11-synthetic-transcript.md",
      source_revision_sha256: artifactSha256,
      source_provenance: "client_asserted",
    },
  });
  expect(artifactResponse.status()).toBe(201);
  const artifactData = (await artifactResponse.json()) as {
    data: {
      artifact: { id: string };
      artifact_version: { id: string; sha256: string };
    };
  };
  expect(artifactData.data.artifact_version.sha256).toBe(artifactSha256);
  const artifactVersionPath = `${matterBase}/project-artifacts/${artifactData.data.artifact.id}/versions/${artifactData.data.artifact_version.id}`;
  const approved = await page.request.post(`${apiBase}${artifactVersionPath}/reviews`, {
    headers: { "x-test-user-id": apiUserId!, "idempotency-key": randomUUID() },
    data: { decision: "approved", review_note: "Synthetic W11 export acceptance." },
  });
  expect(approved.status()).toBe(201);
  const docx = await page.request.get(`${apiBase}${artifactVersionPath}/exports/docx`, {
    headers: { "x-test-user-id": apiUserId! },
  });
  expect(docx.status()).toBe(200);
  expect((await docx.body()).subarray(0, 2).toString()).toBe("PK");
  const pdf = await page.request.get(`${apiBase}${artifactVersionPath}/exports/pdf`, {
    headers: { "x-test-user-id": apiUserId! },
  });
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 2).toString()).toBe("PK");

  // Simulate complete eviction of the browser outbox after the server has
  // durably accepted PCM. The page is unloaded before deleting IndexedDB so
  // its capture controller cannot write the old local snapshot back.
  const evictedCaptureTitle = "W11 本机缓存清除后恢复";
  await page.getByLabel("录音名称").fill(evictedCaptureTitle);
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(
    page.getByText(/正在采集；本机保存、服务器确认和识别进度分开显示/),
  ).toBeVisible({ timeout: 15_000 });
  const listCaptureResponse = async () => {
    const response = await page.request.get(
      `${apiBase}${speechPath}/live-captures`,
      {
        headers: { "x-test-user-id": apiUserId! },
      },
    );
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as {
      data: {
        items: Array<{
          id: string;
          title: string;
          next_sequence_number: number;
        }>;
      };
    };
    return (
      payload.data.items.find((item) => item.title === evictedCaptureTitle) ??
      null
    );
  };
  await expect
    .poll(
      async () => (await listCaptureResponse())?.next_sequence_number ?? 0,
      {
        timeout: 20_000,
      },
    )
    .toBeGreaterThan(0);
  const evictedCapture = await listCaptureResponse();
  expect(evictedCapture).not.toBeNull();
  expect((await readSpeechOutboxCounts(page)).sessions).toBeGreaterThan(0);

  const evictionProbeUrl = new URL(
    "/__w11-storage-eviction-probe",
    page.url(),
  ).toString();
  await page.context().route(evictionProbeUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>W11 IndexedDB eviction probe</body></html>",
    }),
  );
  await page.goto(evictionProbeUrl);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(
          "matrix-law-speech-capture-outbox-v1",
        );
        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(request.error ?? new Error("cannot evict W11 outbox"));
        request.onblocked = () =>
          reject(new Error("W11 outbox eviction remained blocked"));
      }),
  );

  await page.goto(`/workspace/chats/${threadId}`);
  await expect(
    page.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __w11GetUserMediaCalls?: number })
            .__w11GetUserMediaCalls ?? 0,
      ),
    )
    .toBe(0);
  const resumeServerCaptureButton = page.getByRole("button", {
    name: `确认录音已中断，保存服务器录音 · ${evictedCaptureTitle}`,
  });
  await expect(resumeServerCaptureButton).toBeVisible({ timeout: 20_000 });
  await resumeServerCaptureButton.click();
  const evictedCaptureFinishPath = `${speechPath}/live-captures/${evictedCapture!.id}/finish`;
  await expect
    .poll(() => forwarded.includes(`POST ${evictedCaptureFinishPath}`), {
      timeout: 25_000,
    })
    .toBe(true);
  const evictedCaptureStatus = async () => {
    const response = await page.request.get(
      `${apiBase}${speechPath}/live-captures/${evictedCapture!.id}`,
      { headers: { "x-test-user-id": apiUserId! } },
    );
    expect(response.status()).toBe(200);
    const payload = (await response.json()) as { data: { status: string } };
    return payload.data.status;
  };
  await expect
    .poll(evictedCaptureStatus, { timeout: 30_000 })
    .toBe("completed");

  expect(forwarded.some((item) => item === `POST ${speechPath}/live-captures`)).toBe(true);
  expect(forwarded.some((item) => item.includes("/live-captures/") && item.includes("/chunks/"))).toBe(true);
  expect(forwarded.some((item) => item.includes("/live-captures/") && item.endsWith("/finish"))).toBe(true);
  expect(forwarded.some((item) => item.startsWith(`GET ${speechPath}/`))).toBe(true);

  suppressCapturePreview = true;
  await page.getByLabel("录音名称").fill("真实案件 SSE 撤权合成测试");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(page.getByText(/正在采集；本机保存、服务器确认和识别进度分开显示/)).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => caseWorkbenchEventsStarted, { timeout: 15_000 }).toBe(true);
  await expect
    .poll(async () => (await readSpeechOutboxCounts(page)).sessions, { timeout: 15_000 })
    .toBeGreaterThan(0);

  const revoked = await page.request.post(`${apiBase}/__test/revoke-matter-access`);
  expect(revoked.status()).toBe(204);
  const accessAfterRevocation = await page.request.get(
    `${apiBase}${matterBase}/case-workbench`,
    { headers: { "x-test-user-id": apiUserId! } },
  );
  expect(accessAfterRevocation.status()).toBe(404);
  await expect
    .poll(() => readSpeechOutboxCounts(page), { timeout: 15_000 })
    .toEqual({ sessions: 0, chunks: 0 });
  const audioTracks = await page.evaluate(
    () =>
      (
        window as typeof window & { __w11AudioTracks?: MediaStreamTrack[][] }
      ).__w11AudioTracks?.at(-1)?.map((track) => track.readyState) ?? [],
  );
  expect(audioTracks.length).toBeGreaterThan(0);
  expect(audioTracks.every((state) => state === "ended")).toBe(true);
  expect(forwarded.some((item) => item.endsWith(`${matterBase}/case-workbench/events`))).toBe(true);
  const restored = await page.request.post(`${apiBase}/__test/restore-matter-access`);
  expect(restored.status()).toBe(204);
  await page.close();
  reportCaptureOutcome(browserName, "recorded");
});
