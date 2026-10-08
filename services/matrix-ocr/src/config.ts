import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface MatrixOcrConfig {
  bindHost: string;
  port: number;
  token: string;
  maxUploadBytes: number;
  maxPages: number;
  dpi: number;
  intraOpThreads: number;
  maxConcurrency: number;
  maxQueue: number;
  resourcesRoot: string;
  tempRoot?: string;
  processTimeoutSeconds: number;
  structureEndpoint: string;
  structureToken: string;
  structureRequestTimeoutSeconds: number;
  structureMaxResponseBytes: number;
  structureMaxUploadBytes: number;
}

function integerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): MatrixOcrConfig {
  const token = env.MATRIX_OCR_HTTP_TOKEN?.trim() ?? "";
  if (token.length < 24) {
    throw new Error("MATRIX_OCR_HTTP_TOKEN must contain at least 24 characters");
  }
  const structureEndpoint = env.MATRIX_STRUCTURE_ENDPOINT?.trim() ?? "";
  const structureToken = env.MATRIX_STRUCTURE_HTTP_TOKEN?.trim() ?? "";
  if (structureEndpoint) {
    const parsed = new URL(structureEndpoint);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/"
    ) {
      throw new Error("MATRIX_STRUCTURE_ENDPOINT must be an HTTP(S) origin");
    }
    if (structureToken.length < 24) {
      throw new Error(
        "MATRIX_STRUCTURE_HTTP_TOKEN must contain at least 24 characters when the sidecar is configured",
      );
    }
  }
  return {
    bindHost: env.MATRIX_OCR_BIND_HOST?.trim() || "127.0.0.1",
    port: integerEnv(env, "MATRIX_OCR_PORT", 8090, 1, 65_535),
    token,
    maxUploadBytes: integerEnv(
      env,
      "MATRIX_OCR_MAX_UPLOAD_BYTES",
      52_428_800,
      1,
      536_870_912,
    ),
    maxPages: integerEnv(env, "MATRIX_OCR_MAX_PAGES", 100, 1, 2_000),
    dpi: integerEnv(env, "MATRIX_OCR_DPI", 200, 72, 400),
    intraOpThreads: integerEnv(
      env,
      "MATRIX_OCR_INTRA_OP_THREADS",
      1,
      1,
      64,
    ),
    maxConcurrency: integerEnv(
      env,
      "MATRIX_OCR_MAX_CONCURRENCY",
      1,
      1,
      32,
    ),
    maxQueue: integerEnv(env, "MATRIX_OCR_MAX_QUEUE", 8, 0, 1_000),
    resourcesRoot: resolve(
      env.MATRIX_OCR_RESOURCES_ROOT?.trim() ||
        fileURLToPath(new URL("../resources", import.meta.url)),
    ),
    tempRoot: env.MATRIX_OCR_TEMP_ROOT?.trim() || undefined,
    processTimeoutSeconds: integerEnv(
      env,
      "MATRIX_OCR_PROCESS_TIMEOUT_SECONDS",
      300,
      10,
      7_200,
    ),
    structureEndpoint: structureEndpoint.replace(/\/$/, ""),
    structureToken,
    structureRequestTimeoutSeconds: integerEnv(
      env,
      "MATRIX_STRUCTURE_REQUEST_TIMEOUT_SECONDS",
      180,
      10,
      3_600,
    ),
    structureMaxResponseBytes: integerEnv(
      env,
      "MATRIX_STRUCTURE_MAX_RESPONSE_BYTES",
      10_485_760,
      1_024,
      134_217_728,
    ),
    structureMaxUploadBytes: integerEnv(
      env,
      "MATRIX_STRUCTURE_MAX_UPLOAD_BYTES",
      26_214_400,
      1_024,
      134_217_728,
    ),
  };
}
