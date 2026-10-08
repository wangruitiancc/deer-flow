#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const serviceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const resourcesRoot = join(serviceRoot, "resources");
const modelsRoot = join(resourcesRoot, "models");
const manifestPath = join(resourcesRoot, "models.manifest.json");
const force = process.argv.includes("--force");

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function extractCharacterDict(yaml) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*character_dict:\s*$/.test(line));
  if (start < 0) throw new Error("inference.yml has no character_dict");
  const characters = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^\s*- (.*)$/.exec(lines[index]);
    if (!match) {
      if (!lines[index].trim()) continue;
      break;
    }
    let value = match[1];
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1).replaceAll("''", "'");
    }
    characters.push(value);
  }
  if (!characters.length) throw new Error("character_dict is empty");
  return `${characters.join("\n")}\n`;
}

async function verify(path, entry) {
  const fileStat = await stat(path);
  if (fileStat.size !== entry.sizeBytes) {
    throw new Error(`${entry.id}: size mismatch`);
  }
  if ((await sha256(path)) !== entry.sha256) {
    throw new Error(`${entry.id}: SHA-256 mismatch`);
  }
}

async function download(entry) {
  const destination = join(modelsRoot, entry.file);
  if (!force) {
    try {
      await verify(destination, entry);
      process.stdout.write(`verified ${entry.id}\n`);
      return;
    } catch {
      // Missing or invalid files are replaced only after a verified download.
    }
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.download`;
  await rm(temporary, { force: true });
  const response = await fetch(entry.url, {
    redirect: "follow",
    headers: { "User-Agent": "Matrix-Law-Private-OCR-Builder/0.1" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`${entry.id}: download returned HTTP ${response.status}`);
  }
  if (entry.extractCharacterDict) {
    const yaml = await response.text();
    await writeFile(temporary, extractCharacterDict(yaml), {
      encoding: "utf8",
      mode: 0o600,
    });
  } else {
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporary, { mode: 0o600 }),
    );
  }
  try {
    await verify(temporary, entry);
    await rename(temporary, destination);
    process.stdout.write(`downloaded and verified ${entry.id}\n`);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const entries = [...manifest.models, manifest.dict];
  for (const entry of entries) await download(entry);
}

void main().catch((error) => {
  process.stderr.write(
    `Matrix OCR model download failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
