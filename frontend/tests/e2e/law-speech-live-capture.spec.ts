import { createHash } from "node:crypto";

import { expect, test, type Page, type Route } from "@playwright/test";

import { LEGACY_SPEECH_CAPTURE_LIMITS } from "../../src/core/law/speech-capture-limits";

import { mockLangGraphAPI } from "./utils/mock-api";

const tenantId = "10000000-0000-4000-8000-000000000021";
const matterId = "30000000-0000-4000-8000-000000000021";
const threadId = "50000000-0000-4000-8000-000000000021";
const membershipId = "20000000-0000-4000-8000-000000000021";
let captureId = "40000000-0000-4000-8000-000000000021";
const evidenceId = "60000000-0000-4000-8000-000000000021";
const versionId = "70000000-0000-4000-8000-000000000021";
const taskId = "80000000-0000-4000-8000-000000000021";
const now = "2026-10-06T00:00:00Z";

function response(data: unknown, status = 200) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify({ data, meta: { request_id: "speech-browser-test" } }),
  };
}

function readPendingSequences(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve, reject) => {
        const request = indexedDB.open("matrix-law-speech-capture-outbox-v1");
        request.onerror = () =>
          reject(request.error ?? new Error("cannot inspect outbox"));
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("chunks", "readonly");
          const read = transaction.objectStore("chunks").getAll();
          read.onsuccess = () => {
            resolve(
              (read.result as Array<{ scope: string; sequenceNumber: number }>)
                .filter((chunk) => chunk.scope !== "legacy-scope")
                .map((chunk) => chunk.sequenceNumber)
                .sort((left, right) => left - right),
            );
          };
          read.onerror = () =>
            reject(read.error ?? new Error("cannot read outbox"));
          transaction.oncomplete = () => database.close();
        };
      }),
  );
}

function readRecoverableCaptureCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("matrix-law-speech-capture-outbox-v1");
        request.onerror = () =>
          reject(request.error ?? new Error("cannot inspect local captures"));
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("sessions", "readonly");
          const read = transaction.objectStore("sessions").getAll();
          read.onsuccess = () =>
            resolve(
              (read.result as Array<{ scope: string }>).filter(
                (session) => session.scope !== "legacy-scope",
              ).length,
            );
          read.onerror = () =>
            reject(read.error ?? new Error("cannot read local captures"));
          transaction.oncomplete = () => database.close();
        };
      }),
  );
}

