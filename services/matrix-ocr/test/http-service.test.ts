import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type { MatrixOcrConfig } from "../src/config.js";
import {
  MATRIX_OCR_PROTOCOL_VERSION,
  MatrixOcrProcessorError,
  type MatrixOcrProcessInput,
  type MatrixOcrProcessor,
  type MatrixOcrResponse,
} from "../src/contracts.js";
import { createMatrixOcrHttpService, WorkLimiter } from "../src/http-service.js";

const TOKEN = "test-only-token-with-32-characters";

const CONFIG: MatrixOcrConfig = {
  bindHost: "127.0.0.1",
  port: 0,
  token: TOKEN,
  maxUploadBytes: 1_024,
  maxPages: 5,
  dpi: 72,
  intraOpThreads: 1,
  maxConcurrency: 1,
  maxQueue: 1,
  resourcesRoot: "/not-used",
  processTimeoutSeconds: 30,
  structureEndpoint: "",
  structureToken: "",
  structureRequestTimeoutSeconds: 180,
  structureMaxResponseBytes: 10_485_760,
  structureMaxUploadBytes: 26_214_400,
};

class FakeProcessor implements MatrixOcrProcessor {
  readonly modelVersion = "fixture-model";
  calls: Array<{ body: Buffer; input: MatrixOcrProcessInput }> = [];
  fail = false;
  waitForAbort = false;
  processorError: MatrixOcrProcessorError | undefined;

  async checkReady(): Promise<boolean> {
    return true;
  }

  async process(input: MatrixOcrProcessInput): Promise<MatrixOcrResponse> {
    const body = await readFile(input.sourcePath);
    this.calls.push({ body, input });
    if (this.processorError) throw this.processorError;
    if (this.fail) throw new Error(`provider leaked: ${body.toString("utf8")}`);
    if (this.waitForAbort) {
      await new Promise<never>((_resolve, reject) => {
        const fail = () => reject(new Error("provider cancellation detail"));
        if (input.signal.aborted) fail();
        else input.signal.addEventListener("abort", fail, { once: true });
      });
    }
    return {
      version: MATRIX_OCR_PROTOCOL_VERSION,
      model_version: this.modelVersion,
      pages: [
        {
          physical_page_number: 1,
          scan_page_number: 1,
          printed_page_label: null,
          width_points: 100,
          height_points: 200,
          rotation_degrees: 0,
          text: "synthetic output",
          blocks: [],
        },
      ],
    };
  }

  async close(): Promise<void> {}
}

async function withService(
  processor: FakeProcessor,
  run: (baseUrl: string) => Promise<void>,
  config: MatrixOcrConfig = CONFIG,
): Promise<void> {
  const service = createMatrixOcrHttpService({ config, processor });
  await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
  const address = service.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      service.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function processHeaders(body: Buffer): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "image/png",
    "X-OCR-Source-SHA256": createHash("sha256").update(body).digest("hex"),
    "X-OCR-Provider": "local_ppv6",
    "X-OCR-Language": "zh",
    "X-OCR-Enable-Table": "true",
    "X-OCR-Enable-Formula": "false",
    "X-OCR-Attempt": "1",
  };
}

test("health is authenticated, private and exposes bounded capabilities", async () => {
  await withService(new FakeProcessor(), async (baseUrl) => {
    const anonymous = await fetch(`${baseUrl}/v1/ocr/health`);
    assert.equal(anonymous.status, 401);

    const response = await fetch(`${baseUrl}/v1/ocr/health`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await response.json(), {
      status: "ready",
      version: MATRIX_OCR_PROTOCOL_VERSION,
      model_version: "fixture-model",
      capabilities: {
        pdf: true,
        image: true,
        table_structure: false,
        formula_structure: false,
      },
    });
  });
});

test("process verifies the immutable source and never returns input bytes", async () => {
  const processor = new FakeProcessor();
  await withService(processor, async (baseUrl) => {
    const body = Buffer.from("private fixture bytes");
    const response = await fetch(`${baseUrl}/v1/ocr/process`, {
      method: "POST",
      headers: processHeaders(body),
      body,
    });
    assert.equal(response.status, 200);
    const payload = JSON.stringify(await response.json());
    assert.match(payload, /synthetic output/);
    assert.doesNotMatch(payload, /private fixture bytes/);
    assert.equal(processor.calls.length, 1);
    assert.deepEqual(processor.calls[0]!.body, body);
    assert.equal(processor.calls[0]!.input.enableTable, true);
  });
});

test("digest mismatch fails before OCR and provider failures are sanitized", async () => {
  const processor = new FakeProcessor();
  await withService(processor, async (baseUrl) => {
    const body = Buffer.from("private fixture bytes");
    const badHeaders = processHeaders(body);
    badHeaders["X-OCR-Source-SHA256"] = "0".repeat(64);
    const mismatch = await fetch(`${baseUrl}/v1/ocr/process`, {
      method: "POST",
      headers: badHeaders,
      body,
    });
    assert.equal(mismatch.status, 400);
    assert.equal(processor.calls.length, 0);

    processor.fail = true;
    const failed = await fetch(`${baseUrl}/v1/ocr/process`, {
      method: "POST",
      headers: processHeaders(body),
      body,
    });
    assert.equal(failed.status, 500);
    const payload = JSON.stringify(await failed.json());
    assert.match(payload, /OCR processing failed/);
    assert.doesNotMatch(payload, /private fixture bytes|provider leaked/);
  });
});

test("structure unavailability remains a sanitized 503 instead of degrading", async () => {
  const processor = new FakeProcessor();
  processor.processorError = new MatrixOcrProcessorError(
    503,
    "STRUCTURE_UNAVAILABLE",
    "Requested document structure analysis is unavailable",
  );
  await withService(processor, async (baseUrl) => {
    const body = Buffer.from("private fixture bytes");
    const response = await fetch(`${baseUrl}/v1/ocr/process`, {
      method: "POST",
      headers: processHeaders(body),
      body,
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: "STRUCTURE_UNAVAILABLE",
        message: "Requested document structure analysis is unavailable",
      },
    });
  });
});

test("processing timeout is reported as a sanitized gateway timeout", async () => {
  const processor = new FakeProcessor();
  processor.waitForAbort = true;
  await withService(
    processor,
    async (baseUrl) => {
      const body = Buffer.from("private fixture bytes");
      const response = await fetch(`${baseUrl}/v1/ocr/process`, {
        method: "POST",
        headers: processHeaders(body),
        body,
      });
      assert.equal(response.status, 504);
      const payload = JSON.stringify(await response.json());
      assert.match(payload, /OCR processing timed out/);
      assert.doesNotMatch(payload, /provider cancellation detail|private fixture/);
    },
    { ...CONFIG, processTimeoutSeconds: 0.01 },
  );
});

test("work limiter bounds active work and rejects a full queue", async () => {
  const limiter = new WorkLimiter(1, 1);
  const first = await limiter.acquire(new AbortController().signal);
  const secondPromise = limiter.acquire(new AbortController().signal);
  await assert.rejects(
    limiter.acquire(new AbortController().signal),
    /queue is full/,
  );
  first();
  const second = await secondPromise;
  second();
});

test("an aborted queued request is removed and does not consume capacity", async () => {
  const limiter = new WorkLimiter(1, 1);
  const first = await limiter.acquire(new AbortController().signal);
  const queuedController = new AbortController();
  const abandoned = limiter.acquire(queuedController.signal);
  queuedController.abort();
  await assert.rejects(abandoned, /aborted/);

  const replacementPromise = limiter.acquire(new AbortController().signal);
  first();
  const replacement = await replacementPromise;
  replacement();
});
