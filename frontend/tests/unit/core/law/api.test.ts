import { beforeEach, describe, expect, it, rs } from "@rstest/core";

rs.mock("@/core/api/fetcher", () => ({
  fetch: rs.fn(),
}));
rs.mock("@/core/config", () => ({
  getBackendBaseURL: () => "",
}));

import { fetch } from "@/core/api/fetcher";
import {
  claimMatterNotificationIncident,
  closeMatterNotificationIncident,
  createCitation,
  decideMatterMemoryEntry,
  createMatter,
  createMatterConversation,
  detachMatterConversation,
  fetchEvidenceContent,
  getCitation,
  getMatter,
  getMatterContextByThread,
  getOcrPageDraft,
  getOcrProofreadingCollection,
  getOcrProofreadingPublication,
  openCaseWorkbenchEventStream,
  listEvidence,
  listMatterMemoryEntries,
  markMatterNotificationRead,
  listOcrJobs,
  listOcrReviewQueue,
  listTenants,
  listManagementTenants,
  acceptTenantMembershipInvitation,
  proposeOcrBlockCorrection,
  publishOcrProofreading,
  reviewOcrBlockCorrection,
  reviewOcrBlock,
  reviewOcrPageDraft,
  saveOcrPageDraft,
  sha256Hex,
  uploadEvidence,
} from "@/core/law/api";

const mockedFetch = rs.mocked(fetch);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function requestUrl(input: RequestInfo | string | undefined): string {
  if (typeof input === "string") return input;
  if (input instanceof Request) return input.url;
  throw new Error("Expected a request URL");
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body === "string") return init.body;
  throw new Error("Expected a JSON request body");
}