test("recovers encrypted PCM after refresh and clears it on revoked access", async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
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
    original_filename: "live-recording.wav",
    media_type: "audio/wav",
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
    media_type: "audio/wav",
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
  let transcriptVersionNumber = 1;
  let transcriptDetailReads = 0;
  const transcriptVersion = (versionNumber: number, text: string) => ({
    id:
      versionNumber === 1
        ? "90000000-0000-4000-8000-000000000021"
        : "90000000-0000-4000-8000-000000000022",
    task_id: taskId,
    version_number: versionNumber,
    origin: "asr",
    source_sha256: evidenceVersion.sha256,
    transcript: {
      schemaVersion: 1,
      offsetUnit: "utf16",
      text,
      durationMs: 2_000,
      reviewStatus: "unreviewed",
      approxAlignment: true,
      warnings: ["合成对齐估算警告"],
      segments: [
        {
          text,
          charStart: 0,
          charEnd: text.length,
          startMs: 0,
          endMs: 2_000,
        },
      ],
      speakers: [],
    },
    actor_membership_id: membershipId,
    created_at: now,
  });
  const chunks: Array<{
    sequence: number;
    bytes: number;
    digest: string;
    sampleCount: number;
    startSample: number;
  }> = [];
  const attemptedPcmChunks = new Map<number, Buffer>();
  const acceptedPcmChunks = new Map<number, Buffer>();
  const chunkRequests = new Map<number, number>();
  const requestsAfterRefresh = new Map<number, number>();
  const events: string[] = [];
  const finishEndReasons: string[] = [];
  let recordingFinished = false;
  let finishRequested = false;
  let captureCancelled = false;
  let holdNextFinishResponse = false;
  let finishResponseStarted = false;
  let releaseFinishResponse: () => void = () => undefined;
  const finishResponseGate = new Promise<void>((resolve) => {
    releaseFinishResponse = resolve;
  });
  let allowRecoveryUploads = false;
  let loseSequenceTwoAck = true;
  let holdSequenceTwoUpload = true;
  let sequenceTwoUploadStarted = false;
  let releaseSequenceTwoUpload: () => void = () => undefined;
  const sequenceTwoUploadGate = new Promise<void>((resolve) => {
    releaseSequenceTwoUpload = resolve;
  });
  let holdSequenceZeroAck = false;
  let sequenceZeroAckStarted = false;
  let sequenceZeroAckCompleted = false;
  let releaseSequenceZeroAck: () => void = () => undefined;
  const sequenceZeroAckGate = new Promise<void>((resolve) => {
    releaseSequenceZeroAck = resolve;
  });
  let revokeNextChunk = false;
  let createCount = 0;
  let failNextCaptureCreate = false;
  let capacityBusyNextCaptureCreate = false;
  let capacityBusyCaptureCreateCount = 0;
  let asrBusyNextCaptureCreate = false;
  let failedCreateIdempotencyKey: string | null = null;
  let failedCaptureCreateCount = 0;
  let refreshStarted = false;
  let refreshedDocumentLoaded = false;
  let previewOutOfOrderEnabled = false;
  let delayedPreviewStarted = false;
  let newerPreviewStarted = false;
  let releaseDelayedPreview: () => void = () => undefined;
  const delayedPreviewGate = new Promise<void>((resolve) => {
    releaseDelayedPreview = resolve;
  });

  page.on("load", () => {
    if (refreshStarted) refreshedDocumentLoaded = true;
  });
  let nextSample = 0;
  let evidenceItems: (typeof evidenceItem)[] = [];
  const captureRecord = (
    status: "open" | "finalizing" | "completed" | "cancelled",
  ) => ({
    id: captureId,
    tenant_id: tenantId,
    matter_id: matterId,
    created_by_membership_id: membershipId,
    title: "合成浏览器录音",
    original_filename: "live-recording.wav",
    media_type: "audio/wav",
    capture_protocol: "pcm_s16le_v1",
    limits: LEGACY_SPEECH_CAPTURE_LIMITS,
    audio_track_settings: {
      context_sample_rate: 16_000,
      track_sample_rate: null,
      track_channel_count: 1,
      track_sample_size: null,
      echo_cancellation: null,
      noise_suppression: null,
      auto_gain_control: null,
    },
    total_samples: nextSample,
    final_sequence_number: finishRequested ? chunks.length - 1 : null,
    final_total_samples: finishRequested ? nextSample : null,
    preview_revision: 0,
    transcription_task_id: status === "completed" ? taskId : null,
    status,
    next_sequence_number: chunks.length,
    total_byte_size: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
    expires_at: "2026-10-07T00:00:00Z",
    cleanup_pending: false,
    evidence_item_id: status === "completed" ? evidenceId : null,
    evidence_version_id: status === "completed" ? versionId : null,
    source_sha256: status === "completed" ? evidenceVersion.sha256 : null,
    error_code: null,
    created_at: now,
    updated_at: now,
  });

  await page.addInitScript(() => {
    const target = window as typeof window & {
      __w11FailNextWorkletLoad?: boolean;
      __w11WorkletLoadFailures?: number;
      __w11AudioContexts?: AudioContext[];
      __w11FailNextChunkPut?: boolean;
      __w11HoldChunkTransaction?: boolean;
      __w11ChunkTransactionPutSucceeded?: boolean;
      __w11ChunkPutFailureTriggered?: boolean;
      __w11ChunkTransactionAbortIssued?: boolean;
      __w11ChunkTransactionAbortObserved?: boolean;
      __w11ChunkTransactionAbortError?: string | null;
      __w11HoldNextDigest?: boolean;
      __w11DigestStarted?: boolean;
      __w11ReleaseDigest?: () => void;
      AudioContext: typeof AudioContext;
    };
    const nativeDigest = target.crypto.subtle.digest.bind(target.crypto.subtle);
    target.__w11HoldNextDigest = false;
    target.__w11DigestStarted = false;
    target.__w11ReleaseDigest = undefined;
    target.crypto.subtle.digest = async (algorithm, data) => {
      if (target.__w11HoldNextDigest) {
        target.__w11HoldNextDigest = false;
        target.__w11DigestStarted = true;
        await new Promise<void>((resolve) => {
          target.__w11ReleaseDigest = resolve;
        });
      }
      return nativeDigest(algorithm, data);
    };
    const NativeAudioContext = target.AudioContext;
    target.__w11FailNextWorkletLoad =
      sessionStorage.getItem("w11-worklet-failure-injected") !== "1";
    target.__w11WorkletLoadFailures = Number(
      sessionStorage.getItem("w11-worklet-load-failures") ?? "0",
    );
    target.__w11AudioContexts = [];
    target.__w11FailNextChunkPut = false;
    target.__w11HoldChunkTransaction = false;
    target.__w11ChunkTransactionPutSucceeded = false;
    target.__w11ChunkPutFailureTriggered = false;
    target.__w11ChunkTransactionAbortIssued = false;
    target.__w11ChunkTransactionAbortObserved = false;
    target.__w11ChunkTransactionAbortError = null;
    const nativePut = Object.getOwnPropertyDescriptor(
      IDBObjectStore.prototype,
      "put",
    )?.value as
      | ((
          this: IDBObjectStore,
          ...args: Parameters<IDBObjectStore["put"]>
        ) => IDBRequest<IDBValidKey>)
      | undefined;
    if (!nativePut) throw new Error("IndexedDB put method is unavailable");
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const abortAfterChunkWrite =
        this.name === "chunks" && target.__w11FailNextChunkPut;
      const holdAfterChunkWrite =
        this.name === "chunks" && target.__w11HoldChunkTransaction;
      const transaction = this.transaction;
      if (abortAfterChunkWrite) {
        target.__w11FailNextChunkPut = false;
        target.__w11ChunkPutFailureTriggered = true;
      }
      if (this.name === "chunks") {
        transaction.addEventListener(
          "abort",
          () => {
            target.__w11ChunkTransactionAbortObserved = true;
            target.__w11ChunkTransactionAbortError =
              transaction.error?.name ?? null;
          },
          { once: true },
        );
      }
      const request = Reflect.apply(nativePut, this, args);
      if (abortAfterChunkWrite) {
        request.addEventListener(
          "success",
          () => {
            try {
              transaction.addEventListener(
                "abort",
                () => {
                  target.__w11ChunkTransactionAbortObserved = true;
                },
                { once: true },
              );
              transaction.abort();
              target.__w11ChunkTransactionAbortIssued = true;
            } catch (error) {
              target.__w11ChunkTransactionAbortError =
                error instanceof Error ? error.message : String(error);
            }
          },
          { once: true },
        );
      }
      if (holdAfterChunkWrite) {
        request.addEventListener(
          "success",
          () => {
            target.__w11ChunkTransactionPutSucceeded = true;
            const keepAlive = () => {
              if (!target.__w11HoldChunkTransaction) return;
              const pending = transaction
                .objectStore("sessions")
                .get("__w11-keepalive__");
              pending.addEventListener("success", keepAlive, { once: true });
            };
            keepAlive();
          },
          { once: true },
        );
      }
      return request;
    };
    target.AudioContext = class extends NativeAudioContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        target.__w11AudioContexts?.push(this);
        const worklet = this.audioWorklet;
        const addModule = worklet.addModule.bind(worklet);
        worklet.addModule = async (moduleUrl, moduleOptions) => {
          if (target.__w11FailNextWorkletLoad) {
            target.__w11FailNextWorkletLoad = false;
            sessionStorage.setItem("w11-worklet-failure-injected", "1");
            target.__w11WorkletLoadFailures =
              (target.__w11WorkletLoadFailures ?? 0) + 1;
            sessionStorage.setItem(
              "w11-worklet-load-failures",
              String(target.__w11WorkletLoadFailures),
            );
            throw new Error("synthetic AudioWorklet load failure");
          }
          return addModule(moduleUrl, moduleOptions);
        };
      }
    };
  });
  await page.context().route("**/api/**", (route) =>
    route.fulfill({
      status: 404,
      json: { detail: "Unmocked test endpoint" },
    }),
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
  await page.context().route("**/api/law/**", async (route: Route) => {
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
    if (path.endsWith("/deadline-rules")) {
      return route.fulfill(response({ rules: [], calendars: [] }));
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
          items: recordingFinished
            ? [
                {
                  ...taskRecord,
                  status: "awaiting_review",
                  current_version_number: transcriptVersionNumber,
                },
              ]
            : [],
          transcription_available: true,
          supported_media_types: ["audio/wav"],
          live_capture_available: true,
          live_capture_media_types: ["audio/wav"],
        }),
      );
    }
    if (path === capturePath && method === "POST") {
      if (asrBusyNextCaptureCreate) {
        asrBusyNextCaptureCreate = false;
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "SPEECH_ASR_BUSY",
              message:
                "Local speech recognition is finishing another task; try recording again shortly",
            },
          },
        });
      }
      if (capacityBusyNextCaptureCreate) {
        capacityBusyNextCaptureCreate = false;
        capacityBusyCaptureCreateCount += 1;
        failedCreateIdempotencyKey =
          request.headers()["idempotency-key"] ?? null;
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: "SPEECH_CAPTURE_CAPACITY_BUSY",
              message:
                "Live recording capacity is busy; save existing recordings before starting another",
            },
          },
        });
      }
      if (failNextCaptureCreate) {
        failNextCaptureCreate = false;
        failedCaptureCreateCount += 1;
        failedCreateIdempotencyKey =
          request.headers()["idempotency-key"] ?? null;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "synthetic Capture unavailable" }),
        });
      }
      if (createCount > 0) {
        captureId = "40000000-0000-4000-8000-000000000022";
        captureCancelled = false;
        chunks.length = 0;
        attemptedPcmChunks.clear();
        acceptedPcmChunks.clear();
        chunkRequests.clear();
        nextSample = 0;
        finishRequested = false;
        recordingFinished = false;
      }
      createCount += 1;
      const body = request.postDataJSON() as {
        capture_protocol: string;
        media_type: string;
        audio_track_settings?: {
          context_sample_rate: number;
          device_id?: string;
        };
      };
      expect(body.capture_protocol).toBe("pcm_s16le_v1");
      expect(body.media_type).toBe("audio/wav");
      expect(body.audio_track_settings?.context_sample_rate).toBe(16_000);
      expect(body.audio_track_settings).not.toHaveProperty("device_id");
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      if (failedCreateIdempotencyKey) {
        expect(request.headers()["idempotency-key"]).toBe(
          failedCreateIdempotencyKey,
        );
        failedCreateIdempotencyKey = null;
      }
      events.push("create");
      return route.fulfill(
        response({
          ...captureRecord("open"),
          max_chunk_bytes: 65_536,
          max_total_bytes: 52_428_800,
          transcription_available: true,
          sample_rate: 16_000,
          channels: 1,
          max_samples: 9_600_000,
        }),
      );
    }
    const chunkMatch = /\/live-captures\/[^/]+\/chunks\/(\d+)$/.exec(path);
    if (chunkMatch && method === "PUT") {
      const sequence = Number(chunkMatch[1]);
      const body = request.postDataBuffer() ?? Buffer.alloc(0);
      const previousAttempt = attemptedPcmChunks.get(sequence);
      if (previousAttempt) {
        expect(Buffer.from(body).equals(previousAttempt)).toBe(true);
      } else {
        attemptedPcmChunks.set(sequence, Buffer.from(body));
      }
      chunkRequests.set(sequence, (chunkRequests.get(sequence) ?? 0) + 1);
      if (refreshedDocumentLoaded)
        requestsAfterRefresh.set(
          sequence,
          (requestsAfterRefresh.get(sequence) ?? 0) + 1,
        );
      const digest = createHash("sha256").update(body).digest("hex");
      const submittedDigest = request.headers()["x-chunk-sha256"] ?? "";
      const sampleCount = Number(request.headers()["x-sample-count"]);
      const startSample = Number(request.headers()["x-start-sample"]);
      if (
        body.byteLength === 0 ||
        body.byteLength !== sampleCount * 2 ||
        startSample !== nextSample ||
        digest !== submittedDigest
      ) {
        return route.fulfill(
          response({ detail: "chunk_integrity_failed" }, 422),
        );
      }
      if (revokeNextChunk) {
        revokeNextChunk = false;
        return route.fulfill(response({ detail: "permission_revoked" }, 403));
      }
      const existing = chunks.find((chunk) => chunk.sequence === sequence);
      if (existing) {
        if (
          existing.digest !== digest ||
          existing.sampleCount !== sampleCount ||
          existing.startSample !== startSample
        ) {
          return route.fulfill(response({ detail: "chunk_conflict" }, 409));
        }
        return route.fulfill(
          response({
            capture_id: captureId,
            accepted_sequence_number: sequence,
            next_sequence_number: sequence + 1,
            chunk_sha256: digest,
            sample_count: sampleCount,
            start_sample: startSample,
          }),
        );
      }
      if (sequence >= 3 && !allowRecoveryUploads) {
        return route.fulfill(
          response({ detail: "temporary_storage_failure" }, 503),
        );
      }
      if (sequence !== chunks.length) {
        return route.fulfill(response({ detail: "sequence_gap" }, 409));
      }
      chunks.push({
        sequence,
        bytes: body.byteLength,
        digest,
        sampleCount,
        startSample,
      });
      acceptedPcmChunks.set(sequence, Buffer.from(body));
      nextSample += sampleCount;
      events.push(`chunk:${sequence}`);
      if (sequence === 0 && holdSequenceZeroAck) {
        holdSequenceZeroAck = false;
        sequenceZeroAckStarted = true;
        await sequenceZeroAckGate;
        sequenceZeroAckCompleted = true;
      }
      if (sequence === 2 && loseSequenceTwoAck) {
        if (holdSequenceTwoUpload) {
          sequenceTwoUploadStarted = true;
          await sequenceTwoUploadGate;
          holdSequenceTwoUpload = false;
        }
        loseSequenceTwoAck = false;
        return route.abort();
      }
      return route.fulfill(
        response({
          capture_id: captureId,
          accepted_sequence_number: sequence,
          next_sequence_number: sequence + 1,
          chunk_sha256: digest,
          sample_count: sampleCount,
          start_sample: startSample,
        }),
      );
    }
    if (path === `${capturePath}/${captureId}/cancel` && method === "POST") {
      captureCancelled = true;
      return route.fulfill(response(captureRecord("cancelled")));
    }
    if (path === `${capturePath}/${captureId}/chunks` && method === "GET") {
      return route.fulfill(
        response({
          items: chunks.map((chunk) => ({
            sequence_number: chunk.sequence,
            sha256: chunk.digest,
            sample_count: chunk.sampleCount,
            start_sample: chunk.startSample,
            byte_size: chunk.bytes,
          })),
          next_sequence_number: chunks.length,
        }),
      );
    }
    if (path.endsWith(`/live-captures/${captureId}/preview`)) {
      if (previewOutOfOrderEnabled) {
        const afterRevision = Number(
          url.searchParams.get("after_revision") ?? 0,
        );
        if (afterRevision === 0 && !delayedPreviewStarted) {
          delayedPreviewStarted = true;
          await delayedPreviewGate;
          return route.fulfill(
            response({
              capture_id: captureId,
              revision: 1,
              items: [
                {
                  window_id: "synthetic-window-0",
                  window_index: 0,
                  start_sample: 0,
                  end_sample: 80_000,
                  revision: 1,
                  provisional: true,
                  transcript: {
                    text: "迟到旧结果",
                    segments: [],
                    warnings: [],
                    provisional: true,
                    offset_unit: "utf16",
                    speakers: [],
                  },
                },
              ],
            }),
          );
        }
        if (afterRevision === 0 && !newerPreviewStarted) {
          newerPreviewStarted = true;
          return route.fulfill(
            response({
              capture_id: captureId,
              revision: 2,
              items: [
                {
                  window_id: "synthetic-window-0",
                  window_index: 0,
                  start_sample: 0,
                  end_sample: 80_000,
                  revision: 2,
                  provisional: true,
                  transcript: {
                    text: "相同预览文字",
                    segments: [],
                    warnings: [],
                    provisional: true,
                    offset_unit: "utf16",
                    speakers: [],
                  },
                },
                {
                  window_id: "synthetic-window-1",
                  window_index: 1,
                  start_sample: 80_000,
                  end_sample: 160_000,
                  revision: 1,
                  provisional: true,
                  transcript: {
                    text: "相同预览文字",
                    segments: [],
                    warnings: [],
                    provisional: true,
                    offset_unit: "utf16",
                    speakers: [],
                  },
                },
              ],
            }),
          );
        }
        if (afterRevision >= 2) return route.fulfill({ status: 204, body: "" });
      }
      return route.fulfill({ status: 204, body: "" });
    }
    if (path === `${capturePath}/${captureId}` && method === "GET") {
      const completed = finishRequested && !captureCancelled;
      recordingFinished = completed;
      if (completed) evidenceItems = [evidenceItem];
      return route.fulfill(
        response(
          captureRecord(
            captureCancelled ? "cancelled" : completed ? "completed" : "open",
          ),
        ),
      );
    }
    if (path === `${capturePath}/${captureId}/finish` && method === "POST") {
      const body = request.postDataJSON() as {
        final_sequence_number: number;
        total_samples: number;
        end_reason: string;
      };
      expect(chunks.length).toBeGreaterThan(0);
      expect(body.final_sequence_number).toBe(chunks.at(-1)?.sequence);
      expect(body.total_samples).toBe(nextSample);
      expect(["user_stop", "interrupted"]).toContain(body.end_reason);
      finishEndReasons.push(body.end_reason);
      events.push("finish");
      if (holdNextFinishResponse) {
        holdNextFinishResponse = false;
        finishResponseStarted = true;
        await finishResponseGate;
      }
      finishRequested = true;
      return route.fulfill(response(captureRecord("finalizing"), 202));
    }
    if (path === `${basePath}/speech-transcriptions/${taskId}`) {
      transcriptDetailReads += 1;
      return route.fulfill(
        response({
          task: {
            ...taskRecord,
            status: recordingFinished ? "awaiting_review" : "queued",
            current_version_number: recordingFinished
              ? transcriptVersionNumber
              : 0,
          },
          versions: recordingFinished
            ? [
                transcriptVersion(
                  transcriptVersionNumber,
                  transcriptVersionNumber === 1
                    ? "初始机器稿。"
                    : "后台生成的新版。",
                ),
              ]
            : [],
          events: [],
        }),
      );
    }

    return route.fulfill(response({ items: [] }));
  });

  await page.addInitScript(() => {
    const key = "w11-speech-get-user-media-calls";
    let calls = Number(sessionStorage.getItem(key) ?? "0");
    const mediaDevices = navigator.mediaDevices;
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    const target = window as typeof window & {
      __w11AudioTracks?: MediaStreamTrack[][];
      __w11DenyNextGetUserMedia?: boolean;
    };
    target.__w11AudioTracks = [];
    target.__w11DenyNextGetUserMedia = false;
    mediaDevices.getUserMedia = async (...args) => {
      calls += 1;
      sessionStorage.setItem(key, String(calls));
      if (target.__w11DenyNextGetUserMedia) {
        target.__w11DenyNextGetUserMedia = false;
        throw new DOMException(
          "synthetic microphone denial",
          "NotAllowedError",
        );
      }
      const stream = await original(...args);
      target.__w11AudioTracks?.push(stream.getTracks());
      return stream;
    };
  });

  await page.addInitScript(async () => {
    if (sessionStorage.getItem("w11-legacy-outbox-seeded") === "1") return;
    const request = indexedDB.open("matrix-law-speech-capture-outbox-v1", 2);
    await new Promise<void>((resolve, reject) => {
      request.onupgradeneeded = () => {
        const database = request.result;
        const sessions = database.createObjectStore("sessions", {
          keyPath: "key",
        });
        sessions.createIndex("byScope", "scope", { unique: false });
        const chunks = database.createObjectStore("chunks", { keyPath: "key" });
        chunks.createIndex("byScope", "scope", { unique: false });
        chunks.createIndex("bySession", ["scope", "localId"], {
          unique: false,
        });
        database.createObjectStore("keys", { keyPath: "scope" });
        database.createObjectStore("usage", { keyPath: "scope" });
      };
      request.onerror = () =>
        reject(request.error ?? new Error("cannot seed prior outbox"));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          ["chunks", "usage"],
          "readwrite",
        );
        transaction.objectStore("chunks").put({
          key: "legacy-scope:legacy-session:00000000",
          scope: "legacy-scope",
          localId: "legacy-session",
          sequenceNumber: 0,
          sampleCount: 1,
          startSample: 0,
          sha256: "0".repeat(64),
          byteSize: 777,
          iv: new ArrayBuffer(12),
          ciphertext: new ArrayBuffer(2),
        });
        transaction
          .objectStore("usage")
          .put({ scope: "legacy-scope", pendingBytes: 777 });
        transaction.oncomplete = () => {
          sessionStorage.setItem("w11-legacy-outbox-seeded", "1");
          database.close();
          resolve();
        };
        transaction.onerror = () =>
          reject(
            transaction.error ?? new Error("cannot persist legacy outbox"),
          );
        transaction.onabort = () =>
          reject(
            transaction.error ?? new Error("legacy outbox transaction aborted"),
          );
      };
    });
  });

  await page.goto(`/workspace/chats/${threadId}`);
  await page.getByRole("button", { name: /artifacts/i }).click();
  await expect(
    page.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
  const workletResponse = await page.request.get(
    new URL("/worklets/pcm16-capture.js", page.url()).toString(),
  );
  expect(workletResponse.status()).toBe(200);
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  await page.getByLabel("录音名称").fill("合成浏览器录音");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  const startCaptureButton = page.getByRole("button", {
    name: /开始麦克风录音/,
  });
  const unsupportedCaptureMessage = page.getByText(
    /当前浏览器无法建立受支持的 16 kHz 录音能力|浏览器未能及时启动音频上下文|浏览器未能启动音频上下文/,
  );
  await expect
    .poll(
      async () =>
        (await startCaptureButton.isVisible().catch(() => false)) ||
        (await unsupportedCaptureMessage.isVisible().catch(() => false)),
      { timeout: 5_000 },
    )
    .toBe(true);
  if (!(await startCaptureButton.isVisible().catch(() => false))) {
    expect(createCount).toBe(0);
    expect(
      await page.evaluate(() =>
        Number(
          sessionStorage.getItem("w11-speech-get-user-media-calls") ?? "0",
        ),
      ),
    ).toBe(0);
    await expect(page.getByLabel("音视频原件")).toBeVisible();
    test.info().annotations.push({
      type: "browser-audio-capability",
      description:
        "AudioContext did not reach running; capture stayed closed and file upload remained available.",
    });
    return;
  }
  const workletLoadFailures = await page.evaluate(() =>
    Number(
      (window as typeof window & { __w11WorkletLoadFailures?: number })
        .__w11WorkletLoadFailures ?? 0,
    ),
  );
  if (workletLoadFailures !== 1) {
    expect(createCount).toBe(0);
    expect(
      await page
        .getByText(/正在采集；本机保存、服务器确认和识别进度分开显示/)
        .isVisible()
        .catch(() => false),
    ).toBe(false);
    await expect(page.getByLabel("音视频原件")).toBeVisible();
    test.info().annotations.push({
      type: "browser-audio-test-fixture",
      description:
        "This engine did not support the synthetic AudioWorklet failure injection; no server capture was created and file upload remained available.",
    });
    return;
  }
  expect(createCount).toBe(0);
  expect(
    await page.evaluate(() =>
      Number(sessionStorage.getItem("w11-speech-get-user-media-calls") ?? "0"),
    ),
  ).toBe(0);
  expect(
    await page.evaluate(
      () =>
        (
          window as typeof window & { __w11AudioContexts?: AudioContext[] }
        ).__w11AudioContexts?.map((context) => context.state) ?? [],
    ),
  ).toEqual(["closed"]);
  previewOutOfOrderEnabled = true;
  await startCaptureButton.dblclick();
  const captureProgress = page.getByText(
    /正在采集；本机保存、服务器确认和识别进度分开显示/,
  );
  const captureFailure = page.locator("[role=alert]").filter({
    hasText: /\S/,
  });
  const startupSettled = await expect
    .poll(
      async () =>
        (await captureProgress.isVisible().catch(() => false)) ||
        (await captureFailure.count()) > 0 ||
        (await unsupportedCaptureMessage.isVisible().catch(() => false)),
      { timeout: 5_000 },
    )
    .toBe(true)
    .then(
      () => true,
      () => false,
    );
  if (!startupSettled) {
    await expect(page.getByText(/正在准备 16 kHz 录音/)).toBeVisible();
    await page.getByRole("button", { name: /取消启动/ }).click();
    await expect(startCaptureButton).toBeVisible();
    expect(createCount).toBe(0);
    await expect(page.getByLabel("音视频原件")).toBeVisible();
    test.info().annotations.push({
      type: "browser-audio-device",
      description:
        "getUserMedia remained pending in the virtual browser; cancel startup returned to idle and kept file upload available.",
    });
    return;
  }
  if (!(await captureProgress.isVisible().catch(() => false))) {
    expect(createCount).toBe(0);
    await expect(page.getByLabel("音视频原件")).toBeVisible();
    const captureErrorText =
      (await captureFailure.allTextContents()).join(" | ") ||
      (await unsupportedCaptureMessage.allTextContents()).join(" | ");
    test.info().annotations.push({
      type: "browser-audio-device",
      description: `The browser could not start capture; file upload remained available. UI: ${captureErrorText}`,
    });
    return;
  }
  expect(createCount).toBe(1);
  expect(
    await page.evaluate(() =>
      Number(sessionStorage.getItem("w11-speech-get-user-media-calls") ?? "0"),
    ),
  ).toBe(1);
  await expect(page.getByLabel("录音临时识别预览")).toBeVisible();
  await expect(
    page.getByLabel("录音临时识别预览").getByText("相同预览文字"),
  ).toHaveCount(2);
  expect(delayedPreviewStarted).toBe(true);
  releaseDelayedPreview();
  await expect(
    page.getByLabel("录音临时识别预览").getByText("迟到旧结果"),
  ).toHaveCount(0);
  await expect.poll(() => chunks.length, { timeout: 15_000 }).toBe(3);
  await expect
    .poll(() => readPendingSequences(page), { timeout: 15_000 })
    .toEqual(expect.arrayContaining([3, 4]));
  const secondPage = await page.context().newPage();
  await secondPage.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    (window as typeof window & { __w11MediaCalls?: number }).__w11MediaCalls =
      0;
    mediaDevices.getUserMedia = async (...args) => {
      const target = window as typeof window & { __w11MediaCalls?: number };
      target.__w11MediaCalls = (target.__w11MediaCalls ?? 0) + 1;
      return original(...args);
    };
  });
  mockLangGraphAPI(secondPage, {
    threads: [
      {
        thread_id: threadId,
        title: "合成庭审录音",
        artifacts: [],
        messages: [
          {
            type: "ai",
            id: "synthetic-hearing-thread-second-tab",
            content: "仅用于双标签锁测试。",
          },
        ],
      },
    ],
  });
  await secondPage.goto(`/workspace/chats/${threadId}`);
  await secondPage.getByRole("button", { name: /artifacts/i }).click();
  await expect(
    secondPage.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
  await expect(
    secondPage.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  await secondPage.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(
    secondPage.getByText(/另一个标签页正在录音或恢复案件录音/),
  ).toBeVisible();
  expect(finishRequested).toBe(false);
  expect(createCount).toBe(1);
  expect(
    await secondPage.evaluate(
      () =>
        (window as typeof window & { __w11MediaCalls?: number })
          .__w11MediaCalls,
    ),
  ).toBe(0);
  await secondPage.close();

  await expect.poll(() => sequenceTwoUploadStarted).toBe(true);
  await page.evaluate(() => {
    const target = window as typeof window & {
      __w11DigestStarted?: boolean;
      __w11HoldNextDigest?: boolean;
      __w11ChunkTransactionPutSucceeded?: boolean;
    };
    target.__w11DigestStarted = false;
    target.__w11HoldNextDigest = true;
    target.__w11ChunkTransactionPutSucceeded = false;
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as typeof window & { __w11DigestStarted?: boolean })
              .__w11DigestStarted ?? false,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.evaluate(() => {
    (
      window as typeof window & { __w11HoldChunkTransaction?: boolean }
    ).__w11HoldChunkTransaction = true;
  });
  try {
    await page.getByRole("button", { name: /停止并保存/ }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __w11AudioTracks?: MediaStreamTrack[][];
              }
            ).__w11AudioTracks?.[0]?.every(
              (track) => track.readyState === "ended",
            ) ?? false,
        ),
      )
      .toBe(true);
    expect(finishRequested).toBe(false);
    await page.evaluate(() => {
      (
        window as typeof window & { __w11ReleaseDigest?: () => void }
      ).__w11ReleaseDigest?.();
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as typeof window & {
                  __w11ChunkTransactionPutSucceeded?: boolean;
                }
              ).__w11ChunkTransactionPutSucceeded ?? false,
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    expect(finishRequested).toBe(false);
    await page.evaluate(() => {
      (
        window as typeof window & { __w11HoldChunkTransaction?: boolean }
      ).__w11HoldChunkTransaction = false;
    });
    const stoppedPendingSequences = await readPendingSequences(page);
    expect(stoppedPendingSequences).toEqual(expect.arrayContaining([2, 3, 4]));
    expect(stoppedPendingSequences.some((sequence) => sequence >= 5)).toBe(
      true,
    );
    expect(finishRequested).toBe(false);
  } finally {
    await page.evaluate(() => {
      const target = window as typeof window & {
        __w11HoldChunkTransaction?: boolean;
        __w11ReleaseDigest?: () => void;
      };
      target.__w11HoldChunkTransaction = false;
      target.__w11ReleaseDigest?.();
    });
    releaseSequenceTwoUpload();
  }
  await expect(
    page.getByRole("status").filter({
      hasText: "上传或本机暂存遇到问题；未确认数据没有被当作服务器已保存",
    }),
  ).toBeVisible();
  await expect
    .poll(() => readPendingSequences(page))
    .toEqual(expect.arrayContaining([2, 3, 4]));
  expect(chunks.map((chunk) => chunk.sequence)).toEqual([0, 1, 2]);
  expect(finishRequested).toBe(false);

  allowRecoveryUploads = true;
  refreshStarted = true;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(
          sessionStorage.getItem("w11-speech-get-user-media-calls") ?? "0",
        ),
      ),
    )
    .toBe(1);
  await expect.poll(() => recordingFinished, { timeout: 10_000 }).toBe(true);

  expect(chunks.every((chunk) => chunk.bytes > 0)).toBe(true);
  expect(chunks.map((chunk) => chunk.sequence)).toEqual(
    chunks.map((_, index) => index),
  );
  expect(chunks.every((chunk) => chunk.bytes === chunk.sampleCount * 2)).toBe(
    true,
  );
  expect(chunks.map((chunk) => chunk.startSample)).toEqual(
    chunks.map((_, index) =>
      chunks.slice(0, index).reduce((sum, chunk) => sum + chunk.sampleCount, 0),
    ),
  );
  expect(events.at(-1)).toBe("finish");
  expect(chunks.map((chunk) => chunk.sequence)).toEqual(
    chunks.map((_, index) => index),
  );
  // The server accepted sequence 2 before its ACK was lost. The live retry
  // may run before refresh; either path must reuse the exact PCM bytes.
  expect(chunkRequests.get(2)).toBeGreaterThanOrEqual(1);
  expect(chunkRequests.get(2)).toBeLessThanOrEqual(2);
  await expect.poll(() => readPendingSequences(page)).not.toContain(2);
  for (const sequence of [0, 1, 2]) {
    expect(requestsAfterRefresh.get(sequence) ?? 0).toBe(0);
  }
  expect(requestsAfterRefresh.get(3)).toBeGreaterThanOrEqual(1);
  expect(requestsAfterRefresh.get(4)).toBeGreaterThanOrEqual(1);
  expect(acceptedPcmChunks.size).toBe(chunks.length);
  for (const chunk of chunks) {
    expect(
      acceptedPcmChunks
        .get(chunk.sequence)
        ?.equals(attemptedPcmChunks.get(chunk.sequence) ?? Buffer.alloc(0)),
    ).toBe(true);
  }
  expect(events.indexOf("finish")).toBeGreaterThan(
    Math.max(
      ...events
        .filter((event) => event.startsWith("chunk:"))
        .map((event) => events.indexOf(event)),
    ),
  );

  const sameIdentityMeRoute = (route: Route) =>
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
  await page.route("**/api/v1/auth/me", sameIdentityMeRoute);
  const reviewSegment = page.getByLabel("校对片段 1", { exact: true });
  await expect(reviewSegment).toHaveValue("初始机器稿。");
  await reviewSegment.fill("律师未保存的草稿。");
  const simulateVisibilityReturn = () =>
    page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      window.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      window.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
      Reflect.deleteProperty(document, "visibilityState");
    });
  const readsBeforeSameVersion = transcriptDetailReads;
  await simulateVisibilityReturn();
  await expect
    .poll(() => transcriptDetailReads, { timeout: 10_000 })
    .toBeGreaterThan(readsBeforeSameVersion);
  await expect(reviewSegment).toHaveValue("律师未保存的草稿。");
  await page.waitForTimeout(300);

  transcriptVersionNumber = 2;
  const readsBeforeNewVersion = transcriptDetailReads;
  await simulateVisibilityReturn();
  await expect
    .poll(() => transcriptDetailReads, { timeout: 10_000 })
    .toBeGreaterThan(readsBeforeNewVersion);
  await expect(
    page.locator('[role="alert"]').filter({ hasText: "该转写已有新版本" }),
  ).toContainText("该转写已有新版本；当前未保存草稿已保留。");
  await expect(reviewSegment).toHaveValue("律师未保存的草稿。");
  await expect(page.getByText("机器初稿 · 未人工复核")).toBeVisible();
  await page.unroute("**/api/v1/auth/me", sameIdentityMeRoute);

  const delayedPermissionPage = await page.context().newPage();
  mockLangGraphAPI(delayedPermissionPage, {
    threads: [
      {
        thread_id: threadId,
        title: "合成庭审录音",
        artifacts: [],
        messages: [
          {
            type: "ai",
            id: "synthetic-pending-permission-thread",
            content: "仅用于权限挂起卸载测试。",
          },
        ],
      },
    ],
  });
  await delayedPermissionPage.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    const target = window as typeof window & {
      __w11PendingPermission?: boolean;
      __w11ReleasePendingPermission?: () => Promise<void>;
      __w11LateAudioTracks?: MediaStreamTrack[][];
    };
    target.__w11PendingPermission = false;
    target.__w11LateAudioTracks = [];
    mediaDevices.getUserMedia = (...args) => {
      target.__w11PendingPermission = true;
      return new Promise<MediaStream>((resolve, reject) => {
        target.__w11ReleasePendingPermission = async () => {
          try {
            const stream = await original(...args);
            target.__w11LateAudioTracks?.push(stream.getTracks());
            resolve(stream);
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };
      });
    };
  });
  await delayedPermissionPage.goto(`/workspace/chats/${threadId}`);
  await delayedPermissionPage
    .getByRole("button", { name: /artifacts/i })
    .click();
  await expect(
    delayedPermissionPage.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
  await delayedPermissionPage.getByLabel("录音名称").fill("迟到权限音轨测试");
  await delayedPermissionPage
    .getByRole("button", { name: /开始麦克风录音/ })
    .click();
  await expect
    .poll(() =>
      delayedPermissionPage.evaluate(
        () =>
          (window as typeof window & { __w11PendingPermission?: boolean })
            .__w11PendingPermission,
      ),
    )
    .toBe(true);
  await delayedPermissionPage.getByRole("link", { name: "Legal work" }).click();
  await expect(
    delayedPermissionPage.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toHaveCount(0);
  await delayedPermissionPage.evaluate(async () => {
    const target = window as typeof window & {
      __w11ReleasePendingPermission?: () => Promise<void>;
    };
    await target.__w11ReleasePendingPermission?.();
  });
  await expect
    .poll(() =>
      delayedPermissionPage.evaluate(() => {
        const tracks = (
          window as typeof window & {
            __w11LateAudioTracks?: MediaStreamTrack[][];
          }
        ).__w11LateAudioTracks;
        return tracks?.flat().map((track) => track.readyState) ?? [];
      }),
    )
    .toEqual(["ended"]);
  expect(createCount).toBe(1);
  await delayedPermissionPage.close();

  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  await page.evaluate(() => {
    (
      window as typeof window & { __w11DenyNextGetUserMedia?: boolean }
    ).__w11DenyNextGetUserMedia = true;
  });
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  const microphoneDenialMessage = page.getByText(/synthetic microphone denial/);
  const microphoneRetrySettled = await expect
    .poll(
      async () =>
        (await microphoneDenialMessage.isVisible().catch(() => false)) ||
        (await unsupportedCaptureMessage.isVisible().catch(() => false)),
      { timeout: 5_000 },
    )
    .toBe(true)
    .then(
      () => true,
      () => false,
    );
  if (!microphoneRetrySettled) {
    await page.getByRole("button", { name: /取消启动/ }).click();
    await expect(
      page.getByRole("button", { name: /开始麦克风录音/ }),
    ).toBeVisible();
    expect(createCount).toBe(1);
    await expect(page.getByLabel("音视频原件")).toBeVisible();
    test.info().annotations.push({
      type: "browser-audio-device",
      description:
        "A later virtual microphone request remained pending; cancel startup kept the existing Capture isolated and file upload available.",
    });
    return;
  }
  if (!(await microphoneDenialMessage.isVisible().catch(() => false))) {
    expect(createCount).toBe(1);
    await expect(page.getByLabel("音视频原件")).toBeVisible();
    test.info().annotations.push({
      type: "browser-audio-capability",
      description:
        "The browser disabled further microphone capture after an audio-context failure; file upload remained available.",
    });
    return;
  }
  await expect(microphoneDenialMessage).toBeVisible();
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  expect(createCount).toBe(1);
  expect(await readPendingSequences(page)).toEqual([]);

  failNextCaptureCreate = true;
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(page.getByText(/synthetic Capture unavailable/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /补传并继续保存/ }),
  ).toBeVisible();
  expect(failedCaptureCreateCount).toBe(1);
  expect(createCount).toBe(1);
  expect(await readRecoverableCaptureCount(page)).toBe(1);
  expect(await readPendingSequences(page)).toEqual([]);
  const failedCreateResources = await page.evaluate(() => {
    const target = window as typeof window & {
      __w11AudioContexts?: AudioContext[];
      __w11AudioTracks?: MediaStreamTrack[][];
    };
    return {
      contextState: target.__w11AudioContexts?.at(-1)?.state,
      trackStates: target.__w11AudioTracks
        ?.at(-1)
        ?.map((track) => track.readyState),
    };
  });
  expect(failedCreateResources.contextState).toBe("closed");
  expect(failedCreateResources.trackStates?.length).toBeGreaterThan(0);
  expect(
    failedCreateResources.trackStates?.every((state) => state === "ended"),
  ).toBe(true);

  await page.getByRole("button", { name: /补传并继续保存/ }).click();
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  expect(failedCreateIdempotencyKey).toBeNull();
  expect(createCount).toBe(2);
  expect(await readRecoverableCaptureCount(page)).toBe(0);

  let previousOriginPendingBytes: number | null = null;
  if (browserName === "chromium") {
    await page.evaluate(() => {
      (
        window as typeof window & { __w11HoldNextDigest?: boolean }
      ).__w11HoldNextDigest = true;
    });
  } else {
    await page.evaluate(() => {
      (
        window as typeof window & { __w11FailNextChunkPut?: boolean }
      ).__w11FailNextChunkPut = true;
    });
  }
  const finishCountBeforeStorageFailure = finishEndReasons.length;
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  if (browserName === "chromium") {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as typeof window & { __w11DigestStarted?: boolean })
              .__w11DigestStarted,
        ),
      )
      .toBe(true);
    previousOriginPendingBytes = await page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const request = indexedDB.open("matrix-law-speech-capture-outbox-v1");
          request.onerror = () =>
            reject(request.error ?? new Error("cannot open outbox quota row"));
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction("usage", "readwrite");
            const store = transaction.objectStore("usage");
            const read = store.get("__same_origin__");
            let original = 0;
            read.onsuccess = () => {
              original = read.result?.pendingBytes ?? 0;
              store.put({
                scope: "__same_origin__",
                pendingBytes: 64 * 1024 * 1024 - 1,
              });
            };
            read.onerror = () => transaction.abort();
            transaction.oncomplete = () => {
              database.close();
              resolve(original);
            };
            transaction.onabort = () => {
              database.close();
              reject(transaction.error ?? new Error("quota seed aborted"));
            };
          };
        }),
    );
    await page.evaluate(() => {
      (
        window as typeof window & { __w11ReleaseDigest?: () => void }
      ).__w11ReleaseDigest?.();
    });
  } else {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __w11ChunkPutFailureTriggered?: boolean;
              }
            ).__w11ChunkPutFailureTriggered,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __w11ChunkTransactionAbortIssued?: boolean;
              }
            ).__w11ChunkTransactionAbortIssued,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __w11ChunkTransactionAbortObserved?: boolean;
              }
            ).__w11ChunkTransactionAbortObserved,
        ),
      )
      .toBe(true);
  }
  await expect(
    page.getByText(
      browserName === "chromium"
        ? /本机同源录音暂存达到 64 MiB 上限/
        : /本机加密暂存写入失败，录音已停止/,
    ),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  expect(recordingFinished).toBe(false);
  expect(finishRequested).toBe(false);
  expect(captureCancelled).toBe(true);
  expect(finishEndReasons).toHaveLength(finishCountBeforeStorageFailure);
  expect(createCount).toBe(3);
  expect(chunks).toEqual([]);
  expect(await readPendingSequences(page)).toEqual([]);
  expect(await readRecoverableCaptureCount(page)).toBe(0);
  const failedStorageResources = await page.evaluate(() => {
    const target = window as typeof window & {
      __w11AudioContexts?: AudioContext[];
      __w11AudioTracks?: MediaStreamTrack[][];
    };
    return {
      contextState: target.__w11AudioContexts?.at(-1)?.state,
      trackStates: target.__w11AudioTracks
        ?.at(-1)
        ?.map((track) => track.readyState),
    };
  });
  expect(failedStorageResources.contextState).toBe("closed");
  expect(failedStorageResources.trackStates?.length).toBeGreaterThan(0);
  expect(
    failedStorageResources.trackStates?.every((state) => state === "ended"),
  ).toBe(true);
  if (previousOriginPendingBytes !== null) {
    await page.evaluate(
      (pendingBytes) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("matrix-law-speech-capture-outbox-v1");
          request.onerror = () =>
            reject(request.error ?? new Error("cannot restore outbox quota"));
          request.onsuccess = () => {
            const database = request.result;
            const transaction = database.transaction("usage", "readwrite");
            transaction.objectStore("usage").put({
              scope: "__same_origin__",
              pendingBytes,
            });
            transaction.oncomplete = () => {
              database.close();
              resolve();
            };
            transaction.onabort = () => {
              database.close();
              reject(transaction.error ?? new Error("quota restore aborted"));
            };
          };
        }),
      previousOriginPendingBytes,
    );
  }

  const finishCountBeforeRefreshDuringTransaction = finishEndReasons.length;
  await page.evaluate(() => {
    (
      window as typeof window & { __w11HoldChunkTransaction?: boolean }
    ).__w11HoldChunkTransaction = true;
  });
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(
    page.getByText(/正在采集；本机保存、服务器确认和识别进度分开显示/),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __w11ChunkTransactionPutSucceeded?: boolean;
            }
          ).__w11ChunkTransactionPutSucceeded,
      ),
    )
    .toBe(true);
  const mediaCallsBeforeRefreshDuringTransaction = await page.evaluate(() =>
    Number(sessionStorage.getItem("w11-speech-get-user-media-calls") ?? "0"),
  );
  expect(createCount).toBe(4);
  expect(chunks).toHaveLength(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => readPendingSequences(page), { timeout: 10_000 })
    .toEqual([]);
  await expect
    .poll(() => readRecoverableCaptureCount(page), { timeout: 10_000 })
    .toBe(0);
  expect(createCount).toBe(4);
  expect(chunks).toHaveLength(0);
  expect(finishEndReasons).toHaveLength(
    finishCountBeforeRefreshDuringTransaction,
  );
  expect(
    await page.evaluate(() =>
      Number(sessionStorage.getItem("w11-speech-get-user-media-calls") ?? "0"),
    ),
  ).toBe(mediaCallsBeforeRefreshDuringTransaction);

  revokeNextChunk = true;
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(
    page.getByText(/正在采集；本机保存、服务器确认和识别进度分开显示/),
  ).toBeVisible();
  await expect(
    page.getByText(
      /案件权限已撤销或录音会话不可用；麦克风已停止，本机暂存已清除/,
    ),
  ).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => readPendingSequences(page)).toEqual([]);
  const afterRevocation = await page.evaluate(() => ({
    mediaCalls: Number(
      sessionStorage.getItem("w11-speech-get-user-media-calls") ?? "0",
    ),
    trackStates:
      (
        window as typeof window & { __w11AudioTracks?: MediaStreamTrack[][] }
      ).__w11AudioTracks
        ?.at(-1)
        ?.map((track) => track.readyState) ?? [],
  }));
  expect(afterRevocation.mediaCalls).toBe(6);
  expect(afterRevocation.trackStates.length).toBeGreaterThan(0);
  expect(afterRevocation.trackStates.every((state) => state === "ended")).toBe(
    true,
  );
  await expect(
    page.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
  const migratedPendingBytes = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open("matrix-law-speech-capture-outbox-v1");
        request.onerror = () =>
          reject(request.error ?? new Error("cannot inspect migrated outbox"));
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("usage", "readonly");
          const usage = transaction.objectStore("usage").get("__same_origin__");
          usage.onsuccess = () => resolve(usage.result?.pendingBytes ?? 0);
          usage.onerror = () =>
            reject(usage.error ?? new Error("cannot read migrated quota"));
          transaction.oncomplete = () => database.close();
        };
      }),
  );
  expect(migratedPendingBytes).toBe(777);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();

  capacityBusyNextCaptureCreate = true;
  const capturesBeforeCapacityRejection = createCount;
  await page.getByLabel("录音名称").fill("实时录音容量冲突");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(
    page.getByText("实时录音容量正在使用，请先保存已有录音后重试。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /补传并继续保存/ }),
  ).toBeVisible();
  expect(capacityBusyCaptureCreateCount).toBe(1);
  expect(createCount).toBe(capturesBeforeCapacityRejection);
  expect(await readRecoverableCaptureCount(page)).toBe(1);
  expect(await readPendingSequences(page)).toEqual([]);
  const capacityRejectedResources = await page.evaluate(() => {
    const target = window as typeof window & {
      __w11AudioContexts?: AudioContext[];
      __w11AudioTracks?: MediaStreamTrack[][];
    };
    return {
      contextState: target.__w11AudioContexts?.at(-1)?.state,
      trackStates: target.__w11AudioTracks
        ?.at(-1)
        ?.map((track) => track.readyState),
    };
  });
  expect(capacityRejectedResources.contextState).toBe("closed");
  expect(capacityRejectedResources.trackStates?.length).toBeGreaterThan(0);
  expect(
    capacityRejectedResources.trackStates?.every((state) => state === "ended"),
  ).toBe(true);
  await page.getByRole("button", { name: /补传并继续保存/ }).click();
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  expect(createCount).toBe(capturesBeforeCapacityRejection + 1);
  expect(await readRecoverableCaptureCount(page)).toBe(0);
  expect(failedCreateIdempotencyKey).toBeNull();

  asrBusyNextCaptureCreate = true;
  const capturesBeforeAsrRejection = createCount;
  await page.getByLabel("录音名称").fill("正式转写占用识别通道");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(
    page.getByText("本地识别通道正在处理正式转写，请稍后再开始实时录音。"),
  ).toBeVisible();
  const asrRejectedResources = await page.evaluate(() => {
    const target = window as typeof window & {
      __w11AudioContexts?: AudioContext[];
      __w11AudioTracks?: MediaStreamTrack[][];
    };
    return {
      contextState: target.__w11AudioContexts?.at(-1)?.state,
      trackStates: target.__w11AudioTracks
        ?.at(-1)
        ?.map((track) => track.readyState),
    };
  });
  expect(asrRejectedResources.contextState).toBe("closed");
  expect(asrRejectedResources.trackStates?.length).toBeGreaterThan(0);
  expect(
    asrRejectedResources.trackStates?.every((state) => state === "ended"),
  ).toBe(true);
  expect(createCount).toBe(capturesBeforeAsrRejection);
  expect(await readRecoverableCaptureCount(page)).toBe(0);

  holdNextFinishResponse = true;
  await page.getByLabel("录音名称").fill("取消与迟到 finish 回包测试");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect
    .poll(() => chunks.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: /停止并保存/ }).click();
  await expect
    .poll(() => finishResponseStarted, { timeout: 10_000 })
    .toBe(true);
  await page.getByRole("button", { name: /取消录音/ }).click();
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  expect(captureCancelled).toBe(true);
  expect(finishRequested).toBe(false);
  expect(await readRecoverableCaptureCount(page)).toBe(0);
  expect(await readPendingSequences(page)).toEqual([]);

  releaseFinishResponse();
  await expect.poll(() => finishRequested).toBe(true);
  await page.waitForTimeout(1_000);
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /补传并继续保存/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/录音未完成交付/)).toHaveCount(0);
  expect(captureCancelled).toBe(true);
  expect(await readRecoverableCaptureCount(page)).toBe(0);
  expect(await readPendingSequences(page)).toEqual([]);

  holdSequenceZeroAck = true;
  await page.getByLabel("录音名称").fill("取消时上传回执仍在途");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect
    .poll(() => sequenceZeroAckStarted, { timeout: 10_000 })
    .toBe(true);
  await page.getByRole("button", { name: /取消录音/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __w11AudioTracks?: MediaStreamTrack[][];
            }
          ).__w11AudioTracks
            ?.at(-1)
            ?.every((track) => track.readyState === "ended") ?? false,
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  expect(captureCancelled).toBe(true);
  expect(finishRequested).toBe(false);
  await expect.poll(() => readRecoverableCaptureCount(page)).toBe(0);
  expect(await readPendingSequences(page)).toEqual([]);
  releaseSequenceZeroAck();
  await expect
    .poll(() => sequenceZeroAckCompleted, { timeout: 10_000 })
    .toBe(true);
  await page.waitForTimeout(500);
  expect(captureCancelled).toBe(true);
  expect(finishRequested).toBe(false);
  expect(await readRecoverableCaptureCount(page)).toBe(0);
  expect(await readPendingSequences(page)).toEqual([]);

  await page.getByLabel("录音名称").fill("取消时摘要仍在计算");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(
    page.getByText(/正在采集；本机保存、服务器确认和识别进度分开显示/),
  ).toBeVisible();
  await page.evaluate(() => {
    (
      window as typeof window & { __w11HoldNextDigest?: boolean }
    ).__w11HoldNextDigest = true;
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as typeof window & { __w11DigestStarted?: boolean })
              .__w11DigestStarted ?? false,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: /取消录音/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __w11AudioTracks?: MediaStreamTrack[][];
            }
          ).__w11AudioTracks
            ?.at(-1)
            ?.every((track) => track.readyState === "ended") ?? false,
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    (
      window as typeof window & { __w11ReleaseDigest?: () => void }
    ).__w11ReleaseDigest?.();
  });
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  await expect.poll(() => readRecoverableCaptureCount(page)).toBe(0);
  await expect.poll(() => readPendingSequences(page)).toEqual([]);
  expect(chunks).toEqual([]);
  expect(finishRequested).toBe(false);

  await page.getByLabel("录音名称").fill("同源配额耗尽测试");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(
    page.getByText(/正在采集；本机保存、服务器确认和识别进度分开显示/),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("matrix-law-speech-capture-outbox-v1");
        request.onerror = () =>
          reject(request.error ?? new Error("cannot open speech outbox"));
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("usage", "readwrite");
          transaction.objectStore("usage").put({
            scope: "__same_origin__",
            pendingBytes: 64 * 1024 * 1024 - 1,
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onabort = () =>
            reject(transaction.error ?? new Error("usage setup aborted"));
        };
      }),
  );
  await expect(
    page.getByText(/本机同源录音暂存达到 64 MiB 上限，录音已停止/),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __w11AudioTracks?: MediaStreamTrack[][];
            }
          ).__w11AudioTracks
            ?.at(-1)
            ?.every((track) => track.readyState === "ended") ?? false,
      ),
    )
    .toBe(true);
  expect(captureCancelled).toBe(true);
  expect(finishRequested).toBe(false);
  expect(chunks).toEqual([]);
  await expect.poll(() => readRecoverableCaptureCount(page)).toBe(0);
  await expect.poll(() => readPendingSequences(page)).toEqual([]);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("matrix-law-speech-capture-outbox-v1");
        request.onerror = () =>
          reject(request.error ?? new Error("cannot reset speech outbox"));
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("usage", "readwrite");
          transaction.objectStore("usage").put({
            scope: "__same_origin__",
            pendingBytes: 0,
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onabort = () =>
            reject(transaction.error ?? new Error("usage reset aborted"));
        };
      }),
  );

  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
  });
  await page.getByLabel("录音名称").fill("断网补传后切换账号");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(
    page.getByText(/正在采集；本机保存、服务器确认和识别进度分开显示/),
  ).toBeVisible();
  await expect
    .poll(() => readPendingSequences(page), { timeout: 10_000 })
    .toContain(0);
  expect(await readRecoverableCaptureCount(page)).toBe(1);
  expect(chunks).toEqual([]);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => true,
    });
    window.dispatchEvent(new Event("online"));
  });
  await expect
    .poll(() => chunks.length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  expect(finishRequested).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => false,
    });
  });
  await expect
    .poll(() => readPendingSequences(page), { timeout: 10_000 })
    .toContain(chunks.length);

  const identitySwitchRoute = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "second-user",
        email: "second@test.local",
        system_role: "user",
        needs_setup: false,
      }),
    });
  await page.route("**/api/v1/auth/me", identitySwitchRoute);
  const identityResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/v1/auth/me" && response.status() === 200;
  });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await identityResponse;
  await expect(
    page.getByRole("button", { name: /second@test\.local.*Settings and more/ }),
  ).toBeVisible();
  await expect.poll(() => readRecoverableCaptureCount(page)).toBe(0);
  await expect.poll(() => readPendingSequences(page)).toEqual([]);
  await expect.poll(() => captureCancelled).toBe(true);
  expect(finishRequested).toBe(false);
  const afterIdentitySwitchTracks = await page.evaluate(
    () =>
      (
        window as typeof window & { __w11AudioTracks?: MediaStreamTrack[][] }
      ).__w11AudioTracks
        ?.at(-1)
        ?.map((track) => track.readyState) ?? [],
  );
  expect(afterIdentitySwitchTracks.length).toBeGreaterThan(0);
  expect(afterIdentitySwitchTracks.every((state) => state === "ended")).toBe(
    true,
  );
  await page.unroute("**/api/v1/auth/me", identitySwitchRoute);

  await page.getByLabel("录音名称").fill("退出登录时清理待传录音");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(
    page.getByText(/正在采集；本机保存、服务器确认和识别进度分开显示/),
  ).toBeVisible();
  await expect
    .poll(() => readPendingSequences(page), { timeout: 10_000 })
    .toContain(0);
  expect(await readRecoverableCaptureCount(page)).toBe(1);
  expect(chunks).toEqual([]);

  captureCancelled = true;
  await page.evaluate(
    ({ tenantId, matterId }) =>
      window.dispatchEvent(
        new CustomEvent("matrix-law:matter-access-revoked", {
          detail: { tenantId, matterId },
        }),
      ),
    { tenantId, matterId },
  );
  await expect(
    page.getByText(/案件权限已撤销.*麦克风已停止，本机暂存已清除/),
  ).toBeVisible();
  await expect.poll(() => readRecoverableCaptureCount(page)).toBe(0);
  await expect.poll(() => readPendingSequences(page)).toEqual([]);
  const afterAccessRevocationTracks = await page.evaluate(
    () =>
      (
        window as typeof window & { __w11AudioTracks?: MediaStreamTrack[][] }
      ).__w11AudioTracks
        ?.at(-1)
        ?.map((track) => track.readyState) ?? [],
  );
  expect(afterAccessRevocationTracks.length).toBeGreaterThan(0);
  expect(afterAccessRevocationTracks.every((state) => state === "ended")).toBe(
    true,
  );

  await page
    .getByRole("button", {
      name: /second@test\.local.*Settings and more/,
    })
    .click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await settingsDialog.getByRole("button", { name: /Account|账号/ }).click();
  const logoutRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/auth/logout",
  );
  await settingsDialog
    .getByRole("button", { name: /Sign Out|退出登录/ })
    .click();
  await logoutRequest;
  await expect.poll(() => readRecoverableCaptureCount(page)).toBe(0);
  await expect.poll(() => readPendingSequences(page)).toEqual([]);
  await expect.poll(() => captureCancelled).toBe(true);
  expect(chunks).toEqual([]);
  expect(finishRequested).toBe(false);
  const afterLogoutTracks = await page.evaluate(
    () =>
      (
        window as typeof window & { __w11AudioTracks?: MediaStreamTrack[][] }
      ).__w11AudioTracks
        ?.at(-1)
        ?.map((track) => track.readyState) ?? [],
  );
  expect(afterLogoutTracks.length).toBeGreaterThan(0);
  expect(afterLogoutTracks.every((state) => state === "ended")).toBe(true);
});

