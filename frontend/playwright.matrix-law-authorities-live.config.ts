import { defineConfig } from "@playwright/test";

import base from "./playwright.matrix-law-project-artifacts.config";

export default defineConfig(base, {
  testMatch: "matrix-law-authorities-live.spec.ts",
  timeout: 400_000,
  outputDir: "test-results/authorities-live",
  use: { ...base.use, baseURL: "http://127.0.0.1:2035", trace: "off" },
});
