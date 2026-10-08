import { expect, test, type Page, type Route } from "@playwright/test";

import { mockLangGraphAPI } from "./utils/mock-api";

const TENANT_ID = "10000000-0000-0000-0000-000000000001";
const MEMBERSHIP_ID = "20000000-0000-0000-0000-000000000001";
const MATTER_ID = "30000000-0000-0000-0000-000000000001";
const EVIDENCE_ID = "60000000-0000-0000-0000-000000000001";
const VERSION_ID = "70000000-0000-0000-0000-000000000001";
const OCR_JOB_ID = "80000000-0000-0000-0000-000000000001";
const OCR_RESULT_ID = "90000000-0000-0000-0000-000000000001";
const OCR_BLOCK_ID = "a0000000-0000-0000-0000-000000000001";

function envelope(data: unknown) {
  return JSON.stringify({ data, meta: { request_id: "law-request" } });
}

function fulfill(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: envelope(data),
  });
}

async function mockLawAPI(
  page: Page,
  options: {
    ocrStatus?: "succeeded" | "processing";
    lowConfidence?: boolean;
    requiredVerifications?: number;
    acceptedCorrection?: boolean;
  } = {},
) {
  type MockMatter = {
    id: string;
    tenant_id: string;
    kind: string;
    case_number: string | null;
    title: string;
    cause: string | null;
    stage: string;
    status: string;
    classification: string;
    created_by_membership_id: string;
    version: number;
    created_at: string;
    updated_at: string;
  };
  const now = "2026-09-04T12:00:00Z";
  const tenant = {
    id: TENANT_ID,
    slug: "acme-legal",
    name: "Acme Legal",
    status: "active",
    version: 1,
    created_at: now,
    updated_at: now,
  };
  const membership = {
    id: MEMBERSHIP_ID,
    tenant_id: TENANT_ID,
    user_id: "default",
    role: "owner",
    status: "active",
    display_name: "Alice",
    joined_at: now,
    left_at: null,
    version: 1,
    created_at: now,
    updated_at: now,
  };
  let matters: MockMatter[] = [
    {
      id: MATTER_ID,
      tenant_id: TENANT_ID,
      kind: "case",
      case_number: "2026-001",
      title: "Contract dispute",
      cause: "Service agreement",
      stage: "analysis",
      status: "active",
      classification: "sensitive",
      created_by_membership_id: MEMBERSHIP_ID,
      version: 1,
      created_at: now,
      updated_at: now,
    },
  ];
  const mappings: Array<Record<string, unknown>> = [];
  const evidenceBase = `/api/law/tenants/${TENANT_ID}/matters/${MATTER_ID}/evidence`;
  let evidenceItems: Array<Record<string, unknown>> = [
    {
      id: EVIDENCE_ID,
      tenant_id: TENANT_ID,
      matter_id: MATTER_ID,
      kind: "evidence",
      title: "Signed service agreement",
      status: "active",
      created_by_membership_id: MEMBERSHIP_ID,
      version: 1,
      created_at: now,
      updated_at: now,
      archived_at: null,
    },
  ];
  const evidenceVersions = new Map<string, Array<Record<string, unknown>>>([
    [
      EVIDENCE_ID,
      [
        {
          id: VERSION_ID,
          tenant_id: TENANT_ID,
          matter_id: MATTER_ID,
          evidence_item_id: EVIDENCE_ID,
          version_number: 1,
          origin: "upload",
          source_version_id: null,
          original_filename: "service-agreement.pdf",
          media_type: "application/pdf",
          byte_size: 2048,
          sha256: "a".repeat(64),
          created_by_membership_id: MEMBERSHIP_ID,
          created_at: now,
          scan_status: "clean",
          scanned_at: now,
        },
      ],
    ],
  ]);
  const initialOcrStatus = options.ocrStatus ?? "succeeded";
  const ocrJobs: Array<
    Record<string, unknown> & {
      status: string;
      cancel_requested: boolean;
      completed_at: string | null;
    }
  > = [
    {
      id: OCR_JOB_ID,
      evidence_item_id: EVIDENCE_ID,
      evidence_version_id: VERSION_ID,
      rerun_of_ocr_job_id: null,
      run_number: 1,
      provider: "matrix-ocr-test",
      language: "zh",
      enable_table: true,
      enable_formula: false,
      status: initialOcrStatus,
      attempts: 1,
      max_attempts: 3,
      last_error_code: null,
      page_count: initialOcrStatus === "succeeded" ? 1 : null,
      cancel_requested: false,
      started_at: now,
      completed_at: initialOcrStatus === "succeeded" ? now : null,
      created_at: now,
      updated_at: now,
    },
  ];
  const corrections: Array<Record<string, unknown>> = [];
  const ocrBlock = {
    id: OCR_BLOCK_ID,
    block_index: 0,
    reading_order: 0,
    kind: "paragraph",
    text: "Payment shall be made within thirty days.",
    bbox: { x0: 0.12, y0: 0.2, x1: 0.82, y1: 0.3 },
    confidence: options.lowConfidence ? 0.61 : 0.98,
    structure: null,
    quality: {
      review_required: Boolean(options.lowConfidence),
      threshold: 0.8,
      status: options.lowConfidence ? "pending" : "not_required",
      verification_count: 0,
      required_verifications: options.requiredVerifications ?? 1,
      current_reviewer_has_verified: false,
      review_number: null as number | null,
      reviewed_at: null as string | null,
    },
    correction: {
      effective_text: "Payment shall be made within thirty days.",
      effective_correction_id: null as string | null,
      latest_status: "none",
      items: corrections,
    },
  };
  if (options.acceptedCorrection) {
    const acceptedCorrection = {
      id: "ab000000-0000-0000-0000-000000000002",
      ocr_block_id: OCR_BLOCK_ID,
      correction_number: 1,
      base_correction_id: null,
      base_text: ocrBlock.text,
      base_text_sha256: "c".repeat(64),
      corrected_text: "Payment must be made within thirty days.",
      corrected_text_sha256: "d".repeat(64),
      reason: "Compared with the signed source",
      status: "accepted",
      can_current_user_review: false,
      created_at: now,
      latest_review: {
        id: "ac000000-0000-0000-0000-000000000001",
        decision: "accepted",
        comment: "Confirmed against source",
        review_number: 1,
        created_at: now,
      },
    };
    corrections.push(acceptedCorrection);
    ocrBlock.correction.effective_text = acceptedCorrection.corrected_text;
    ocrBlock.correction.effective_correction_id = acceptedCorrection.id;
    ocrBlock.correction.latest_status = "accepted";
  }
  const ocrResult = {
    id: OCR_RESULT_ID,
    ocr_job_id: OCR_JOB_ID,
    evidence_version_id: VERSION_ID,
    attempt: 1,
    provider: "matrix-ocr-test",
    model_version: "test-1",
    language: "zh",
    page_count: 1,
    created_at: now,
    pages: [
      {
        physical_page_number: 1,
        scan_page_number: 1,
        printed_page_label: "1",
        width_points: 595,
        height_points: 842,
        rotation_degrees: 0,
        block_count: 1,
      },
    ],
  };
  const citations: Array<Record<string, unknown>> = [];

  await page.route("**/api/law/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (
      path ===
        `/api/law/tenants/${TENANT_ID}/matters/${MATTER_ID}/ocr-review-queue` &&
      method === "GET"
    ) {
      return fulfill(route, {
        items:
          options.lowConfidence && ocrBlock.quality.status !== "verified"
            ? [
                {
                  evidence_item_id: EVIDENCE_ID,
                  evidence_version_id: VERSION_ID,
                  ocr_job_id: OCR_JOB_ID,
                  ocr_result_id: OCR_RESULT_ID,
                  physical_page_number: 1,
                  block: {
                    ...ocrBlock,
                    bbox: undefined,
                  },
                },
              ]
            : [],
      });
    }

    if (path === "/api/law/tenants" && method === "GET") {
      return fulfill(route, { items: [{ tenant, membership }] });
    }
    if (path === `/api/law/tenants/${TENANT_ID}/matters` && method === "GET") {
      return fulfill(route, { items: matters });
    }
    if (path === `/api/law/tenants/${TENANT_ID}/matters` && method === "POST") {
      const body = request.postDataJSON() as {
        kind: string;
        case_number?: string;
        title: string;
        cause?: string;
        stage: string;
        classification: string;
      };
      const created = {
        id: "30000000-0000-0000-0000-000000000002",
        tenant_id: TENANT_ID,
        kind: body.kind,
        case_number: body.case_number ?? null,
        title: body.title,
        cause: body.cause ?? null,
        stage: body.stage,
        status: "active",
        classification: body.classification,
        created_by_membership_id: MEMBERSHIP_ID,
        version: 1,
        created_at: now,
        updated_at: now,
      };
      matters = [...matters, created];
      return fulfill(route, { matter: created }, 201);
    }

    const matterMatch = /^\/api\/law\/tenants\/[^/]+\/matters\/([^/]+)$/.exec(
      path,
    );
    if (matterMatch && method === "GET") {
      return fulfill(route, {
        matter: matters.find((item) => item.id === matterMatch[1]),
      });
    }
    if (path === evidenceBase && method === "GET") {
      return fulfill(route, { items: evidenceItems });
    }
    if (path === evidenceBase && method === "POST") {
      const uploadData = request.postData() ?? "";
      const titleMatch = /name="title"\r\n\r\n([^\r\n]+)/.exec(uploadData);
      const createdId = "60000000-0000-0000-0000-000000000002";
      const createdVersionId = "70000000-0000-0000-0000-000000000002";
      const item = {
        id: createdId,
        tenant_id: TENANT_ID,
        matter_id: MATTER_ID,
        kind: "evidence",
        title: titleMatch?.[1] ?? "Uploaded exhibit",
        status: "active",
        created_by_membership_id: MEMBERSHIP_ID,
        version: 1,
        created_at: now,
        updated_at: now,
        archived_at: null,
      };
      const version = {
        id: createdVersionId,
        tenant_id: TENANT_ID,
        matter_id: MATTER_ID,
        evidence_item_id: createdId,
        version_number: 1,
        origin: "upload",
        source_version_id: null,
        original_filename: "exhibit.pdf",
        media_type: "application/pdf",
        byte_size: 13,
        sha256: "b".repeat(64),
        created_by_membership_id: MEMBERSHIP_ID,
        created_at: now,
        scan_status: "clean",
        scanned_at: now,
      };
      evidenceItems = [...evidenceItems, item];
      evidenceVersions.set(createdId, [version]);
      return fulfill(
        route,
        { evidence_item: item, evidence_version: version },
        201,
      );
    }
    const versionsMatch = new RegExp(`^${evidenceBase}/([^/]+)/versions$`).exec(
      path,
    );
    if (versionsMatch && method === "GET") {
      return fulfill(route, {
        items: evidenceVersions.get(versionsMatch[1]!) ?? [],
      });
    }
    const versionBase = `${evidenceBase}/${EVIDENCE_ID}/versions/${VERSION_ID}`;
    if (path === `${versionBase}/content` && method === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: "%PDF-1.4\n%%EOF",
      });
    }
    if (path === `${versionBase}/ocr-jobs` && method === "GET") {
      return fulfill(route, { items: ocrJobs });
    }
    if (path === `${versionBase}/ocr-jobs` && method === "POST") {
      return fulfill(route, { ocr_job: ocrJobs[0], deduplicated: true }, 202);
    }
    if (
      path === `${versionBase}/ocr-jobs/${OCR_JOB_ID}/cancel` &&
      method === "POST"
    ) {
      ocrJobs[0]!.status = "cancelled";
      ocrJobs[0]!.cancel_requested = true;
      ocrJobs[0]!.completed_at = now;
      return fulfill(route, { ocr_job: ocrJobs[0] });
    }
    if (
      path === `${versionBase}/ocr-jobs/${OCR_JOB_ID}/result/pages/1` &&
      method === "GET"
    ) {
      return fulfill(route, {
        ocr_page: {
          ...ocrResult.pages[0],
          ocr_result_id: OCR_RESULT_ID,
          evidence_version_id: VERSION_ID,
          text: ocrBlock.text,
          blocks: [ocrBlock],
        },
      });
    }
    if (
      path ===
        `${versionBase}/ocr-jobs/${OCR_JOB_ID}/result/pages/1/blocks/${OCR_BLOCK_ID}/reviews` &&
      method === "POST"
    ) {
      ocrBlock.quality.status =
        (options.requiredVerifications ?? 1) > 1
          ? "partially_verified"
          : "verified";
      ocrBlock.quality.verification_count = 1;
      ocrBlock.quality.current_reviewer_has_verified = true;
      ocrBlock.quality.review_number = 1;
      ocrBlock.quality.reviewed_at = now;
      return fulfill(
        route,
        {
          ocr_block_review: {
            id: "aa000000-0000-0000-0000-000000000001",
            ocr_block_id: OCR_BLOCK_ID,
            decision: "verified",
            review_number: 1,
            created_at: now,
          },
        },
        201,
      );
    }
    if (
      path ===
        `${versionBase}/ocr-jobs/${OCR_JOB_ID}/result/pages/1/blocks/${OCR_BLOCK_ID}/corrections` &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as {
        corrected_text: string;
        reason: string;
      };
      const correction = {
        id: "ab000000-0000-0000-0000-000000000001",
        ocr_block_id: OCR_BLOCK_ID,
        correction_number: 1,
        base_correction_id: null,
        base_text: ocrBlock.text,
        base_text_sha256: "c".repeat(64),
        corrected_text: body.corrected_text,
        corrected_text_sha256: "d".repeat(64),
        reason: body.reason,
        status: "pending",
        can_current_user_review: false,
        created_at: now,
        latest_review: null,
      };
      corrections.push(correction);
      ocrBlock.correction.latest_status = "pending";
      return fulfill(route, { ocr_block_correction: correction }, 201);
    }
    if (
      path === `${versionBase}/ocr-jobs/${OCR_JOB_ID}/result` &&
      method === "GET"
    ) {
      return fulfill(route, { ocr_result: ocrResult });
    }
    if (path === `${versionBase}/citations` && method === "GET") {
      return fulfill(route, {
        items: citations.map(({ quote_text: quoteText, ...citation }) => ({
          ...citation,
          quote_preview: quoteText,
        })),
      });
    }
    if (path === `${versionBase}/citations` && method === "POST") {
      const body = request.postDataJSON() as {
        physical_page_number: number;
        start_block_id: string;
        end_block_id: string;
        start_offset: number;
        end_offset: number;
      };
      const citation = {
        id: "b0000000-0000-0000-0000-000000000001",
        evidence_item_id: EVIDENCE_ID,
        evidence_version_id: VERSION_ID,
        ocr_job_id: OCR_JOB_ID,
        ocr_result_id: OCR_RESULT_ID,
        ocr_page_id: "c0000000-0000-0000-0000-000000000001",
        physical_page_number: body.physical_page_number,
        anchor: {
          start_block_id: body.start_block_id,
          end_block_id: body.end_block_id,
          start_offset: body.start_offset,
          end_offset: body.end_offset,
        },
        viewer_location: {
          page_index: 0,
          physical_page_number: 1,
          scan_page_number: 1,
          printed_page_label: "1",
          rotation_degrees: 0,
          start_bbox: ocrBlock.bbox,
          end_bbox: ocrBlock.bbox,
        },
        source_state: "available",
        text_basis: ocrBlock.correction.effective_correction_id
          ? "corrected"
          : "ocr",
        block_sources: [
          {
            source_index: 0,
            ocr_block_id: OCR_BLOCK_ID,
            correction_id: ocrBlock.correction.effective_correction_id,
            text_sha256: ocrBlock.correction.effective_correction_id
              ? "d".repeat(64)
              : "c".repeat(64),
          },
        ],
        ocr_result_state: "current",
        latest_ocr_result_id: OCR_RESULT_ID,
        created_at: now,
        quote_text: ocrBlock.correction.effective_text,
      };
      citations.push(citation);
      return fulfill(route, { citation }, 201);
    }
    const citationMatch = new RegExp(`^${versionBase}/citations/([^/]+)$`).exec(
      path,
    );
    if (citationMatch && method === "GET") {
      return fulfill(route, {
        citation: citations.find((item) => item.id === citationMatch[1]),
      });
    }
    if (path.endsWith("/members") && method === "GET") {
      return fulfill(route, {
        items: [
          {
            id: "40000000-0000-0000-0000-000000000001",
            tenant_id: TENANT_ID,
            matter_id: path.split("/").at(-2),
            membership_id: MEMBERSHIP_ID,
            role: "owner",
            status: "active",
            version: 1,
            created_at: now,
            updated_at: now,
          },
        ],
      });
    }
    if (path.endsWith("/threads") && method === "GET") {
      return fulfill(route, { items: mappings });
    }
    if (path.endsWith("/threads") && method === "POST") {
      const body = request.postDataJSON() as { thread_id: string };
      const mapping = {
        id: "50000000-0000-0000-0000-000000000001",
        tenant_id: TENANT_ID,
        matter_id: path.split("/").at(-2),
        thread_id: body.thread_id,
        created_by_membership_id: MEMBERSHIP_ID,
        purpose: "matter-chat",
        status: "active",
        version: 1,
        created_at: now,
        updated_at: now,
      };
      mappings.push(mapping);
      return fulfill(route, { thread_mapping: mapping }, 201);
    }
    const detachMatch = /\/threads\/([^/]+)\/detach$/.exec(path);
    if (detachMatch && method === "POST") {
      const mapping = mappings.find(
        (item) => item.thread_id === detachMatch[1],
      );
      if (!mapping) {
        return route.fulfill({ status: 404, body: "mapping not found" });
      }
      mapping.status = "detached";
      mapping.version = Number(mapping.version) + 1;
      return fulfill(route, { thread_mapping: mapping });
    }
    return route.fulfill({ status: 404, body: "not mocked" });
  });
}

