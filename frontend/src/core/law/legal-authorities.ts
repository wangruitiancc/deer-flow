import { z } from "zod";

export const MAX_LEGAL_AUTHORITIES_BYTES = 2 * 1024 * 1024;
export const LEGAL_AUTHORITIES_ERROR =
  "法律依据文件无效、来源摘要不符或超过 2 MiB。请检查原始 JSON；不会自动修补、截断或丢弃条目。";

export function isLegalAuthoritiesFile(path: string): boolean {
  return path.toLowerCase().endsWith(".law-authorities.json");
}

// Python str.strip whitespace (BOM is content), with code-point rather than UTF-16 limits.
const blank =
  /^[\t\n\r \x85\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u;
const text = (max: number, allowBlank = false) =>
  z
    .string()
    .refine(
      (value) =>
        (allowBlank || !blank.test(value)) &&
        [...value].length <= max &&
        !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value) &&
        ![...value].some(
          (char) => char.length === 1 && /[\ud800-\udfff]/u.test(char),
        ),
    );
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
const sha = z.string().regex(/^[0-9a-f]{64}$/);

function validDate(value: string): boolean {
  if (value !== value.trim()) return false;
  if (!/^[0-9]{4}(-[0-9]{2}){0,2}$/.test(value)) return false;
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1]!
  );
}
const date = z
  .object({ value: text(10).refine(validDate), basis: text(2000) })
  .strict();
