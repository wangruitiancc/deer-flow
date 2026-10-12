import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

const platformUrl = process.env.S7_PLATFORM_URL!;
const tenantAdminUrl = process.env.S7_TENANT_ADMIN_URL!;
const lawyerUrl = process.env.S7_LAWYER_URL!;
const platformEmail = process.env.S7_PLATFORM_EMAIL!;
const platformPassword = process.env.S7_PLATFORM_PASSWORD!;
const systemEmail = process.env.S7_SYSTEM_ADMIN_EMAIL!;
const systemPassword = process.env.S7_SYSTEM_ADMIN_PASSWORD!;
const ownerEmail = process.env.S7_OWNER_EMAIL!;
const ownerPassword = process.env.S7_OWNER_PASSWORD!;
const mailSinkUrl = process.env.S7_MAIL_SINK_URL!;
const capabilityEndpoint = process.env.S7_CAPABILITY_ENDPOINT!;
const capabilityIssuer = process.env.S7_CAPABILITY_ISSUER!;
const capabilityDatabaseUrl = process.env.S7_CAPABILITY_DATABASE_URL!;
const tenantDatabaseUrl = process.env.S7_TENANT_DATABASE_URL!;
const psqlBin = process.env.S7_PSQL_BIN!;
const lawyerMemberEmail = process.env.S7_LAWYER_MEMBER_EMAIL!;
const lawyerMemberPassword = process.env.S7_LAWYER_MEMBER_PASSWORD!;
const financeEmail = process.env.S7_FINANCE_EMAIL!;
const financePassword = process.env.S7_FINANCE_PASSWORD!;
const secondOwnerEmail = process.env.S7_SECOND_OWNER_EMAIL!;
const secondOwnerPassword = process.env.S7_SECOND_OWNER_PASSWORD!;
const secondLawyerAEmail = process.env.S7_SECOND_LAWYER_A_EMAIL!;
const secondLawyerAPassword = process.env.S7_SECOND_LAWYER_A_PASSWORD!;
const secondLawyerBEmail = process.env.S7_SECOND_LAWYER_B_EMAIL!;
const secondLawyerBPassword = process.env.S7_SECOND_LAWYER_B_PASSWORD!;
const secondFinanceEmail = process.env.S7_SECOND_FINANCE_EMAIL!;
const secondFinancePassword = process.env.S7_SECOND_FINANCE_PASSWORD!;
const firmOneLawyerBEmail = process.env.S7_FIRM_ONE_LAWYER_B_EMAIL!;
const firmOneLawyerBPassword = process.env.S7_FIRM_ONE_LAWYER_B_PASSWORD!;
let activatedTenantId = "";
let activatedLawyerUserId = "";
let activatedMatterId = "";
let activatedCapabilityApiKey = "";
let secondTenantId = "";
let secondMatterId = "";

test("S7[platform-login] platform operations UI authenticates against isolated capability PostgreSQL", async ({ page }) => {
  await page.goto(`${platformUrl}/console/login`);
  await page.getByLabel("邮箱").fill(platformEmail);
  await page.getByLabel("密码").fill(platformPassword);
  await page.getByLabel("密码").press("Enter");
  await expect(page.getByText("能力运营总览", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => Boolean(localStorage.getItem("gw_jwt")))).toBe(true);
});

test("S7[owner-activation] public application, platform approval, and activation claim create the first owner", async ({ page }) => {
  const slug = `s7-${Date.now().toString(36)}`;
  await page.goto(`${platformUrl}/console/register`);
  await page.getByLabel("律所全称").fill(`S7 合成律所 ${slug}`);
  await page.getByLabel("组织标识").fill(slug);
  await page.getByLabel("负责人姓名").fill("S7 合成负责人");
  await page.getByLabel("负责人邮箱").fill(ownerEmail);
  await page.getByRole("button", { name: "提交接入申请" }).click();
  await expect(page.getByRole("heading", { name: "律所开户申请已提交" })).toBeVisible();

  await page.goto(`${platformUrl}/console/login`);
  await page.getByLabel("邮箱").fill(platformEmail);
  await page.getByLabel("密码").fill(platformPassword);
  await page.getByLabel("密码").press("Enter");
  await expect(page.getByText("能力运营总览", { exact: true }).first()).toBeVisible();
  await page.goto(`${platformUrl}/console/law-firms`);
  const application = page.getByRole("row").filter({ hasText: ownerEmail });
  await expect(application).toBeVisible();
  await application.getByRole("button", { name: "批准并签发激活码" }).click();
  const activationDialog = page.getByRole("dialog", { name: "请安全交付激活码" });
  await expect(activationDialog).toBeVisible();
  const activationText = await activationDialog.innerText();
  const activationCode = /lfa_[A-Za-z0-9_-]{32,128}/.exec(activationText)?.[0];
  expect(activationCode).toBeTruthy();

  await page.goto(`${platformUrl}/console/activate`);
  await page.getByLabel("激活码").fill(activationCode!);
  await page.getByLabel("负责人邮箱").fill(ownerEmail);
  await page.getByLabel("设置密码").fill(ownerPassword);
  await page.getByLabel("确认密码").fill(ownerPassword);
  const activationResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/v1/law-firms/activations/claim") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "激活账号" }).click();
  const activationResponse = await activationResponsePromise;
  const activationPayload = await activationResponse.json().catch(() => ({})) as {
    error?: { code?: string };
    data?: { api_key?: string; capability_endpoint?: string };
  };
  const activationErrorCode = activationPayload.error?.code ?? "unknown_error_code";
  expect(activationResponse.ok(), `activation_http_${activationResponse.status()}_${activationErrorCode}`).toBe(true);
  activatedCapabilityApiKey = activationPayload.data?.api_key ?? "";
  expect(activatedCapabilityApiKey.length, "one_time_capability_api_key_present_only_in_memory").toBeGreaterThan(16);
  expect(activationPayload.data?.capability_endpoint, "activation_capability_endpoint_matches_isolated_gateway").toBe(capabilityEndpoint);
  await expect(page.getByRole("heading", { name: "管理员账号已激活" })).toBeVisible({ timeout: 30_000 });

  const secondSlug = `${slug}-b`;
  await page.goto(`${platformUrl}/console/register`);
  await page.getByLabel("律所全称").fill(`S7 第二合成律所 ${secondSlug}`);
  await page.getByLabel("组织标识").fill(secondSlug);
  await page.getByLabel("负责人姓名").fill("S7 第二合成负责人");
  await page.getByLabel("负责人邮箱").fill(secondOwnerEmail);
  await page.getByRole("button", { name: "提交接入申请" }).click();
  await expect(page.getByRole("heading", { name: "律所开户申请已提交" })).toBeVisible();
  await page.goto(`${platformUrl}/console/law-firms`);
  const secondApplication = page.getByRole("row").filter({ hasText: secondOwnerEmail });
  await expect(secondApplication).toBeVisible();
  await secondApplication.getByRole("button", { name: "批准并签发激活码" }).click();
  const secondActivationDialog = page.getByRole("dialog", { name: "请安全交付激活码" });
  await expect(secondActivationDialog).toBeVisible();
  const secondActivationText = await secondActivationDialog.innerText();
  const secondActivationCode = /lfa_[A-Za-z0-9_-]{32,128}/.exec(secondActivationText)?.[0];
  expect(secondActivationCode).toBeTruthy();
  await page.goto(`${platformUrl}/console/activate`);
  await page.getByLabel("激活码").fill(secondActivationCode!);
  await page.getByLabel("负责人邮箱").fill(secondOwnerEmail);
  await page.getByLabel("设置密码").fill(secondOwnerPassword);
  await page.getByLabel("确认密码").fill(secondOwnerPassword);
  const secondActivationResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/v1/law-firms/activations/claim") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "激活账号" }).click();
  const secondActivationResponse = await secondActivationResponsePromise;
  const secondActivationPayload = await secondActivationResponse.json().catch(() => ({})) as { error?: { code?: string } };
  expect(secondActivationResponse.ok(), `second_activation_http_${secondActivationResponse.status()}_${secondActivationPayload.error?.code ?? "unknown_error_code"}`).toBe(true);
  await expect(page.getByRole("heading", { name: "管理员账号已激活" })).toBeVisible({ timeout: 30_000 });
  await loginTenant(page, tenantAdminUrl, secondOwnerEmail, secondOwnerPassword);
  secondTenantId = await page.locator("#tenant-select").inputValue();
  expect(secondTenantId, "second_firm_tenant_id").toMatch(/^[0-9a-f-]{36}$/i);
  expect(secondTenantId).not.toBe(activatedTenantId);
});

