import { expect, test, type APIRequestContext, type Locator, type Page, type TestInfo } from "@playwright/test";

const fixtureBaseUrl = `http://127.0.0.1:${process.env.AGENTS_FIXTURE_PORT ?? 18092}`;

interface FixtureRequest {
  method: string;
  path: string;
  query?: string;
  beta: string | null;
  authorizationPresent: boolean;
  idempotencyKeyPresent: boolean;
  idempotencyKey: string | null;
  body?: Record<string, unknown>;
}

async function resetFixture(request: APIRequestContext) {
  const response = await request.post(`${fixtureBaseUrl}/__fixture/reset`);
  expect(response.ok()).toBe(true);
}

async function controlFixture(request: APIRequestContext, control: Record<string, unknown>) {
  const response = await request.post(`${fixtureBaseUrl}/__fixture/control`, { data: control });
  expect(response.ok()).toBe(true);
}

interface FixtureState {
  sessions: Array<{ id: string; metadata: Record<string, string> }>;
  aborts: { sessionReads: number; itemReads: number; turnReads: number; streams: number };
  openStreams: string[];
}

async function fixtureState(request: APIRequestContext): Promise<FixtureState> {
  const response = await request.get(`${fixtureBaseUrl}/__fixture/state`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<FixtureState>;
}

async function setFixtureSessionMetadata(
  request: APIRequestContext,
  id: string,
  metadata: Record<string, string>,
) {
  const response = await request.post(`${fixtureBaseUrl}/__fixture/session-metadata`, { data: { id, metadata } });
  expect(response.ok()).toBe(true);
}

async function removeFixtureSession(request: APIRequestContext, id: string) {
  const response = await request.post(`${fixtureBaseUrl}/__fixture/remove-session`, { data: { id } });
  expect(response.ok()).toBe(true);
}

async function emitTurnFixture(request: APIRequestContext, status: "completed" | "failed" | "cancelled") {
  const response = await request.post(`${fixtureBaseUrl}/__fixture/emit-turn`, { data: { status } });
  expect(response.ok()).toBe(true);
}

async function fixtureRequests(request: APIRequestContext): Promise<FixtureRequest[]> {
  const response = await request.get(`${fixtureBaseUrl}/__fixture/requests`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<FixtureRequest[]>;
}

async function expectSelectedDeleteAbortsSessionRead(
  page: Page,
  request: APIRequestContext,
  startRead: () => Promise<unknown>,
) {
  const path = "/v1/agents/sessions/session_snapshot";
  const failedReads = new Map<string, string>();
  page.on("requestfailed", (failedRequest) => {
    const failedPath = new URL(failedRequest.url()).pathname;
    if (failedRequest.method() === "GET") {
      failedReads.set(failedPath, failedRequest.failure()?.errorText ?? "unknown failure");
    }
  });
  const before = await fixtureState(request);
  const previousReads = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "GET" && entry.path === path
  )).length;

  await startRead();
  await expect.poll(async () => (await fixtureRequests(request)).filter((entry) => (
    entry.method === "GET" && entry.path === path
  )).length).toBeGreaterThan(previousReads);

  await page.locator(".conversation-session-action").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete Session" }).click();
  await expect(dialog).toHaveCount(0);

  await expect.poll(() => failedReads.get(path)).toContain("ERR_ABORTED");
  await expect.poll(async () => (await fixtureState(request)).aborts.sessionReads)
    .toBeGreaterThan(before.aborts.sessionReads);
  expect((await fixtureState(request)).sessions.some((session) => session.id === "session_snapshot")).toBe(false);
}

async function openAgents(page: Page, request: APIRequestContext) {
  await resetFixture(request);
  await page.goto("/");
  await page.getByRole("button", { name: "Agents" }).click();
  await expect(page.getByRole("table", { name: "Agents" })).toBeVisible();
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png",
  });
}

async function attachElementScreenshot(locator: Locator, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await locator.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
}

test("retrieves latest details and reuses a validated create/edit form", async ({ page, request }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await openAgents(page, request);
  await expect(page.getByText("Lifecycle Agent · stale list", { exact: true })).toBeVisible();

  await controlFixture(request, { retrieveDelayMs: 250 });
  await page.getByRole("button", { name: /Open details for Lifecycle Agent/ }).click();
  await expect(page.getByText("Retrieving the latest saved Agent…")).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Lifecycle Agent", exact: true })).toBeVisible();
  await expect(dialog).not.toContainText("stale list");
  await expect(dialog).toContainText("agent_a");
  await expect(dialog).toContainText("Advanced configuration · read only");
  await expect(dialog).toContainText("known Core Session profile cannot start it");
  await expect(dialog.locator("input, textarea, select")).toHaveCount(0);
  await attachScreenshot(page, testInfo, "desktop-light-agent-details");

  await page.getByRole("button", { name: "Edit" }).click();
  const name = page.getByLabel("Name");
  await expect(name).toBeFocused();
  await expect(page.getByRole("dialog")).toContainText("Web-side suggestions, not a discovered Core catalog");
  await expect(page.getByRole("dialog")).toContainText("Never store secrets in Agent metadata");

  await page.getByLabel("Metadata").fill('{"retries":3}');
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Every metadata value must be a string.")).toBeVisible();
  let requests = await fixtureRequests(request);
  expect(requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/agents/agent_a")).toHaveLength(0);

  await page.getByLabel("Metadata").fill(JSON.stringify(Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [`key-${index}`, "value"]),
  )));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Agent metadata supports at most 16 pairs.")).toBeVisible();
  requests = await fixtureRequests(request);
  expect(requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/agents/agent_a")).toHaveLength(0);

  await name.fill("");
  await page.getByLabel("Instructions").fill("");
  await page.getByLabel("Metadata").fill('{"team":"acceptance"}');
  await page.getByLabel("Reasoning effort").selectOption("");
  await page.getByLabel("Reasoning summary").selectOption("");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeFocused();

  requests = await fixtureRequests(request);
  const updates = requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/agents/agent_a");
  expect(updates).toHaveLength(1);
  expect(updates[0]?.body).toMatchObject({
    name: null,
    instructions: null,
    metadata: { team: "acceptance" },
    reasoning: { effort: null, summary: null },
  });
  expect(browserErrors).toEqual([]);
});