test("legal work navigation creates a one-off consultation and opens a server-bound chat", async ({
  page,
}) => {
  mockLangGraphAPI(page, { threads: [] });
  await mockLawAPI(page);

  await page.goto("/workspace/chats/new");
  const legalWorkLink = page
    .locator('[data-sidebar="sidebar"]')
    .getByRole("link", { name: "Legal work", exact: true });
  await expect(legalWorkLink).toHaveCount(1);
  await legalWorkLink.click();
  await page.waitForURL("**/workspace/law");

  await expect(
    page.getByRole("heading", { name: "Legal work", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Contract dispute").first()).toBeVisible();
  await expect(
    page.getByText("Service agreement", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Owner").first()).toBeVisible();

  await page
    .getByRole("button", { name: "New legal work", exact: true })
    .click();
  await page.getByLabel("Title").fill("Employment consultation");
  await page
    .getByLabel("Question, background or objective (optional)")
    .fill("Employment agreement");
  await page
    .getByRole("button", { name: "Create and start", exact: true })
    .click();
  await page.waitForURL(/\/workspace\/chats\/[0-9a-f-]{36}$/);
});

test("legal matter workspace stays within a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 664 });
  mockLangGraphAPI(page, { threads: [] });
  await mockLawAPI(page);

  await page.goto("/workspace/law");
  await expect(
    page.getByRole("heading", { name: "Legal work", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Contract dispute").first()).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
});

test("project tree deletes an owned idle conversation after confirmation", async ({
  page,
}) => {
  mockLangGraphAPI(page, { threads: [] });
  await mockLawAPI(page);

  await page.goto(`/workspace/law?tenant=${TENANT_ID}&matter=${MATTER_ID}`);
  await page
    .getByRole("button", { name: "New conversation: Contract dispute" })
    .click();
  await page.waitForURL(/\/workspace\/chats\/[0-9a-f-]{36}$/);

  const removeAction = page.getByRole("button", {
    name: /^Delete conversation:/,
  });
  await expect(removeAction).toBeVisible();
  await removeAction.click();
  await page.getByRole("menuitem", { name: "Delete conversation" }).click();

  const dialog = page.getByRole("dialog", { name: "Delete conversation" });
  await expect(dialog).toContainText("Saved project artifacts");
  const detachRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/detach"),
  );
  await dialog
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  expect((await detachRequest).postDataJSON()).toEqual({ expected_version: 1 });

  await expect(page).toHaveURL(
    new RegExp(`/workspace/law\\?tenant=${TENANT_ID}&matter=${MATTER_ID}$`),
  );
  await expect(page.getByText("No conversations yet")).toBeVisible();
  await expect(
    page.getByText("No conversation has been bound to this legal work item."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Open conversation/ }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("No conversations yet")).toBeVisible();
  await expect(
    page.getByText("No conversation has been bound to this legal work item."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Open conversation/ }),
  ).toHaveCount(0);
});

test("evidence workbench uploads, reads OCR and opens an immutable citation", async ({
  page,
}) => {
  mockLangGraphAPI(page, { threads: [] });
  await mockLawAPI(page);

  await page.goto("/workspace/law");
  await expect(
    page.getByRole("heading", { name: "Evidence workbench" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Signed service agreement Active" }),
  ).toBeVisible();
  await expect(page.getByText("Clean")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Run 1 Completed/ }),
  ).toBeVisible();
  const ocrText = page
    .getByRole("paragraph")
    .filter({ hasText: /^Payment shall be made within thirty days\.$/ });
  await expect(ocrText).toBeVisible();
  const ocrTextBox = await ocrText.boundingBox();
  expect(ocrTextBox?.width).toBeGreaterThan(180);
  await page.getByRole("button", { name: "Cite block" }).click();
  await expect(
    page.getByRole("heading", { name: "Citation viewer" }),
  ).toBeVisible();
  await expect(page.getByText("Physical PDF page 1")).toBeVisible();
  const citationDialog = page.getByRole("dialog");
  await expect(
    citationDialog
      .getByText("Payment shall be made within thirty days.", { exact: true })
      .last(),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Upload evidence" }).first().click();
  await page.getByLabel("Evidence title").fill("Uploaded exhibit");
  await page.getByLabel("Evidence file").setInputFiles({
    name: "exhibit.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test"),
  });
  await page.getByRole("button", { name: "Scan and upload" }).click();
  await expect(
    page.getByRole("button", { name: "Uploaded exhibit Active" }),
  ).toBeVisible();
});

test("low-confidence OCR requires human verification before citation", async ({
  page,
}) => {
  mockLangGraphAPI(page, { threads: [] });
  await mockLawAPI(page, { lowConfidence: true });

  await page.goto("/workspace/law");
  await expect(
    page.getByRole("heading", { name: "Review queue" }),
  ).toBeVisible();
  await expect(page.getByText("Verification 0/1")).toBeVisible();
  const citeButton = page.getByRole("button", { name: "Cite block" });
  await expect(citeButton).toBeDisabled();
  await expect(
    page.getByText(
      "Human verification is required before this OCR text can be cited.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Verify text" }).click();
  await expect(page.getByText("Human verified")).toBeVisible();
  await expect(
    page.getByText("No OCR blocks currently require review."),
  ).toBeVisible();
  await expect(citeButton).toBeEnabled();
  await citeButton.click();
  await expect(
    page.getByRole("heading", { name: "Citation viewer" }),
  ).toBeVisible();
});

test("OCR correction proposal preserves the source and waits for an independent reviewer", async ({
  page,
}) => {
  mockLangGraphAPI(page, { threads: [] });
  await mockLawAPI(page);

  await page.goto("/workspace/law");
  await page.getByRole("button", { name: "Correct text" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "OCR correction history" }),
  ).toBeVisible();
  await dialog
    .getByLabel("Proposed text")
    .fill("Payment must be made within thirty days.");
  await dialog.getByLabel("Reason for correction").fill("Source says must");
  await dialog.getByRole("button", { name: "Submit correction" }).click();

  await expect(
    dialog.getByText("Awaiting independent review").first(),
  ).toBeVisible();
  await expect(
    dialog.getByText("Payment shall be made within thirty days.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Payment must be made within thirty days.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByText("Waiting for another reviewer")).toBeVisible();
});

test("accepted OCR correction can be cited with sealed correction provenance", async ({
  page,
}) => {
  mockLangGraphAPI(page, { threads: [] });
  await mockLawAPI(page, { lowConfidence: true, acceptedCorrection: true });

  await page.goto("/workspace/law");
  await expect(page.getByText("Corrected text in effect")).toBeVisible();
  const citeButton = page.getByRole("button", { name: "Cite block" });
  await expect(citeButton).toBeEnabled();
  await citeButton.click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Citation viewer" }),
  ).toBeVisible();
  await expect(dialog.getByText("Accepted correction")).toBeVisible();
  await expect(dialog.locator("blockquote")).toHaveText(
    "Payment must be made within thirty days.",
  );
});

test("dual-control OCR review waits for a distinct second reviewer", async ({
  page,
}) => {
  mockLangGraphAPI(page, { threads: [] });
  await mockLawAPI(page, { lowConfidence: true, requiredVerifications: 2 });

  await page.goto("/workspace/law");
  const citeButton = page.getByRole("button", { name: "Cite block" });
  await page.getByRole("button", { name: "Verify text" }).click();

  await expect(citeButton).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Waiting for another reviewer" }),
  ).toBeDisabled();
  await expect(page.getByText("Verification 1/2").first()).toBeVisible();
  await expect(page.getByText("Partially verified")).toBeVisible();
});

test("evidence workbench cancels a processing OCR job", async ({ page }) => {
  mockLangGraphAPI(page, { threads: [] });
  await mockLawAPI(page, { ocrStatus: "processing" });

  await page.goto("/workspace/law");
  const run = page.getByRole("button", { name: /Run 1 Processing/ });
  await expect(run).toBeVisible();
  const cancellationRequest = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith(
        `/ocr-jobs/${OCR_JOB_ID}/cancel`,
      ),
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await cancellationRequest;
  await expect(
    page.getByRole("button", { name: /Run 1 Cancelled/ }),
  ).toBeVisible();
});