async function loginTenant(page: Page, url: string, email = systemEmail, password = systemPassword) {
  await page.goto(url);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('input[type="password"]').press("Enter");
  await expect.poll(async () => page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    return response.status;
  })).toBe(200);
  const authenticatedEmail = await page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    if (!response.ok) return null;
    const user = await response.json();
    return user.email as string;
  });
  expect(authenticatedEmail, "authenticated_identity_matches_requested_email").toBe(email);
  const cookies = await page.context().cookies(url);
  expect(cookies.some((cookie) => cookie.name === "access_token" && cookie.httpOnly)).toBe(true);
  expect(cookies.some((cookie) => cookie.name === "csrf_token")).toBe(true);
}

async function authenticatedTenantIdentity(page: Page): Promise<{ id: string; email: string }> {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    if (!response.ok) throw new Error(`authenticated_identity_http_${response.status}`);
    const user = await response.json();
    return { id: user.id as string, email: user.email as string };
  });
}

function runTenantPsql(query: string, input: { inviteEmail: string; tenantId: string; userId: string }): string {
  if (!/^[0-9a-f-]{36}$/i.test(input.tenantId)) throw new Error("synthetic tenant fixture id invalid");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.userId)) throw new Error("synthetic user fixture id invalid");
  try {
    return execFileSync(psqlBin, [
      tenantDatabaseUrl,
      "-X",
      "-v", "ON_ERROR_STOP=1",
      "-v", "VERBOSITY=verbose",
      "-v", `invite_email=${input.inviteEmail}`,
      "-v", `tenant_id=${input.tenantId}`,
      "-v", `user_id=${input.userId}`,
      "-Atq",
    ], { encoding: "utf8", input: query, maxBuffer: 1024 * 1024 }).trim();
  } catch (error) {
    const diagnostic = error as { stderr?: Buffer | string };
    const stderr = diagnostic.stderr?.toString() ?? "";
    const sqlState = /(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/.exec(stderr)?.[1];
    throw new Error(sqlState ? `synthetic tenant identity fixture failed SQLSTATE ${sqlState}` : "synthetic tenant identity fixture failed without a SQLSTATE");
  }
}

function runCapabilityPsql(tenantId: string, query: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error("synthetic finance fixture tenant id invalid");
  try {
    return execFileSync(psqlBin, [
      capabilityDatabaseUrl,
      "-X",
      "-v", "ON_ERROR_STOP=1",
      "-v", "VERBOSITY=verbose",
      "-v", `tenant_id=${tenantId}`,
      "-v", `issuer=${capabilityIssuer}`,
      "-Atq",
    ], { encoding: "utf8", input: query, maxBuffer: 1024 * 1024 }).trim();
  } catch (error) {
    const diagnostic = error as { stderr?: Buffer | string };
    const stderr = diagnostic.stderr?.toString() ?? "";
    const sqlState = /(?:ERROR|FATAL):\s+([0-9A-Z]{5}):/.exec(stderr)?.[1];
    throw new Error(sqlState ? `synthetic finance projection fixture failed SQLSTATE ${sqlState}` : "synthetic finance projection fixture failed without a SQLSTATE");
  }
}

function seedZeroWalletProjection(tenantId: string): void {
  const seeded = runCapabilityPsql(tenantId, `
    INSERT INTO law_firm_wallets
      (billing_account_id,currency,available_microunits,reserved_microunits,version,created_at,updated_at)
    SELECT b.billing_account_id,'CNY',0,0,1,now(),now()
      FROM tenant_account_bindings b
     WHERE b.issuer=:'issuer' AND b.tenant_id=:'tenant_id' AND b.provisioning_status='active'
    ON CONFLICT (billing_account_id,currency) DO NOTHING;
    SELECT count(*)::text
      FROM law_firm_wallets w
      JOIN tenant_account_bindings b ON b.billing_account_id=w.billing_account_id
     WHERE b.issuer=:'issuer' AND b.tenant_id=:'tenant_id' AND b.provisioning_status='active'
       AND w.currency='CNY' AND w.available_microunits=0 AND w.reserved_microunits=0;
  `);
  expect(seeded, "one_synthetic_zero_balance_wallet_projection").toBe("1");
}

function financeMutationCounts(tenantId: string): string {
  return runCapabilityPsql(tenantId, `
    SELECT
      (SELECT count(*) FROM capability_ledger_events e
        JOIN capability_usage_reservations r ON r.id=e.reservation_id
        WHERE r.issuer=:'issuer' AND r.tenant_id=:'tenant_id')::text || ':' ||
      (SELECT count(*) FROM law_firm_wallet_transactions t
        JOIN tenant_account_bindings b ON b.billing_account_id=t.billing_account_id
        WHERE b.issuer=:'issuer' AND b.tenant_id=:'tenant_id')::text;
  `);
}

async function inviteAndClaimMember(
  ownerPage: Page,
  browser: Browser,
  tenantId: string,
  email: string,
  displayName: string,
  role: "member" | "finance",
  password: string,
): Promise<string> {
  await ownerPage.goto(tenantAdminUrl);
  await ownerPage.getByRole("button", { name: "律师与成员" }).click();
  const previousCodeResponse = await ownerPage.context().request.get(`${mailSinkUrl}/invitation-code`);
  const previousCode = previousCodeResponse.ok() ? await previousCodeResponse.text() : "";
  await ownerPage.locator("#member-email").fill(email);
  await ownerPage.locator("#member-display-name").fill(displayName);
  await ownerPage.locator("#member-role").selectOption(role);
  const inviteResponsePromise = ownerPage.waitForResponse((response) =>
    response.url().includes(`/api/law/tenants/${tenantId}/memberships`) && response.request().method() === "POST",
  );
  await ownerPage.getByRole("button", { name: "发送邀请" }).click();
  const inviteResponse = await inviteResponsePromise;
  expect(inviteResponse.status(), `member_invite_http_${inviteResponse.status()}`).toBe(201);
  await expect(ownerPage.getByRole("status")).toContainText("邀请邮件已加入队列");
  let code = "";
  await expect.poll(async () => {
    const response = await ownerPage.context().request.get(`${mailSinkUrl}/invitation-code`);
    if (!response.ok()) return false;
    code = await response.text();
    return code !== previousCode && /^lmi_[A-Za-z0-9_-]{32,128}$/.test(code);
  }, { timeout: 45_000, intervals: [250, 500, 1000] }).toBe(true);
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto(`${lawyerUrl}/register`);
  await memberPage.getByRole("button", { name: "已收到律所邀请码？使用邀请码加入" }).click();
  await memberPage.locator("#invitation-email").fill(email);
  await memberPage.locator("#invitation-code").fill(code);
  await memberPage.locator("#invite-password").fill(password);
  await memberPage.locator("#invite-password-confirm").fill(password);
  await memberPage.locator('input[type="checkbox"]').check();
  const claimPromise = memberPage.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/register") && response.request().method() === "POST",
  );
  await memberPage.getByRole("button", { name: "加入律所" }).click();
  const claimResponse = await claimPromise;
  expect(claimResponse.status(), `member_claim_http_${claimResponse.status()}`).toBe(201);
  const profile = await memberPage.evaluate(async (expectedEmail) => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    if (!response.ok) return null;
    const user = await response.json();
    return { id: user.id as string, emailMatches: user.email === expectedEmail };
  }, email);
  expect(profile?.emailMatches, "distinct_member_identity_authenticated").toBe(true);
  expect(Boolean(profile?.id), "distinct_member_user_id_present").toBe(true);
  const memberContextCookies = await memberContext.cookies(lawyerUrl);
  expect(memberContextCookies.some((cookie) => cookie.name === "access_token" && cookie.httpOnly)).toBe(true);
  expect(memberContextCookies.some((cookie) => cookie.name === "csrf_token")).toBe(true);
  await memberContext.close();
  return profile!.id;
}