test("supports global Create keyboard navigation and consumes setup requests once", async ({ page, request }) => {
  await openAgents(page, request);
  const sidebar = page.locator(".app-sidebar");
  const productNavigation = sidebar.getByRole("navigation", { name: "Agents product" });
  await expect(productNavigation).toBeVisible();
  await expect(productNavigation.getByRole("button", { name: "Agents", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".product-header").getByRole("navigation", { name: "Agents product" })).toHaveCount(0);
  const createMenu = page.getByRole("button", { name: "Create", exact: true });
  await createMenu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: /^Agent\b/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(createMenu).toBeFocused();
  await page.keyboard.press("ArrowDown");
  const createAgentItem = page.getByRole("menuitem", { name: /^Agent\b/ });
  const startSessionItem = page.getByRole("menuitem", { name: /^Start Session\b/ });
  await expect(createAgentItem).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(startSessionItem).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(createAgentItem).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Name")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Request preview" })).toBeVisible();

  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await expect(page.getByRole("table", { name: "Agents" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "New Agent" })).toHaveCount(0);

  const detailTrigger = page.getByRole("button", { name: /Open details for Lifecycle Agent/ });
  await detailTrigger.focus();
  await detailTrigger.evaluate((button) => button.click());
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Lifecycle Agent", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(detailTrigger).toBeFocused();
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);

  await createMenu.click();
  await startSessionItem.click();
  const sessionDialog = page.getByRole("dialog", { name: "Start an idle Session" });
  await expect(sessionDialog).toBeVisible();
  await expect(sessionDialog.getByLabel("Saved Agent")).toHaveValue("agent_b");
  await expect(sessionDialog.locator('option[value="agent_a"]')).toHaveAttribute("disabled", "");
  await expect(sessionDialog.locator('option[value="agent_tool_only"]')).toHaveAttribute("disabled", "");
  const sessionPostsBeforeCancel = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions"
  )).length;
  await sessionDialog.getByRole("button", { name: "Cancel" }).click();
  expect((await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions"
  ))).toHaveLength(sessionPostsBeforeCancel);
  await expect(createMenu).toBeFocused();
  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Start an idle Session" })).toHaveCount(0);

  await page.getByRole("button", { name: "Agents", exact: true }).click();
  await createMenu.click();
  await createAgentItem.click();
  const createMetadata = page.locator(".agent-metadata-input");
  const createName = page.locator('input[data-agent-initial-focus="true"]');
  await expect(createName).toBeFocused();
  await createMetadata.fill('{"owner":"local-test"}');
  await expect(createMetadata).toHaveValue('{"owner":"local-test"}');
  await expect(createName).toHaveValue("");
  await createName.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Agent definition saved as");

  await createMenu.click();
  await createAgentItem.click();
  await expect(page.getByLabel("Name")).toHaveValue("");
  await expect(page.getByLabel("Name")).toBeEnabled();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to Agents" }).click();
  await expect(createMenu).toBeFocused();

  const ledgerCreate = page.getByRole("button", { name: "New Agent" });
  await ledgerCreate.click();
  await page.getByRole("button", { name: "Back to Agents" }).click();
  await expect(ledgerCreate).toBeFocused();

  const requests = await fixtureRequests(request);
  const creates = requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/agents");
  expect(creates).toHaveLength(1);
  expect(creates[0]?.body).toMatchObject({
    name: null,
    instructions: null,
    metadata: { owner: "local-test" },
    service_tier: "auto",
    text: { format: { type: "text" }, verbosity: "medium" },
  });
  expect(creates[0]?.body).not.toHaveProperty("reasoning");
});

test("continues from a default Agent definition into an admitted idle Session", async ({ page, request }) => {
  await openAgents(page, request);
  await page.getByRole("button", { name: "New Agent" }).click();
  await page.getByLabel("Name").fill("Session-safe Agent");
  await page.getByRole("button", { name: "Save Agent definition" }).click();
  await expect(page.getByRole("status")).toContainText("Agent definition saved as");

  const requestsAfterSave = await fixtureRequests(request);
  const create = requestsAfterSave.find((entry) => entry.method === "POST" && entry.path === "/v1/agents");
  expect(create?.body).toMatchObject({
    name: "Session-safe Agent",
    service_tier: "auto",
    text: { format: { type: "text" }, verbosity: "medium" },
  });
  expect(create?.body).not.toHaveProperty("reasoning");

  await expect(page.getByRole("button", { name: "Start Session" })).toBeEnabled();
  await page.getByRole("button", { name: "Start Session" }).click();
  await expect(page.getByRole("button", { name: "Sessions", exact: true })).toHaveAttribute("aria-current", "page");

  const sessionCreates = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions"
  ));
  expect(sessionCreates).toHaveLength(1);
  expect(sessionCreates[0]?.body).toMatchObject({
    agent_id: expect.stringMatching(/^agent_created_/),
    environment: { type: "none" },
    stream: false,
  });
});

test("rechecks the saved response before offering the setup-page Session continuation", async ({ page, request }) => {
  await openAgents(page, request);
  await controlFixture(request, { createAgentResponseVariant: "reasoning" });
  await page.getByRole("button", { name: "New Agent" }).click();
  await page.getByLabel("Name").fill("Core-adjusted Agent");
  await page.getByRole("button", { name: "Save Agent definition" }).click();

  await expect(page.getByRole("status")).toContainText("Agent definition saved as");
  await expect(page.locator("#created-agent-session-blocker")).toContainText("Start Session is unavailable");
  const startSession = page.getByRole("button", { name: "Start Session" });
  await expect(startSession).toBeDisabled();

  // Bypass the setup view's disabled control to prove App's final admission
  // guard independently blocks the write if a caller reaches it anyway.
  await startSession.evaluate((button) => {
    const propsKey = Object.getOwnPropertyNames(button).find((key) => key.startsWith("__reactProps$"));
    if (!propsKey) throw new Error("React event props were not found on the Start Session button.");
    const props = (button as unknown as Record<string, { onClick?: () => void }>)[propsKey];
    if (!props?.onClick) throw new Error("Start Session does not have an onClick handler.");
    props.onClick();
  });
  await expect(page.getByText(/Session was not created\./)).toBeVisible();
  expect((await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions"
  ))).toHaveLength(0);
});

test("starts only Agents that pass known Session admission", async ({ page, request }) => {
  await openAgents(page, request);

  const blockedStart = page.getByRole("button", { name: /Start a Session with Lifecycle Agent/ });
  await expect(blockedStart).toHaveAttribute("aria-disabled", "true");
  await blockedStart.focus();
  await expect(blockedStart.locator("xpath=..").getByRole("tooltip")).toBeVisible();
  const blockedSessionCount = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions"
  )).length;
  await page.keyboard.press("Enter");
  expect((await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions"
  ))).toHaveLength(blockedSessionCount);

  const toolOnlyStart = page.getByRole("button", { name: "Start a Session with Saved-only Tool Agent" });
  await expect(toolOnlyStart).toHaveAttribute("aria-disabled", "true");
  await toolOnlyStart.focus();
  await expect(toolOnlyStart.locator("xpath=..").getByRole("tooltip")).toContainText("tool_search is saved-only");
  await page.keyboard.press("Enter");
  expect((await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions"
  ))).toHaveLength(blockedSessionCount);
  await expect(page.getByRole("button", { name: "Start a Session with Second Agent" })).toBeEnabled();

  const before = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions"
  )).length;
  await page.getByRole("button", { name: "Start a Session with Second Agent" }).click();
  await expect(page.getByRole("button", { name: "Sessions", exact: true })).toHaveAttribute("aria-current", "page");

  const sessionCreates = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions"
  ));
  expect(sessionCreates).toHaveLength(before + 1);
  expect(sessionCreates.at(-1)?.body).toMatchObject({
    agent_id: "agent_b",
    environment: { type: "none" },
    stream: false,
  });
});

test("keeps the New Session reason keyboard-accessible when every loaded Agent is incompatible", async ({ page, request }) => {
  await openAgents(page, request);
  const deleted = await request.delete(`${fixtureBaseUrl}/v1/agents/agent_b`);
  expect(deleted.ok()).toBe(true);
  await page.getByRole("button", { name: "Refresh Agents" }).click();
  await expect(page.getByRole("button", { name: "Open details for Second Agent" })).toHaveCount(0);

  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  const newSession = page.getByRole("button", { name: "New Session" });
  await expect(newSession).toHaveAttribute("aria-disabled", "true");
  await newSession.focus();
  await expect(newSession.locator("xpath=..").getByRole("tooltip")).toContainText("No loaded Agent matches");
  const before = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions"
  )).length;
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Start an idle Session" })).toHaveCount(0);
  expect((await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions"
  ))).toHaveLength(before);
});

