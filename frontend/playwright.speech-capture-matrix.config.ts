import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "law-speech-live-capture.spec.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  timeout: 120_000,
  use: {
    baseURL,
    locale: "en-US",
    ignoreHTTPSErrors: process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === "1",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        launchOptions: {
          headless:
            process.env.PLAYWRIGHT_SPEECH_HEADFUL === "1" ? false : undefined,
          env: {
            ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
            ...(process.env.PULSE_SERVER
              ? { PULSE_SERVER: process.env.PULSE_SERVER }
              : {}),
          },
          firefoxUserPrefs: {
            "media.navigator.streams.fake": true,
            "media.navigator.permission.disabled": true,
            "media.autoplay.default": 0,
            "media.autoplay.block-webaudio": false,
            "media.autoplay.blocking_policy": 2,
          },
        },
      },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command:
          "./node_modules/.bin/next build && ./node_modules/.bin/next start",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          SKIP_ENV_VALIDATION: "1",
          DEER_FLOW_AUTH_DISABLED: "1",
        },
      },
});
