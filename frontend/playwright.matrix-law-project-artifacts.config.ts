import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e-real-backend",
  testMatch: [
    "matrix-law-project-artifacts-real.spec.ts",
    "matrix-law-legal-graph-real.spec.ts",
    "matrix-law-template-picker-real.spec.ts",
    "matrix-law-template-management-real.spec.ts",
    "matrix-law-legal-authorities-real.spec.ts",
  ],
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  outputDir: "test-results/project-artifacts-real",
  use: {
    baseURL: process.env.E2E_P1_URL ?? "http://127.0.0.1:2035",
    actionTimeout: 20_000,
    trace: "off", // Real cookie-auth session; do not persist cookies in traces.
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
