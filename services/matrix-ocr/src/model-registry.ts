import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestEntry {
  id: string;
  file: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  extractCharacterDict?: boolean;
}

interface ModelManifest {
  version: string;
  license: string;
  models: ManifestEntry[];
  dict: ManifestEntry;
}

export interface MatrixOcrModelPaths {
  version: string;
  det: string;
  cls: string;
  rec: string;
  dict: string;
}

const HASH = /^[a-f0-9]{64}$/;
const IDS = ["det", "cls", "rec", "dict"] as const;

function safeChild(root: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath)) {
    throw new Error("model manifest paths must be relative");
  }
  const normalized = normalize(relativePath);
  if (normalized === ".." || normalized.startsWith(`..${sep}`)) {
    throw new Error("model manifest paths must stay inside the model root");
  }
  const target = resolve(root, normalized);
  const prefix = `${resolve(root)}${sep}`;
  if (!target.startsWith(prefix)) {
    throw new Error("model manifest paths must stay inside the model root");
  }
  return target;
}

async function sha256(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

function validateEntry(entry: ManifestEntry): void {
  if (
    !entry ||
    typeof entry.id !== "string" ||
    typeof entry.file !== "string" ||
    typeof entry.url !== "string" ||
    !HASH.test(entry.sha256) ||
    !Number.isSafeInteger(entry.sizeBytes) ||
    entry.sizeBytes <= 0
  ) {
    throw new Error("model manifest contains an invalid entry");
  }
}

export async function resolveModelPaths(
  resourcesRoot: string,
): Promise<MatrixOcrModelPaths> {
  const manifestPath = join(resourcesRoot, "models.manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ModelManifest;
  if (
    !manifest.version?.trim() ||
    manifest.license !== "Apache-2.0" ||
    !Array.isArray(manifest.models)
  ) {
    throw new Error("model manifest metadata is invalid");
  }
  const entries = [...manifest.models, manifest.dict];
  const byId = new Map<string, ManifestEntry>();
  for (const entry of entries) {
    validateEntry(entry);
    if (byId.has(entry.id)) throw new Error("model manifest IDs must be unique");
    byId.set(entry.id, entry);
  }
  for (const id of IDS) {
    if (!byId.has(id)) throw new Error(`model manifest is missing ${id}`);
  }
  const modelsDir = join(resourcesRoot, "models");
  const resolved = new Map<string, string>();
  for (const id of IDS) {
    const entry = byId.get(id)!;
    const path = safeChild(modelsDir, entry.file);
    const fileStat = await stat(path);
    if (!fileStat.isFile() || fileStat.size !== entry.sizeBytes) {
      throw new Error(`model file ${id} failed size validation`);
    }
    if ((await sha256(path)) !== entry.sha256) {
      throw new Error(`model file ${id} failed SHA-256 validation`);
    }
    resolved.set(id, path);
  }
  return {
    version: manifest.version,
    det: resolved.get("det")!,
    cls: resolved.get("cls")!,
    rec: resolved.get("rec")!,
    dict: resolved.get("dict")!,
  };
}

async function main(): Promise<void> {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const resourcesRoot = resolve(thisDir, "../resources");
  const models = await resolveModelPaths(resourcesRoot);
  process.stdout.write(`Matrix OCR models verified: ${models.version}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `Matrix OCR model verification failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
