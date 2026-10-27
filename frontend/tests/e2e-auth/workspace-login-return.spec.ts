import { expect, test } from "@playwright/test";

// No login bypass or backend interception: the server must reject the anonymous
// workspace before the browser preserves its navigation destination.
for (const { returnPath, expiredSession } of [
  { returnPath: "/workspace/law?tab=matters#resume", expiredSession: false },
  {
    returnPath:
      "/workspace/chats/10000000-0000-0000-0000-000000000001?view=artifacts",
    expiredSession: false,
  },
  { returnPath: "/workspace/law?tab=matters#resume", expiredSession: true },
]) {
  test(`${expiredSession ? "expired" : "anonymous"} workspace retains its destination: ${returnPath}`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (expiredSession) {
      await context.addCookies([
        {
          name: "access_token",
          value: "expired-synthetic-return-test",
          url: baseURL!,
        },
      ]);
    }
    await page.goto(returnPath);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/login" &&
        url.searchParams.get("next") === returnPath,
    );
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(
      page.getByText("整理材料、分析案情、核验引用、起草文书。"),
    ).toBeVisible();
    await expect(
      page.getByText("每位律师独立承担 LLM 用量", { exact: false }),
    ).toHaveCount(0);
  });
}
