import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

const frontendUrl = `http://127.0.0.1:${process.env.W12_FRONTEND_PORT ?? "3312"}`;
const apiUrl = `http://127.0.0.1:${process.env.W12_API_PORT ?? "8312"}`;

type Fixture = {
  tenant_id: string;
  matter_id: string;
  owner_user_id: string;
  owner_membership_id: string;
  departing_user_id: string;
  departing_membership_id: string;
  departing_matter_member_id: string;
  successor_user_id: string;
  successor_membership_id: string;
};

function matterApi(tenantId: string, matterId: string): string {
  return `/api/law/tenants/${tenantId}/matters/${matterId}`;
}

async function pageForUser(
  browser: Browser,
  userId: string,
  tenantId: string,
  matterId: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    extraHTTPHeaders: { "X-Test-User-ID": userId },
  });
  const page = await context.newPage();
  const query = new URLSearchParams({
    tenant: tenantId,
    matter: matterId,
    view: "schedule",
  });
  await page.goto(`${frontendUrl}/workspace/law?${query.toString()}`);
  await expect(page.getByText("My cross-matter agenda", { exact: true })).toBeVisible();
  return { context, page };
}

async function requestJson<T>(
  context: BrowserContext,
  userId: string,
  path: string,
  method: "GET" | "POST" | "PATCH",
  data?: unknown,
  expectedStatus = 200,
): Promise<T> {
  const response = await context.request.fetch(`${frontendUrl}${path}`, {
    method,
    headers: {
      "X-Test-User-ID": userId,
      ...(method !== "GET" ? { "Idempotency-Key": randomUUID() } : {}),
    },
    data,
  });
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(expectedStatus);
  return body as T;
}

async function expectRlsProof(request: {
  get: (url: string) => Promise<{ status: () => number; json: () => Promise<unknown> }>;
}) {
  const response = await request.get(`${apiUrl}/__test/w12/rls-proof`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    database_role: "matrix_law_api",
    superuser: false,
    bypass_rls: false,
    incident_table_force_rls: true,
    candidate_draft_table_force_rls: true,
  });
}

