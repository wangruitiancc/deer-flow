import { defineConfig, devices } from "@playwright/test";

const frontendPort = process.env.E2E_FRONTEND_PORT ?? "3019";
const gatewayPort = process.env.E2E_GATEWAY_PORT ?? "8019";
const frontendUrl = `http://localhost:${frontendPort}`;

export default defineConfig({
  testDir: "./tests/e2e-real-backend",
  testMatch: "matrix-law-evidence-real.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 240_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: frontendUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm start",
    url: frontendUrl,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PORT: frontendPort,
      SKIP_ENV_VALIDATION: "1",
      BETTER_AUTH_SECRET: "phase9-frontend-test-secret",
      DEER_FLOW_INTERNAL_GATEWAY_BASE_URL: `http://127.0.0.1:${gatewayPort}`,
    },
  },
});