test("keeps failures visible, rejects stale async continuations, and never retries writes", async ({ page, request }) => {
  await openAgents(page, request);

  await controlFixture(request, { retrieveStatus: 500 });
  await page.getByRole("button", { name: /Open details for Lifecycle Agent/ }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Lifecycle Agent · stale list", exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Fixture retrieve failed.");
  await expect(dialog.getByRole("button", { name: "Edit" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Retry latest Agent" }).click();
  await expect(dialog.getByRole("heading", { name: "Lifecycle Agent", exact: true })).toBeVisible();
  await expect(dialog).not.toContainText("stale list");
  await page.keyboard.press("Escape");

  await controlFixture(request, { retrieveDelayMs: 400 });
  await page.getByRole("button", { name: /Open details for Lifecycle Agent/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Retrieving the latest saved Agent…")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: /Open details for Lifecycle Agent/ }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Name").fill("Preserved after failure");
  await controlFixture(request, { updateStatus: 500 });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText("Fixture update failed.");
  await expect(page.getByLabel("Name")).toHaveValue("Preserved after failure");

  let requests = await fixtureRequests(request);
  expect(requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/agents/agent_a")).toHaveLength(1);

  await controlFixture(request, { updateDelayMs: 600 });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await page.waitForTimeout(100);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(700);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  requests = await fixtureRequests(request);
  expect(requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/agents/agent_a")).toHaveLength(2);
});

test("requires delete confirmation, preserves failures, and keeps Session snapshots", async ({ page, request }) => {
  await openAgents(page, request);
  await page.getByRole("button", { name: /Open details for Lifecycle Agent/ }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog")).toContainText("Existing Sessions keep their durable Agent snapshots");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeFocused();

  let requests = await fixtureRequests(request);
  expect(requests.filter((entry) => entry.method === "DELETE" && entry.path === "/v1/agents/agent_a")).toHaveLength(0);

  await page.getByRole("button", { name: "Delete" }).click();
  await controlFixture(request, { deleteStatus: 500 });
  await page.getByRole("button", { name: "Delete Agent" }).click();
  await expect(page.getByRole("alert")).toContainText("Fixture delete failed.");
  await expect(page.getByRole("dialog")).toContainText("Lifecycle Agent");

  requests = await fixtureRequests(request);
  expect(requests.filter((entry) => entry.method === "DELETE" && entry.path === "/v1/agents/agent_a")).toHaveLength(1);

  await controlFixture(request, { deleteDelayMs: 300 });
  await page.getByRole("button", { name: "Delete Agent" }).click();
  await expect(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Open details for Lifecycle Agent/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Sessions" }).click();
  await expect(page.getByRole("button", { name: /idle Lifecycle Agent/ })).toBeVisible();
  requests = await fixtureRequests(request);
  expect(requests.filter((entry) => entry.method === "DELETE" && entry.path === "/v1/agents/agent_a")).toHaveLength(2);
});

test("keeps the Agent ledger and dialogs usable at 390 px in light and dark modes", async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAgents(page, request);

  const metrics = await page.evaluate(() => {
    const main = document.querySelector(".app-main")?.getBoundingClientRect();
    const trigger = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("New Agent"))?.getBoundingClientRect();
    const ledger = document.querySelector(".agent-ledger")?.getBoundingClientRect();
    return {
      innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      main: main && { left: main.left, right: main.right, width: main.width },
      trigger: trigger && { left: trigger.left, right: trigger.right, width: trigger.width },
      ledger: ledger && { left: ledger.left, right: ledger.right, width: ledger.width },
    };
  });
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.innerWidth);
  expect(metrics.main?.left).toBeGreaterThanOrEqual(0);
  expect(metrics.main?.right).toBeLessThanOrEqual(390);
  expect(metrics.trigger?.left).toBeGreaterThanOrEqual(0);
  expect(metrics.trigger?.right).toBeLessThanOrEqual(390);
  expect(metrics.ledger?.left).toBeGreaterThanOrEqual(0);
  expect(metrics.ledger?.right).toBeLessThanOrEqual(390);
  await attachScreenshot(page, testInfo, "narrow-light-agent-ledger");

  await expect(page.getByRole("button", { name: "Environments", exact: true })).toHaveCount(0);
  const sessionsNavigation = page.getByRole("button", { name: "Sessions", exact: true });
  await sessionsNavigation.click();
  await expect(sessionsNavigation).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".session-page")).toBeVisible();
  await page.getByRole("button", { name: "Agents", exact: true }).click();

  const globalCreate = page.getByRole("button", { name: "Create", exact: true });
  await globalCreate.click();
  const createPanel = page.getByRole("menu", { name: "Create" });
  await expect(createPanel).toBeVisible();
  await expect(createPanel.getByRole("menuitem")).toHaveCount(2);
  await expect(createPanel.getByRole("menuitem", { name: /Environment template/i })).toHaveCount(0);
  await expect(createPanel.getByRole("menuitem", { name: /Environment key/i })).toHaveCount(0);
  const createPanelBox = await createPanel.boundingBox();
  expect(createPanelBox).not.toBeNull();
  expect(createPanelBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((createPanelBox?.x ?? 0) + (createPanelBox?.width ?? 0)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await createPanel.getByRole("menuitem", { name: /^Agent\b/ }).click();
  const setup = page.locator(".agent-setup-page");
  const box = await setup.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390.5);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole("button", { name: "Save Agent definition" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Request preview" })).toBeVisible();
  await expect(page.getByLabel("Text format")).toHaveValue("Text");
  await attachScreenshot(page, testInfo, "narrow-light-agent-setup");
  await page.getByRole("button", { name: "Back to Agents" }).click();
  await expect(globalCreate).toBeFocused();

  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /Open details for Lifecycle Agent/ }).click();
  const detailDialog = page.getByRole("dialog");
  await expect(detailDialog).toBeVisible();
  const deleteAction = detailDialog.getByRole("button", { name: "Delete", exact: true });
  const editAction = detailDialog.getByRole("button", { name: "Edit", exact: true });
  await expect(deleteAction).toBeInViewport();
  await expect(editAction).toBeInViewport();
  const detailLayout = await detailDialog.evaluate((card) => {
    const body = card.querySelector<HTMLElement>(".modal-body");
    const footer = card.querySelector<HTMLElement>(".modal-footer");
    const cardBox = card.getBoundingClientRect();
    const footerBox = footer?.getBoundingClientRect();
    return {
      bodyClientHeight: body?.clientHeight ?? 0,
      bodyScrollHeight: body?.scrollHeight ?? 0,
      cardBottom: cardBox.bottom,
      footerBottom: footerBox?.bottom ?? Number.POSITIVE_INFINITY,
    };
  });
  expect(detailLayout.bodyScrollHeight).toBeGreaterThan(detailLayout.bodyClientHeight);
  expect(detailLayout.footerBottom).toBeLessThanOrEqual(detailLayout.cardBottom);
  expect(detailLayout.cardBottom).toBeLessThanOrEqual(844);
  await attachScreenshot(page, testInfo, "narrow-dark-agent-details");
  await detailDialog.locator(".modal-body").evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  await expect(deleteAction).toBeInViewport();
  await expect(editAction).toBeInViewport();
});

test("starts one Session with an idempotency key and without browser authorization", async ({ page, request }) => {
  await openAgents(page, request);
  await page.getByRole("button", { name: /Start a Session with Second Agent/ }).click();
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

  const requests = await fixtureRequests(request);
  const creates = requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/agents/sessions");
  expect(creates).toHaveLength(1);
  expect(creates[0]?.idempotencyKeyPresent).toBe(true);
  expect(creates[0]?.body).toMatchObject({ agent_id: "agent_b", environment: { type: "none" }, stream: false });
  for (const entry of requests.filter((candidate) => candidate.path.startsWith("/v1/"))) {
    expect(entry.beta).toBe("agents=v1");
    expect(entry.authorizationPresent).toBe(false);
  }
});

test("updates Session title and metadata after a latest read while preserving failed and unknown drafts", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  const manage = page.locator(".conversation-session-action");
  const streamReadsBefore = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "GET" && entry.path.endsWith("/events")
  )).length;

  await manage.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByLabel("Session title", { exact: true }).fill("Renamed Session");
  await dialog.getByLabel("Additional Session metadata", { exact: true }).fill('{"team":"web","note":"safe"}');
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("heading", { name: "Renamed Session" })).toBeVisible();
  await expect(page.locator(".conversation-header h2")).toHaveText("Renamed Session");

  let requests = await fixtureRequests(request);
  const updateIndex = requests.findLastIndex((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions/session_snapshot"
  ));
  const latestReadIndex = requests.findLastIndex((entry, index) => (
    index < updateIndex && entry.method === "GET" && entry.path === "/v1/agents/sessions/session_snapshot"
  ));
  expect(latestReadIndex).toBeGreaterThanOrEqual(0);
  expect(latestReadIndex).toBeLessThan(updateIndex);
  expect(requests[updateIndex]?.body).toEqual({
    metadata: { team: "web", note: "safe", title: "Renamed Session" },
  });
  expect(requests.filter((entry) => entry.method === "GET" && entry.path.endsWith("/events"))).toHaveLength(streamReadsBefore);

  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByLabel("Session title", { exact: true }).fill("Draft survives 503");
  await controlFixture(request, { sessionUpdateStatus: 503 });
  const postsBefore503 = requests.filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions/session_snapshot"
  )).length;
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alert")).toContainText("503");
  await expect(dialog.getByLabel("Session title", { exact: true })).toHaveValue("Draft survives 503");
  await expect(page.locator(".conversation-header h2")).toHaveText("Renamed Session");
  await page.waitForTimeout(350);
  requests = await fixtureRequests(request);
  expect(requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/agents/sessions/session_snapshot"))
    .toHaveLength(postsBefore503 + 1);

  await controlFixture(request, { sessionUpdateResponseLoss: 1 });
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alert")).toContainText("result is unknown");
  await expect(dialog.getByLabel("Session title", { exact: true })).toHaveValue("Draft survives 503");
  await expect(page.locator(".conversation-header h2")).toHaveText("Renamed Session");
  const postsAfterLoss = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions/session_snapshot"
  )).length;
  await page.waitForTimeout(350);
  expect((await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions/session_snapshot"
  ))).toHaveLength(postsAfterLoss);
});

