import type { Message } from "@langchain/langgraph-sdk";

export type WorkspaceAttachment = { filename: string; path: string };

// Use structured upload metadata only. Text inside documents/messages is not a
// material binding, and a filename match cannot associate a project evidence ID.
export function workspaceAttachments(
  messages: Message[],
): WorkspaceAttachment[] {
  const files = new Map<string, WorkspaceAttachment>();
  for (const message of messages) {
    if (message.type !== "human") continue;
    const rows: unknown = message.additional_kwargs?.files;
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const file = row as Record<string, unknown>;
      if (
        typeof file.path !== "string" ||
        typeof file.filename !== "string" ||
        file.status === "uploading"
      )
        continue;
      if (
        !file.path.startsWith("/mnt/user-data/uploads/") ||
        file.path.split("/").some((part) => part === ".." || part === ".")
      )
        continue;
      files.set(file.path, { path: file.path, filename: file.filename });
    }
  }
  return [...files.values()];
}