test("tenant system bootstrap administrator signs in through real cookie and CSRF auth", async ({ page }) => {
  await loginTenant(page, tenantAdminUrl);
});

test("S7[owner-login] first law firm owner signs into the tenant administration UI", async ({ page }) => {
  await loginTenant(page, tenantAdminUrl, ownerEmail, ownerPassword);
});

test("S7[member-invitation-claim] twenty parallel real registrations create one account, membership, and workspace", async ({ page, context, browser }) => {
  await loginTenant(page, tenantAdminUrl, ownerEmail, ownerPassword);
  const tenantId = await page.locator("#tenant-select").inputValue();
  expect(tenantId.length).toBeGreaterThan(0);
  activatedTenantId = tenantId;
  await page.getByRole("button", { name: "律师与成员" }).click();
  await expect(page.getByRole("heading", { name: "邀请成员" })).toBeVisible();
  await page.locator("#member-email").fill(lawyerMemberEmail);
  await page.locator("#member-display-name").fill("S7 合成律师");
  await page.locator("#member-role").selectOption("member");
  const invitationResponsePromise = page.waitForResponse((response) =>
    response.url().includes(`/api/law/tenants/${tenantId}/memberships`) && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "发送邀请" }).click();
  const invitationResponse = await invitationResponsePromise;
  const invitationPayload = await invitationResponse.json().catch(() => ({})) as { error?: { code?: string } };
  expect(invitationResponse.status(), `membership_invite_http_${invitationResponse.status()}_${invitationPayload.error?.code ?? "no_error_code"}`).toBe(201);
  await expect(page.getByRole("status")).toContainText("邀请邮件已加入队列");

  let invitationCode = "";
  await expect.poll(async () => {
    const response = await context.request.get(`${mailSinkUrl}/invitation-code`);
    if (!response.ok()) return false;
    invitationCode = await response.text();
    return /^lmi_[A-Za-z0-9_-]{32,128}$/.test(invitationCode);
  }, { timeout: 45_000, intervals: [250, 500, 1000] }).toBe(true);

  // Cookies are host-scoped (ports do not isolate them), so the lawyer must
  // claim from a clean browser context distinct from the owner administrator.
  const lawyerContext = await browser.newContext();
  const lawyerPage = await lawyerContext.newPage();
  await lawyerPage.goto(`${lawyerUrl}/register`);
  await lawyerPage.getByRole("button", { name: "已收到律所邀请码？使用邀请码加入" }).click();
  await lawyerPage.locator("#invitation-email").fill(lawyerMemberEmail);
  await lawyerPage.locator("#invitation-code").fill(invitationCode);
  await lawyerPage.locator("#invite-password").fill(lawyerMemberPassword);
  await lawyerPage.locator("#invite-password-confirm").fill(lawyerMemberPassword);
  await lawyerPage.locator('input[type="checkbox"]').check();
  const invitationForm = lawyerPage.locator("form").filter({ has: lawyerPage.locator("#invitation-code") });
  const submitButton = invitationForm.locator('button[type="submit"]');
  await expect(submitButton).toHaveCount(1);
  const submitState = await submitButton.evaluate((button: HTMLButtonElement) => ({
    disabled: button.disabled,
    text: button.textContent?.replace(/\s+/g, " ").trim() ?? "",
    ariaLabel: button.getAttribute("aria-label"),
  }));
  const buttonTree = (await lawyerPage.locator("body").ariaSnapshot())
    .split("\n")
    .filter((line) => line.includes("button"))
    .map((line) => line.replace(lawyerMemberEmail, "[synthetic-email]").replace(lawyerMemberPassword, "[synthetic-password]"));
  expect(buttonTree.some((line) => /button .*加入律所/.test(line)), `register_buttons_${JSON.stringify(buttonTree)};submit_disabled_${submitState.disabled};submit_text_${submitState.text};submit_aria_${submitState.ariaLabel ?? "none"}`).toBe(true);
  expect(submitState.disabled, "invitation_submit_disabled").toBe(false);
  // Race the actual invite-only account-registration route. Tokens and passwords
  // stay in page memory; the Playwright project disables trace, screenshots, and video.
  const registrationResults = await lawyerPage.evaluate(async () => {
    const email = (document.querySelector<HTMLInputElement>("#invitation-email"))?.value ?? "";
    const password = (document.querySelector<HTMLInputElement>("#invite-password"))?.value ?? "";
    const token = (document.querySelector<HTMLInputElement>("#invitation-code"))?.value ?? "";
    if (!email || !password || !token) throw new Error("invitation_registration_form_incomplete");
    const payload = JSON.stringify({ email, password, invitation_token: token });
    const responses = await Promise.all(Array.from({ length: 20 }, () => fetch("/api/v1/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: payload,
    })));
    return Promise.all(responses.map(async (response) => {
      const body = await response.json().catch(() => ({})) as {
        id?: unknown;
        detail?: { code?: unknown };
        error?: { code?: unknown };
      };
      const rawErrorCode = body.detail?.code ?? body.error?.code;
      const errorCode = typeof rawErrorCode === "string" && /^[a-z0-9_]{1,80}$/.test(rawErrorCode)
        ? rawErrorCode
        : null;
      return { status: response.status, userId: typeof body.id === "string" ? body.id : null, errorCode };
    }));
  });
  const registrationResponseCounts = registrationResults.reduce<Record<string, number>>((counts, result) => {
    const key = `${result.status}:${result.errorCode ?? "none"}`;
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  expect(registrationResults, "twenty_parallel_invitation_registrations").toHaveLength(20);
  expect(registrationResults.every((result) => result.status === 201), `all_invitation_registration_retries_succeed response_counts=${JSON.stringify(registrationResponseCounts)}`).toBe(true);
  expect(new Set(registrationResults.map((result) => result.userId)).size, "one_authenticated_account_id").toBe(1);
  expect(registrationResults[0]?.userId, "authenticated_account_id_present").toBeTruthy();
  const uiReplayResponsePromise = lawyerPage.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/register") && response.request().method() === "POST",
  );
  await lawyerPage.getByRole("button", { name: "加入律所" }).click();
  const uiReplayResponse = await uiReplayResponsePromise;
  expect(uiReplayResponse.status(), `lawyer_claim_ui_replay_http_${uiReplayResponse.status()}`).toBe(201);
  await expect(lawyerPage).toHaveURL(/\/workspace\/law/);
  const lawyerProfile = await lawyerPage.evaluate(async (expectedEmail) => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    if (!response.ok) return null;
    const user = await response.json();
    return { id: user.id as string, emailMatches: user.email === expectedEmail };
  }, lawyerMemberEmail);
  expect(lawyerProfile?.emailMatches, "lawyer_identity_authenticated").toBe(true);
  expect(Boolean(lawyerProfile?.id), "lawyer_user_id_present").toBe(true);
  activatedLawyerUserId = lawyerProfile?.id ?? "";
  const lawyerCookies = await lawyerContext.cookies(lawyerUrl);
  expect(lawyerCookies.some((cookie) => cookie.name === "access_token" && cookie.httpOnly)).toBe(true);
  expect(lawyerCookies.some((cookie) => cookie.name === "csrf_token")).toBe(true);
  await lawyerContext.close();

  await page.goto(tenantAdminUrl);
  await page.getByRole("button", { name: "律师与成员" }).click();
  const membership = page.getByRole("row").filter({ hasText: "S7 合成律师" });
  await expect(membership).toHaveCount(1);
  await expect(membership.locator("[data-member-role]")).toHaveValue("member");
  await expect(membership.locator("[data-member-status]")).toHaveValue("active");
  const membershipBinding = await page.evaluate(async ({ id, lawyerUserId }) => {
    const response = await fetch(`/api/law/tenants/${encodeURIComponent(id)}/memberships`, { credentials: "include" });
    if (!response.ok) return { status: response.status, matches: 0 };
    const body = await response.json();
    const items = body.data?.items ?? body.items ?? [];
    const matches = items.filter((item: { display_name?: string; user_id?: string; role?: string; status?: string; tenant_id?: string }) =>
      item.display_name === "S7 合成律师" && item.user_id === lawyerUserId && item.tenant_id === id && item.role === "member" && item.status === "active",
    );
    return { status: response.status, matches: matches.length };
  }, { id: tenantId, lawyerUserId: lawyerProfile?.id });
  expect(membershipBinding.status, "owner_memberships_api_status").toBe(200);
  expect(membershipBinding.matches, "invitation_claim_creates_exactly_one_bound_active_membership").toBe(1);
  const accountMembershipWorkspaceCounts = runTenantPsql(`
    SELECT
      (SELECT count(*) FROM public.users WHERE email=:'invite_email')::text || ':' ||
      (SELECT count(*) FROM deerflow.law_memberships
        WHERE tenant_id=:'tenant_id'::uuid AND user_id=:'user_id' AND status='active')::text || ':' ||
      (SELECT count(*) FROM deerflow.law_lawyer_workspaces w
        JOIN deerflow.law_memberships m ON m.tenant_id=w.tenant_id AND m.id=w.membership_id
        WHERE m.tenant_id=:'tenant_id'::uuid AND m.user_id=:'user_id' AND m.status='active')::text;
  `, { inviteEmail: lawyerMemberEmail, tenantId, userId: lawyerProfile!.id });
  expect(accountMembershipWorkspaceCounts, "one_account_membership_and_authorized_workspace").toBe("1:1:1");
  expect(tenantId).toMatch(/^[0-9a-f-]{36}$/i);
});

