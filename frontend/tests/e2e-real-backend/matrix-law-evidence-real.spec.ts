import { expect, test } from "@playwright/test";

const APP =
  process.env.E2E_APP_URL ??
  `http://localhost:${process.env.E2E_FRONTEND_PORT ?? "3019"}`;

test("uploads, scans, OCRs, reruns and cites evidence through the real isolated stack", async ({
  browser,
  context,
  page,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const registration = await context.request.post(
    `${APP}/api/v1/auth/register`,
    {
      data: {
        email: `phase9-${suffix}@example.com`,
        password: "phase9-very-strong-password-123",
      },
    },
  );
  expect(registration.status(), await registration.text()).toBe(201);

  // Generate a deterministic non-production evidence image in the browser so
  // no private fixture bytes enter the repository.
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.setContent(`
    <style>
      @page { size: 1100px 720px; margin: 0; }
      body { margin: 0; }
      .evidence-page { box-sizing: border-box; width: 1100px; height: 720px; padding: 70px; background: #fff; color: #111; font-family: Arial, 'PingFang SC', sans-serif; break-after: page; }
      .evidence-page:last-child { break-after: auto; }
    </style>
    <section id="evidence" class="evidence-page">
      <div style="font-size:42px;font-weight:700;margin-bottom:48px">合同编号 2026</div>
      <div style="font-size:36px;margin-bottom:34px">付款期限 PAYMENT WITHIN 30 DAYS</div>
      <div style="font-size:36px">合同金额 128,000 元</div>
    </section>
    <section class="evidence-page">
      <div style="font-size:42px;font-weight:700;margin-bottom:48px">附件清单 02</div>
      <div style="font-size:36px;margin-bottom:34px">交付日期 DELIVERY DATE 2026-12-31</div>
      <div style="font-size:36px">见证人 TEST WITNESS</div>
    </section>
  `);
  const evidencePng = await page.locator("#evidence").screenshot();
  const evidencePdf = await page.pdf({
    width: "1100px",
    height: "720px",
    printBackground: true,
  });
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.setContent(`
    <svg id="structure-fixture" width="1400" height="1000" xmlns="http://www.w3.org/2000/svg">
      <rect width="1400" height="1000" fill="white"/>
      <text x="80" y="95" font-family="Arial" font-weight="bold" font-size="46">Contract Payment Schedule</text>
      <g stroke="black" stroke-width="5">
        <line x1="90" y1="180" x2="1310" y2="180"/><line x1="90" y1="290" x2="1310" y2="290"/>
        <line x1="90" y1="410" x2="1310" y2="410"/><line x1="90" y1="530" x2="1310" y2="530"/>
        <line x1="90" y1="650" x2="1310" y2="650"/><line x1="90" y1="180" x2="90" y2="650"/>
        <line x1="430" y1="180" x2="430" y2="650"/><line x1="900" y1="180" x2="900" y2="650"/>
        <line x1="1310" y1="180" x2="1310" y2="650"/>
      </g>
      <g fill="black" font-family="Arial" font-size="42">
        <text x="110" y="255">Item</text><text x="450" y="255">Due date</text><text x="920" y="255">Amount</text>
        <text x="110" y="375">Deposit</text><text x="450" y="375">2026-10-01</text><text x="920" y="375">USD 10,000</text>
        <text x="110" y="495">Delivery</text><text x="450" y="495">2026-11-15</text><text x="920" y="495">USD 25,000</text>
        <text x="110" y="615">Total</text><text x="920" y="615">USD 35,000</text>
      </g>
      <g fill="black" font-family="Times New Roman" font-size="64">
        <text x="120" y="825">E = mc²</text><text x="600" y="825">x² + y² = z²</text>
      </g>
    </svg>
  `);
  const structurePng = await page.locator("#structure-fixture").screenshot();
  await page.setContent(`
    <style>
      @page { size: 1100px 720px; margin: 0; }
      body { margin: 0; }
      .evidence-page { box-sizing: border-box; width: 1100px; height: 720px; padding: 70px; background: #fff; color: #111; font-family: Arial, sans-serif; break-after: page; }
      .evidence-page:last-child { break-after: auto; }
    </style>
    ${Array.from(
      { length: 24 },
      (_, index) => `
        <section class="evidence-page">
          <div style="font-size:42px;font-weight:700;margin-bottom:48px">CANCELLATION TEST PAGE ${index + 1}</div>
          <div style="font-size:36px;margin-bottom:34px">SYNTHETIC NON PRODUCTION DOCUMENT</div>
          <div style="font-size:36px">REQUEST MUST NOT COMMIT AFTER CANCEL</div>
        </section>`,
    ).join("")}
  `);
  const cancellationPdf = await page.pdf({
    width: "1100px",
    height: "720px",
    printBackground: true,
  });

  await page.goto("/workspace/law");
  await expect(
    page.getByRole("heading", { name: "Legal matters" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "New workspace" }).first().click();
  const tenantDialog = page.getByRole("dialog");
  await tenantDialog.getByLabel("Workspace name").fill("Phase 9 Legal Lab");
  await tenantDialog.getByLabel("Workspace slug").fill(`phase9-${suffix}`);
  await tenantDialog
    .getByLabel("Your display name (optional)")
    .fill("QA Owner");
  await tenantDialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Phase 9 Legal Lab").first()).toBeVisible();

  await page.getByRole("button", { name: "New matter" }).click();
  const matterDialog = page.getByRole("dialog");
  await matterDialog.getByLabel("Case number").fill(`CASE-${suffix}`);
  await matterDialog
    .getByLabel("Matter title")
    .fill("Synthetic contract review");
  await matterDialog
    .getByLabel("Cause or subject (optional)")
    .fill("Non-production OCR integration fixture");
  await matterDialog.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByText("Synthetic contract review").first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Upload evidence" }).first().click();
  const uploadDialog = page.getByRole("dialog");
  await uploadDialog.getByLabel("Evidence title").fill("Synthetic agreement");
  await uploadDialog.getByLabel("Evidence file").setInputFiles({
    name: "synthetic-agreement.png",
    mimeType: "image/png",
    buffer: evidencePng,
  });
  await uploadDialog.getByRole("button", { name: "Scan and upload" }).click();

  await expect(
    page.getByRole("button", { name: "Synthetic agreement Active" }),
  ).toBeVisible();
  await expect(page.getByText("Clean")).toBeVisible();

  await page.getByRole("button", { name: "Open document" }).click();
  const documentDialog = page.getByRole("dialog");
  await expect(
    documentDialog.locator('object[aria-label="Open document"]'),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Run OCR" }).click();
  const runOne = page.getByRole("button").filter({ hasText: "Run 1" });
  await expect(runOne).toContainText("Completed", { timeout: 120_000 });
  await expect(
    page.getByRole("button", { name: "Cite block" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Review queue" }),
  ).toBeVisible();
  const reviewQueuePanel = page.locator(
    'section[aria-labelledby="ocr-review-queue-title"]',
  );
  const reviewQueueCountBadge = reviewQueuePanel
    .locator('[data-slot="badge"]')
    .first();
  const initialQueueCount = Number(await reviewQueueCountBadge.textContent());
  expect(initialQueueCount).toBeGreaterThan(0);
  await expect(page.getByText("Verification 0/1").first()).toBeVisible();
  const reviewRequiredBlock = page
    .getByRole("status")
    .filter({
      hasText:
        "Human verification is required before this OCR text can be cited.",
    })
    .first()
    .locator("..");
  const reviewRequiredText = (
    await reviewRequiredBlock.locator("p").first().innerText()
  ).trim();
  const stableReviewRequiredBlock = page
    .getByRole("region", { name: "OCR result" })
    .getByText(reviewRequiredText, { exact: true })
    .last()
    .locator("..");
  const firstCitationButton = stableReviewRequiredBlock.getByRole("button", {
    name: "Cite block",
  });
  await expect(firstCitationButton).toBeDisabled();
  await expect(reviewRequiredBlock).toContainText(
    "Human verification is required before this OCR text can be cited.",
  );
  await reviewRequiredBlock
    .getByRole("button", { name: "Verify text" })
    .click();
  await expect(page.getByText("Human verified").first()).toBeVisible();
  if (initialQueueCount === 1) {
    await expect(
      reviewQueuePanel.getByText("No OCR blocks currently require review."),
    ).toBeVisible();
  } else {
    await expect(reviewQueueCountBadge).toHaveText(
      String(initialQueueCount - 1),
    );
  }
  await expect(firstCitationButton).toBeEnabled();
  await firstCitationButton.click();
  let citationDialog = page.getByRole("dialog");
  await expect(
    citationDialog.getByRole("heading", { name: "Citation viewer" }),
  ).toBeVisible();
  await expect(citationDialog.getByText("Physical PDF page 1")).toBeVisible();
  await expect(citationDialog.locator("blockquote")).not.toHaveText("");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Run again" }).click();
  const runTwo = page.getByRole("button").filter({ hasText: "Run 2" });
  await expect(runTwo).toContainText("Completed", { timeout: 120_000 });

  await page.getByRole("button", { name: "View citation" }).first().click();
  citationDialog = page.getByRole("dialog");
  await expect(citationDialog.getByText("Superseded")).toBeVisible();
  await expect(citationDialog.locator("blockquote")).not.toHaveText("");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Upload evidence" }).click();
  const pdfUploadDialog = page.getByRole("dialog");
  await pdfUploadDialog
    .getByLabel("Evidence title")
    .fill("Synthetic PDF exhibit");
  await pdfUploadDialog.getByLabel("Evidence file").setInputFiles({
    name: "synthetic-two-page-exhibit.pdf",
    mimeType: "application/pdf",
    buffer: evidencePdf,
  });
  await pdfUploadDialog
    .getByRole("button", { name: "Scan and upload" })
    .click();

  await expect(
    page.getByRole("button", { name: "Synthetic PDF exhibit Active" }),
  ).toBeVisible();
  await expect(
    page.getByText("synthetic-two-page-exhibit.pdf", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Clean", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Run OCR" }).click();
  await expect(
    page.getByRole("button").filter({ hasText: "Run 1" }),
  ).toContainText("Completed", { timeout: 120_000 });
  await expect(page.getByRole("button", { name: "Page 1" })).toBeVisible();
  await page.getByRole("button", { name: "Page 2" }).click();
  await expect(
    page.getByRole("button", { name: "Cite block" }).first(),
  ).toBeVisible();
  const secondPageReviewRequiredBlock = page
    .getByRole("status")
    .filter({
      hasText:
        "Human verification is required before this OCR text can be cited.",
    })
    .first()
    .locator("..");
  const secondPageReviewRequiredText = (
    await secondPageReviewRequiredBlock.locator("p").first().innerText()
  ).trim();
  const stableSecondPageReviewRequiredBlock = page
    .getByRole("region", { name: "OCR result" })
    .getByText(secondPageReviewRequiredText, { exact: true })
    .last()
    .locator("..");
  const secondPageCitationButton =
    stableSecondPageReviewRequiredBlock.getByRole("button", {
      name: "Cite block",
    });
  await expect(secondPageCitationButton).toBeDisabled();
  await secondPageReviewRequiredBlock
    .getByRole("button", { name: "Verify text" })
    .click();
  await expect(secondPageCitationButton).toBeEnabled();
  await secondPageCitationButton.click();
  citationDialog = page.getByRole("dialog");
  await expect(citationDialog.getByText("Physical PDF page 2")).toBeVisible();
  await expect(citationDialog.locator("blockquote")).not.toHaveText("");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Upload evidence" }).click();
  const cancellationUploadDialog = page.getByRole("dialog");
  await cancellationUploadDialog
    .getByLabel("Evidence title")
    .fill("Cancellation fixture");
  await cancellationUploadDialog.getByLabel("Evidence file").setInputFiles({
    name: "synthetic-cancellation-fixture.pdf",
    mimeType: "application/pdf",
    buffer: cancellationPdf,
  });
  await cancellationUploadDialog
    .getByRole("button", { name: "Scan and upload" })
    .click();
  await expect(
    page.getByRole("button", { name: "Cancellation fixture Active" }),
  ).toBeVisible();
  await expect(
    page.getByText("synthetic-cancellation-fixture.pdf", { exact: true }),
  ).toBeVisible();
  const cancellationScheduleResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/ocr-jobs") &&
      response.status() === 202,
  );
  await page.getByRole("button", { name: "Run OCR" }).click();
  const scheduledCancellation = await cancellationScheduleResponse;
  const scheduledCancellationBody = (await scheduledCancellation.json()) as {
    data: { ocr_job: { id: string } };
  };
  const cancellationJobId = scheduledCancellationBody.data.ocr_job.id;
  const cancellationJobsUrl = scheduledCancellation.url();
  const cancellationStatus = async () => {
    const response = await context.request.get(cancellationJobsUrl);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: { items: Array<{ id: string; status: string }> };
    };
    return body.data.items.find((item) => item.id === cancellationJobId)
      ?.status;
  };
  await expect
    .poll(cancellationStatus, {
      timeout: 60_000,
      intervals: [100, 100, 250, 500],
    })
    .toBe("processing");
  const cancellationRun = page.getByRole("button").filter({ hasText: "Run 1" });
  const cancelButton = page.getByRole("button", {
    name: "Cancel",
    exact: true,
  });
  await expect(cancelButton).toBeVisible({ timeout: 15_000 });
  const [cancellationResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(
          `/ocr-jobs/${cancellationJobId}/cancel`,
        ),
      { timeout: 15_000 },
    ),
    cancelButton.click(),
  ]);
  expect(cancellationResponse.status()).toBe(200);
  await expect.poll(cancellationStatus, { timeout: 60_000 }).toBe("cancelled");
  await expect(cancellationRun).toContainText("Cancelled", {
    timeout: 60_000,
  });

  const tenantListA = await context.request.get(`${APP}/api/law/tenants`);
  expect(tenantListA.status()).toBe(200);
  const tenantListABody = (await tenantListA.json()) as {
    data: { items: Array<{ tenant: { id: string } }> };
  };
  expect(tenantListABody.data.items).toHaveLength(1);
  const tenantAId = tenantListABody.data.items[0]!.tenant.id;
  const matterListA = await context.request.get(
    `${APP}/api/law/tenants/${tenantAId}/matters`,
  );
  expect(matterListA.status()).toBe(200);
  const matterListABody = (await matterListA.json()) as {
    data: { items: Array<{ id: string }> };
  };
  expect(matterListABody.data.items).toHaveLength(1);
  const matterAId = matterListABody.data.items[0]!.id;

  await page.getByRole("button", { name: "Upload evidence" }).click();
  const structureUploadDialog = page.getByRole("dialog");
  await structureUploadDialog
    .getByLabel("Evidence title")
    .fill("Structured payment schedule");
  await structureUploadDialog.getByLabel("Evidence file").setInputFiles({
    name: "synthetic-table-formula.png",
    mimeType: "image/png",
    buffer: structurePng,
  });
  const structureUploadResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/evidence") &&
      response.status() === 201,
  );
  await structureUploadDialog
    .getByRole("button", { name: "Scan and upload" })
    .click();
  const structureUploadResponse = await structureUploadResponsePromise;
  const structureUploadBody = (await structureUploadResponse.json()) as {
    data: {
      evidence_item: { id: string };
      evidence_version: { id: string };
    };
  };
  await expect(
    page.getByRole("button", { name: "Structured payment schedule Active" }),
  ).toBeVisible();
  const structureEvidenceId = structureUploadBody.data.evidence_item.id;
  const structureVersionId = structureUploadBody.data.evidence_version.id;
  const structureJobPath = `/api/law/tenants/${tenantAId}/matters/${matterAId}/evidence/${structureEvidenceId}/versions/${structureVersionId}/ocr-jobs`;
  const structureSchedule = await page.evaluate(
    async ({ path }) => {
      const csrfToken = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("csrf_token="))
        ?.slice("csrf_token=".length);
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...(csrfToken
            ? { "X-CSRF-Token": decodeURIComponent(csrfToken) }
            : {}),
        },
        body: JSON.stringify({
          language: "auto",
          enable_table: true,
          enable_formula: true,
        }),
      });
      return { status: response.status, body: await response.json() };
    },
    { path: structureJobPath },
  );
  expect(structureSchedule.status).toBe(202);
  const structureJobId = (
    structureSchedule.body as { data: { ocr_job: { id: string } } }
  ).data.ocr_job.id;
  await expect
    .poll(
      async () => {
        const response = await context.request.get(
          `${APP}${structureJobPath}/${structureJobId}`,
        );
        expect(response.status()).toBe(200);
        const body = (await response.json()) as {
          data: { ocr_job: { status: string } };
        };
        return body.data.ocr_job.status;
      },
      { timeout: 120_000, intervals: [250, 500, 1000] },
    )
    .toBe("succeeded");
  const structurePageResponse = await context.request.get(
    `${APP}${structureJobPath}/${structureJobId}/result/pages/1`,
  );
  expect(structurePageResponse.status()).toBe(200);
  const structurePageBody = (await structurePageResponse.json()) as {
    data: {
      ocr_page: {
        blocks: Array<{
          kind: string;
          structure:
            | {
                type: "table";
                rows: number;
                columns: number;
                cells: unknown[];
              }
            | { type: "formula"; latex: string }
            | null;
        }>;
      };
    };
  };
  const structureBlocks = structurePageBody.data.ocr_page.blocks;
  const tableBlock = structureBlocks.find(
    (block) => block.structure?.type === "table",
  );
  const formulaBlock = structureBlocks.find(
    (block) => block.structure?.type === "formula",
  );
  expect(tableBlock?.structure).toMatchObject({
    type: "table",
    rows: 4,
    columns: 3,
  });
  expect(
    tableBlock?.structure?.type === "table"
      ? tableBlock.structure.cells.length
      : 0,
  ).toBe(12);
  expect(
    formulaBlock?.structure?.type === "formula"
      ? formulaBlock.structure.latex
      : "",
  ).not.toBe("");

  const secondContext = await browser.newContext();
  try {
    const secondRegistration = await secondContext.request.post(
      `${APP}/api/v1/auth/register`,
      {
        data: {
          email: `phase10-tenant-b-${suffix}@example.com`,
          password: "phase10-very-strong-password-123",
        },
      },
    );
    expect(secondRegistration.status(), await secondRegistration.text()).toBe(
      201,
    );
    const secondPage = await secondContext.newPage();
    await secondPage.goto(`${APP}/workspace/law`);
    await expect(
      secondPage.getByRole("heading", { name: "Legal matters" }),
    ).toBeVisible();
    const tenantBCreate = await secondPage.evaluate(
      async ({ slug }) => {
        const csrfToken = document.cookie
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith("csrf_token="))
          ?.slice("csrf_token=".length);
        const response = await fetch("/api/law/tenants", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
            ...(csrfToken
              ? { "X-CSRF-Token": decodeURIComponent(csrfToken) }
              : {}),
          },
          body: JSON.stringify({
            name: "Phase 10 Isolated Workspace B",
            slug,
            owner_display_name: "Tenant B Owner",
          }),
        });
        return { status: response.status, body: await response.text() };
      },
      { slug: `phase10-b-${suffix}` },
    );
    expect(tenantBCreate.status, tenantBCreate.body).toBe(201);

    const tenantListB = await secondContext.request.get(
      `${APP}/api/law/tenants`,
    );
    expect(tenantListB.status()).toBe(200);
    const tenantListBBody = (await tenantListB.json()) as {
      data: { items: Array<{ tenant: { id: string } }> };
    };
    expect(tenantListBBody.data.items).toHaveLength(1);
    const tenantBId = tenantListBBody.data.items[0]!.tenant.id;

    const [aReadsB, bReadsA] = await Promise.all([
      context.request.get(`${APP}/api/law/tenants/${tenantBId}`),
      secondContext.request.get(`${APP}/api/law/tenants/${tenantAId}`),
    ]);
    expect(aReadsB.status()).toBe(404);
    expect(bReadsA.status()).toBe(404);
    expect(tenantListBBody.data.items.map((item) => item.tenant.id)).toEqual([
      tenantBId,
    ]);
  } finally {
    await secondContext.close();
  }
});
