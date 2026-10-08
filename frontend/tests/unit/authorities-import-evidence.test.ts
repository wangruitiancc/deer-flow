import { describe, expect, it } from "@rstest/core";

import { assertAuthoritiesImportEvidence } from "../e2e-real-backend/authorities-import-evidence";

function fixture() {
  const files = {
    authorities_path: "/mnt/user-data/uploads/fixture.law-authorities.json",
    report_path: "/mnt/user-data/uploads/fixture.import-report.json",
  };
  const outputs = [
    {
      kind: "authorities",
      path: `/mnt/user-data/outputs/draft-${"a".repeat(32)}.law-authorities.json`,
      byte_size: 3363,
      sha256: "b".repeat(64),
    },
    {
      kind: "report",
      path: `/mnt/user-data/outputs/draft-${"c".repeat(32)}.import-report.json`,
      byte_size: 2010,
      sha256: "d".repeat(64),
    },
  ];
  const data = {
    outputs,
    source_file_sha256: "e".repeat(64),
    source_bytes: 500,
    validation: { valid: true, entries_count: 2, sources_count: 2 },
    missing_body_count: 1,
    duplicate_name_article_count: 1,
    current_validity: "unverified",
    review_status: "unreviewed",
    verification_performed: false,
    saved_to_project: false,
  };
  const messages = [
    {
      type: "ai",
      tool_calls: [
        { id: "import-call", name: "law_import_authorities", args: { files } },
      ],
    },
    {
      type: "tool",
      tool_call_id: "import-call",
      content: JSON.stringify({ status: "ok", data }),
    },
  ];
  return { files, data, messages };
}

describe("strict live authorities import evidence", () => {
  it("accepts the matching native call/receipt without a separate model present_files or read_file call", () => {
    const { files, data, messages } = fixture();
    expect(assertAuthoritiesImportEvidence(messages, files, data)).toEqual(
      data.outputs.map((o) => o.path),
    );
  });

  it.each([
    [
      "another call",
      (f: ReturnType<typeof fixture>) => {
        f.messages[1]!.tool_call_id = "unrelated";
      },
    ],
    [
      "AI success text",
      (f: ReturnType<typeof fixture>) => {
        f.messages[1]!.type = "ai";
      },
    ],
    [
      "wrong upload",
      (f: ReturnType<typeof fixture>) => {
        f.messages[0]!.tool_calls![0]!.args.files = {
          ...f.files,
          report_path: "/mnt/user-data/uploads/other.import-report.json",
        };
      },
    ],
    [
      "repeated invocation",
      (f: ReturnType<typeof fixture>) => {
        f.messages[0]!.tool_calls!.push(f.messages[0]!.tool_calls![0]!);
      },
    ],
    [
      "repeated receipt",
      (f: ReturnType<typeof fixture>) => {
        f.messages.push(f.messages[1]!);
      },
    ],
    [
      "failed tool",
      (f: ReturnType<typeof fixture>) => {
        f.messages[1]!.content = JSON.stringify({
          status: "error",
          data: f.data,
        });
      },
    ],
    [
      "unparseable receipt",
      (f: ReturnType<typeof fixture>) => {
        f.messages[1]!.content = "import succeeded";
      },
    ],
    [
      "no receipt",
      (f: ReturnType<typeof fixture>) => {
        f.messages.pop();
      },
    ],
  ])("rejects %s", (_label, mutate) => {
    const current = fixture();
    mutate(current);
    expect(() =>
      assertAuthoritiesImportEvidence(
        current.messages,
        current.files,
        current.data,
      ),
    ).toThrow();
  });

  it.each([
    [
      "authority lost LF",
      {
        outputs: [
          { ...fixture().data.outputs[0], byte_size: 3362 },
          fixture().data.outputs[1],
        ],
      },
    ],
    [
      "report digest mismatch",
      {
        outputs: [
          fixture().data.outputs[0],
          { ...fixture().data.outputs[1], sha256: "0".repeat(64) },
        ],
      },
    ],
    ["partial pair", { outputs: [fixture().data.outputs[0]] }],
    ["source mismatch", { source_file_sha256: "0".repeat(64) }],
    ["false verification", { verification_performed: true }],
    ["automatic project save", { saved_to_project: true }],
    ["false approval", { review_status: "reviewed" }],
    [
      "wrong counts",
      { validation: { valid: true, entries_count: 1, sources_count: 2 } },
    ],
  ])("rejects %s in an otherwise successful receipt", (_label, changes) => {
    const { files, data, messages } = fixture();
    messages[1]!.content = JSON.stringify({
      status: "ok",
      data: { ...data, ...changes },
    });
    expect(() =>
      assertAuthoritiesImportEvidence(messages, files, data),
    ).toThrow();
  });

  it("rejects unsafe output paths even if supplied in expected metadata", () => {
    const { files, data, messages } = fixture();
    data.outputs[0]!.path =
      "/mnt/user-data/outputs/../uploads/fixture.law-authorities.json";
    messages[1]!.content = JSON.stringify({ status: "ok", data });
    expect(() =>
      assertAuthoritiesImportEvidence(messages, files, data),
    ).toThrow();
  });
});
