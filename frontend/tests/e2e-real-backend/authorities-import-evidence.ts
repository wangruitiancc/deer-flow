import assert from "node:assert/strict";

export type AuthoritiesMessage = {
  type: string;
  name?: string;
  status?: string;
  content?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; name: string; args: unknown }[];
};

type EvidenceData = {
  outputs: { kind: string; path: string; byte_size: number; sha256: string }[];
  source_file_sha256: string;
  source_bytes: number;
  validation: { valid: boolean; entries_count: number; sources_count: number };
  missing_body_count: number;
  duplicate_name_article_count: number;
  current_validity: string;
  review_status: string;
  verification_performed: boolean;
  saved_to_project: boolean;
};

function record(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

// Acceptance-only checks. File bytes, native delivery events and saved history
// must still be fetched independently by the live browser test.
export function assertAuthoritiesImportEvidence(
  messages: AuthoritiesMessage[],
  files: { authorities_path: string; report_path: string },
  expected: EvidenceData,
): string[] {
  const calls = messages
    .filter((message) => message.type === "ai")
    .flatMap((message) => message.tool_calls ?? [])
    .filter((call) => call.name === "law_import_authorities");
  assert.equal(
    calls.length,
    1,
    "Exactly one deterministic import invocation is required",
  );
  const call = calls[0]!;
  assert.equal(typeof call.id, "string");
  assert(call.id.length > 0);
  assert.deepEqual(
    call.args,
    { files },
    "Import must use this upload pair, without scope/overwrite arguments",
  );
  const results = messages.filter(
    (message) => message.type === "tool" && message.tool_call_id === call.id,
  );
  assert.equal(
    results.length,
    1,
    "A matching native tool result is required, not assistant prose",
  );
  const result = results[0]!;
  assert.notEqual(result.status, "error");
  assert.equal(typeof result.content, "string");
  const receipt = record(JSON.parse(result.content!));
  assert.equal(receipt.status, "ok");
  assert.deepEqual(
    receipt.data,
    expected,
    "Code receipt must match independently downloaded bytes and original metadata",
  );
  assert.deepEqual(
    expected.outputs.map((item) => item.kind),
    ["authorities", "report"],
  );
  assert.equal(expected.current_validity, "unverified");
  assert.equal(expected.review_status, "unreviewed");
  assert.equal(expected.verification_performed, false);
  assert.equal(expected.saved_to_project, false);
  const suffixes = ["law-authorities", "import-report"];
  for (const [index, output] of expected.outputs.entries()) {
    assert.match(
      output.path,
      new RegExp(
        `^/mnt/user-data/outputs/draft-[0-9a-f]{32}\\.${suffixes[index]}\\.json$`,
      ),
    );
    assert.match(output.sha256, /^[0-9a-f]{64}$/);
    assert(Number.isSafeInteger(output.byte_size) && output.byte_size > 0);
  }
  return expected.outputs.map((output) => output.path);
}