const timestamp = text(40).refine((value) => {
  if (value !== value.trim()) return false;
  if (
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.test(
      value,
    )
  )
    return false;
  return validDate(value.slice(0, 10));
});
const webUrl = text(2048).refine((value) => {
  if (/[\s\x85\\]/u.test(value) || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
});
const textSource = z
  .object({
    id,
    kind: z.enum(["legacy_excerpt", "manual"]),
    text: text(100_000),
    text_sha256: sha,
    reference: text(2000).nullish(),
    legacy_id: text(200).nullish(),
    catalog_sha256: sha.nullish(),
  })
  .strict();
export const legacyLawRefSchema = z
  .object({
    articleId: text(200, true).nullish(),
    code: text(500),
    article: text(200),
    text: text(100_000, true).nullish(),
    source: text(2000, true).nullish(),
    origin: z.enum(["manual", "mining", "favorite"]),
    addedAt: text(100),
  })
  .strict();
const legacyOrigin = z
  .object({
    source_file_sha256: sha,
    source_index: z.number().int().min(0).max(100_000),
    original: legacyLawRefSchema,
  })
  .strict();
export function legacyLawRefHasBody(
  value: string | null | undefined,
): value is string {
  return value != null && !blank.test(value);
}
const source = z.discriminatedUnion("kind", [
  textSource,
  z
    .object({
      id,
      kind: z.literal("web_capture"),
      url: webUrl,
      title: text(500),
      publisher: text(500).nullish(),
      retrieved_at: timestamp,
      text: text(100_000),
      text_sha256: sha,
      completeness: z.enum(["unknown", "partial", "claimed_complete"]),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("project_citation"),
      citation_id: uuid,
      evidence_item_id: uuid,
      evidence_version_id: uuid,
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("legacy_reference"),
      legacy_origin: legacyOrigin,
    })
    .strict(),
]);
const entry = z
  .object({
    id,
    law_name: text(500),
    article_label: text(200).nullish(),
    law_version: text(500).nullish(),
    jurisdiction: text(500).nullish(),
    text: text(100_000).nullable(),
    text_kind: z.enum([
      "legacy_excerpt",
      "quotation",
      "summary",
      "reference_only",
    ]),
    source_ids: z.array(id).min(1).max(32),
    published_date: date.nullish(),
    effective_date: date.nullish(),
    repealed_date: date.nullish(),
    relevant_date: date.nullish(),
    validity_statement: text(8000).nullish(),
    applicability_analysis: text(16_000).nullish(),
    uncertainty: text(8000).nullish(),
    current_validity: z.literal("unverified"),
    review_status: z.literal("unreviewed"),
    origin: z.enum([
      "manual",
      "mining",
      "favorite",
      "legacy_import",
      "research",
    ]),
    inclusion_reason: text(4000).nullish(),
    state: z.enum(["active", "removed"]),
    removal_reason: text(4000).nullish(),
    legacy_origin: legacyOrigin.nullish(),
  })
  .strict()
  .refine(
    (value) =>
      (value.state === "removed") === (value.removal_reason != null) &&
      (value.origin !== "legacy_import" || value.legacy_origin != null) &&
      (value.text_kind === "reference_only") === (value.text === null) &&
      (value.text_kind !== "reference_only" ||
        (value.origin === "legacy_import" &&
          value.legacy_origin != null &&
          !legacyLawRefHasBody(value.legacy_origin.original.text))),
  );
const schema = z
  .object({
    format: z.literal("matrix-law.legal-authorities"),
    schema_version: z.literal(1),
    title: text(240),
    question: text(8000),
    review_status: z.literal("unreviewed"),
    entries: z.array(entry).max(500),
    sources: z.array(source).max(1000),
  })
  .strict()
  .refine((value) => {
    const sourceIds = new Set(value.sources.map((item) => item.id));
    const byId = new Map(value.sources.map((item) => [item.id, item]));
    return (
      sourceIds.size === value.sources.length &&
      new Set(value.entries.map((item) => item.id)).size ===
        value.entries.length &&
      value.entries.every(
        (item) =>
          new Set(item.source_ids).size === item.source_ids.length &&
          item.source_ids.every((key) => sourceIds.has(key)) &&
          (item.text_kind !== "reference_only" ||
            item.source_ids.some((key) => {
              const origin = byId.get(key);
              return (
                origin?.kind === "legacy_reference" &&
                JSON.stringify(origin.legacy_origin) ===
                  JSON.stringify(item.legacy_origin)
              );
            })),
      ) &&
      value.sources.every(
        (item) =>
          item.kind !== "manual" ||
          (item.legacy_id == null && item.catalog_sha256 == null),
      )
    );
  });

export type LegalAuthorities = z.infer<typeof schema>;
export type LegalAuthorityEntry = LegalAuthorities["entries"][number];
export type LegalAuthoritySource = LegalAuthorities["sources"][number];

// JSON.parse validates grammar; this pass preserves duplicate-key and integer-token checks
// which would otherwise be lost before Zod sees the object. Quoted JSON remains plain text.
export function checkAuthorityJsonTokens(content: string): void {
  const stack: Array<Set<string> | null> = [];
  for (let cursor = 0; cursor < content.length; cursor++) {
    const char = content[cursor];
    if (char === "{") stack.push(new Set());
    else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === '"') {
      const start = cursor++;
      while (cursor < content.length && content[cursor] !== '"') {
        if (content[cursor] === "\\") cursor++;
        cursor++;
      }
      let next = cursor + 1;
      while (/\s/.test(content[next] ?? "x")) next++;
      if (content[next] !== ":") continue;
      const key = JSON.parse(content.slice(start, cursor + 1)) as string;
      const keys = stack.at(-1);
      if (!keys || keys.has(key)) throw new Error(LEGAL_AUTHORITIES_ERROR);
      keys.add(key);
      if (key === "schema_version" || key === "source_index") {
        const token = /^\s*(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
          content.slice(next + 1),
        )?.[1];
        if (!token || /[.eE]/.test(token))
          throw new Error(LEGAL_AUTHORITIES_ERROR);
      }
    }
  }
}

export async function parseLegalAuthorities(
  content: string,
): Promise<LegalAuthorities> {
  try {
    if (
      !content ||
      new TextEncoder().encode(content).byteLength > MAX_LEGAL_AUTHORITIES_BYTES
    )
      throw new Error();
    const payload: unknown = JSON.parse(content);
    checkAuthorityJsonTokens(content);
    const result = schema.parse(payload);
    await Promise.all(
      result.sources.map(async (item) => {
        if (
          item.kind === "project_citation" ||
          item.kind === "legacy_reference"
        )
          return;
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(item.text),
        );
        const actual = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (actual !== item.text_sha256) throw new Error();
      }),
    );
    return result;
  } catch {
    throw new Error(LEGAL_AUTHORITIES_ERROR);
  }
}
