import { defineConfig, devices } from "@playwright/test";

const required = [
  "S7_PLATFORM_URL",
  "S7_TENANT_ADMIN_URL",
  "S7_LAWYER_URL",
  "S7_PLATFORM_EMAIL",
  "S7_PLATFORM_PASSWORD",
  "S7_SYSTEM_ADMIN_EMAIL",
  "S7_SYSTEM_ADMIN_PASSWORD",
  "S7_OWNER_EMAIL",
  "S7_OWNER_PASSWORD",
  "S7_MAIL_SINK_URL",
  "S7_LAWYER_MEMBER_EMAIL",
  "S7_LAWYER_MEMBER_PASSWORD",
  "S7_FINANCE_EMAIL",
  "S7_FINANCE_PASSWORD",
  "S7_SECOND_OWNER_EMAIL",
  "S7_SECOND_OWNER_PASSWORD",
  "S7_SECOND_LAWYER_A_EMAIL",
  "S7_SECOND_LAWYER_A_PASSWORD",
  "S7_SECOND_LAWYER_B_EMAIL",
  "S7_SECOND_LAWYER_B_PASSWORD",
  "S7_SECOND_FINANCE_EMAIL",
  "S7_SECOND_FINANCE_PASSWORD",
  "S7_FIRM_ONE_LAWYER_B_EMAIL",
  "S7_FIRM_ONE_LAWYER_B_PASSWORD",
  "S7_JOURNEYS_FILE",
  "S7_CAPABILITY_ENDPOINT",
  "S7_CAPABILITY_ISSUER",
  "S7_CAPABILITY_DATABASE_URL",
  "S7_PSQL_BIN",
  "S7_TENANT_DATABASE_URL",
] as const;
for (const name of required) {
  if (!process.env[name]) throw new Error(`S7 browser test requires ${name}`);
}

export default defineConfig({
  testDir: "./tests/e2e-s7",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  outputDir: process.env.S7_TEST_OUTPUT_DIR,
  preserveOutput: "never",
  reporter: [
    ["list"],
    ["./tests/e2e-s7/status-reporter.ts", { outputFile: process.env.S7_JOURNEYS_FILE }],
  ],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    ...devices["Desktop Chrome"],
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