test("S7[lawyer-case-authorization] tenant owner grants one synthetic case and the distinct lawyer reads it", async ({ browser }) => {
  expect(activatedTenantId.length).toBeGreaterThan(0);
  expect(activatedLawyerUserId.length).toBeGreaterThan(0);
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await loginTenant(ownerPage, tenantAdminUrl, ownerEmail, ownerPassword);
  await ownerPage.getByRole("button", { name: "事项与权限" }).click();
  await ownerPage.locator("#matter-case-number").fill(`S7-${Date.now()}`);
  const matterTitle = `S7 合成授权案件 ${Date.now().toString(36)}`;
  await ownerPage.locator("#matter-title").fill(matterTitle);
  const createMatterResponsePromise = ownerPage.waitForResponse((response) =>
    response.url().includes(`/api/law/tenants/${activatedTenantId}/matters`) && response.request().method() === "POST",
  );
  await ownerPage.getByRole("button", { name: "创建事项" }).click();
  const createMatterResponse = await createMatterResponsePromise;
  expect(createMatterResponse.status(), `matter_create_http_${createMatterResponse.status()}`).toBe(201);
  const createPayload = await createMatterResponse.json();
  const matterId: string | undefined = createPayload.data?.matter?.id ?? createPayload.matter?.id;
  expect(Boolean(matterId), "created_matter_id_present").toBe(true);
  activatedMatterId = matterId!;

  const grantResult = await ownerPage.evaluate(async ({ tenantId, userId, id }) => {
    const membershipResponse = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/memberships`, { credentials: "include" });
    if (!membershipResponse.ok) return { status: membershipResponse.status, granted: false };
    const membershipBody = await membershipResponse.json();
    const memberships = membershipBody.data?.items ?? membershipBody.items ?? [];
    const matches = memberships.filter((item: { user_id?: string }) => item.user_id === userId);
    if (matches.length !== 1) return { status: membershipResponse.status, granted: false };
    const csrf = document.cookie.split("; ").find((part) => part.startsWith("csrf_token="))?.slice("csrf_token=".length) ?? "";
    const result = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(id)}/members`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ membership_id: matches[0].id, role: "lawyer" }),
    });
    return { status: result.status, granted: result.status === 201 };
  }, { tenantId: activatedTenantId, userId: activatedLawyerUserId, id: matterId! });
  expect(grantResult.status, "matter_member_grant_http_status").toBe(201);
  expect(grantResult.granted, "tenant_owner_grants_lawyer_case_access").toBe(true);

  const lawyerContext = await browser.newContext();
  const lawyerPage = await lawyerContext.newPage();
  await loginTenant(lawyerPage, `${lawyerUrl}/login`, lawyerMemberEmail, lawyerMemberPassword);
  const authorizedMatterResult = await lawyerPage.evaluate(async ({ tenantId, title }) => {
    const response = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/matters`, { credentials: "include" });
    if (!response.ok) return { status: response.status, count: 0 };
    const body = await response.json();
    const items = body.data?.items ?? body.items ?? [];
    return { status: response.status, count: items.filter((item: { title?: string }) => item.title === title).length };
  }, { tenantId: activatedTenantId, title: matterTitle });
  expect(authorizedMatterResult.status, "lawyer_matter_list_http_status").toBe(200);
  expect(authorizedMatterResult.count, "assigned_lawyer_reads_exactly_one_authorized_case").toBe(1);
  await lawyerContext.close();
  await ownerContext.close();
});

test("S7[two-firm-eight-identities] two isolated firms each have one owner, one finance user, and two distinct lawyers", async ({ browser }) => {
  expect(activatedTenantId.length).toBeGreaterThan(0);
  expect(secondTenantId.length).toBeGreaterThan(0);
  expect(secondTenantId).not.toBe(activatedTenantId);
  const firstOwnerContext = await browser.newContext();
  const firstOwnerPage = await firstOwnerContext.newPage();
  await loginTenant(firstOwnerPage, tenantAdminUrl, ownerEmail, ownerPassword);
  const firstOwnerIdentity = await authenticatedTenantIdentity(firstOwnerPage);
  const firstSecondLawyerId = await inviteAndClaimMember(
    firstOwnerPage, browser, activatedTenantId, firmOneLawyerBEmail, "S7 律所甲第二律师", "member", firmOneLawyerBPassword,
  );
  const firstFinanceId = await inviteAndClaimMember(
    firstOwnerPage, browser, activatedTenantId, financeEmail, "S7 律所甲财务", "finance", financePassword,
  );
  const firstMemberships = await firstOwnerPage.evaluate(async (tenantId) => {
    const response = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/memberships`, { credentials: "include" });
    const body = response.ok ? await response.json() : {};
    return { status: response.status, items: body.data?.items ?? body.items ?? [] };
  }, activatedTenantId);
  expect(firstMemberships.status, "first_firm_membership_api_status").toBe(200);
  const firstExpected = [
    { email: ownerEmail, userId: firstOwnerIdentity.id, role: "owner" },
    { email: lawyerMemberEmail, role: "member" },
    { email: firmOneLawyerBEmail, role: "member" },
    { email: financeEmail, role: "finance" },
  ];
  for (const identity of firstExpected) {
    expect(firstMemberships.items.filter((item: { email?: string; role?: string; status?: string; user_id?: string; tenant_id?: string }) =>
      (identity.role === "owner" ? item.user_id === identity.userId : item.email === identity.email) &&
      item.role === identity.role && item.status === "active" && Boolean(item.user_id) && item.tenant_id === activatedTenantId,
    ).length, `first_firm_identity_${identity.role}_exists_once`).toBe(1);
  }

  const secondOwnerContext = await browser.newContext();
  const secondOwnerPage = await secondOwnerContext.newPage();
  await loginTenant(secondOwnerPage, tenantAdminUrl, secondOwnerEmail, secondOwnerPassword);
  const secondOwnerIdentity = await authenticatedTenantIdentity(secondOwnerPage);
  const secondFinanceId = await inviteAndClaimMember(
    secondOwnerPage, browser, secondTenantId, secondFinanceEmail, "S7 律所乙财务", "finance", secondFinancePassword,
  );
  const secondLawyerAId = await inviteAndClaimMember(
    secondOwnerPage, browser, secondTenantId, secondLawyerAEmail, "S7 律所乙第一律师", "member", secondLawyerAPassword,
  );
  const secondLawyerBId = await inviteAndClaimMember(
    secondOwnerPage, browser, secondTenantId, secondLawyerBEmail, "S7 律所乙第二律师", "member", secondLawyerBPassword,
  );
  const secondMemberships = await secondOwnerPage.evaluate(async (tenantId) => {
    const response = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/memberships`, { credentials: "include" });
    const body = response.ok ? await response.json() : {};
    return { status: response.status, items: body.data?.items ?? body.items ?? [] };
  }, secondTenantId);
  expect(secondMemberships.status, "second_firm_membership_api_status").toBe(200);
  const secondExpected = [
    { email: secondOwnerEmail, userId: secondOwnerIdentity.id, role: "owner" },
    { email: secondLawyerAEmail, role: "member" },
    { email: secondLawyerBEmail, role: "member" },
    { email: secondFinanceEmail, role: "finance" },
  ];
  for (const identity of secondExpected) {
    expect(secondMemberships.items.filter((item: { email?: string; role?: string; status?: string; user_id?: string; tenant_id?: string }) =>
      (identity.role === "owner" ? item.user_id === identity.userId : item.email === identity.email) &&
      item.role === identity.role && item.status === "active" && Boolean(item.user_id) && item.tenant_id === secondTenantId,
    ).length, `second_firm_identity_${identity.role}_exists_once`).toBe(1);
  }
  const allUserIds = [
    ...firstMemberships.items.map((item: { user_id?: string }) => item.user_id),
    ...secondMemberships.items.map((item: { user_id?: string }) => item.user_id),
  ].filter(Boolean);
  expect(firstMemberships.items).toHaveLength(4);
  expect(secondMemberships.items).toHaveLength(4);
  expect(new Set(allUserIds).size, "eight_distinct_tenant_user_ids_across_two_firms").toBe(8);
  expect([firstSecondLawyerId, firstFinanceId, secondFinanceId, secondLawyerAId, secondLawyerBId].every(Boolean)).toBe(true);
  await secondOwnerPage.getByRole("button", { name: "事项与权限" }).click();
  await secondOwnerPage.locator("#matter-case-number").fill(`S7-B-${Date.now()}`);
  const secondMatterTitle = `S7 律所乙合成案件 ${Date.now().toString(36)}`;
  await secondOwnerPage.locator("#matter-title").fill(secondMatterTitle);
  const secondMatterResponsePromise = secondOwnerPage.waitForResponse((response) =>
    response.url().includes(`/api/law/tenants/${secondTenantId}/matters`) && response.request().method() === "POST",
  );
  await secondOwnerPage.getByRole("button", { name: "创建事项" }).click();
  const secondMatterResponse = await secondMatterResponsePromise;
  expect(secondMatterResponse.status(), `second_firm_matter_create_http_${secondMatterResponse.status()}`).toBe(201);
  const secondMatterPayload = await secondMatterResponse.json();
  secondMatterId = secondMatterPayload.data?.matter?.id ?? secondMatterPayload.matter?.id;
  expect(Boolean(secondMatterId), "second_firm_matter_created").toBe(true);
  const secondGrant = await secondOwnerPage.evaluate(async ({ tenantId, matterId, userId }) => {
    const response = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/memberships`, { credentials: "include" });
    if (!response.ok) return { membershipStatus: response.status, grantStatus: 0 };
    const body = await response.json();
    const items = body.data?.items ?? body.items ?? [];
    const matches = items.filter((item: { user_id?: string }) => item.user_id === userId);
    if (matches.length !== 1) return { membershipStatus: response.status, grantStatus: 0 };
    const csrf = document.cookie.split("; ").find((part) => part.startsWith("csrf_token="))?.slice("csrf_token=".length) ?? "";
    const grant = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/members`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ membership_id: matches[0].id, role: "lawyer" }),
    });
    return { membershipStatus: response.status, grantStatus: grant.status };
  }, { tenantId: secondTenantId, matterId: secondMatterId, userId: secondLawyerAId });
  expect(secondGrant.membershipStatus, "second_firm_membership_read_status").toBe(200);
  expect(secondGrant.grantStatus, "second_firm_lawyer_case_grant_status").toBe(201);
  await firstOwnerContext.close();
  await secondOwnerContext.close();
});

test("S7[cross-firm-isolation] tenant finance identities cannot read the other firm's authorized matter", async ({ browser }) => {
  expect(activatedTenantId.length).toBeGreaterThan(0);
  expect(secondTenantId.length).toBeGreaterThan(0);
  expect(activatedMatterId.length).toBeGreaterThan(0);
  expect(secondMatterId.length).toBeGreaterThan(0);
  const checks: Array<{ email: string; password: string; tenantId: string; matterId: string }> = [
    { email: financeEmail, password: financePassword, tenantId: secondTenantId, matterId: secondMatterId },
    { email: secondFinanceEmail, password: secondFinancePassword, tenantId: activatedTenantId, matterId: activatedMatterId },
  ];
  const results: number[] = [];
  for (const check of checks) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginTenant(page, tenantAdminUrl, check.email, check.password);
    const status = await page.evaluate(async ({ tenantId, matterId }) => {
      const response = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}`, { credentials: "include" });
      return response.status;
    }, check);
    results.push(status);
    await context.close();
  }
  expect(results, "cross_firm_case_reads_fail_closed").toEqual([404, 404]);
});