test("preserves and safely rebases a Session metadata draft after a same-key conflict", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  await page.locator(".conversation-session-action").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByLabel("Session title", { exact: true }).fill("My preserved draft");
  await setFixtureSessionMetadata(request, "session_snapshot", {
    title: "Concurrent title",
    concurrent: "must survive",
  });

  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Metadata changed in Agent Core");
  await expect(dialog.getByLabel("Session title", { exact: true })).toHaveValue("My preserved draft");
  await expect(dialog.getByLabel("Additional Session metadata", { exact: true })).toContainText('"concurrent": "must survive"');
  await expect(page.locator(".conversation-header h2")).toHaveText("Concurrent title");
  let writes = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions/session_snapshot"
  ));
  expect(writes).toHaveLength(0);

  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("heading", { name: "My preserved draft" })).toBeVisible();
  writes = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions/session_snapshot"
  ));
  expect(writes).toHaveLength(1);
  expect(writes[0]?.body).toEqual({
    metadata: { title: "My preserved draft", concurrent: "must survive" },
  });
});

test("rejects wrong-id and deep-malformed Session reads before writes or delete retries", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();

  await controlFixture(request, { sessionRetrieveVariant: "wrong_id" });
  await page.locator(".conversation-session-action").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("invalid Session retrieval response");
  await expect(dialog).toContainText("session_snapshot");
  await expect(dialog).not.toContainText("another_session");

  await dialog.getByRole("button", { name: "Edit", exact: true }).click();
  await dialog.getByLabel("Session title", { exact: true }).fill("Draft stays local");
  await controlFixture(request, { sessionRetrieveVariant: "deep_malformed" });
  const writesBefore = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions/session_snapshot"
  )).length;
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("alert")).toContainText("invalid Session retrieval response");
  await expect(dialog.getByLabel("Session title", { exact: true })).toHaveValue("Draft stays local");
  expect((await fixtureRequests(request)).filter((entry) => (
    entry.method === "POST" && entry.path === "/v1/agents/sessions/session_snapshot"
  ))).toHaveLength(writesBefore);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toContainText("Exact Session: session_snapshot");
  await controlFixture(request, {
    sessionDeleteResponseLoss: 2,
    sessionRetrieveVariant: "deep_malformed",
  });
  const deletesBefore = (await fixtureRequests(request)).filter((entry) => entry.method === "DELETE").length;
  await dialog.getByRole("button", { name: "Delete Session" }).click();
  await expect(dialog.getByRole("alert")).toContainText("follow-up durable Session refresh also failed");
  await expect(dialog.getByRole("button", { name: "Delete Session" })).toBeDisabled();
  expect((await fixtureRequests(request)).filter((entry) => entry.method === "DELETE"))
    .toHaveLength(deletesBefore + 1);
});

test("requires confirmation and reconciles unknown Session deletes once without retrying the write", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  const manage = page.locator(".conversation-session-action");
  await manage.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toContainText("Exact Session: session_snapshot");
  await expect(dialog).toContainText("not a promise of physical history erasure");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
  expect((await fixtureRequests(request)).filter((entry) => entry.method === "DELETE")).toHaveLength(0);

  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await controlFixture(request, { sessionDeleteStatus: 409 });
  await dialog.getByRole("button", { name: "Delete Session" }).click();
  await expect(dialog.getByRole("alert")).toContainText("compatible Core rejected");
  await expect(page.locator(".conversation-header h2")).toHaveText("Lifecycle Agent");

  await controlFixture(request, { sessionDeleteStatus: 503 });
  const readsBefore503 = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "GET" && entry.path === "/v1/agents/sessions/session_snapshot"
  )).length;
  await dialog.getByRole("button", { name: "Delete Session" }).click();
  await expect(dialog.getByRole("alert")).toContainText("503");
  await expect(dialog.getByRole("alert")).toContainText("refresh confirmed that the Session is still present");
  await expect(page.locator(".conversation-header h2")).toHaveText("Lifecycle Agent");
  let requests = await fixtureRequests(request);
  expect(requests.filter((entry) => entry.method === "DELETE")).toHaveLength(2);
  expect(requests.filter((entry) => (
    entry.method === "GET" && entry.path === "/v1/agents/sessions/session_snapshot"
  ))).toHaveLength(readsBefore503 + 1);

  await controlFixture(request, {
    sessionDeleteResponseLoss: 2,
    sessionRetrieveStatus: 503,
  });
  const readsBeforeUnresolved = requests.filter((entry) => (
    entry.method === "GET" && entry.path === "/v1/agents/sessions/session_snapshot"
  )).length;
  await dialog.getByRole("button", { name: "Delete Session" }).click();
  await expect(dialog.getByRole("alert")).toContainText("result is unknown");
  await expect(dialog.getByRole("alert")).toContainText("follow-up durable Session refresh also failed");
  await expect(page.locator(".conversation-header h2")).toHaveText("Lifecycle Agent");
  await expect(dialog.getByRole("button", { name: "Delete Session" })).toBeDisabled();
  requests = await fixtureRequests(request);
  expect(requests.filter((entry) => entry.method === "DELETE")).toHaveLength(3);
  expect(requests.filter((entry) => (
    entry.method === "GET" && entry.path === "/v1/agents/sessions/session_snapshot"
  ))).toHaveLength(readsBeforeUnresolved + 1);
  await page.waitForTimeout(350);
  expect((await fixtureRequests(request)).filter((entry) => entry.method === "DELETE")).toHaveLength(3);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await manage.click();
  await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await controlFixture(request, { sessionDeleteResponseLoss: 1 });
  const readsBeforeAppliedLoss = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "GET" && entry.path === "/v1/agents/sessions/session_snapshot"
  )).length;
  await dialog.getByRole("button", { name: "Delete Session" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".session-row").filter({ hasText: "Lifecycle Agent" })).toHaveCount(0);
  requests = await fixtureRequests(request);
  expect(requests.filter((entry) => entry.method === "DELETE")).toHaveLength(4);
  expect(requests.filter((entry) => (
    entry.method === "GET" && entry.path === "/v1/agents/sessions/session_snapshot"
  ))).toHaveLength(readsBeforeAppliedLoss + 1);
  await page.waitForTimeout(350);
  expect((await fixtureRequests(request)).filter((entry) => entry.method === "DELETE")).toHaveLength(4);
});

