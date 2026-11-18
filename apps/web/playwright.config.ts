import { defineConfig } from "@playwright/test";

// Started by e2e/run.mjs (empty database, api, worker, web). Two projects run the same flows: desktop and phone.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  outputDir: "./e2e/results",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_WEB_URL ?? "http://localhost:5273", trace: "retain-on-failure" },
  projects: [{ name: "desktop" }, { name: "phone" }],
});