test("S7[finance-readonly-isolation] finance identity cannot mutate tenant administration", async ({ browser }) => {
  expect(activatedTenantId.length).toBeGreaterThan(0);
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await loginTenant(ownerPage, tenantAdminUrl, ownerEmail, ownerPassword);
  const financeContext = await browser.newContext();
  const financePage = await financeContext.newPage();
  await loginTenant(financePage, tenantAdminUrl, financeEmail, financePassword);
  const financeProfile = await financePage.evaluate(async (expectedEmail) => {
    const response = await fetch("/api/v1/auth/me", { credentials: "include" });
    if (!response.ok) return null;
    const user = await response.json();
    return { id: user.id as string, emailMatches: user.email === expectedEmail };
  }, financeEmail);
  expect(financeProfile?.emailMatches, "finance_identity_authenticated").toBe(true);
  expect(Boolean(financeProfile?.id), "finance_user_id_present").toBe(true);
  await financeContext.close();

  const financeBinding = await ownerPage.evaluate(async ({ tenantId, userId }) => {
    const response = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/memberships`, { credentials: "include" });
    if (!response.ok) return { status: response.status, matches: 0, membershipId: "" };
    const body = await response.json();
    const items = body.data?.items ?? body.items ?? [];
    const matches = items.filter((item: { user_id?: string; tenant_id?: string; role?: string; status?: string }) =>
      item.user_id === userId && item.tenant_id === tenantId && item.role === "finance" && item.status === "active",
    );
    return { status: response.status, matches: matches.length, membershipId: matches[0]?.id ?? "" };
  }, { tenantId: activatedTenantId, userId: financeProfile?.id ?? "" });
  expect(financeBinding.status, "finance_owner_membership_read_http_status").toBe(200);
  expect(financeBinding.matches, "exactly_one_finance_membership_binding").toBe(1);

  const financeLoginContext = await browser.newContext();
  const financeLoginPage = await financeLoginContext.newPage();
  await loginTenant(financeLoginPage, tenantAdminUrl, financeEmail, financePassword);
  const scopedResponses = await financeLoginPage.evaluate(async ({ tenantId, membershipId }) => {
    const adminResponse = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/administration/overview`, { credentials: "include" });
    const csrf = document.cookie.split("; ").find((part) => part.startsWith("csrf_token="))?.slice("csrf_token=".length) ?? "";
    const mutationResponse = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/memberships/${encodeURIComponent(membershipId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf) },
      body: JSON.stringify({ role: "finance", status: "suspended", expected_version: 1 }),
    });
    const otherTenantId = "00000000-0000-4000-8000-000000000000";
    const otherTenantResponse = await fetch(`/api/law/tenants/${otherTenantId}/finance/billing`, { credentials: "include" });
    return {
      adminStatus: adminResponse.status,
      mutationStatus: mutationResponse.status,
      otherTenantStatus: otherTenantResponse.status,
    };
  }, { tenantId: activatedTenantId, membershipId: financeBinding.membershipId });
  expect(scopedResponses.adminStatus, "finance_role_cannot_read_admin_overview").toBe(403);
  expect([403, 404].includes(scopedResponses.mutationStatus), "finance_role_cannot_mutate_membership").toBe(true);
  expect(scopedResponses.otherTenantStatus, "finance_role_cannot_read_another_tenant").toBe(404);
  const unchangedFinanceBinding = await ownerPage.evaluate(async ({ tenantId, userId }) => {
    const response = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/memberships`, { credentials: "include" });
    if (!response.ok) return false;
    const body = await response.json();
    const items = body.data?.items ?? body.items ?? [];
    const matches = items.filter((item: { user_id?: string; role?: string; status?: string }) =>
      item.user_id === userId && item.role === "finance" && item.status === "active",
    );
    return matches.length === 1;
  }, { tenantId: activatedTenantId, userId: financeProfile?.id ?? "" });
  expect(unchangedFinanceBinding, "finance_membership_unchanged_after_denied_write").toBe(true);
  await financeLoginContext.close();
  await ownerContext.close();
});

async function financeResourceResponse(browser: Browser, email: string, password: string, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginTenant(page, tenantAdminUrl, email, password);
  const status = await page.evaluate(async (target) => (await fetch(target, { credentials: "include" })).status, url);
  await context.close();
  return status;
}

test("S7[finance-case-denial] finance cannot read a tenant case", async ({ browser }) => {
  expect(activatedMatterId.length).toBeGreaterThan(0);
  expect(secondMatterId.length).toBeGreaterThan(0);
  const statusA = await financeResourceResponse(browser, financeEmail, financePassword, `/api/law/tenants/${encodeURIComponent(activatedTenantId)}/matters/${encodeURIComponent(activatedMatterId)}`);
  const statusB = await financeResourceResponse(browser, secondFinanceEmail, secondFinancePassword, `/api/law/tenants/${encodeURIComponent(secondTenantId)}/matters/${encodeURIComponent(secondMatterId)}`);
  expect([403, 404].includes(statusA) && [403, 404].includes(statusB), "both_firm_finance_case_reads_denied").toBe(true);
});

test("S7[finance-evidence-denial] finance cannot list case evidence", async ({ browser }) => {
  expect(activatedMatterId.length).toBeGreaterThan(0);
  const statusA = await financeResourceResponse(browser, financeEmail, financePassword, `/api/law/tenants/${encodeURIComponent(activatedTenantId)}/matters/${encodeURIComponent(activatedMatterId)}/evidence`);
  const statusB = await financeResourceResponse(browser, secondFinanceEmail, secondFinancePassword, `/api/law/tenants/${encodeURIComponent(secondTenantId)}/matters/${encodeURIComponent(secondMatterId)}/evidence`);
  expect([403, 404].includes(statusA) && [403, 404].includes(statusB), "both_firm_finance_evidence_reads_denied").toBe(true);
});

test("S7[finance-speech-denial] finance cannot read speech transcription resources", async ({ browser }) => {
  expect(activatedMatterId.length).toBeGreaterThan(0);
  const statusA = await financeResourceResponse(browser, financeEmail, financePassword, `/api/law/tenants/${encodeURIComponent(activatedTenantId)}/matters/${encodeURIComponent(activatedMatterId)}/speech-transcriptions`);
  const statusB = await financeResourceResponse(browser, secondFinanceEmail, secondFinancePassword, `/api/law/tenants/${encodeURIComponent(secondTenantId)}/matters/${encodeURIComponent(secondMatterId)}/speech-transcriptions`);
  expect([403, 404].includes(statusA) && [403, 404].includes(statusB), "both_firm_finance_speech_reads_denied").toBe(true);
});

test("S7[finance-thread-denial] finance cannot list matter threads", async ({ browser }) => {
  expect(activatedMatterId.length).toBeGreaterThan(0);
  const statusA = await financeResourceResponse(browser, financeEmail, financePassword, `/api/law/tenants/${encodeURIComponent(activatedTenantId)}/matters/${encodeURIComponent(activatedMatterId)}/threads`);
  const statusB = await financeResourceResponse(browser, secondFinanceEmail, secondFinancePassword, `/api/law/tenants/${encodeURIComponent(secondTenantId)}/matters/${encodeURIComponent(secondMatterId)}/threads`);
  expect([403, 404].includes(statusA) && [403, 404].includes(statusB), "both_firm_finance_thread_reads_denied").toBe(true);
});

test("S7[finance-tool-denial] finance is rejected before a lawyer matter thread can start a model or tool run", async ({ browser }) => {
  expect(activatedTenantId.length).toBeGreaterThan(0);
  expect(activatedMatterId.length).toBeGreaterThan(0);
  const lawyerContext = await browser.newContext();
  const lawyerPage = await lawyerContext.newPage();
  await loginTenant(lawyerPage, lawyerUrl, lawyerMemberEmail, lawyerMemberPassword);
  const threadSetup = await lawyerPage.evaluate(async ({ tenantId, matterId }) => {
    const csrf = document.cookie.split("; ").find((part) => part.startsWith("csrf_token="))?.slice("csrf_token=".length) ?? "";
    const threadResponse = await fetch("/api/threads", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf) },
      body: JSON.stringify({}),
    });
    const threadBody = await threadResponse.json().catch(() => ({}));
    const threadId = threadBody.thread_id ?? "";
    if (!threadResponse.ok || !threadId) return { threadStatus: threadResponse.status, threadId: "", bindStatus: 0 };
    const bindResponse = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/matters/${encodeURIComponent(matterId)}/threads`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf), "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ thread_id: threadId, purpose: "finance-tool-denial" }),
    });
    return { threadStatus: threadResponse.status, threadId, bindStatus: bindResponse.status };
  }, { tenantId: activatedTenantId, matterId: activatedMatterId });
  expect(threadSetup.threadStatus, "lawyer_owned_thread_created").toBe(200);
  expect(threadSetup.bindStatus, "lawyer_thread_bound_to_authorized_matter").toBe(201);

  const financeContext = await browser.newContext();
  const financePage = await financeContext.newPage();
  await loginTenant(financePage, tenantAdminUrl, financeEmail, financePassword);
  const deniedRun = await financePage.evaluate(async (threadId) => {
    const csrf = document.cookie.split("; ").find((part) => part.startsWith("csrf_token="))?.slice("csrf_token=".length) ?? "";
    const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/runs`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf) },
      body: JSON.stringify({ input: { messages: [{ role: "user", content: "Use the authorized matter search tool and return its result." }] } }),
    });
    return response.status;
  }, threadSetup.threadId);
  expect([403, 404].includes(deniedRun), "finance_run_rejected_at_permission_or_thread_ownership_boundary").toBe(true);
  const runsAfterDenial = await lawyerPage.evaluate(async (threadId) => {
    const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/runs`, { credentials: "include" });
    const body = await response.json().catch(() => null);
    return { status: response.status, count: Array.isArray(body) ? body.length : -1 };
  }, threadSetup.threadId);
  expect(runsAfterDenial.status, "authorized_lawyer_can_verify_thread_runs").toBe(200);
  expect(runsAfterDenial.count, "denied_finance_request_created_no_run_or_tool_call").toBe(0);
  await financeContext.close();
  await lawyerContext.close();
});