test("keeps a stale Session row and surfaces each explicit repeated 404 deletion", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  const manage = page.locator(".conversation-session-action");
  await manage.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
  await removeFixtureSession(request, "session_snapshot");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();

  for (const expectedDeletes of [1, 2]) {
    await dialog.getByRole("button", { name: "Delete Session" }).click();
    await expect(dialog.getByRole("alert")).toContainText("not found in Agent Core");
    await expect(page.locator(".conversation-header h2")).toHaveText("Lifecycle Agent");
    expect((await fixtureRequests(request)).filter((entry) => entry.method === "DELETE")).toHaveLength(expectedDeletes);
  }
});

test("deletes an inactive Session without disturbing the active composer or listening stream", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Agents" }).click();
  await page.getByRole("button", { name: /Start a Session with Second Agent/ }).click();
  await expect(page.locator(".conversation-header h2")).toHaveText("Second Agent");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message the Agent");
  await composer.fill("active draft must survive");
  const before = await fixtureState(request);
  const activeId = before.sessions.find((session) => session.id !== "session_snapshot")?.id;
  expect(activeId).toBeTruthy();
  const activeStreamReads = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "GET" && entry.path === `/v1/agents/sessions/${activeId}/events`
  )).length;

  const inactiveRow = page.locator(".session-row").filter({ hasText: "Lifecycle Agent" });
  await inactiveRow.locator(".session-row-action").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await controlFixture(request, { sessionDeleteDelayMs: 1_500 });
  const deleteButton = dialog.locator(".modal-footer .button.danger");
  const deleteClick = deleteButton.click();
  await expect(deleteButton).toBeDisabled();
  await expect(deleteButton).toHaveText("Deleting…");
  await expect(inactiveRow).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await deleteClick;
  await expect(dialog).toHaveCount(0);
  await expect(inactiveRow).toHaveCount(0);
  await expect(composer).toHaveValue("active draft must survive");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  await expect(page.locator(".conversation-session-action")).toBeFocused();

  const after = await fixtureState(request);
  expect(after.aborts.streams).toBe(before.aborts.streams);
  expect(after.openStreams).toContain(activeId);
  expect((await fixtureRequests(request)).filter((entry) => (
    entry.method === "GET" && entry.path === `/v1/agents/sessions/${activeId}/events`
  ))).toHaveLength(activeStreamReads);
});

for (const pendingRead of [
  {
    label: "Session",
    path: "/v1/agents/sessions/session_snapshot",
    control: { sessionRetrieveDelayMs: 5_000 },
  },
  {
    label: "Item",
    path: "/v1/agents/sessions/session_snapshot/items",
    control: { itemsRetrieveDelayMs: 5_000 },
  },
  {
    label: "Turn",
    path: "/v1/agents/sessions/session_snapshot/turns",
    control: { turnsRetrieveDelayMs: 5_000 },
  },
] as const) {
  test(`aborts the selected Session's pending ${pendingRead.label} read and SSE after confirmed delete`, async ({ page, request }) => {
    const failedReads = new Map<string, string>();
    page.on("requestfailed", (failedRequest) => {
      const path = new URL(failedRequest.url()).pathname;
      if (failedRequest.method() === "GET") {
        failedReads.set(path, failedRequest.failure()?.errorText ?? "unknown failure");
      }
    });
    await resetFixture(request);
    await page.goto("/");
    await expect(page.getByText("listening", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Agents" }).click();
    await page.getByRole("button", { name: /Start a Session with Second Agent/ }).click();
    await expect(page.locator(".conversation-header h2")).toHaveText("Second Agent");
    await controlFixture(request, { turnsScenario: 1 });
    await page.locator(".session-row").filter({ hasText: "Lifecycle Agent" }).locator(".session-row-select").click();
    await expect(page.locator(".conversation-header h2")).toHaveText("Lifecycle Agent");
    await expect(page.getByText("listening", { exact: true })).toBeVisible();
    await expect(page.getByText("Completed Turn output remains in the conversation.")).toBeVisible();
    await page.locator(".conversation-session-action").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    const before = await fixtureState(request);
    const previousReads = (await fixtureRequests(request)).filter((entry) => (
      entry.method === "GET" && entry.path === pendingRead.path
    )).length;
    await controlFixture(request, pendingRead.control);
    await emitTurnFixture(request, "completed");
    await expect.poll(async () => (await fixtureRequests(request)).filter((entry) => (
      entry.method === "GET" && entry.path === pendingRead.path
    )).length).toBeGreaterThan(previousReads);

    await controlFixture(request, { sessionDeleteStreamCloseDelayMs: 3_000 });
    await dialog.getByRole("button", { name: "Delete Session" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".conversation-header h2")).toHaveText("Second Agent");
    await expect(page.getByText("Completed Turn output remains in the conversation.")).toHaveCount(0);
    await expect(page.locator('[data-turn-id="turn_completed"]')).toHaveCount(0);
    await expect(page.locator(".conversation-session-action")).toBeFocused();
    await expect(page.getByText("listening", { exact: true })).toBeVisible();

    await expect.poll(() => failedReads.get(pendingRead.path)).toContain("ERR_ABORTED");
    await expect.poll(async () => (await fixtureState(request)).aborts.streams).toBeGreaterThan(before.aborts.streams);
    const after = await fixtureState(request);
    expect(after.sessions.some((session) => session.id === "session_snapshot")).toBe(false);
    expect(after.openStreams).not.toContain("session_snapshot");
  });
}

test("aborts a pending manual recovery read after deleting the selected Session", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  await controlFixture(request, { sessionRetrieveDelayMs: 5_000 });

  await expectSelectedDeleteAbortsSessionRead(page, request, () => (
    page.getByRole("button", { name: "Recover durable state" }).click()
  ));
});

test("aborts a pending detail retry read after deleting the selected Session", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  await controlFixture(request, { sessionRetrieveStatus: 503 });
  await page.getByRole("button", { name: "Recover durable state" }).click();
  const detailError = page.locator(".session-detail-error");
  await expect(detailError).toBeVisible();
  await controlFixture(request, { sessionRetrieveDelayMs: 5_000 });

  await expectSelectedDeleteAbortsSessionRead(page, request, () => (
    detailError.getByRole("button", { name: "Retry" }).click()
  ));
});

test("deletes the selected Session while its SSE is still connecting", async ({ page, request }) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Agents" }).click();
  await page.getByRole("button", { name: /Start a Session with Second Agent/ }).click();
  await expect(page.locator(".conversation-header h2")).toHaveText("Second Agent");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();

  await controlFixture(request, { streamOpenDelayMs: 3_000 });
  await page.locator(".session-row").filter({ hasText: "Lifecycle Agent" }).locator(".session-row-select").click();
  await expect(page.locator(".conversation-header h2")).toHaveText("Lifecycle Agent");
  await expect(page.getByText("connecting", { exact: true })).toBeVisible();
  const before = await fixtureState(request);

  await page.locator(".conversation-session-action").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Delete", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete Session" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".conversation-header h2")).toHaveText("Second Agent");
  await expect.poll(async () => (await fixtureState(request)).aborts.streams).toBeGreaterThan(before.aborts.streams);
  expect((await fixtureState(request)).sessions.some((session) => session.id === "session_snapshot")).toBe(false);
});

