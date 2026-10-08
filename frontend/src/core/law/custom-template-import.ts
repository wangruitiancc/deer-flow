import { MAX_CUSTOM_TEMPLATE_BYTES } from "./custom-templates";

export type TemplateImportDiagnostic = {
  placeholder: string;
  kind: "variable" | "date-format" | "preserved";
  count: number;
};
export type TemplateImportPreview = {
  filename: string;
  suggestedName: string;
  content: string;
  sha256: string;
  byteSize: number;
  bom: boolean;
  diagnostics: TemplateImportDiagnostic[];
  omittedDiagnostics: number;
};

// Exactly the old placeholder grammar. Diagnostics never evaluate the template.
const recognized = /^\{\{\s*(title|date|time|case)\s*(?::([^}]*))?\}\}$/;

export async function previewTemplateImport(
  file: File,
  signal?: AbortSignal,
): Promise<TemplateImportPreview> {
  signal?.throwIfAborted();
  if (
    !/\.(md|markdown)$/i.test(file.name) ||
    file.name.startsWith(".") ||
    /[\\/\u0000-\u001f\u007f]/.test(file.name)
  )
    throw new Error(
      "请选择非隐藏的 .md 或 .markdown 模板文件，不接受路径或其他文件类型。",
    );
  if (file.size > MAX_CUSTOM_TEMPLATE_BYTES)
    throw new Error("模板不能超过 64 KiB；不会截断导入。");
  const buffer = await file.arrayBuffer();
  signal?.throwIfAborted();
  if (
    buffer.byteLength !== file.size ||
    buffer.byteLength > MAX_CUSTOM_TEMPLATE_BYTES
  )
    throw new Error("文件大小不一致或超过 64 KiB，请重新选择。");
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      buffer,
    );
  } catch {
    throw new Error(
      "模板不是有效 UTF-8；请保留原件并另存 UTF-8 后重试，不会猜测编码。",
    );
  }
  if (content.includes("\0")) throw new Error("模板含 NUL 字符，不能导入。");
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  signal?.throwIfAborted();
  const all = new Map<string, TemplateImportDiagnostic>();
  for (const match of content.matchAll(/\{\{[^{}]*\}\}/g)) {
    const placeholder = match[0];
    const known = recognized.exec(placeholder);
    const previous = all.get(placeholder);
    if (previous) previous.count++;
    else
      all.set(placeholder, {
        placeholder,
        kind: !known
          ? "preserved"
          : ["date", "time"].includes(known[1]!)
            ? "date-format"
            : "variable",
        count: 1,
      });
  }
  return {
    filename: file.name,
    suggestedName: file.name.replace(/\.(md|markdown)$/i, ""),
    content,
    sha256: Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
    byteSize: buffer.byteLength,
    bom: content.startsWith("\ufeff"),
    diagnostics: [...all.values()].slice(0, 20),
    omittedDiagnostics: Math.max(0, all.size - 20),
  };
}