describe("Matrix-Law API client", () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it("reads finance-safe management metadata without caching or querying case data", async () => {
    const items = [
      {
        tenant: { id: "firm", name: "Synthetic" },
        membership: { role: "finance", status: "active" },
      },
    ];
    mockedFetch.mockResolvedValue(jsonResponse({ data: { items } }));
    await expect(listManagementTenants()).resolves.toEqual(items);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch.mock.calls[0]?.[0]).toBe("/api/law/management/tenants");
    expect(mockedFetch.mock.calls[0]?.[1]?.cache).toBe("no-store");
  });

  it("preserves management failures instead of inventing a finance role", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({ error: { message: "Unavailable" } }, 503),
    );
    await expect(listManagementTenants()).rejects.toThrow();
  });

  it("claims an incident with a valid idempotency key and the expected version", async () => {
    const receipt = { id: "incident/1", status: "claimed", version: 2 };
    mockedFetch.mockResolvedValue(jsonResponse({ data: receipt }));
    await expect(
      claimMatterNotificationIncident("tenant/a", "matter b", "incident/1", {
        expected_version: 1,
      }),
    ).resolves.toEqual(receipt);
    const [url, init] = mockedFetch.mock.calls[0]!;
    expect(url).toBe(
      "/api/law/tenants/tenant%2Fa/matters/matter%20b/notification-incidents/incident%2F1/claim",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(requestBody(init))).toEqual({ expected_version: 1 });
    expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("closes an incident with an idempotency key and preserves its resolution", async () => {
    const receipt = { id: "incident/1", status: "closed", version: 3 };
    mockedFetch.mockResolvedValue(jsonResponse({ data: receipt }));
    const input = {
      expected_version: 2,
      resolution_note: "SYNTHETIC: reviewed and closed",
    };
    await expect(
      closeMatterNotificationIncident(
        "tenant/a",
        "matter b",
        "incident/1",
        input,
      ),
    ).resolves.toEqual(receipt);
    const [url, init] = mockedFetch.mock.calls[0]!;
    expect(url).toBe(
      "/api/law/tenants/tenant%2Fa/matters/matter%20b/notification-incidents/incident%2F1/close",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(requestBody(init))).toEqual(input);
    expect(new Headers(init?.headers).get("Idempotency-Key")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("rechecks matter metadata without the browser HTTP cache before analysis edits", async () => {
    const matter = { id: "matter", version: 2, cause: "Synthetic" };
    mockedFetch.mockResolvedValue(jsonResponse({ data: { matter } }));
    const controller = new AbortController();
    await expect(
      getMatter("tenant", "matter", controller.signal),
    ).resolves.toEqual(matter);
    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/law/tenants/tenant/matters/matter",
      { signal: controller.signal, cache: "no-store" },
    );
  });

  it("reads citations with current authorization and no browser HTTP cache", async () => {
    const citation = { id: "citation", quote_text: "synthetic" };
    mockedFetch.mockResolvedValue(jsonResponse({ data: { citation } }));
    const request = new AbortController();
    await expect(
      getCitation(
        "tenant",
        "matter",
        "evidence",
        "version",
        "citation",
        request.signal,
      ),
    ).resolves.toEqual(citation);
    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/law/tenants/tenant/matters/matter/evidence/evidence/versions/version/citations/citation",
      { signal: request.signal, cache: "no-store" },
    );
  });

  it("opens the case event stream with an authenticated, body-free cursor URL", async () => {
    const response = { ok: true, status: 200 } as Response;
    mockedFetch.mockResolvedValue(response);
    const controller = new AbortController();

    await expect(
      openCaseWorkbenchEventStream(
        "tenant/a",
        "matter b",
        17,
        controller.signal,
      ),
    ).resolves.toBe(response);

    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/law/tenants/tenant%2Fa/matters/matter%20b/case-workbench/events?after=17",
      {
        headers: { Accept: "text/event-stream" },
        cache: "no-store",
        signal: controller.signal,
      },
    );
  });

  it("loads matter memory with no-store and posts optimistic lawyer decisions", async () => {
    const collection = { items: [], can_review: true };
    mockedFetch.mockResolvedValue(jsonResponse({ data: collection }));
    await expect(
      listMatterMemoryEntries("tenant/a", "matter b"),
    ).resolves.toEqual(collection);
    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/law/tenants/tenant%2Fa/matters/matter%20b/memory-entries",
      { cache: "no-store" },
    );

    const receipt = {
      memory_entry_id: "entry/1",
      decision: "approved",
      version: 1,
      decided_at: "2026-10-03T00:00:00Z",
    };
    mockedFetch.mockResolvedValue(jsonResponse({ data: receipt }));
    await expect(
      decideMatterMemoryEntry("tenant/a", "matter b", "entry/1", {
        decision: "approved",
        expected_version: 0,
      }),
    ).resolves.toEqual(receipt);
    const [url, init] = mockedFetch.mock.calls[1]!;
    expect(url).toBe(
      "/api/law/tenants/tenant%2Fa/matters/matter%20b/memory-entries/entry%2F1/decisions",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(requestBody(init))).toEqual({
      decision: "approved",
      expected_version: 0,
    });
  });

  it("marks only the recipient's delivered in-app deadline notification as read", async () => {
    const notification = {
      id: "notification",
      deadline_id: "deadline",
      deadline_version: 2,
      recipient_membership_id: "member",
      channel: "in_app",
      scheduled_at: "2030-01-01T08:00:00+00:00",
      status: "sent",
      sent_at: "2030-01-01T08:00:01+00:00",
      read_at: "2030-01-01T08:10:00+00:00",
    };
    mockedFetch.mockResolvedValue(jsonResponse({ data: notification }));

    await expect(
      markMatterNotificationRead("tenant/a", "matter b", "notification/1"),
    ).resolves.toEqual(notification);
    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/law/tenants/tenant%2Fa/matters/matter%20b/notifications/outbox/notification%2F1/read",
      expect.objectContaining({ method: "POST", body: "{}" }),
    );
  });

  it("lists the current user's tenant memberships", async () => {
    const items = [
      {
        tenant: { id: "tenant-1", name: "Acme Legal" },
        membership: { id: "membership-1", role: "owner" },
      },
    ];
    mockedFetch.mockResolvedValue(
      jsonResponse({ data: { items }, meta: { request_id: "request-1" } }),
    );

    await expect(listTenants()).resolves.toEqual(items);
    expect(mockedFetch).toHaveBeenCalledWith("/api/law/tenants", undefined);
  });

  it("sends the one-time membership invitation token in the authenticated POST body", async () => {
    const membership = { id: "membership-1", status: "active" };
    mockedFetch.mockResolvedValue(jsonResponse({ data: { membership } }));

    await expect(
      acceptTenantMembershipInvitation(
        "tenant/a",
        "membership-1",
        "lmi_synthetic-token",
      ),
    ).resolves.toEqual(membership);
    const [url, init] = mockedFetch.mock.calls[0]!;
    expect(url).toBe(
      "/api/law/tenants/tenant%2Fa/memberships/membership-1/accept",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(requestBody(init))).toEqual({
      invitation_token: "lmi_synthetic-token",
    });
  });

  it("resolves the trusted legal context before opening a conversation", async () => {
    const context = {
      user_id: "user-1",
      tenant_id: "tenant-1",
      membership_id: "membership-1",
      tenant_role: "owner",
      matter_id: "matter-1",
      matter_member_id: "matter-member-1",
      matter_role: "owner",
      thread_id: "thread/with spaces",
      mapping_id: "mapping-1",
      policy_version: "phase4-v1",
      context_version: 1,
    };
    mockedFetch.mockResolvedValue(
      jsonResponse({ data: { context }, meta: { request_id: "request-1" } }),
    );

    await expect(getMatterContextByThread(context.thread_id)).resolves.toEqual(
      context,
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/law/context/by-thread/thread%2Fwith%20spaces",
      undefined,
    );
  });

  it("adds an idempotency key when creating a matter", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({
        data: { matter: { id: "matter-1", tenant_id: "tenant-1" } },
        meta: { request_id: "request-1" },
      }),
    );

    await createMatter("tenant-1", {
      kind: "case",
      case_number: "2026-001",
      title: "Contract dispute",
      stage: "intake",
      classification: "normal",
    });

    const [, init] = mockedFetch.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("POST");
    expect(headers.get("Idempotency-Key")).toBeTruthy();
    expect(JSON.parse(requestBody(init))).toMatchObject({
      kind: "case",
      case_number: "2026-001",
      title: "Contract dispute",
    });
  });

  it("creates the thread before binding it to the matter", async () => {
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({ thread_id: "thread-1" }, 201))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              thread_mapping: {
                id: "mapping-1",
                tenant_id: "tenant-1",
                matter_id: "matter-1",
                thread_id: "thread-1",
              },
            },
            meta: { request_id: "request-2" },
          },
          201,
        ),
      );

    const result = await createMatterConversation("tenant-1", "matter-1");

    expect(result.mapping.id).toBe("mapping-1");
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(requestUrl(mockedFetch.mock.calls[0]?.[0])).toBe("/api/threads");
    expect(requestUrl(mockedFetch.mock.calls[1]?.[0])).toContain(
      "/api/law/tenants/tenant-1/matters/matter-1/threads",
    );
    const createdThread = JSON.parse(
      requestBody(mockedFetch.mock.calls[0]?.[1]),
    ) as { thread_id: string };
    const bindBody = JSON.parse(
      requestBody(mockedFetch.mock.calls[1]?.[1]),
    ) as { thread_id: string };
    expect(bindBody.thread_id).toBe(createdThread.thread_id);
  });

  it("best-effort deletes a newly created empty thread when binding fails", async () => {
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({ thread_id: "thread-1" }, 201))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "MATTER_NOT_FOUND",
              message: "Matter not found",
            },
          },
          404,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    await expect(
      createMatterConversation("tenant-1", "matter-1"),
    ).rejects.toMatchObject({
      status: 404,
      code: "MATTER_NOT_FOUND",
    });

    expect(mockedFetch).toHaveBeenCalledTimes(3);
    expect(requestUrl(mockedFetch.mock.calls[2]?.[0])).toContain(
      "/api/threads/",
    );
    expect(mockedFetch.mock.calls[2]?.[1]?.method).toBe("DELETE");
  });

  it("detaches a conversation with encoded scope and optimistic version", async () => {
    const threadMapping = {
      id: "mapping-1",
      tenant_id: "tenant/one",
      matter_id: "matter one",
      thread_id: "thread/with spaces",
      status: "detached",
      version: 4,
    };
    mockedFetch.mockResolvedValue(
      jsonResponse({
        data: { thread_mapping: threadMapping },
        meta: { request_id: "request-1" },
      }),
    );

    await expect(
      detachMatterConversation("tenant/one", "matter one", {
        thread_id: "thread/with spaces",
        version: 3,
      }),
    ).resolves.toEqual(threadMapping);

    const [url, init] = mockedFetch.mock.calls[0]!;
    expect(requestUrl(url)).toBe(
      "/api/law/tenants/tenant%2Fone/matters/matter%20one/threads/thread%2Fwith%20spaces/detach",
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(requestBody(init))).toEqual({ expected_version: 3 });
  });

  it("hashes and uploads evidence as authenticated multipart data", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({
        data: {
          evidence_item: { id: "evidence-1", title: "Contract" },
          evidence_version: { id: "version-1", scan_status: "clean" },
        },
        meta: { request_id: "request-1" },
      }),
    );
    const file = new File(["abc"], "contract.pdf", {
      type: "application/pdf",
    });

    const created = await uploadEvidence("tenant-1", "matter-1", {
      title: "Signed contract",
      file,
    });

    expect(created.evidence_version.id).toBe("version-1");
    const [url, init] = mockedFetch.mock.calls[0]!;
    expect(requestUrl(url)).toBe(
      "/api/law/tenants/tenant-1/matters/matter-1/evidence",
    );
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("Idempotency-Key")).toBeTruthy();
    expect(headers.get("X-Content-SHA256")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(headers.has("Content-Type")).toBe(false);
    const body = init?.body as FormData;
    expect(body.get("title")).toBe("Signed contract");
    expect(body.get("byte_size")).toBe("3");
    expect((body.get("file") as File).name).toBe("contract.pdf");
  });

  it("loads evidence and OCR history within the full URL scope", async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: { items: [{ id: "evidence-1" }] },
          meta: { request_id: "request-1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { items: [{ id: "job-1", run_number: 1 }] },
          meta: { request_id: "request-2" },
        }),
      );

    await listEvidence("tenant/one", "matter one");
    await listOcrJobs(
      "tenant/one",
      "matter one",
      "evidence/one",
      "version one",
    );

    expect(requestUrl(mockedFetch.mock.calls[0]?.[0])).toBe(
      "/api/law/tenants/tenant%2Fone/matters/matter%20one/evidence",
    );
    expect(requestUrl(mockedFetch.mock.calls[1]?.[0])).toBe(
      "/api/law/tenants/tenant%2Fone/matters/matter%20one/evidence/evidence%2Fone/versions/version%20one/ocr-jobs",
    );
  });

  it("loads and saves page-scoped OCR proofreading drafts with version fencing", async () => {
    const draft = {
      id: "draft-1",
      physical_page_number: 2,
      markdown_text: "校对稿",
      version: 4,
    };
    mockedFetch.mockResolvedValue(
      jsonResponse({ data: { ocr_page_draft: draft } }),
    );

    await getOcrPageDraft(
      "tenant",
      "matter",
      "evidence",
      "version",
      2,
      "job/one",
    );
    await saveOcrPageDraft("tenant", "matter", "evidence", "version", 2, {
      ocr_job_id: "job/one",
      markdown_text: "校对稿",
      expected_version: 3,
    });
    await reviewOcrPageDraft("tenant", "matter", "evidence", "version", 2, {
      ocr_job_id: "job/one",
      expected_version: 4,
    });

    expect(requestUrl(mockedFetch.mock.calls[0]?.[0])).toBe(
      "/api/law/tenants/tenant/matters/matter/evidence/evidence/versions/version/ocr-page-drafts/2?ocr_job_id=job%2Fone",
    );
    expect(mockedFetch.mock.calls[1]?.[1]?.method).toBe("PUT");
    expect(JSON.parse(requestBody(mockedFetch.mock.calls[1]?.[1]))).toEqual({
      ocr_job_id: "job/one",
      markdown_text: "校对稿",
      expected_version: 3,
    });
    expect(requestUrl(mockedFetch.mock.calls[2]?.[0])).toBe(
      "/api/law/tenants/tenant/matters/matter/evidence/evidence/versions/version/ocr-page-drafts/2/review",
    );
  });

  it("publishes a fenced whole-document proofreading version and reads its manifest", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({
        data: {
          ocr_page_drafts: [],
          recognized_page_numbers: [1, 2],
          missing_page_numbers: [2],
          latest_publication: null,
          ocr_proofreading_publication: { id: "publication-1" },
        },
      }),
    );

    await getOcrProofreadingCollection(
      "tenant",
      "matter",
      "evidence",
      "version",
    );
    await publishOcrProofreading("tenant", "matter", "evidence", "version", {
      expected_versions: { 1: 3 },
      allow_partial: true,
    });
    await getOcrProofreadingPublication(
      "tenant",
      "matter",
      "evidence",
      "version",
      "publication/1",
    );

    const base =
      "/api/law/tenants/tenant/matters/matter/evidence/evidence/versions/version/ocr-page-drafts";
    expect(requestUrl(mockedFetch.mock.calls[0]?.[0])).toBe(base);
    expect(requestUrl(mockedFetch.mock.calls[1]?.[0])).toBe(`${base}/publish`);
    expect(JSON.parse(requestBody(mockedFetch.mock.calls[1]?.[1]))).toEqual({
      expected_versions: { 1: 3 },
      allow_partial: true,
    });
    expect(requestUrl(mockedFetch.mock.calls[2]?.[0])).toBe(
      `${base}/publications/publication%2F1`,
    );
  });

  it("passes cancellation through protected evidence downloads", async () => {
    const blob = new Blob(["protected"], { type: "image/png" });
    mockedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
    } as Response);
    const controller = new AbortController();

    await expect(
      fetchEvidenceContent(
        "tenant-1",
        "matter-1",
        "evidence-1",
        "version-1",
        controller.signal,
      ),
    ).resolves.toBe(blob);

    expect(mockedFetch).toHaveBeenCalledWith(
      "/api/law/tenants/tenant-1/matters/matter-1/evidence/evidence-1/versions/version-1/content",
      { signal: controller.signal },
    );
  });

  it("creates a citation without accepting client supplied quote text", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({
        data: { citation: { id: "citation-1", quote_text: "sealed" } },
        meta: { request_id: "request-1" },
      }),
    );

    await createCitation("tenant-1", "matter-1", "evidence-1", "version-1", {
      ocr_result_id: "result-1",
      physical_page_number: 2,
      start_block_id: "block-1",
      end_block_id: "block-1",
      start_offset: 0,
      end_offset: 12,
    });

    const [, init] = mockedFetch.mock.calls[0]!;
    const body = JSON.parse(requestBody(init)) as Record<string, unknown>;
    expect(body).toMatchObject({
      ocr_result_id: "result-1",
      physical_page_number: 2,
      start_block_id: "block-1",
      end_offset: 12,
    });
    expect(body).not.toHaveProperty("quote_text");
  });

  it("records an idempotent OCR block review in the full evidence scope", async () => {
    mockedFetch.mockResolvedValue(
      jsonResponse({
        data: {
          ocr_block_review: {
            id: "review-1",
            ocr_block_id: "block/1",
            decision: "verified",
            review_number: 1,
          },
        },
        meta: { request_id: "request-1" },
      }),
    );

    await reviewOcrBlock(
      "tenant-1",
      "matter-1",
      "evidence-1",
      "version-1",
      "job-1",
      2,
      "block/1",
      "verified",
    );

    const [url, init] = mockedFetch.mock.calls[0]!;
    expect(requestUrl(url)).toBe(
      "/api/law/tenants/tenant-1/matters/matter-1/evidence/evidence-1/versions/version-1/ocr-jobs/job-1/result/pages/2/blocks/block%2F1/reviews",
    );
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBeTruthy();
    expect(JSON.parse(requestBody(init))).toEqual({ decision: "verified" });
  });

  it("loads the matter-scoped OCR review queue without caching client state", async () => {
    const items = [
      {
        evidence_item_id: "evidence-1",
        evidence_version_id: "version-1",
        ocr_job_id: "job-1",
        ocr_result_id: "result-1",
        physical_page_number: 2,
        block: {
          id: "block-1",
          block_index: 0,
          reading_order: 0,
          kind: "text",
          text: "Amount 1000",
          confidence: 0.4,
          quality: {
            review_required: true,
            threshold: 0.8,
            status: "partially_verified",
            verification_count: 1,
            required_verifications: 2,
            current_reviewer_has_verified: true,
            review_number: 1,
            reviewed_at: "2026-09-05T00:00:00Z",
          },
        },
      },
    ];
    mockedFetch.mockResolvedValue(
      jsonResponse({ data: { items }, meta: { request_id: "request-1" } }),
    );

    await expect(listOcrReviewQueue("tenant/1", "matter/1")).resolves.toEqual(
      items,
    );
    expect(requestUrl(mockedFetch.mock.calls[0]?.[0])).toBe(
      "/api/law/tenants/tenant%2F1/matters/matter%2F1/ocr-review-queue",
    );
    expect(mockedFetch.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("proposes and independently reviews an OCR correction in the full block scope", async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            ocr_block_correction: { id: "correction-1", status: "pending" },
          },
          meta: { request_id: "request-1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            ocr_block_correction: { id: "correction-1", status: "accepted" },
          },
          meta: { request_id: "request-2" },
        }),
      );

    await proposeOcrBlockCorrection(
      "tenant-1",
      "matter-1",
      "evidence-1",
      "version-1",
      "job-1",
      2,
      "block/1",
      { corrected_text: "Corrected text", reason: "Compared with source" },
    );
    await reviewOcrBlockCorrection(
      "tenant-1",
      "matter-1",
      "evidence-1",
      "version-1",
      "job-1",
      2,
      "block/1",
      "correction/1",
      { decision: "accepted", comment: "Confirmed" },
    );

    expect(requestUrl(mockedFetch.mock.calls[0]?.[0])).toBe(
      "/api/law/tenants/tenant-1/matters/matter-1/evidence/evidence-1/versions/version-1/ocr-jobs/job-1/result/pages/2/blocks/block%2F1/corrections",
    );
    expect(JSON.parse(requestBody(mockedFetch.mock.calls[0]?.[1]))).toEqual({
      corrected_text: "Corrected text",
      reason: "Compared with source",
    });
    expect(requestUrl(mockedFetch.mock.calls[1]?.[0])).toBe(
      "/api/law/tenants/tenant-1/matters/matter-1/evidence/evidence-1/versions/version-1/ocr-jobs/job-1/result/pages/2/blocks/block%2F1/corrections/correction%2F1/reviews",
    );
    expect(JSON.parse(requestBody(mockedFetch.mock.calls[1]?.[1]))).toEqual({
      decision: "accepted",
      comment: "Confirmed",
    });
    expect(
      new Headers(mockedFetch.mock.calls[1]?.[1]?.headers).get(
        "Idempotency-Key",
      ),
    ).toBeTruthy();
  });

  it("computes the standard SHA-256 digest", async () => {
    await expect(sha256Hex(new Blob(["abc"]))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
