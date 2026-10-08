import { expect, test } from "@playwright/test";

const APP =
  process.env.E2E_APP_URL ??
  `http://localhost:${process.env.E2E_FRONTEND_PORT ?? "3020"}`;
const LOAD_BALANCER = `http://127.0.0.1:${
  process.env.E2E_GATEWAY_PORT ?? "8018"
}`;
const EVIDENCE_PAGE_COUNT = 8;

test("recovers a leased OCR job after every original Gateway process is killed", async ({
  context,
  page,
}) => {
  const upstreams = new Set<string>();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await context.request.get(`${LOAD_BALANCER}/health`, {
      headers: { Connection: "close" },
    });
    expect(response.status()).toBe(200);
    const upstream = response.headers()["x-matrix-test-upstream"];
    if (upstream) upstreams.add(upstream);
  }
  expect(upstreams.size).toBe(2);

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const registration = await context.request.post(
    `${APP}/api/v1/auth/register`,
    {
      data: {
        email: `phase10b-${suffix}@example.com`,
        password: "phase10b-very-strong-password-123",
      },
    },
  );
  expect(registration.status(), await registration.text()).toBe(201);

  await page.setViewportSize({ width: 1100, height: 720 });
  await page.setContent(`
    <style>
      @page { size: 1100px 720px; margin: 0; }
      body { margin: 0; }
      .evidence-page { box-sizing: border-box; width: 1100px; height: 720px; padding: 70px; background: #fff; color: #111; font-family: Arial, sans-serif; break-after: page; }
      .evidence-page:last-child { break-after: auto; }
    </style>
    ${Array.from(
      { length: EVIDENCE_PAGE_COUNT },
      (_, index) => `
        <section class="evidence-page">
          <div style="font-size:42px;font-weight:700;margin-bottom:48px">FAILOVER PAGE ${index + 1}</div>
          <div style="font-size:36px;margin-bottom:34px">SYNTHETIC MULTI GATEWAY TEST</div>
          <div style="font-size:36px">DURABLE OCR LEASE RECOVERY</div>
        </section>`,
    ).join("")}
  `);
  const failoverPdf = await page.pdf({
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
  await tenantDialog.getByLabel("Workspace name").fill("Phase 10B Failover");
  await tenantDialog.getByLabel("Workspace slug").fill(`phase10b-${suffix}`);
  await tenantDialog
    .getByLabel("Your display name (optional)")
    .fill("Failover Owner");
  await tenantDialog.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText("Phase 10B Failover").first()).toBeVisible();

  await page.getByRole("button", { name: "New matter" }).click();
  const matterDialog = page.getByRole("dialog");
  await matterDialog.getByLabel("Case number").fill(`FAILOVER-${suffix}`);
  await matterDialog
    .getByLabel("Matter title")
    .fill("Synthetic Gateway crash recovery");
  await matterDialog.getByRole("button", { name: "Create" }).click();
  await expect(
    page.getByText("Synthetic Gateway crash recovery").first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "Upload evidence" }).first().click();
  const uploadDialog = page.getByRole("dialog");
  await uploadDialog.getByLabel("Evidence title").fill("Failover fixture");
  await uploadDialog.getByLabel("Evidence file").setInputFiles({
    name: `synthetic-${EVIDENCE_PAGE_COUNT}-page-failover.pdf`,
    mimeType: "application/pdf",
    buffer: failoverPdf,
  });
  await uploadDialog.getByRole("button", { name: "Scan and upload" }).click();
  await expect(
    page.getByRole("button", { name: "Failover fixture Active" }),
  ).toBeVisible();

  const scheduleResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/ocr-jobs") &&
      response.status() === 202,
  );
  await page.getByRole("button", { name: "Run OCR" }).click();
  const scheduleResponse = await scheduleResponsePromise;
  const scheduleBody = (await scheduleResponse.json()) as {
    data: { ocr_job: { id: string } };
  };
  const jobId = scheduleBody.data.ocr_job.id;
  const jobsUrl = scheduleResponse.url();
  let observedGatewayOutage = false;

  const currentStatus = async (): Promise<string> => {
    try {
      const response = await context.request.get(jobsUrl);
      if (response.status() !== 200) {
        observedGatewayOutage = true;
        return `http-${response.status()}`;
      }
      const body = (await response.json()) as {
        data: { items: Array<{ id: string; status: string }> };
      };
      return (
        body.data.items.find((item) => item.id === jobId)?.status ?? "missing"
      );
    } catch {
      observedGatewayOutage = true;
      return "network-error";
    }
  };

  await expect
    .poll(currentStatus, {
      timeout: 300_000,
      intervals: [100, 250, 500, 1000],
    })
    .toBe("succeeded");
  expect(observedGatewayOutage).toBe(true);

  const sessionAfterFailover = await context.request.get(
    `${APP}/api/law/tenants`,
  );
  expect(sessionAfterFailover.status()).toBe(200);
  const tenants = (await sessionAfterFailover.json()) as {
    data: { items: unknown[] };
  };
  expect(tenants.data.items).toHaveLength(1);

  const finalPage = await context.request.get(
    `${jobsUrl}/${jobId}/result/pages/${EVIDENCE_PAGE_COUNT}`,
  );
  const finalPageText = await finalPage.text();
  expect(finalPage.status(), finalPageText).toBe(200);
  const finalPageBody = JSON.parse(finalPageText) as {
    data: { ocr_page: { physical_page_number: number; blocks: unknown[] } };
  };
  expect(finalPageBody.data.ocr_page.physical_page_number).toBe(
    EVIDENCE_PAGE_COUNT,
  );
  expect(finalPageBody.data.ocr_page.blocks.length).toBeGreaterThan(0);
});
