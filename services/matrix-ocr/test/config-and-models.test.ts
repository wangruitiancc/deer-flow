import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { resolveModelPaths } from "../src/model-registry.js";

test("configuration fails closed without a sufficiently strong runtime token", () => {
  assert.throws(() => loadConfig({}), /at least 24 characters/);
  assert.throws(
    () =>
      loadConfig({
        MATRIX_OCR_HTTP_TOKEN: "x".repeat(24),
        MATRIX_OCR_MAX_PAGES: "0",
      }),
    /MATRIX_OCR_MAX_PAGES/,
  );
});

test("configuration defaults to loopback and bounded processing", () => {
  const config = loadConfig({ MATRIX_OCR_HTTP_TOKEN: "x".repeat(24) });
  assert.equal(config.bindHost, "127.0.0.1");
  assert.equal(config.port, 8090);
  assert.equal(config.maxPages, 100);
  assert.equal(config.intraOpThreads, 1);
  assert.equal(config.maxConcurrency, 1);
  assert.equal(config.processTimeoutSeconds, 300);
  assert.equal(config.structureEndpoint, "");
  assert.equal(config.structureMaxUploadBytes, 26_214_400);
});

test("structure sidecar configuration requires a clean origin and private token", () => {
  assert.throws(
    () =>
      loadConfig({
        MATRIX_OCR_HTTP_TOKEN: "x".repeat(24),
        MATRIX_STRUCTURE_ENDPOINT: "http://structure:8091/path",
        MATRIX_STRUCTURE_HTTP_TOKEN: "y".repeat(24),
      }),
    /origin/,
  );
  assert.throws(
    () =>
      loadConfig({
        MATRIX_OCR_HTTP_TOKEN: "x".repeat(24),
        MATRIX_STRUCTURE_ENDPOINT: "http://structure:8091",
      }),
    /MATRIX_STRUCTURE_HTTP_TOKEN/,
  );
  const config = loadConfig({
    MATRIX_OCR_HTTP_TOKEN: "x".repeat(24),
    MATRIX_STRUCTURE_ENDPOINT: "http://structure:8091/",
    MATRIX_STRUCTURE_HTTP_TOKEN: "y".repeat(24),
  });
  assert.equal(config.structureEndpoint, "http://structure:8091");
});

test("configuration rejects unsafe ONNX thread settings", () => {
  assert.throws(
    () =>
      loadConfig({
        MATRIX_OCR_HTTP_TOKEN: "x".repeat(24),
        MATRIX_OCR_INTRA_OP_THREADS: "0",
      }),
    /MATRIX_OCR_INTRA_OP_THREADS/,
  );
});

test("model registry validates size, hash, IDs and traversal", async () => {
  const root = await mkdtemp(join(tmpdir(), "matrix-ocr-models-"));
  try {
    const entries = ["det", "cls", "rec", "dict"].map((id) => {
      const content = Buffer.from(`${id}-model`);
      return {
        id,
        file: `${id}/${id}.bin`,
        url: `https://example.invalid/${id}`,
        sha256: createHash("sha256").update(content).digest("hex"),
        sizeBytes: content.length,
        content,
      };
    });
    for (const entry of entries) {
      const path = join(root, "models", entry.file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, entry.content);
    }
    const manifest = {
      version: "fixture-1",
      license: "Apache-2.0",
      models: entries.slice(0, 3).map(({ content: _content, ...entry }) => entry),
      dict: (({ content: _content, ...entry }) => entry)(entries[3]!),
    };
    await writeFile(
      join(root, "models.manifest.json"),
      JSON.stringify(manifest),
    );

    const paths = await resolveModelPaths(root);
    assert.equal(paths.version, "fixture-1");
    assert.match(paths.det, /det\.bin$/);

    manifest.models[0]!.file = "../escape.bin";
    await writeFile(
      join(root, "models.manifest.json"),
      JSON.stringify(manifest),
    );
    await assert.rejects(resolveModelPaths(root), /stay inside/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
