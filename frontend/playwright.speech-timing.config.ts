import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "law-speech-timing-probe.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: "list",
  outputDir: "test-results/speech-timing-probe",
  use: { trace: "off", screenshot: "off", video: "off" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
      },
    },
  ],
});