test("real PostgreSQL W12 deadline lifecycle is reflected in the browser agenda", async ({
  browser,
  request,
}) => {
  await expectRlsProof(request);
  const fixtureResponse = await request.get(`${apiUrl}/__test/w12/fixture`);
  expect(fixtureResponse.status()).toBe(200);
  const fixture = (await fixtureResponse.json()) as Fixture;
  const {
    tenant_id,
    matter_id,
    owner_user_id,
    owner_membership_id,
    departing_user_id,
    departing_membership_id,
  } = fixture;
  const base = matterApi(tenant_id, matter_id);
  const accessProof = await request.get(
    `${apiUrl}/__test/w12/rls-context?tenant_id=${tenant_id}&matter_id=${matter_id}`,
    { headers: { "X-Test-User-ID": owner_user_id } },
  );
  expect(accessProof.status()).toBe(200);
  expect(await accessProof.json()).toMatchObject({
    database_role: "matrix_law_api",
    effective_user_id: owner_user_id,
    matter_access: true,
    privileged: false,
  });

  const localDate = (daysFromNow: number) => {
    const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  };
  const dueDate = localDate(4);
  const title = "W12 合成浏览器期限旅程";
  const requestContext = await browser.newContext();
  const created = await requestJson<{ data: { id: string; version: number; due_at: string } }>(
    requestContext,
    owner_user_id,
    `${base}/deadlines`,
    "POST",
    {
      kind: "filing",
      title,
      origin: "lawyer_entry",
      local_due_at: `${dueDate}T09:00:00`,
      due_precision: "date_only",
      legal_due_date: dueDate,
      timezone_name: "Asia/Shanghai",
      basis_note: "合成浏览器验收事实，不是法律材料。",
      rule_version: "w12-browser-synthetic-v1",
      source_refs: ["synthetic:w12-browser"],
      calculation: { explanation: "手工登记的合成日期，仅用于隔离验收。" },
    },
    201,
  );
  const draft = created.data as { id: string; version: number; due_at: string };
  const outboxInsertProof = await request.post(
    `${apiUrl}/__test/w12/outbox-insert-proof?tenant_id=${tenant_id}&matter_id=${matter_id}&deadline_id=${draft.id}`,
    { headers: { "X-Test-User-ID": owner_user_id } },
  );
  expect(outboxInsertProof.status()).toBe(200);
  expect(await outboxInsertProof.json()).toEqual({ insert_allowed: true });

  const confirmed = await requestJson<{
    data: { id: string; version: number; due_at: string };
  }>(
    requestContext,
    owner_user_id,
    `${base}/deadlines/${draft.id}/confirm`,
    "POST",
    {
      expected_version: draft.version,
      primary_responsible_membership_id: departing_membership_id,
      recipient_membership_ids: [
        owner_membership_id,
        departing_membership_id,
        fixture.successor_membership_id,
      ],
      reminder_offsets_minutes: [60],
      channels: ["in_app"],
      reminder_time_local: "09:00",
    },
  );
  const confirmedDeadline = confirmed.data as { id: string; version: number; due_at: string };
  expect(confirmedDeadline.version).toBe(2);

  const dispatched = await request.post(`${apiUrl}/__test/w12/dispatch`, {
    data: {
      now: new Date(
        Date.parse(confirmedDeadline.due_at) - 30 * 60 * 1000,
      ).toISOString(),
    },
  });
  expect(dispatched.status()).toBe(200);
  expect((await dispatched.json()).dispatched).toBeGreaterThanOrEqual(1);

  const outbox = await requestJson<{
    data: {
      items: Array<{
        id: string;
        status: string;
        recipient_membership_id: string;
        read_at: string | null;
      }>;
    };
  }>(
    requestContext,
    owner_user_id,
    `${base}/notifications/outbox?limit=100`,
    "GET",
  );
  const ownNotification = (outbox.data.items as Array<{
    id: string;
    status: string;
    recipient_membership_id: string;
    read_at: string | null;
  }>).find(
    (item) =>
      item.recipient_membership_id === owner_membership_id &&
      item.status === "sent",
  );
  expect(ownNotification, JSON.stringify(outbox.data.items)).toBeDefined();
  const read = await requestJson<{ data: { read_at: string | null } }>(
    requestContext,
    owner_user_id,
    `${base}/notifications/outbox/${ownNotification!.id}/read`,
    "POST",
    {},
  );
  expect(read.data.read_at).toBeTruthy();

  const nextDueDate = localDate(5);
  const rescheduled = await requestJson<{
    data: { version: number; due_at: string };
  }>(
    requestContext,
    owner_user_id,
    `${base}/deadlines/${draft.id}/reschedule`,
    "POST",
    {
      expected_version: confirmedDeadline.version,
      primary_responsible_membership_id: departing_membership_id,
      local_due_at: `${nextDueDate}T09:00:00`,
      due_precision: "date_only",
      legal_due_date: nextDueDate,
      timezone_name: "Asia/Shanghai",
      basis_note: "合成改期记录，仅用于隔离浏览器验收。",
      rule_version: "w12-browser-synthetic-v2",
      source_refs: ["synthetic:w12-browser-reschedule"],
      calculation: { explanation: "合成改期，不代表法律期限判断。" },
      change_note: "合成日期调整。",
      recipient_membership_ids: [
        owner_membership_id,
        departing_membership_id,
        fixture.successor_membership_id,
      ],
      reminder_offsets_minutes: [60],
      channels: ["in_app"],
      reminder_time_local: "09:00",
    },
  );
  const rescheduledDeadline = rescheduled.data as { version: number; due_at: string };
  expect(rescheduledDeadline.version).toBe(3);

  await requestJson<{ data: { member: { status: string } } }>(
    requestContext,
    owner_user_id,
    `${base}/members/${fixture.departing_matter_member_id}`,
    "PATCH",
    { role: "lawyer", status: "removed", expected_version: 1 },
  );
  await requestJson<{ error: { code: string } }>(
    requestContext,
    departing_user_id,
    `${base}/deadlines?limit=100`,
    "GET",
    undefined,
    404,
  );
  const afterRevocation = await requestJson<{
    data: { items: Array<{ id: string; version: number; responsibility_state: string }> };
  }>(requestContext, owner_user_id, `${base}/deadlines?limit=100`, "GET");
  const pendingHandoff = afterRevocation.data.items.find(
    (deadline) => deadline.id === draft.id,
  );
  expect(pendingHandoff?.responsibility_state).toBe("pending_handoff");
  expect(pendingHandoff?.version).toBe(4);

  const handedOff = await requestJson<{
    data: { primary_responsible_membership_id: string; version: number };
  }>(
    requestContext,
    owner_user_id,
    `${base}/deadlines/${draft.id}/handoff`,
    "POST",
    {
      expected_version: pendingHandoff!.version,
      new_primary_responsible_membership_id: fixture.successor_membership_id,
      change_note: "合成负责人交接，仅用于隔离浏览器验收。",
    },
  );
  expect(handedOff.data.primary_responsible_membership_id).toBe(
    fixture.successor_membership_id,
  );
  expect(handedOff.data.version).toBe(5);

  const { context: successorContext, page } = await pageForUser(
    browser,
    fixture.successor_user_id,
    tenant_id,
    matter_id,
  );
  const agenda = page.locator('[aria-labelledby="my-matter-deadline-agenda-title"]');
  await expect(agenda.getByText(title, { exact: true })).toBeVisible();
  const agendaTime = agenda.locator("time");
  await expect(agendaTime).toBeVisible();
  await expect(agendaTime).not.toContainText(/\d{1,2}:\d{2}/);

  await page.setViewportSize({ width: 390, height: 844 });
  const narrowDocumentWidth = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  );
  expect(narrowDocumentWidth).toBeLessThanOrEqual(390);
  const matterLink = agenda.getByRole("link", { name: /W12-SYNTHETIC-/ });
  await matterLink.focus();
  await expect(matterLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`matter=${matter_id}.*view=schedule`));

  await page.reload();
  await expect(agenda.getByText(title, { exact: true })).toBeVisible();
  expect(await agenda.locator("time").getAttribute("datetime")).toBe(
    rescheduledDeadline.due_at,
  );

  await successorContext.close();
  await requestContext.close();
});

