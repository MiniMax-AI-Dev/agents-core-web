import { defineConfig } from "@playwright/test";

const fixturePort = Number(process.env.AGENTS_FIXTURE_PORT ?? 18092);
const webPort = Number(process.env.AGENTS_WEB_PORT ?? 4174);
const reuseExistingServer = process.env.AGENTS_REUSE_E2E_SERVERS === "1";

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
      reuseExistingServer,
      timeout: 15_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `AGENTS_CORE_WEB_SELF_HOSTED_SESSIONS=1 AGENTS_CORE_WEB_OPENAI_HOSTED_SESSIONS=1 AGENTS_CORE_WEB_ENVIRONMENT_FILES=1 AGENTS_CORE_WEB_DOCKER_BACKEND_GUIDE=1 AGENTS_CORE_WEB_DOCKER_DATABASE_CONTAINER=parsar-agents-api-web-smoke-db AGENTS_CORE_WEB_DOCKER_API_CONTAINER=agents-core-web-api AGENTS_CORE_WEB_DOCKER_DAEMON_CONTAINER=agents-core-web-daemon AGENTS_CORE_WEB_DOCKER_CORE_PORT=8091 AGENTS_API_PROXY_TARGET=http://127.0.0.1:${fixturePort} node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --mode test --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
