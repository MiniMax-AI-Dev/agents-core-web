import { defineConfig } from "@playwright/test";

const fixturePort = 18092;
const webPort = 4174;

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  outputDir: "test-results",
  preserveOutput: "always",
  reporter: [
    ["line"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    channel: "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: [
    {
      command: "node apps/web/e2e/fixture-core.mjs",
      url: `http://127.0.0.1:${fixturePort}/__fixture/health`,
      reuseExistingServer: false,
      timeout: 15_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `AGENTS_API_PROXY_TARGET=http://127.0.0.1:${fixturePort} pnpm --filter @agents-core-web/web exec vite --host 127.0.0.1 --mode test --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
