import {
  parseLegalAuthorities,
  type LegalAuthorities,
  type LegalAuthorityEntry,
} from "./legal-authorities";

export const authorityValueKeys = [
  "law_name",
  "article_label",
  "law_version",
  "jurisdiction",
  "text",
  "text_kind",
  "published_date",
  "effective_date",
  "repealed_date",
  "relevant_date",
  "validity_statement",
  "applicability_analysis",
  "uncertainty",
  "inclusion_reason",
] as const;
export type AuthorityValues = Pick<
  LegalAuthorityEntry,
  (typeof authorityValueKeys)[number]
>;
export type AuthorityEdit =
  | { kind: "document"; title: string; question: string }
  | {
      kind: "manual";
      id: string;
      sourceId: string;
      reference: string | null;
      value: AuthorityValues;
    }
  | { kind: "collect"; id: string; sourceId: string; value: AuthorityValues }
  | { kind: "entry"; id: string; value: AuthorityValues }
  | { kind: "remove"; id: string; reason: string }
  | { kind: "restore"; id: string };

export function serializeLegalAuthorities(document: LegalAuthorities): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
export function authorityValues(entry: LegalAuthorityEntry): AuthorityValues {
  return Object.fromEntries(
    authorityValueKeys
      .filter((key) => key in entry)
      .map((key) => [key, entry[key]]),
  ) as AuthorityValues;
}

// Local immutable draft edits only. Provenance, source bytes and IDs are not editable
// through entry fields; removal is a tombstone, never an array deletion or approval.
export async function editLegalAuthorities(
  document: LegalAuthorities,
  edit: AuthorityEdit,
): Promise<LegalAuthorities> {
  await parseLegalAuthorities(serializeLegalAuthorities(document));
  if (
    "value" in edit &&
    Object.keys(edit.value).some(
      (key) =>
        !authorityValueKeys.includes(
          key as (typeof authorityValueKeys)[number],
        ),
    )
  )
    throw new Error("不能通过条目编辑改写身份、来源或审核状态。");
  let next = document;
  if (edit.kind === "document")
    next = { ...document, title: edit.title, question: edit.question };
  else if (edit.kind === "manual" || edit.kind === "collect") {
    if (document.entries.some((entry) => entry.id === edit.id))
      throw new Error("条目标识已存在，请重新打开添加表单。");
    let sources = document.sources;
    if (edit.kind === "manual") {
      if (edit.value.text == null) throw new Error("手工添加必须填写正文。");
      if (sources.some((source) => source.id === edit.sourceId))
        throw new Error("来源标识已存在。");
      const bytes = new TextEncoder().encode(edit.value.text);
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      const text_sha256 = Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      sources = [
        ...sources,
        {
          id: edit.sourceId,
          kind: "manual",
          reference: edit.reference,
          text: edit.value.text,
          text_sha256,
        },
      ];
    } else if (!sources.some((source) => source.id === edit.sourceId))
      throw new Error("所选来源已不存在，请重新选择。");
    next = {
      ...document,
      sources,
      entries: [
        ...document.entries,
        {
          ...edit.value,
          id: edit.id,
          source_ids: [edit.sourceId],
          origin: edit.kind === "manual" ? "manual" : "favorite",
          state: "active",
          current_validity: "unverified",
          review_status: "unreviewed",
        },
      ],
    };
  } else {
    const entry = document.entries.find((item) => item.id === edit.id);
    if (!entry) throw new Error("所选条目已不存在，请重新打开。");
    let updated: LegalAuthorityEntry;
    if (edit.kind === "entry") updated = { ...entry, ...edit.value };
    else if (edit.kind === "remove") {
      if (entry.state !== "active") throw new Error("条目已移除，请重新打开。");
      updated = { ...entry, state: "removed", removal_reason: edit.reason };
    } else {
      if (entry.state !== "removed")
        throw new Error("条目已收录，请重新打开。");
      updated = { ...entry, state: "active", removal_reason: null };
    }
    next = {
      ...document,
      entries: document.entries.map((item) =>
        item.id === edit.id ? updated : item,
      ),
    };
  }
  return parseLegalAuthorities(serializeLegalAuthorities(next));
}
