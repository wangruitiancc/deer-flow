import { fetch } from "@/core/api/fetcher";
import { urlOfArtifact } from "@/core/artifacts/utils";

import { LawRequestError, sha256Hex } from "./api";

export const MAX_PROJECT_ARTIFACT_BYTES = 50 * 1024 * 1024;

export function isFormalProjectArtifact(path: string): boolean {
  return (
    path.startsWith("/mnt/user-data/outputs/") &&
    !path.includes("\\") &&
    !/[\u0000-\u001f]/.test(path) &&
    path
      .split("/")
      .slice(1)
      .every((part) => {
        let decoded = part;
        try {
          decoded = decodeURIComponent(part);
        } catch {
          return false;
        }
        return (
          decoded !== "" &&
          decoded !== "." &&
          decoded !== ".." &&
          !/[\\/\u0000-\u001f]/.test(decoded)
        );
      })
  );
}

export async function loadProjectArtifactSource(input: {
  threadId: string;
  filepath: string;
  expectedSha256?: string;
  signal?: AbortSignal;
  maxBytes?: number;
  allowEmpty?: boolean;
}): Promise<{ file: File; sha256: string }> {
  const maxBytes = input.maxBytes ?? MAX_PROJECT_ARTIFACT_BYTES;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > MAX_PROJECT_ARTIFACT_BYTES
  )
    throw new Error("无效的文件读取上限。");
  const sizeError =
    maxBytes === MAX_PROJECT_ARTIFACT_BYTES
      ? "项目成果不能超过 50 MiB。"
      : `文件不能超过 ${maxBytes} 字节。`;
  if (!isFormalProjectArtifact(input.filepath))
    throw new Error("只能保存已生成的正式成果文件。");
  const response = await fetch(
    urlOfArtifact({
      threadId: input.threadId,
      filepath: input.filepath,
      download: true,
    }),
    {
      signal: input.signal,
      cache: "no-store",
    },
  );
  if (response.status !== 200 || response.headers.has("Content-Range")) {
    await response.body?.cancel();
    throw new LawRequestError(
      "未能读取完整成果，请刷新文件后重试。",
      response.status,
    );
  }
  const length = Number(response.headers.get("Content-Length"));
  if (length > maxBytes) {
    await response.body?.cancel();
    throw new Error(sizeError);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("成果内容不可用。");
  const parts: ArrayBuffer[] = [];
  let size = 0;
  try {
    for (;;) {
      input.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(sizeError);
      parts.push(new Uint8Array(value).buffer);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if ((!size && !input.allowEmpty) || (length > 0 && length !== size))
    throw new Error("成果文件为空或读取不完整。");
  const name = input.filepath.split("/").at(-1)!;
  const type = name.endsWith(".md")
    ? "text/markdown"
    : (
        response.headers.get("Content-Type") ?? "application/octet-stream"
      ).split(";")[0]!;
  const file = new File(parts, name, { type });
  const sha256 = await sha256Hex(file);
  const etag = response.headers.get("ETag")?.replace(/^"|"$/g, "");
  if (
    (etag && /^[a-f0-9]{64}$/.test(etag) && etag !== sha256) ||
    (input.expectedSha256 && input.expectedSha256 !== sha256)
  ) {
    throw new LawRequestError(
      "成果文件已变化，请刷新预览并确认后再保存。",
      409,
      "SOURCE_CHANGED",
    );
  }
  input.signal?.throwIfAborted();
  return { file, sha256 };
}