test("keeps Session actions accessible and contained at 390 px in dark mode", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Dark theme" }).click();
  const manage = page.locator(".conversation-session-action");
  await manage.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const metrics = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const footer = element.querySelector(".modal-footer")?.getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      left: box.left,
      right: box.right,
      bottom: box.bottom,
      footerBottom: footer?.bottom ?? Number.POSITIVE_INFINITY,
    };
  });
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(390);
  expect(metrics.bottom).toBeLessThanOrEqual(844);
  expect(metrics.footerBottom).toBeLessThanOrEqual(metrics.bottom);

  await expect(dialog.getByRole("button", { name: "Edit", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(manage).toBeFocused();
});

test("renders self-hosted Environment and Workspace state safely across reconnect and narrow themes", async ({ page, request }, testInfo) => {
  await resetFixture(request);
  await controlFixture(request, {
    environmentScenario: 1,
    environmentEventStatus: 1,
    environmentEventCount: 1,
    streamCloseCount: 1,
    streamCloseDelayMs: 1_000,
  });
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();

  const panel = page.getByRole("region", { name: "Environment and Workspace status" });
  await expect(panel).toContainText("Self-hosted Environment");
  await expect(panel).toContainText("Pending");
  await expect(panel).toContainText("environment_fixture");
  await expect(panel).toContainText("Workspace is this Environment’s execution directory, not a top-level workspaces API");
  await expect(panel).toContainText("https://executor.example.test/connect");
  await expect(panel.locator('a[href="https://executor.example.test/connect"]')).toHaveCount(0);
  await expect(panel.getByRole("link", { name: "Core setup" })).toBeVisible();
  await expect(panel.getByRole("link", { name: "Launcher setup" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Environment connection required" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Function result required" })).toBeVisible();
  await expect(page.getByLabel("Function result or error")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Return error" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Submit result" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel active Turn" })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText("launcher:private");
  await expect(page.locator("body")).not.toContainText("executor_token=secret");
  await expect(page.locator('a[href^="file:"]')).toHaveCount(0);

  await expect.poll(async () => (
    await fixtureRequests(request)
  ).filter((entry) => entry.method === "GET" && entry.path.endsWith("/events")).length).toBeGreaterThanOrEqual(2);
  await expect(panel).toContainText("Pending");
  await expect(panel).toContainText("Status comes from the durable Environment resource");
  await panel.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await attachElementScreenshot(panel, testInfo, "desktop-light-environment-panel");
  await attachScreenshot(page, testInfo, "desktop-light-self-hosted-environment");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const widths = await panel.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      left: box.left,
      right: box.right,
    };
  });
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  expect(widths.left).toBeGreaterThanOrEqual(0);
  expect(widths.right).toBeLessThanOrEqual(390);
  await panel.getByRole("link", { name: "Launcher setup" }).focus();
  await expect(panel.getByRole("link", { name: "Launcher setup" })).toBeFocused();
  await panel.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await attachElementScreenshot(panel, testInfo, "narrow-dark-environment-panel");
  await attachScreenshot(page, testInfo, "narrow-dark-self-hosted-environment");

  await controlFixture(request, { environmentScenario: 2, environmentEventStatus: 0 });
  await page.reload();
  const unknown = page.getByRole("region", { name: "Environment and Workspace status" });
  await expect(unknown).toContainText("Environment unavailable");
  await expect(unknown).toContainText("Unknown type");
  await expect(unknown).not.toContainText("/must-not-render");
  await expect(unknown.locator("a")).toHaveCount(0);

  await controlFixture(request, { environmentScenario: 3, environmentEventStatus: 0 });
  await page.reload();
  const missing = page.getByRole("region", { name: "Environment and Workspace status" });
  await expect(missing).toContainText("ID unavailable");
  await expect(missing).toContainText("unsafe or malformed URL");
});

test("hydrates durable expired and unavailable Environment states without a write or paid Turn", async ({ page, request }) => {
  await resetFixture(request);
  await controlFixture(request, {
    environmentScenario: 4,
    environmentResourceStatus: "expired",
    environmentEventStatus: 0,
  });
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();

  const panel = page.getByRole("region", { name: "Environment and Workspace status" });
  await expect(panel).toContainText("Expired");
  await expect(panel).toContainText("Environment expired");
  await expect(panel).toContainText("no API-managed files, plugins, or skills");
  await expect(page.getByLabel("Message the Agent")).toBeVisible();

  const initialRequests = await fixtureRequests(request);
  const sessionReadIndex = initialRequests.findIndex(
    (entry) => entry.method === "GET" && /^\/v1\/agents\/sessions\/[^/]+$/.test(entry.path),
  );
  const environmentReadIndex = initialRequests.findIndex(
    (entry) => entry.method === "GET" && entry.path.startsWith("/v1/agents/environments/"),
  );
  expect(sessionReadIndex).toBeGreaterThanOrEqual(0);
  expect(environmentReadIndex).toBeGreaterThan(sessionReadIndex);

  let environmentRequests = initialRequests.filter(
    (entry) => entry.path.startsWith("/v1/agents/environments/"),
  );
  expect(environmentRequests.length).toBeGreaterThanOrEqual(1);
  expect(environmentRequests.every((entry) => entry.method === "GET" && entry.body === undefined)).toBe(true);

  await controlFixture(request, { environmentRetrieveStatus: 503 });
  await page.reload();
  await expect(panel).toContainText("Unavailable");
  await expect(panel).toContainText("conversation remains usable");
  await expect(panel).not.toContainText("Expired");
  await expect(panel).not.toContainText("Connected");
  await expect(page.getByLabel("Message the Agent")).toBeVisible();

  await controlFixture(request, {
    environmentRetrieveStatus: 200,
    environmentResourceVariant: "missing_skills",
  });
  await page.reload();
  await expect(panel).toContainText("Unavailable");
  await expect(page.getByLabel("Message the Agent")).toBeVisible();

  environmentRequests = (await fixtureRequests(request)).filter(
    (entry) => entry.path.startsWith("/v1/agents/environments/"),
  );
  expect(environmentRequests.every((entry) => entry.method === "GET")).toBe(true);
});

test("hydrates durable Environment state even when the live stream is rejected", async ({ page, request }) => {
  await resetFixture(request);
  await controlFixture(request, {
    environmentScenario: 4,
    environmentResourceStatus: "expired",
    streamStatus: 401,
  });
  await page.goto("/");

  const panel = page.getByRole("region", { name: "Environment and Workspace status" });
  await expect(panel).toContainText("Expired");
  await expect(panel).toContainText("Status comes from the durable Environment resource");
  await expect(page.getByText("failed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Message the Agent")).toBeVisible();

  const requests = await fixtureRequests(request);
  expect(requests.some((entry) => (
    entry.method === "GET" && entry.path.startsWith("/v1/agents/environments/")
  ))).toBe(true);
});

test("keeps canonical Environment UUID identity across Session and resource projections", async ({ page, request }) => {
  await resetFixture(request);
  const canonicalEnvironmentUuid = "0f745b0d-b545-49cd-8d7e-4c31c80dc564";
  await controlFixture(request, {
    environmentScenario: 5,
    environmentResourceStatus: "connected",
    environmentEventStatus: 0,
  });
  await page.goto("/");

  const panel = page.getByRole("region", { name: "Environment and Workspace status" });
  await expect(panel).toContainText("Connected");
  await expect(panel).toContainText("Status comes from the durable Environment resource");
  await expect(panel).not.toContainText("Durable Environment status is unavailable");
  await expect(panel).toContainText(canonicalEnvironmentUuid.toUpperCase());

  const environmentRequests = (await fixtureRequests(request)).filter(
    (entry) => entry.method === "GET" && entry.path.startsWith("/v1/agents/environments/"),
  );
  expect(environmentRequests.length).toBeGreaterThanOrEqual(1);
  expect(environmentRequests.every(
    (entry) => entry.path === `/v1/agents/environments/${canonicalEnvironmentUuid.toUpperCase()}` &&
      entry.body === undefined,
  )).toBe(true);
});

