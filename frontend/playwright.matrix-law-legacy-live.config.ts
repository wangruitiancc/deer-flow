import { defineConfig } from "@playwright/test";

import base from "./playwright.matrix-law-project-artifacts.config";

export default defineConfig(base, {
  testMatch: "matrix-law-legacy-graph-live.spec.ts",
  timeout: 400_000,
  outputDir: "test-results/legacy-graph-live",
  use: { ...base.use, baseURL: "http://127.0.0.1:2035", trace: "off" },
});
