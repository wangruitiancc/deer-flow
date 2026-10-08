import {
  readCustomTemplateVersion,
  saveCustomTemplate,
} from "./custom-templates";

export async function createBlankCustomTemplate(input: {
  tenantId: string;
  name: string;
  visibility: "private" | "shared";
  idempotencyKey: string;
  signal?: AbortSignal;
}) {
  const name = input.name.trim();
  if (
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      new TextEncoder().encode(name),
    ) !== name
  )
    throw new Error("模板名称须为有效 UTF-8 文本。");
  const receipt = await saveCustomTemplate({
    tenantId: input.tenantId,
    name,
    content: "",
    visibility: input.visibility,
    idempotencyKey: input.idempotencyKey,
    signal: input.signal,
  });
  input.signal?.throwIfAborted();
  if (receipt.version !== 1 || receipt.current_version_number !== 1)
    throw new Error("新建回执不是模板第一版，请核验目录；创建结果未确认。");
  const stored = await readCustomTemplateVersion(
    input.tenantId,
    receipt.template_id,
    1,
    input.signal,
  );
  if (stored.content !== "" || stored.version.byte_size !== 0)
    throw new Error("第一版回读不是空白正文，请核验目录；创建结果未确认。");
  return receipt;
}
