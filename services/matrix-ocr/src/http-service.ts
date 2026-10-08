import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { open, mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MATRIX_OCR_PROTOCOL_VERSION,
  MatrixOcrProcessorError,
  SUPPORTED_MEDIA_TYPES,
  type MatrixOcrProcessor,
  type SupportedMediaType,
} from "./contracts.js";
import type { MatrixOcrConfig } from "./config.js";

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type LogEvent = {
  request_id: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  byte_size?: number;
  page_count?: number;
  error_code?: string;
};

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

class WorkLimiter {
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxQueue: number,
  ) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) {
      return Promise.reject(new DOMException("Request aborted", "AbortError"));
    }
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve(this.releaseCallback());
    }
    if (this.waiters.length >= this.maxQueue) {
      return Promise.reject(
        new HttpError(503, "OCR_BUSY", "OCR service queue is full"),
      );
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new DOMException("Request aborted", "AbortError"));
        },
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private releaseCallback(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      while (this.waiters.length) {
        const waiter = this.waiters.shift()!;
        waiter.signal.removeEventListener("abort", waiter.onAbort);
        if (waiter.signal.aborted) continue;
        waiter.resolve(this.releaseCallback());
        return;
      }
      this.active -= 1;
    };
  }
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest) && supplied.length > 0;
}

function oneHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? undefined : value;
}

function requiredHeader(request: IncomingMessage, name: string): string {
  const value = oneHeader(request, name)?.trim();
  if (!value) {
    throw new HttpError(400, "INVALID_REQUEST", `Missing ${name} header`);
  }
  return value;
}

function booleanHeader(request: IncomingMessage, name: string): boolean {
  const value = requiredHeader(request, name);
  if (value === "true") return true;
  if (value === "false") return false;
  throw new HttpError(400, "INVALID_REQUEST", `${name} must be true or false`);
}

function parseProcessHeaders(request: IncomingMessage, maxBytes: number) {
  const mediaType = requiredHeader(request, "content-type").toLowerCase();
  if (!SUPPORTED_MEDIA_TYPES.includes(mediaType as SupportedMediaType)) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Unsupported OCR media type");
  }
  const rawLength = requiredHeader(request, "content-length");
  const byteSize = Number(rawLength);
  if (
    !Number.isSafeInteger(byteSize) ||
    byteSize < 1 ||
    byteSize > maxBytes ||
    String(byteSize) !== rawLength
  ) {
    throw new HttpError(413, "UPLOAD_LIMIT", "OCR source size is invalid");
  }
  const expectedSha256 = requiredHeader(
    request,
    "x-ocr-source-sha256",
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new HttpError(400, "INVALID_REQUEST", "OCR source SHA-256 is invalid");
  }
  const provider = requiredHeader(request, "x-ocr-provider");
  const language = requiredHeader(request, "x-ocr-language");
  if (provider.length > 64 || language.length > 32) {
    throw new HttpError(400, "INVALID_REQUEST", "OCR request metadata is invalid");
  }
  const attempt = Number(requiredHeader(request, "x-ocr-attempt"));
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 100) {
    throw new HttpError(400, "INVALID_REQUEST", "OCR attempt is invalid");
  }
  return {
    mediaType: mediaType as SupportedMediaType,
    byteSize,
    expectedSha256,
    language,
    enableTable: booleanHeader(request, "x-ocr-enable-table"),
    enableFormula: booleanHeader(request, "x-ocr-enable-formula"),
  };
}