test("lawyer can create, confirm, and read a deadline through the real browser UI", async ({
  browser,
  request,
}) => {
  await expectRlsProof(request);
  const fixtureResponse = await request.get(`${apiUrl}/__test/w12/fixture`);
  expect(fixtureResponse.status()).toBe(200);
  const fixture = (await fixtureResponse.json()) as Fixture;
  const { context, page } = await pageForUser(
    browser,
    fixture.owner_user_id,
    fixture.tenant_id,
    fixture.matter_id,
  );
  const candidateDrafts = await requestJson<{
    data: { items: Array<{ title: string; status: string; missing_information: string[] }> };
  }>(
    context,
    fixture.owner_user_id,
    `${matterApi(fixture.tenant_id, fixture.matter_id)}/deadline-candidate-drafts?limit=100`,
    "GET",
  );
  expect(
    candidateDrafts.data.items.some(
      (draft) =>
        draft.title === "W12 待补资料合成候选" &&
        draft.status === "needs_information" &&
        draft.missing_information.includes("judgment_service_date"),
    ),
  ).toBe(true);
  await expect(page.getByText("待补资料的期限候选", { exact: true })).toBeVisible();
  await expect(page.getByText("W12 待补资料合成候选", { exact: false })).toBeVisible();
  const base = matterApi(fixture.tenant_id, fixture.matter_id);
  const recipients = await requestJson<{
    data: {
      items: Array<{ membership_id: string; role: string; display_name: string | null }>;
    };
  }>(context, fixture.owner_user_id, `${base}/deadline-recipients`, "GET");
  const ownerRecipient = recipients.data.items.find(
    (recipient) => recipient.membership_id === fixture.owner_membership_id,
  );
  expect(ownerRecipient).toBeDefined();
  const ownerDisplay = ownerRecipient!.display_name?.trim();
  const ownerRecipientLabel = `${ownerDisplay && ownerDisplay.length > 0 ? ownerDisplay : `成员 ${fixture.owner_membership_id.slice(0, 8)}`} · ${ownerRecipient!.role}`;
  const title = "W12 页面操作合成期限";
  const date = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  await page.getByRole("button", { name: "新建提案" }).click();
  const proposal = page
    .locator("form")
    .filter({ has: page.getByRole("heading", { name: "新增待确认期限" }) });
  await proposal.locator('[name="due_precision"]').selectOption("date_only");
  await proposal.locator('[name="kind"]').selectOption("filing");
  await proposal.locator('[name="title"]').fill(title);
  await proposal.locator('[name="local_due_date"]').fill(date);
  await proposal.locator('[name="local_due_time"]').fill("09:00");
  await proposal.locator('[name="timezone_name"]').fill("Asia/Shanghai");
  await proposal.locator('[name="rule_version"]').fill("synthetic-browser-ui-v1");
  await proposal.locator('[name="basis_note"]').fill("仅用于隔离浏览器验收的合成依据。");
  await proposal
    .locator('[name="calculation_explanation"]')
    .fill("律师手工录入的合成日期。");
  await proposal.getByRole("button", { name: "保存待确认提案" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  await page
    .getByRole("group", { name: "提醒接收成员" })
    .getByLabel(ownerRecipientLabel)
    .check();
  await page.getByLabel("期限主要负责人").selectOption(fixture.owner_membership_id);
  await page.getByLabel("内部提醒排期时刻").fill("09:00");
  const confirmResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`${base}/deadlines/`) &&
      response.url().endsWith("/confirm"),
  );
  await page.getByRole("button", { name: "确认期限并安排站内提醒" }).click();
  const confirmationResponse = await confirmResponsePromise;
  expect(confirmationResponse.status()).toBe(200);
  const confirmation = (await confirmationResponse.json()) as {
    data: { id: string; reminder_plan: { recipient_membership_ids: string[] } };
  };
  expect(confirmation.data.reminder_plan.recipient_membership_ids).toContain(
    fixture.owner_membership_id,
  );
  await expect(page.getByText("已确认", { exact: true })).toBeVisible();

  const listed = await requestJson<{
    data: { items: Array<{ id: string; title: string; due_at: string }> };
  }>(context, fixture.owner_user_id, `${base}/deadlines?limit=100`, "GET");
  const saved = listed.data.items.find((item) => item.title === title);
  expect(saved).toBeDefined();
  expect(saved!.id).toBe(confirmation.data.id);
  const pendingOutbox = await requestJson<{
    data: { items: Array<{ id: string; deadline_id: string; status: string; scheduled_at: string }> };
  }>(context, fixture.owner_user_id, `${base}/notifications/outbox?limit=100`, "GET");
  const reminderToDispatch = pendingOutbox.data.items
    .filter((item) => item.deadline_id === saved!.id && item.status === "pending")
    .sort((left, right) => Date.parse(left.scheduled_at) - Date.parse(right.scheduled_at))[0];
  expect(reminderToDispatch, JSON.stringify(pendingOutbox.data.items)).toBeDefined();
  expect(Date.parse(reminderToDispatch!.scheduled_at)).toBeLessThanOrEqual(
    Date.parse(saved!.due_at),
  );
  const dispatch = await request.post(`${apiUrl}/__test/w12/dispatch`, {
    data: {
      now: new Date(Date.parse(reminderToDispatch!.scheduled_at) + 1000).toISOString(),
    },
  });
  expect(dispatch.status()).toBe(200);
  expect((await dispatch.json()).dispatched).toBeGreaterThanOrEqual(1);

  const dispatchedOutbox = await requestJson<{
    data: {
      items: Array<{
        id: string;
        deadline_id: string;
        status: string;
        read_at: string | null;
      }>;
    };
  }>(context, fixture.owner_user_id, `${base}/notifications/outbox?limit=100`, "GET");
  const notificationToRead = dispatchedOutbox.data.items.find(
    (item) =>
      item.id === reminderToDispatch!.id &&
      item.status === "sent" &&
      item.read_at === null,
  );
  expect(notificationToRead, JSON.stringify(dispatchedOutbox.data.items)).toBeDefined();

  await page.getByRole("button", { name: "刷新" }).click();
  const reminders = page.locator(
    'section[aria-labelledby="my-deadline-reminders-title"]',
  );
  const targetReminder = reminders.locator(
    `li[data-notification-id="${notificationToRead!.id}"]`,
  );
  await expect(targetReminder.getByText(title, { exact: false })).toBeVisible();
  const markRead = targetReminder.getByRole("button", { name: "标记已读" });
  await expect(markRead).toBeVisible();
  await markRead.click();
  await expect(targetReminder.getByText(/已读/u)).toBeVisible();
  await expect(
    targetReminder.getByRole("button", { name: "标记已读" }),
  ).toHaveCount(0);

  const outbox = await requestJson<{
    data: { items: Array<{ id: string; deadline_id: string; read_at: string | null }> };
  }>(context, fixture.owner_user_id, `${base}/notifications/outbox?limit=100`, "GET");
  expect(
    outbox.data.items.some(
      (item) => item.id === notificationToRead!.id && item.read_at,
    ),
  ).toBe(true);
  await context.close();
});