test("S7[ownership-handoff] owner atomically transfers ownership to the distinct lawyer account", async ({ browser }) => {
  expect(activatedTenantId.length).toBeGreaterThan(0);
  expect(activatedLawyerUserId.length).toBeGreaterThan(0);
  const formerOwnerContext = await browser.newContext();
  const formerOwnerPage = await formerOwnerContext.newPage();
  await loginTenant(formerOwnerPage, tenantAdminUrl, ownerEmail, ownerPassword);
  await formerOwnerPage.getByRole("button", { name: "律师与成员" }).click();
  const lawyerRow = formerOwnerPage.getByRole("row").filter({ hasText: "S7 合成律师" });
  await expect(lawyerRow).toHaveCount(1);
  const handoffResponsePromise = formerOwnerPage.waitForResponse((response) =>
    response.url().includes(`/api/law/tenants/${activatedTenantId}/memberships/`) && response.url().endsWith("/owner-handoff") && response.request().method() === "POST",
  );
  formerOwnerPage.once("dialog", async (dialog) => { await dialog.accept(); });
  await lawyerRow.getByRole("button", { name: "移交所有权" }).click();
  const handoffResponse = await handoffResponsePromise;
  expect(handoffResponse.status(), `owner_handoff_http_${handoffResponse.status()}`).toBe(200);
  await expect(formerOwnerPage.getByRole("status")).toContainText("律所所有权已完成原子移交");

  const roleBindings = await formerOwnerPage.evaluate(async ({ tenantId, owner, lawyer }) => {
    const response = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/memberships`, { credentials: "include" });
    if (!response.ok) return { status: response.status, ownerMatches: 0, lawyerMatches: 0 };
    const body = await response.json();
    const items = body.data?.items ?? body.items ?? [];
    return {
      status: response.status,
      ownerMatches: items.filter((item: { user_id?: string; role?: string; status?: string }) => item.user_id === owner && item.role === "admin" && item.status === "active").length,
      lawyerMatches: items.filter((item: { user_id?: string; role?: string; status?: string }) => item.user_id === lawyer && item.role === "owner" && item.status === "active").length,
    };
  }, { tenantId: activatedTenantId, owner: await formerOwnerPage.evaluate(async () => (await (await fetch("/api/v1/auth/me", { credentials: "include" })).json()).id), lawyer: activatedLawyerUserId });
  expect(roleBindings.status, "handoff_membership_api_status").toBe(200);
  expect(roleBindings.ownerMatches, "former_owner_becomes_single_active_admin").toBe(1);
  expect(roleBindings.lawyerMatches, "lawyer_becomes_single_active_owner").toBe(1);

  const newOwnerContext = await browser.newContext();
  const newOwnerPage = await newOwnerContext.newPage();
  await loginTenant(newOwnerPage, tenantAdminUrl, lawyerMemberEmail, lawyerMemberPassword);
  await expect(newOwnerPage.getByRole("button", { name: "律师与成员" })).toBeVisible();
  await newOwnerPage.getByRole("button", { name: "律师与成员" }).click();
  await expect(newOwnerPage.getByRole("heading", { name: "成员与邀请" })).toBeVisible();
  await newOwnerContext.close();
  await formerOwnerContext.close();
});

test("S7[member-suspend-restore] new owner suspends and restores a distinct finance member", async ({ browser }) => {
  expect(activatedTenantId.length).toBeGreaterThan(0);
  const financeMember = financeEmail;
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await loginTenant(ownerPage, tenantAdminUrl, lawyerMemberEmail, lawyerMemberPassword);
  await ownerPage.getByRole("button", { name: "律师与成员" }).click();
  const financeRow = ownerPage.getByRole("row").filter({ hasText: "S7 律所甲财务" });
  await expect(financeRow).toHaveCount(1);
  const memberStatus = financeRow.locator("[data-member-status]");
  await expect(memberStatus).toHaveValue("active");
  await memberStatus.selectOption("suspended");
  const suspendResponsePromise = ownerPage.waitForResponse((response) =>
    response.url().includes(`/api/law/tenants/${activatedTenantId}/memberships/`) && response.request().method() === "PATCH",
  );
  await financeRow.getByRole("button", { name: "保存" }).click();
  const suspendResponse = await suspendResponsePromise;
  expect(suspendResponse.status(), `member_suspend_http_${suspendResponse.status()}`).toBe(200);
  await expect(ownerPage.getByRole("status")).toContainText("成员权限已更新");
  await expect(financeRow.locator("[data-member-status]")).toHaveValue("suspended");
  const financeContext = await browser.newContext();
  const financePage = await financeContext.newPage();
  await loginTenant(financePage, tenantAdminUrl, financeMember, financePassword);
  const suspendedAccess = await financePage.evaluate(async ({ tenantId }) => {
    const response = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/finance/billing`, { credentials: "include" });
    return { status: response.status };
  }, { tenantId: activatedTenantId });
  expect([401, 403, 404].includes(suspendedAccess.status), "suspended_finance_member_is_denied").toBe(true);

  await financeContext.close();
  await financeRow.locator("[data-member-status]").selectOption("active");
  const restoreResponsePromise = ownerPage.waitForResponse((response) =>
    response.url().includes(`/api/law/tenants/${activatedTenantId}/memberships/`) && response.request().method() === "PATCH",
  );
  await financeRow.getByRole("button", { name: "保存" }).click();
  const restoreResponse = await restoreResponsePromise;
  expect(restoreResponse.status(), `member_restore_http_${restoreResponse.status()}`).toBe(200);
  await expect(ownerPage.getByRole("status")).toContainText("成员权限已更新");
  await expect(ownerPage.getByRole("row").filter({ hasText: "S7 律所甲财务" }).locator("[data-member-status]")).toHaveValue("active");
  await ownerContext.close();
  const restoredFinanceContext = await browser.newContext();
  const restoredFinancePage = await restoredFinanceContext.newPage();
  await loginTenant(restoredFinancePage, tenantAdminUrl, financeMember, financePassword);
  const restoredAccess = await restoredFinancePage.evaluate(async ({ tenantId }) => {
    const response = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/finance/billing`, { credentials: "include" });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, code: body.error?.code ?? "" };
  }, { tenantId: activatedTenantId });
  expect([200, 503].includes(restoredAccess.status), "restored_finance_member_authorized").toBe(true);
  if (restoredAccess.status === 503) expect(restoredAccess.code).toBe("FINANCE_BILLING_UNAVAILABLE");
  await restoredFinanceContext.close();
});

test("tenant auth smoke reaches the lawyer UI using the distinct system administrator identity", async ({ page }) => {
  await loginTenant(page, `${lawyerUrl}/login`);
});

test("S7[password-reset-and-session-revocation] local STARTTLS reset is one-time and invalidates two browser sessions", async ({ browser }) => {
  const oldPassword = lawyerMemberPassword;
  const newPassword = `${lawyerMemberPassword.slice(0, 20)}-reset-2026`;
  const firstContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  await loginTenant(firstPage, `${lawyerUrl}/login`, lawyerMemberEmail, oldPassword);
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await loginTenant(secondPage, `${lawyerUrl}/login`, lawyerMemberEmail, oldPassword);

  const unknownContext = await browser.newContext();
  const unknownPage = await unknownContext.newPage();
  await unknownPage.goto(`${lawyerUrl}/forgot-password`);
  await expect(unknownPage.locator('input[type="email"]')).toBeVisible();
  await unknownPage.locator('input[type="email"]').fill(`missing-${Date.now()}@example.com`);
  await unknownPage.locator('button[type="submit"]').click();
  const genericUnknown = await unknownPage.getByRole("status").innerText();
  await expect(unknownPage.getByRole("status")).toBeVisible();

  const resetRequestContext = await browser.newContext();
  const resetRequestPage = await resetRequestContext.newPage();
  await resetRequestPage.goto(`${lawyerUrl}/forgot-password`);
  await resetRequestPage.locator('input[type="email"]').fill(lawyerMemberEmail);
  await resetRequestPage.locator('button[type="submit"]').click();
  const genericKnown = await resetRequestPage.getByRole("status").innerText();
  expect(genericKnown, "password_reset_request_does_not_enumerate_accounts").toBe(genericUnknown);

  let resetToken = "";
  await expect.poll(async () => {
    const response = await resetRequestContext.request.get(`${mailSinkUrl}/password-reset-token`);
    if (!response.ok()) return false;
    resetToken = await response.text();
    return /^eyJ[A-Za-z0-9._-]{40,4096}$/.test(resetToken);
  }, { timeout: 45_000, intervals: [250, 500, 1000] }).toBe(true);

  const redemptionContext = await browser.newContext();
  const redemptionPage = await redemptionContext.newPage();
  await redemptionPage.goto(`${lawyerUrl}/reset-password#token=${resetToken}`);
  await expect(redemptionPage.locator('input[type="password"]').first()).toBeVisible();
  await expect.poll(async () => redemptionPage.evaluate(() => window.location.hash)).toBe("");
  await redemptionPage.locator("#new-password").fill(newPassword);
  await redemptionPage.locator("#confirm-password").fill(newPassword);
  const completionPromise = redemptionPage.waitForResponse((response) =>
    response.url().endsWith("/api/v1/auth/password-reset/complete") && response.request().method() === "POST",
  );
  await redemptionPage.locator('button[type="submit"]').click();
  const completion = await completionPromise;
  expect(completion.status(), "password_reset_redemption_status").toBe(200);
  await expect(redemptionPage.getByRole("status")).toBeVisible();

  const replay = await redemptionContext.request.post(`${lawyerUrl}/api/v1/auth/password-reset/complete`, {
    data: { token: resetToken, new_password: `${newPassword}-again` },
  });
  expect(replay.status(), "password_reset_token_replay_rejected").toBe(400);
  const replayBody = await replay.text();
  expect(replayBody.includes(resetToken), "reset_token_not_reflected_in_replay_error").toBe(false);

  for (const page of [firstPage, secondPage]) {
    const staleSessionStatus = await page.evaluate(async () => (await fetch("/api/v1/auth/me", { credentials: "include" })).status);
    expect(staleSessionStatus, "old_browser_session_revoked").toBe(401);
  }
  const oldLoginContext = await browser.newContext();
  const oldLoginPage = await oldLoginContext.newPage();
  await oldLoginPage.goto(`${lawyerUrl}/login`);
  await oldLoginPage.locator('input[type="email"]').fill(lawyerMemberEmail);
  await oldLoginPage.locator('input[type="password"]').fill(oldPassword);
  await oldLoginPage.locator('input[type="password"]').press("Enter");
  await expect.poll(async () => oldLoginPage.evaluate(async () => (await fetch("/api/v1/auth/me", { credentials: "include" })).status)).toBe(401);
  const newLoginContext = await browser.newContext();
  const newLoginPage = await newLoginContext.newPage();
  await loginTenant(newLoginPage, `${lawyerUrl}/login`, lawyerMemberEmail, newPassword);

  await firstContext.close();
  await secondContext.close();
  await unknownContext.close();
  await resetRequestContext.close();
  await redemptionContext.close();
  await oldLoginContext.close();
  await newLoginContext.close();
});

test("S7[keyboard-and-viewport-accessibility] reset screens remain operable at desktop and mobile widths", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${lawyerUrl}/forgot-password`);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await page.keyboard.press("Tab");
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName.toLowerCase());
  expect(["input", "a"].includes(focusedTag ?? ""), "keyboard_focus_moves_to_interactive_control").toBe(true);
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(mobileOverflow, "forgot_password_no_horizontal_overflow_at_390px").toBe(false);
  await page.goto(`${lawyerUrl}/register`);
  await expect(page.getByRole("button", { name: "已收到律所邀请码？使用邀请码加入" })).toBeVisible();
  await page.getByRole("button", { name: "已收到律所邀请码？使用邀请码加入" }).click();
  const termsTrigger = page.getByRole("button", { name: "《Matrix-Law 服务条款》" });
  await expect(termsTrigger).toBeVisible();
  await termsTrigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect.poll(async () => page.evaluate(() => document.activeElement?.textContent?.trim())).toContain("Matrix-Law 服务条款");
  const registrationMobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(registrationMobileOverflow, "invitation_registration_no_horizontal_overflow_at_390px").toBe(false);
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(desktopOverflow, "forgot_password_no_horizontal_overflow_at_1440px").toBe(false);
  const registrationDesktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(registrationDesktopOverflow, "invitation_registration_no_horizontal_overflow_at_1440px").toBe(false);
  await context.close();
});

test("S7[finance-billing-readonly] owner enrolls the real relay and finance reads a zero-balance projection", async ({ browser }) => {
  test.setTimeout(180_000);
  expect(activatedTenantId.length).toBeGreaterThan(0);
  expect(activatedCapabilityApiKey.length).toBeGreaterThan(16);
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await loginTenant(ownerPage, tenantAdminUrl, ownerEmail, ownerPassword);
  const connectResult = await ownerPage.evaluate(async ({ tenantId, endpoint, apiKey }) => {
    const csrf = document.cookie.split("; ").find((part) => part.startsWith("csrf_token="))?.slice("csrf_token=".length) ?? "";
    const response = await fetch("/api/law/tenants/connect", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf) },
      body: JSON.stringify({ tenant_id: tenantId, name: "S7 loopback capability", endpoint_url: endpoint, api_key: apiKey, enabled: true, priority: 10 }),
    });
    const body = await response.json().catch(() => ({}));
    return {
      status: response.status,
      connectionStatus: body.data?.connection?.status ?? "",
      relayEndpoint: body.data?.connection?.relay_endpoint_url ?? "",
      tenantMatches: body.data?.connection?.tenant_id === tenantId,
    };
  }, { tenantId: activatedTenantId, endpoint: capabilityEndpoint, apiKey: activatedCapabilityApiKey });
  expect(connectResult.status, "real_capability_connect_and_signed_mtls_enrollment_status").toBe(201);
  expect(connectResult.connectionStatus, "relay_connection_active_after_signed_enrollment").toBe("active");
  expect(connectResult.relayEndpoint.startsWith("https://127.0.0.1:"), "relay_uses_loopback_mtls_listener").toBe(true);
  expect(connectResult.tenantMatches, "relay_binding_matches_activated_tenant").toBe(true);

  seedZeroWalletProjection(activatedTenantId);
  const countsBeforeRead = financeMutationCounts(activatedTenantId);
  const financeContext = await browser.newContext();
  const financePage = await financeContext.newPage();
  await loginTenant(financePage, tenantAdminUrl, financeEmail, financePassword);
  const projection = await financePage.evaluate(async (tenantId) => {
    const response = await fetch(`/api/law/tenants/${encodeURIComponent(tenantId)}/finance/billing`, { credentials: "include", cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, data: body.data ?? null, errorCode: body.error?.code ?? "" };
  }, activatedTenantId);
  expect(projection.status, `real_finance_projection_http_${projection.status}_${projection.errorCode}`).toBe(200);
  expect(projection.data?.wallet?.wallets, "synthetic_wallet_projection_is_zero_balance").toEqual([
    expect.objectContaining({ currency: "CNY", available_microunits: "0", reserved_microunits: "0" }),
  ]);
  expect(projection.data?.wallet?.transactions, "no_wallet_transactions_created").toEqual([]);
  expect(projection.data?.wallet?.receipts, "no_payment_receipts_created").toEqual([]);
  expect(projection.data?.wallet?.refunds, "no_refunds_created").toEqual([]);
  expect(projection.data?.ledger?.entries, "no_billing_ledger_events_created").toEqual([]);
  expect(projection.data?.ocr?.entries, "no_ocr_charges_created").toEqual([]);
  expect(financeMutationCounts(activatedTenantId), "finance_get_does_not_mutate_ledger_or_wallet_transactions").toBe(countsBeforeRead);
  await financeContext.close();
  await ownerContext.close();
  activatedCapabilityApiKey = "";
});