test("applies a buffered live Environment event after an earlier durable snapshot", async ({ page, request }) => {
  await resetFixture(request);
  await controlFixture(request, {
    environmentScenario: 4,
    environmentRetrieveDelayMs: 500,
    environmentResourceStatus: "pending",
    environmentEventStatus: 3,
    environmentEventCount: 1,
  });
  await page.goto("/");

  const panel = page.getByRole("region", { name: "Environment and Workspace status" });
  await expect(panel).toContainText("Connected");
  await expect(panel).toContainText("last supported live event observed after the durable Environment snapshot");
  await expect(panel).not.toContainText("Pending");
});

test("loads every Turn page, reconciles terminal events, and keeps failures beside conversation Items", async ({ page, request }, testInfo) => {
  await resetFixture(request);
  await controlFixture(request, {
    turnsScenario: 1,
    turnsPageSize: 2,
  });
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();

  const timeline = page.getByRole("region", { name: "Turn timeline" });
  await expect(timeline).toContainText("7 observed Turns");
  for (const status of ["Queued", "In progress", "Waiting", "Completed", "Failed", "Cancelled"]) {
    await expect(timeline.getByRole("img", { name: `Turn status: ${status}` }).first()).toBeVisible();
  }
  await expect(timeline).toContainText("Running ·");
  await expect(timeline.locator('[data-turn-id="turn_completed"]')).toContainText("7s");
  await expect(timeline.getByRole("region", { name: "Session aggregate usage" })).toContainText("26");
  await expect(timeline.locator('[data-turn-id="turn_completed"]').getByRole("group", { name: "Usage for Turn turn_completed" })).toContainText("13");
  const failed = timeline.locator('[data-turn-id="turn_failed"]');
  await expect(failed).toContainText("The execution could not complete.");
  await expect(failed).toContainText("1 linked Item");
  await expect(page.getByText("Persisted input before the Turn failed.")).toBeVisible();
  await expect(timeline).toContainText("1 Item is not associated with an observed Turn yet.");

  const readsBeforeTerminal = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "GET" && entry.path.endsWith("/turns")
  ));
  expect(readsBeforeTerminal.length).toBeGreaterThanOrEqual(4);
  expect(readsBeforeTerminal.some((entry) => entry.query === "?limit=100&order=asc")).toBe(true);
  expect(readsBeforeTerminal.some((entry) => entry.query?.includes("after=turn_in_progress"))).toBe(true);
  expect(readsBeforeTerminal.every((entry) => entry.body === undefined)).toBe(true);

  const terminal = timeline.locator('[data-turn-id="turn_terminal_refresh"]');
  await expect(terminal).toHaveAttribute("data-turn-status", "in_progress");
  await emitTurnFixture(request, "completed");
  await expect(terminal).toHaveAttribute("data-turn-status", "completed");
  await expect(terminal).toContainText("Turn usage");
  await expect.poll(async () => (
    await fixtureRequests(request)
  ).filter((entry) => entry.method === "GET" && entry.path.endsWith("/turns")).length).toBeGreaterThan(readsBeforeTerminal.length);

  await controlFixture(request, { turnsRetrieveStatus: 503 });
  await page.getByRole("button", { name: "Recover durable state" }).click();
  await expect(timeline.locator(".turn-timeline-failure")).toContainText("Couldn’t load Turn history");
  await expect(timeline).toContainText("last observed Turn timeline remains visible");
  await expect(page.getByText("Completed Turn output remains in the conversation.")).toBeVisible();
  await expect(page.getByLabel("Message the Agent")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await timeline.evaluate((element) => element.scrollIntoView({ block: "start" }));
  const widths = await timeline.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      left: box.left,
      right: box.right,
    };
  });
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  expect(widths.left).toBeGreaterThanOrEqual(0);
  expect(widths.right).toBeLessThanOrEqual(widths.viewport);
  await attachElementScreenshot(timeline, testInfo, "narrow-turn-timeline");
});

test("presents an honest searchable Trace workbench without changing the conversation draft", async ({ page, request }, testInfo) => {
  await resetFixture(request);
  await controlFixture(request, {
    turnsScenario: 1,
    turnsPageSize: 2,
    itemsScenario: 2,
  });
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();

  const viewTabs = page.getByRole("tablist", { name: "Session view" });
  const conversationTab = viewTabs.getByRole("tab", { name: "Conversation" });
  const traceTab = viewTabs.getByRole("tab", { name: "Trace" });
  const composer = page.getByLabel("Message the Agent");
  await expect(page.locator("#session-trace-panel")).toBeHidden();
  await composer.fill("Draft survives Trace inspection\nwith a second line");
  const sendsBefore = (await fixtureRequests(request)).filter(
    (entry) => entry.method === "POST" && entry.path.endsWith("/events"),
  ).length;

  await conversationTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(traceTab).toHaveAttribute("aria-selected", "true");
  const trace = page.getByRole("tabpanel", { name: "Trace" });
  await expect(trace).toBeVisible();
  await expect(trace).toContainText("Known Turn time");
  await expect(trace.getByText("7 observed Turns")).toHaveCount(0);
  await expect(trace).toContainText("Turns");
  await expect(trace).toContainText("Tool calls");
  await expect(trace).toContainText("Equal-width sequence · not time-scaled");
  await expect(trace.locator(".trace-order-scroll")).toHaveCount(1);
  await expect(trace).toContainText("Per-item timing is unavailable");
  await expect(trace).toContainText("Configured instructions");
  await expect(trace).toContainText("Completed Turn output remains in the conversation.");
  await expect(trace).not.toContainText("TTFT");
  await expect(trace).not.toContainText("Throughput");

  const search = trace.getByRole("searchbox", { name: "Search trace" });
  await search.fill("Persisted input failed");
  await expect(trace.locator(".trace-ledger-row")).toHaveCount(1);
  await expect(trace).toContainText("Persisted input before the Turn failed.");
  await search.fill("");

  const patchRow = trace.locator(".trace-ledger-row-tools").filter({ hasText: "apply_patch" }).first();
  await patchRow.click();
  const detail = page.getByRole("complementary", { name: "Trace item details" });
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("button", { name: "Close trace details" })).toBeFocused();
  const previewTab = detail.getByRole("tab", { name: "Preview" });
  await expect(previewTab).toHaveAttribute("aria-controls", "session-trace-panel-detail-content");
  await previewTab.click();
  await expect(detail.getByRole("tabpanel", { name: "Preview" })).toHaveAttribute("tabindex", "0");
  const viewer = detail.getByRole("region", { name: "Parsar apply patch diff" });
  await expect(viewer).toContainText("3 files");
  await expect(viewer).toContainText("Completed");
  const desktopSplit = await Promise.all([
    trace.locator(".trace-ledger").boundingBox(),
    detail.boundingBox(),
  ]);
  expect(desktopSplit[0]).not.toBeNull();
  expect(desktopSplit[1]).not.toBeNull();
  expect(desktopSplit[1]!.x).toBeGreaterThanOrEqual(desktopSplit[0]!.x + desktopSplit[0]!.width - 1);
  await attachScreenshot(page, testInfo, "desktop-trace-detail");
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(patchRow).toBeFocused();

  await patchRow.click();
  await search.fill("filter selected row out");
  await expect(patchRow).toBeHidden();
  await page.getByRole("button", { name: "Close trace details" }).click();
  await expect(search).toBeFocused();
  await search.fill("");

  await conversationTab.click();
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue("Draft survives Trace inspection\nwith a second line");
  const sendsAfter = (await fixtureRequests(request)).filter(
    (entry) => entry.method === "POST" && entry.path.endsWith("/events"),
  ).length;
  expect(sendsAfter).toBe(sendsBefore);

  await page.setViewportSize({ width: 390, height: 844 });
  await traceTab.click();
  const narrowTrace = page.getByRole("tabpanel", { name: "Trace" });
  const narrowPatchRow = narrowTrace.locator(".trace-ledger-row-tools").filter({ hasText: "apply_patch" }).first();
  await narrowPatchRow.click();
  const narrowDetail = page.getByRole("complementary", { name: "Trace item details" });
  await expect(narrowDetail).toBeVisible();
  await expect(narrowTrace.locator(".trace-ledger")).toBeHidden();
  const widths = await narrowDetail.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      left: box.left,
      right: box.right,
    };
  });
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  expect(widths.left).toBeGreaterThanOrEqual(0);
  expect(widths.right).toBeLessThanOrEqual(widths.viewport);
  await attachScreenshot(page, testInfo, "narrow-trace-detail");
});