async function receiveSource(input: {
  request: IncomingMessage;
  path: string;
  expectedBytes: number;
  expectedSha256: string;
  maxBytes: number;
  signal: AbortSignal;
}): Promise<void> {
  const handle = await open(input.path, "wx", 0o600);
  const hasher = createHash("sha256");
  let received = 0;
  try {
    for await (const rawChunk of input.request) {
      if (input.signal.aborted) {
        throw new DOMException("Request aborted", "AbortError");
      }
      const chunk = Buffer.isBuffer(rawChunk)
        ? rawChunk
        : Buffer.from(rawChunk as Uint8Array);
      received += chunk.length;
      if (received > input.maxBytes || received > input.expectedBytes) {
        throw new HttpError(413, "UPLOAD_LIMIT", "OCR source exceeds declared size");
      }
      hasher.update(chunk);
      await handle.write(chunk);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (received !== input.expectedBytes) {
    throw new HttpError(400, "SOURCE_MISMATCH", "OCR source size mismatch");
  }
  if (hasher.digest("hex") !== input.expectedSha256) {
    throw new HttpError(400, "SOURCE_MISMATCH", "OCR source SHA-256 mismatch");
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  requestId: string,
  body: unknown,
): void {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": payload.length,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Request-ID": requestId,
  });
  response.end(payload);
}

export function createMatrixOcrHttpService(input: {
  config: MatrixOcrConfig;
  processor: MatrixOcrProcessor;
  log?: (event: LogEvent) => void;
}) {
  const limiter = new WorkLimiter(
    input.config.maxConcurrency,
    input.config.maxQueue,
  );
  const log = input.log ?? (() => undefined);
  return createServer(async (request, response) => {
    const requestId = randomUUID();
    const started = performance.now();
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    let status = 500;
    let byteSize: number | undefined;
    let pageCount: number | undefined;
    let errorCode: string | undefined;
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    request.once("aborted", abort);
    response.once("close", () => {
      if (!response.writableEnded) abort();
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      abort();
    }, input.config.processTimeoutSeconds * 1_000);
    timeout.unref();
    let release: (() => void) | undefined;
    let workDir: string | undefined;
    try {
      if (path !== "/v1/ocr/health" && path !== "/v1/ocr/process") {
        throw new HttpError(404, "NOT_FOUND", "Route not found");
      }
      if (
        !tokenMatches(
          oneHeader(request, "authorization"),
          input.config.token,
        )
      ) {
        throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
      }
      if (path === "/v1/ocr/health") {
        if (request.method !== "GET") {
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
        }
        const ready = await input.processor.checkReady();
        const capabilities = await input.processor.getCapabilities?.();
        status = ready ? 200 : 503;
        sendJson(response, status, requestId, {
          status: ready ? "ready" : "not_ready",
          version: MATRIX_OCR_PROTOCOL_VERSION,
          model_version: input.processor.modelVersion,
          capabilities: {
            pdf: true,
            image: true,
            table_structure: capabilities?.tableStructure ?? false,
            formula_structure: capabilities?.formulaStructure ?? false,
          },
        });
        return;
      }
      if (request.method !== "POST") {
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      }
      const headers = parseProcessHeaders(request, input.config.maxUploadBytes);
      byteSize = headers.byteSize;
      release = await limiter.acquire(controller.signal);
      workDir = await mkdtemp(
        join(input.config.tempRoot ?? tmpdir(), "matrix-ocr-"),
      );
      const sourcePath = join(workDir, "source.bin");
      await receiveSource({
        request,
        path: sourcePath,
        expectedBytes: headers.byteSize,
        expectedSha256: headers.expectedSha256,
        maxBytes: input.config.maxUploadBytes,
        signal: controller.signal,
      });
      const result = await input.processor.process({
        sourcePath,
        mediaType: headers.mediaType,
        language: headers.language,
        enableTable: headers.enableTable,
        enableFormula: headers.enableFormula,
        signal: controller.signal,
        workDir,
      });
      pageCount = result.pages.length;
      status = 200;
      sendJson(response, status, requestId, result);
    } catch (error) {
      const httpError =
        error instanceof HttpError
          ? error
          : error instanceof MatrixOcrProcessorError
            ? new HttpError(error.status, error.code, error.message)
          : controller.signal.aborted
            ? timedOut
              ? new HttpError(504, "OCR_TIMEOUT", "OCR processing timed out")
              : new HttpError(499, "REQUEST_ABORTED", "OCR request was aborted")
            : new HttpError(500, "OCR_FAILED", "OCR processing failed");
      status = httpError.status;
      errorCode = httpError.code;
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, status, requestId, {
          error: { code: httpError.code, message: httpError.message },
        });
      }
    } finally {
      clearTimeout(timeout);
      request.removeListener("aborted", abort);
      release?.();
      if (workDir) await rm(workDir, { recursive: true, force: true });
      log({
        request_id: requestId,
        method: request.method ?? "UNKNOWN",
        path,
        status,
        duration_ms: Math.round(performance.now() - started),
        byte_size: byteSize,
        page_count: pageCount,
        error_code: errorCode,
      });
    }
  });
}

export { HttpError, WorkLimiter, parseProcessHeaders, tokenMatches };