test("pauses recovery for a corrupted encrypted PCM chunk", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== "chromium",
    "corrupted-cache probe is Chromium-only",
  );
  test.setTimeout(60_000);
  const corruptThreadId = "50000000-0000-4000-8000-000000000022";
  const corruptCaptureId = "40000000-0000-4000-8000-000000000022";
  const capturePath = `/api/law/tenants/${tenantId}/matters/${matterId}/speech-transcriptions/live-captures`;
  let captureStatus: "open" | "cancelled" = "open";
  let captureCreated = false;
  let chunkUploadCount = 0;
  let finishCount = 0;
  let cancelCount = 0;
  let captureListReadCount = 0;

  const captureRecord = () => ({
    id: corruptCaptureId,
    tenant_id: tenantId,
    matter_id: matterId,
    created_by_membership_id: membershipId,
    title: "损坏缓存合成测试",
    original_filename: "corrupt-cache.wav",
    media_type: "audio/wav",
    capture_protocol: "pcm_s16le_v1",
    limits: LEGACY_SPEECH_CAPTURE_LIMITS,
    audio_track_settings: {
      context_sample_rate: 16_000,
      track_sample_rate: null,
      track_channel_count: 1,
      track_sample_size: null,
      echo_cancellation: null,
      noise_suppression: null,
      auto_gain_control: null,
    },
    total_samples: 0,
    final_sequence_number: null,
    final_total_samples: null,
    preview_revision: 0,
    transcription_task_id: null,
    status: captureStatus,
    next_sequence_number: 0,
    total_byte_size: 0,
    expires_at: "2026-10-10T00:00:00Z",
    cleanup_pending: false,
    evidence_item_id: null,
    evidence_version_id: null,
    source_sha256: null,
    error_code: null,
    created_at: now,
    updated_at: now,
  });

  await page.context().grantPermissions(["microphone"]);
  await page.addInitScript(() => {
    let online = true;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => online,
    });
    (
      window as typeof window & {
        __w11SetOnline?: (value: boolean) => void;
      }
    ).__w11SetOnline = (value) => {
      online = value;
      window.dispatchEvent(new Event(value ? "online" : "offline"));
    };
    const key = "w11-corrupt-outbox-media-calls";
    let calls = Number(sessionStorage.getItem(key) ?? "0");
    const mediaDevices = navigator.mediaDevices;
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    mediaDevices.getUserMedia = async (...args) => {
      calls += 1;
      sessionStorage.setItem(key, String(calls));
      return original(...args);
    };
  });
  await page.context().route("**/api/**", (route) =>
    route.fulfill({
      status: 404,
      json: { detail: "Unmocked test endpoint" },
    }),
  );
  mockLangGraphAPI(page, {
    threads: [
      {
        thread_id: corruptThreadId,
        title: "损坏缓存合成测试",
        artifacts: [],
        messages: [
          {
            type: "ai",
            id: "synthetic-corrupt-cache-thread",
            content: "仅用于本机加密缓存恢复测试。",
          },
        ],
      },
    ],
  });
  await page.context().route("**/api/law/**", async (route: Route) => {
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
            thread_id: corruptThreadId,
          },
        }),
      );
    }
    if (path.endsWith(`/matters/${matterId}`))
      return route.fulfill(response({ matter: { title: "损坏缓存合成测试" } }));
    if (path.endsWith("/deadline-rules")) {
      return route.fulfill(response({ rules: [], calendars: [] }));
    }
    if (path.endsWith("/speech-transcriptions") && method === "GET") {
      return route.fulfill(
        response({
          items: [],
          transcription_available: true,
          supported_media_types: ["audio/wav"],
          live_capture_available: true,
          live_capture_media_types: ["audio/wav"],
        }),
      );
    }
    if (path === capturePath && method === "GET") {
      captureListReadCount += 1;
      return route.fulfill(
        response({
          items:
            captureCreated && captureStatus === "open" ? [captureRecord()] : [],
        }),
      );
    }
    if (path === capturePath && method === "POST") {
      captureCreated = true;
      await page.evaluate(() =>
        (
          window as typeof window & {
            __w11SetOnline?: (value: boolean) => void;
          }
        ).__w11SetOnline?.(false),
      );
      return route.fulfill(
        response(
          {
            ...captureRecord(),
            max_chunk_bytes: 65_536,
            max_total_bytes: 19_200_044,
            sample_rate: 16_000,
            channels: 1,
            max_samples: 9_600_000,
            transcription_available: true,
          },
          201,
        ),
      );
    }
    if (path === `${capturePath}/${corruptCaptureId}` && method === "GET")
      return route.fulfill(response(captureRecord()));
    if (
      path === `${capturePath}/${corruptCaptureId}/chunks` &&
      method === "GET"
    )
      return route.fulfill(response({ items: [], next_sequence_number: 0 }));
    if (
      path.startsWith(`${capturePath}/${corruptCaptureId}/chunks/`) &&
      method === "PUT"
    ) {
      chunkUploadCount += 1;
      return route.fulfill(
        response({ detail: "unexpected_chunk_upload" }, 500),
      );
    }
    if (
      path === `${capturePath}/${corruptCaptureId}/finish` &&
      method === "POST"
    ) {
      finishCount += 1;
      return route.fulfill(response({ detail: "unexpected_finish" }, 500));
    }
    if (
      path === `${capturePath}/${corruptCaptureId}/cancel` &&
      method === "POST"
    ) {
      cancelCount += 1;
      captureStatus = "cancelled";
      return route.fulfill(response(captureRecord()));
    }
    if (path === `${capturePath}/${corruptCaptureId}/preview`)
      return route.fulfill({ status: 204, body: "" });
    return route.fulfill(response({ items: [] }));
  });

  await page.goto(`/workspace/chats/${corruptThreadId}`);
  await page.getByRole("button", { name: /artifacts/i }).click();
  await expect(
    page.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
  await page.getByLabel("录音名称").fill("损坏缓存合成测试");
  await page.getByRole("button", { name: /开始麦克风录音/ }).click();
  await expect(
    page.getByText(/正在采集；本机保存、服务器确认和识别进度分开显示/),
  ).toBeVisible();
  await expect
    .poll(() => readPendingSequences(page), { timeout: 10_000 })
    .toContain(0);
  await expect(page.getByRole("button", { name: /停止并保存/ })).toBeVisible();
  await page.getByRole("button", { name: /停止并保存/ }).click();
  await expect(
    page.getByText(
      "已采集内容已加密保存到本机；联网并重新打开案件后会补传并完成保存。",
    ),
  ).toBeVisible();
  expect(chunkUploadCount).toBe(0);
  expect(finishCount).toBe(0);
  const mediaCallsBeforeReload = await page.evaluate(() =>
    Number(sessionStorage.getItem("w11-corrupt-outbox-media-calls") ?? "0"),
  );
  expect(mediaCallsBeforeReload).toBeGreaterThan(0);

  await page.evaluate(
    (sequenceNumber) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("matrix-law-speech-capture-outbox-v1");
        request.onerror = () =>
          reject(
            request.error ??
              new Error("cannot open outbox for corruption probe"),
          );
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("chunks", "readwrite");
          const store = transaction.objectStore("chunks");
          const read = store.getAll();
          read.onsuccess = () => {
            const record = (
              read.result as Array<{
                scope: string;
                sequenceNumber: number;
                ciphertext: ArrayBuffer;
              }>
            ).find(
              (chunk) =>
                chunk.scope !== "legacy-scope" &&
                chunk.sequenceNumber === sequenceNumber,
            );
            if (!record) {
              transaction.abort();
              reject(new Error("pending encrypted chunk was not found"));
              return;
            }
            const bytes = new Uint8Array(record.ciphertext.slice(0));
            bytes[0] = (bytes[0] ?? 0) ^ 0xff;
            record.ciphertext = bytes.buffer;
            store.put(record);
          };
          read.onerror = () => transaction.abort();
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onabort = () => {
            database.close();
            reject(transaction.error ?? new Error("corruption probe aborted"));
          };
        };
      }),
    0,
  );
  await page.reload();
  await expect(
    page.getByText(
      "本机录音加密暂存无法解密或完整性校验失败；已暂停补传，暂存未自动删除。请联系管理员处理。",
    ),
  ).toBeVisible({ timeout: 10_000 });
  expect(await readRecoverableCaptureCount(page)).toBe(1);
  expect(await readPendingSequences(page)).toContain(0);
  expect(chunkUploadCount).toBe(0);
  expect(finishCount).toBe(0);
  expect(
    await page.evaluate(() =>
      Number(sessionStorage.getItem("w11-corrupt-outbox-media-calls") ?? "0"),
    ),
  ).toBe(mediaCallsBeforeReload);

  const identitySwitchRoute = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "second-user",
        email: "second@test.local",
        system_role: "user",
        needs_setup: false,
      }),
    });
  await page.route("**/api/v1/auth/me", identitySwitchRoute);
  const identityResponse = page.waitForResponse((reply) => {
    const url = new URL(reply.url());
    return url.pathname === "/api/v1/auth/me" && reply.status() === 200;
  });
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await identityResponse;
  await expect(
    page.getByRole("button", { name: /second@test\.local.*Settings and more/ }),
  ).toBeVisible();
  await expect.poll(() => cancelCount).toBe(1);
  await expect.poll(() => readRecoverableCaptureCount(page)).toBe(0);
  await expect.poll(() => readPendingSequences(page)).toEqual([]);
  expect(chunkUploadCount).toBe(0);
  expect(finishCount).toBe(0);
  await page.unroute("**/api/v1/auth/me", identitySwitchRoute);

  const mediaCallsBeforeDatabaseFailure = await page.evaluate(() =>
    Number(sessionStorage.getItem("w11-corrupt-outbox-media-calls") ?? "0"),
  );
  const captureListReadsBeforeDatabaseFailure = captureListReadCount;
  await page.addInitScript(() => {
    const factory = indexedDB;
    const originalOpen = factory.open.bind(factory);
    Object.defineProperty(factory, "open", {
      configurable: true,
      value: (name: string, version?: number) => {
        if (name === "matrix-law-speech-capture-outbox-v1") {
          throw new DOMException(
            "synthetic database corruption",
            "UnknownError",
          );
        }
        return originalOpen(name, version);
      },
    });
  });
  await page.reload();
  await expect(
    page.getByText(
      "浏览器本机加密录音暂存无法打开；麦克风录音已关闭，未确认内容不会被当作已保存。请检查浏览器存储后重试。",
    ),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Number(sessionStorage.getItem("w11-corrupt-outbox-media-calls") ?? "0"),
    ),
  ).toBe(mediaCallsBeforeDatabaseFailure);
  expect(captureListReadCount).toBe(captureListReadsBeforeDatabaseFailure);
  expect(chunkUploadCount).toBe(0);
  expect(finishCount).toBe(0);
});

