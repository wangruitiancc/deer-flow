import { defineConfig, devices } from "@playwright/test";

const frontendPort = process.env.W12_FRONTEND_PORT ?? "3312";
const apiPort = process.env.W12_API_PORT ?? "8312";
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;
const matrixLawRoot = process.env.MATRIX_LAW_SOURCE_ROOT;
const deerFlowRoot = process.env.DEER_FLOW_SOURCE_ROOT;
const databaseUrl = process.env.MATRIX_LAW_TEST_DATABASE_URL;

if (!matrixLawRoot || !deerFlowRoot || !databaseUrl) {
  throw new Error(
    "W12 browser tests require explicit Matrix Law, DeerFlow, Python, and isolated PostgreSQL paths.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e-w12",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: frontendUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next build --webpack && pnpm exec next start -p ${frontendPort}`,
    cwd: `${deerFlowRoot}/frontend`,
    url: frontendUrl,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PORT: frontendPort,
      SKIP_ENV_VALIDATION: "1",
      DEER_FLOW_AUTH_DISABLED: "1",
      BETTER_AUTH_SECRET: "w12-isolated-browser-test-secret",
      DEER_FLOW_INTERNAL_GATEWAY_BASE_URL: apiUrl,
    },
  },
});
