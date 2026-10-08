import { afterEach, describe, expect, it, rs } from "@rstest/core";

import {
  sha256Hex,
  saveProjectArtifact,
  fetchProjectArtifactContent,
  saveWorkspaceEditorArtifact,
  getProjectArtifactSources,
  listWorkProductProposals,
  getWorkProductProposalComparison,
  acceptWorkProductProposal,
} from "@/core/law/api";
import {
  isFormalProjectArtifact,
  loadProjectArtifactSource,
  MAX_PROJECT_ARTIFACT_BYTES,
} from "@/core/law/artifact-source";
import type { ProjectArtifactVersion } from "@/core/law/types";

afterEach(() => {
  rs.restoreAllMocks();
});
const input = {
  threadId: "thread-1",
  filepath: "/mnt/user-data/outputs/意见.md",
};

describe("legal project artifact promotion", () => {
  it("loads the exact project version through the protected API and verifies immutable bytes", async () => {
    const blob = new Blob(["saved"]);
    const version = {
      id: "v1",
      tenant_id: "tenant",
      matter_id: "matter",
      project_artifact_id: "artifact",
      byte_size: blob.size,
      sha256: await sha256Hex(blob),
    } as ProjectArtifactVersion;
    const mock = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(blob));
    expect(await (await fetchProjectArtifactContent(version)).text()).toBe(
      "saved",
    );
    expect(mock.mock.calls[0]![0]).toContain(
      "/project-artifacts/artifact/versions/v1/content",
    );
    expect(mock.mock.calls[0]![1]?.cache).toBe("no-store");
    mock.mockResolvedValue(new Response("wrong"));
    await expect(fetchProjectArtifactContent(version)).rejects.toThrow(
      "与所选版本不一致",
    );
  });

  it("rejects partial or unauthorized project downloads", async () => {
    const version = {
      id: "v1",
      tenant_id: "tenant",
      matter_id: "matter",
      project_artifact_id: "artifact",
    } as ProjectArtifactVersion;
    const mock = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("partial", { status: 206 }));
    await expect(fetchProjectArtifactContent(version)).rejects.toThrow(
      "响应不完整",
    );
    mock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Access revoked" } }), {
        status: 404,
      }),
    );
    await expect(fetchProjectArtifactContent(version)).rejects.toMatchObject({
      status: 404,
      message: "Access revoked",
    });
  });
  it("accepts only normalized formal output paths", () => {
    expect(isFormalProjectArtifact(input.filepath)).toBe(true);
    for (const path of [
      "write-file:/mnt/user-data/outputs/x.md",
      "/etc/passwd",
      "/mnt/user-data/outputs/../x",
      "/mnt/user-data/outputs/",
      "/mnt/user-data/outputs/a//x",
      "/mnt/user-data/outputs/a\\x",
    ]) {
      expect(isFormalProjectArtifact(path)).toBe(false);
    }
  });

  it("fetches full bytes without Range and verifies the displayed revision", async () => {
    const blob = new Blob(["完整法律意见"]);
    const digest = await sha256Hex(blob);
    const mock = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(blob, { headers: { ETag: `"${digest}"` } }),
      );
    const result = await loadProjectArtifactSource({
      ...input,
      expectedSha256: digest,
    });
    expect(await result.file.text()).toBe("完整法律意见");
    expect(result.file.type).toBe("text/markdown");
    expect(result.sha256).toBe(digest);
    expect(mock.mock.calls[0]![0]).toContain("download=true");
    const init = mock.mock.calls[0]![1];
    expect(new Headers(init?.headers).has("Range")).toBe(false);
    expect(init?.cache).toBe("no-store");
  });

  it("rejects partial responses instead of promoting a preview", async () => {
    rs.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("partial", {
        status: 206,
        headers: { "Content-Range": "bytes 0-6/100" },
      }),
    );
    await expect(loadProjectArtifactSource(input)).rejects.toMatchObject({
      status: 206,
    });
  });

  it("rejects a changed source without posting anything", async () => {
    const mock = rs
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("new bytes"));
    await expect(
      loadProjectArtifactSource({ ...input, expectedSha256: "0".repeat(64) }),
    ).rejects.toMatchObject({ code: "SOURCE_CHANGED" });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized, truncated, empty and digest-mismatched transfers", async () => {
    const mock = rs.spyOn(globalThis, "fetch");
    for (const response of [
      new Response("large", {
        headers: { "Content-Length": String(MAX_PROJECT_ARTIFACT_BYTES + 1) },
      }),
      new Response("short", { headers: { "Content-Length": "100" } }),
      new Response(""),
      new Response("changed", { headers: { ETag: `"${"0".repeat(64)}"` } }),
    ]) {
      mock.mockResolvedValueOnce(response);
      await expect(loadProjectArtifactSource(input)).rejects.toBeInstanceOf(
        Error,
      );
    }
  });

  it("carries caller-owned idempotency and optimistic version to the existing authenticated API", async () => {
    const mock = rs.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { artifact: { id: "saved" } } }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    await saveProjectArtifact({
      tenantId: "tenant",
      matterId: "matter",
      ...input,
      file: new File(["draft"], "draft.md", { type: "text/markdown" }),
      sha256: "a".repeat(64),
      title: "Draft",
      kind: "note",
      artifactId: "existing",
      expectedVersion: 3,
      idempotencyKey: "same-retry-key",
    });
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toContain("/tenants/tenant/matters/matter/project-artifacts");
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toBe("same-retry-key");
    expect(headers.has("Content-Type")).toBe(false);
    const body = init?.body as FormData;
    expect(body.get("expected_version")).toBe("3");
    expect(body.get("project_artifact_id")).toBe("existing");
    expect(body.get("source_thread_id")).toBe(input.threadId);
    expect(body.has("review_status")).toBe(false);
  });

  it("saves structured workspace edits without asserting a thread source", async () => {
    const mock = rs.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { artifact: { id: "analysis" } } }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const content = JSON.stringify({
      format: "matrix-law.case-analysis",
      schema_version: 1,
      entries: [],
    });
    await saveWorkspaceEditorArtifact({
      tenantId: "tenant",
      matterId: "matter",
      content,
      title: "Case analysis",
      kind: "case_analysis",
      artifactId: "analysis",
      expectedVersion: 2,
      idempotencyKey: "manual-edit-retry",
    });
    const [url, init] = mock.mock.calls[0]!;
    expect(url).toContain("/tenants/tenant/matters/matter/project-artifacts");
    const body = init?.body as FormData;
    expect(body.get("source_provenance")).toBe("workspace_editor");
    expect(body.get("project_artifact_id")).toBe("analysis");
    expect(body.get("expected_version")).toBe("2");
    expect(body.has("source_thread_id")).toBe(false);
    expect(body.has("source_artifact_path")).toBe(false);
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(
      "manual-edit-retry",
    );
    expect(new Headers(init?.headers).get("X-Content-SHA256")).toBe(
      await sha256Hex(new Blob([content])),
    );
  });

  it("reads an immutable source receipt for one exact artifact version", async () => {
    const receipt = {
      artifact_id: "artifact",
      version_id: "version",
      version_number: 3,
      source_state: "bound",
    };
    const mock = rs.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: receipt }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(
      getProjectArtifactSources("tenant", "matter", "artifact", "version"),
    ).resolves.toMatchObject(receipt);
    expect(mock.mock.calls[0]![0]).toContain(
      "/project-artifacts/artifact/versions/version/sources",
    );
    expect(mock.mock.calls[0]![1]?.cache).toBe("no-store");
  });

  it("loads proposal diffs and sends only selected change IDs to the decision API", async () => {
    const proposal = {
      id: "proposal-1",
      kind: "case_analysis",
      status: "pending",
      version: 2,
      candidate_sha256: "a".repeat(64),
      source_manifest_sha256: "b".repeat(64),
    };
    const change = {
      change_id: "change-1",
      item_id: "entry-1",
      change: "modified",
      before: { text: "Old" },
      after: { text: "New" },
    };
    const mock = rs.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { items: [proposal] } }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(listWorkProductProposals("tenant", "matter")).resolves.toEqual(
      [proposal],
    );
    expect(mock.mock.calls[0]![0]).toContain("/work-product-proposals");
    expect(mock.mock.calls[0]![1]?.cache).toBe("no-store");

    mock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            proposal,
            is_stale: false,
            base: { entries: [] },
            candidate: { entries: [{ id: "entry-1" }] },
            changes: [change],
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    const comparison = await getWorkProductProposalComparison(
      "tenant",
      "matter",
      "proposal-1",
    );
    expect(comparison.changes).toEqual([change]);
    expect(mock.mock.calls[1]![0]).toContain(
      "/work-product-proposals/proposal-1/comparison",
    );

    mock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            proposal: { ...proposal, status: "accepted" },
            artifact: { id: "artifact-1" },
            artifact_version: { id: "version-2", review_status: "unreviewed" },
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
    await acceptWorkProductProposal({
      tenantId: "tenant",
      matterId: "matter",
      proposalId: "proposal-1",
      proposalVersion: 2,
      selectedChangeIds: ["change-1"],
      idempotencyKey: "decision-retry-key",
    });
    const [acceptUrl, acceptInit] = mock.mock.calls[2]!;
    expect(acceptUrl).toContain("/proposal-1/accept");
    expect(new Headers(acceptInit?.headers).get("Idempotency-Key")).toBe(
      "decision-retry-key",
    );
    expect(JSON.parse(acceptInit?.body as string)).toEqual({
      proposal_version: 2,
      selected_change_ids: ["change-1"],
      decision_note: undefined,
    });
  });
});