test("Chromium reports native IndexedDB quota exhaustion", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP quota injection is Chromium-only");
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const quotaSession = await page.context().newCDPSession(page);
  await quotaSession.send("Storage.overrideQuotaForOrigin", {
    origin,
    quotaSize: 1024,
  });
  const result = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const request = indexedDB.open("w11-native-quota-probe", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("payload");
        request.onerror = () =>
          resolve(request.error?.name ?? "IndexedDBOpenError");
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("payload", "readwrite");
          transaction
            .objectStore("payload")
            .put(new Uint8Array(65_536), "quota-probe");
          transaction.oncomplete = () => {
            database.close();
            resolve("complete");
          };
          transaction.onabort = () => {
            const error = transaction.error?.name ?? "AbortError";
            database.close();
            resolve(error);
          };
          transaction.onerror = () => undefined;
        };
      }),
  );
  expect(result).toBe("QuotaExceededError");
  await quotaSession.send("Storage.overrideQuotaForOrigin", {
    origin,
    quotaSize: 64 * 1024 * 1024,
  });
  await quotaSession.detach();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("w11-native-quota-probe");
        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(request.error ?? new Error("cannot remove quota probe"));
        request.onblocked = () => reject(new Error("quota probe is blocked"));
      }),
  );
});

test("fails closed across browsers when the encrypted capture database cannot open", async ({
  page,
}) => {
  const unavailableThreadId = "50000000-0000-4000-8000-000000000023";
  const capturePath = `/api/law/tenants/${tenantId}/matters/${matterId}/speech-transcriptions/live-captures`;
  let getUserMediaCalls = 0;
  let captureListReads = 0;
  let captureCreates = 0;
  let chunkWrites = 0;
  let finishCalls = 0;

  await page.addInitScript(() => {
    const factory = indexedDB;
    const factoryPrototype = Object.getPrototypeOf(factory);
    const originalOpen = factoryPrototype.open as IDBFactory["open"];
    Object.defineProperty(factoryPrototype, "open", {
      configurable: true,
      writable: true,
      value: function (this: IDBFactory, name: string, ...versions: [number?]) {
        if (name === "matrix-law-speech-capture-outbox-v1") {
          throw new DOMException(
            "synthetic outbox unavailable",
            "UnknownError",
          );
        }
        return originalOpen.call(this, name, ...versions);
      },
    });
    sessionStorage.setItem("w11-storage-open-media-calls", "0");
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices && typeof mediaDevices.getUserMedia === "function") {
      const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      mediaDevices.getUserMedia = async (...args) => {
        const calls =
          Number(
            sessionStorage.getItem("w11-storage-open-media-calls") ?? "0",
          ) + 1;
        sessionStorage.setItem("w11-storage-open-media-calls", String(calls));
        return originalGetUserMedia(...args);
      };
    }
  });
  await page.context().route("**/api/**", (route) =>
    route.fulfill({
      status: 404,
      json: { detail: "Unmocked test endpoint" },
    }),
  );
  mockLangGraphAPI(page, {
    threads: [
      {
        thread_id: unavailableThreadId,
        title: "本机录音存储不可用测试",
        artifacts: [],
        messages: [
          {
            type: "ai",
            id: "synthetic-outbox-unavailable-thread",
            content: "只验证浏览器存储不可用时录音入口关闭。",
          },
        ],
      },
    ],
  });
  await page.context().route("**/api/law/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
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
            thread_id: unavailableThreadId,
          },
        }),
      );
    }
    if (path.endsWith(`/matters/${matterId}`)) {
      return route.fulfill(
        response({ matter: { title: "本机录音存储不可用测试" } }),
      );
    }
    if (path.endsWith("/deadline-rules")) {
      return route.fulfill(response({ rules: [], calendars: [] }));
    }
    if (path === `${capturePath}` && method === "GET") {
      captureListReads += 1;
      return route.fulfill(response({ items: [] }));
    }
    if (path === `${capturePath}` && method === "POST") {
      captureCreates += 1;
      return route.fulfill(
        response({ detail: "capture_must_not_be_created" }, 500),
      );
    }
    if (path.startsWith(`${capturePath}/`) && method === "PUT") {
      chunkWrites += 1;
      return route.fulfill(
        response({ detail: "chunk_must_not_be_uploaded" }, 500),
      );
    }
    if (path.endsWith("/finish") && method === "POST") {
      finishCalls += 1;
      return route.fulfill(
        response({ detail: "finish_must_not_be_called" }, 500),
      );
    }
    if (path.endsWith("/speech-transcriptions") && method === "GET") {
      return route.fulfill(
        response({
          items: [],
          transcription_available: true,
          supported_media_types: ["audio/wav"],
          live_capture_available: true,
          live_capture_media_types: ["audio/wav"],
        }),
      );
    }
    return route.fulfill(response({ items: [] }));
  });

  await page.goto(`/workspace/chats/${unavailableThreadId}`);
  await page.getByRole("button", { name: /artifacts/i }).click();
  await expect(
    page.getByRole("heading", { name: "庭审录音与语音转写" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "浏览器本机加密录音暂存无法打开；麦克风录音已关闭，未确认内容不会被当作已保存。请检查浏览器存储后重试。",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /开始麦克风录音/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("音视频原件")).toBeVisible();
  getUserMediaCalls = await page.evaluate(() =>
    Number(sessionStorage.getItem("w11-storage-open-media-calls") ?? "0"),
  );
  expect(getUserMediaCalls).toBe(0);
  expect(captureListReads).toBe(0);
  expect(captureCreates).toBe(0);
  expect(chunkWrites).toBe(0);
  expect(finishCalls).toBe(0);
});