test("drops a delayed Turn page after switching Sessions", async ({ page, request }) => {
  await resetFixture(request);
  await controlFixture(request, {
    turnsScenario: 1,
    turnsRetrieveDelayMs: 700,
    turnsPageSize: 2,
  });
  await page.goto("/");
  const timeline = page.getByRole("region", { name: "Turn timeline" });
  await expect(page.getByText("Completed Turn output remains in the conversation.")).toBeVisible({ timeout: 1_500 });
  await expect(timeline).toContainText("Loading every Turn page");
  await page.getByRole("button", { name: "Agents" }).click();
  await expect(page.getByRole("table", { name: "Agents" })).toBeVisible();
  await page.getByRole("button", { name: /Start a Session with Second Agent/ }).click();

  await expect(timeline).toContainText("No Turns reported yet.");
  await page.waitForTimeout(3_000);
  await expect(timeline).not.toContainText("turn_queued");
  await expect(page.getByText("Completed Turn output remains in the conversation.")).toHaveCount(0);

  const turnReads = (await fixtureRequests(request)).filter((entry) => (
    entry.method === "GET" && entry.path.endsWith("/turns")
  ));
  expect(turnReads.some((entry) => entry.path.includes("session_snapshot"))).toBe(true);
  expect(turnReads.some((entry) => entry.path.includes("session_created_"))).toBe(true);
});

test("renders Parsar patches as accessible read-only diffs in desktop and narrow themes", async ({ page, request }, testInfo) => {
  await resetFixture(request);
  await controlFixture(request, { itemsScenario: 1 });
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();

  const completedTrace = page.locator('[data-work-trace="completed"]');
  await completedTrace.getByRole("button", { name: /Completed/ }).click();
  const completedStep = completedTrace.locator('[data-trace-step="patch_completed"]');
  await completedStep.getByRole("button", { name: /apply_patch/ }).click();
  const viewer = completedStep.getByRole("region", { name: "Parsar apply patch diff" });
  await expect(viewer).toContainText("3 files");
  await expect(viewer).toContainText("Completed");
  await expect(viewer.getByRole("button", { name: /modify src\/modify.ts/ })).toHaveAttribute("aria-expanded", "true");
  await viewer.getByRole("button", { name: /modify src\/modify.ts/ }).focus();
  await page.keyboard.press("Enter");
  await expect(viewer.getByRole("button", { name: /modify src\/modify.ts/ })).toHaveAttribute("aria-expanded", "false");
  await viewer.getByText("Raw arguments").click();
  await viewer.getByText("Raw result").click();
  await expect(viewer).toContainText('"applied": true');
  await expect(viewer.locator("script")).toHaveCount(0);
  const runningStep = page.locator('[data-trace-step="patch_running"]');
  await runningStep.getByRole("button", { name: /apply_patch/ }).click();
  await expect(runningStep.locator('[data-patch-status="in_progress"]')).toContainText("In progress");
  const failedTrace = page.locator('[data-work-trace="failed"]');
  await failedTrace.getByRole("button", { name: /Failed/ }).click();
  const failedStep = failedTrace.locator('[data-trace-step="patch_failed"]');
  await failedStep.getByRole("button", { name: /apply_patch/ }).click();
  await expect(failedStep.locator('[data-patch-status="failed"]')).toContainText("Failed");
  const fallback = page.locator('[data-trace-step="patch_alternate"]');
  await fallback.getByRole("button", { name: /apply_patch/ }).click();
  await expect(fallback).toContainText("malformed alternate shape");
  await expect(fallback.getByRole("region", { name: "Parsar apply patch diff" })).toHaveCount(0);
  await attachScreenshot(page, testInfo, "desktop-light-parsar-diff");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const widths = await viewer.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewerLeft: box.left, viewerRight: box.right };
  });
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
  expect(widths.viewerLeft).toBeGreaterThanOrEqual(0);
  expect(widths.viewerRight).toBeLessThanOrEqual(widths.viewport);
  await expect(viewer).toBeVisible();
  await attachScreenshot(page, testInfo, "narrow-dark-parsar-diff");
});

test("manually retries uncertain sends with the original key only while the payload is unchanged", async ({ page, request }, testInfo) => {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  const composer = page.getByLabel("Message the Agent");

  await controlFixture(request, { sendResponseLoss: 1 });
  await composer.fill("uncertain payload");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".session-send-error")).toContainText("may have accepted this message");
  await expect(composer).toHaveValue("uncertain payload");
  await attachScreenshot(page, testInfo, "desktop-uncertain-send");
  await page.getByRole("button", { name: "Send message" }).click();

  let sends = (await fixtureRequests(request)).filter(
    (entry) => entry.method === "POST" && entry.path.endsWith("/events"),
  );
  expect(sends).toHaveLength(2);
  expect(sends[0]?.idempotencyKey).toBeTruthy();
  expect(sends[1]?.idempotencyKey).toBe(sends[0]?.idempotencyKey);

  await controlFixture(request, { sendResponseLoss: 1 });
  await composer.fill("original before edit");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(composer).toHaveValue("original before edit");
  await composer.fill("edited payload");
  await page.getByRole("button", { name: "Send message" }).click();

  sends = (await fixtureRequests(request)).filter(
    (entry) => entry.method === "POST" && entry.path.endsWith("/events"),
  );
  expect(sends).toHaveLength(4);
  expect(sends[3]?.idempotencyKey).not.toBe(sends[2]?.idempotencyKey);

  await controlFixture(request, { sendStatus: 422 });
  await composer.fill("permanently rejected");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".session-send-error")).toContainText("Agent Core rejected the message");
  await page.getByRole("button", { name: "Send message" }).click();

  sends = (await fixtureRequests(request)).filter(
    (entry) => entry.method === "POST" && entry.path.endsWith("/events"),
  );
  expect(sends).toHaveLength(6);
  expect(sends[5]?.idempotencyKey).not.toBe(sends[4]?.idempotencyKey);
  await attachScreenshot(page, testInfo, "desktop-send-recovery");
});

test("keeps cancellation available for an Environment-only required action", async ({ page, request }) => {
  await resetFixture(request);
  await controlFixture(request, { environmentScenario: 6 });
  await page.goto("/");
  await expect(page.getByText("listening", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Environment connection required" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Function result required" })).toHaveCount(0);
  const writesBefore = (await fixtureRequests(request)).filter(
    (entry) => entry.method === "POST" && entry.path.endsWith("/events"),
  ).length;
  const cancel = page.getByRole("button", { name: "Cancel active Turn" });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect.poll(async () => (await fixtureRequests(request)).filter(
    (entry) => entry.method === "POST" && entry.path.endsWith("/events"),
  ).length).toBe(writesBefore + 1);
  const writes = (await fixtureRequests(request)).filter(
    (entry) => entry.method === "POST" && entry.path.endsWith("/events"),
  );
  expect(writes.at(-1)?.body).toEqual({ events: [{ type: "agent.session.input.cancel" }] });
});
