import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

const fixtureBaseUrl = `http://127.0.0.1:${process.env.AGENTS_FIXTURE_PORT ?? 18092}`;

interface FixtureRequest {
  method: string;
  path: string;
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

async function controlFixture(request: APIRequestContext, control: Record<string, number>) {
  const response = await request.post(`${fixtureBaseUrl}/__fixture/control`, { data: control });
  expect(response.ok()).toBe(true);
}

async function fixtureRequests(request: APIRequestContext): Promise<FixtureRequest[]> {
  const response = await request.get(`${fixtureBaseUrl}/__fixture/requests`);
  expect(response.ok()).toBe(true);
  return response.json() as Promise<FixtureRequest[]>;
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
  await expect(dialog).toContainText("does not prove the current executor");
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

  await name.fill("");
  await page.getByLabel("Instructions").fill("");
  await page.getByLabel("Metadata").fill('{"team":"acceptance"}');
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeFocused();

  requests = await fixtureRequests(request);
  const updates = requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/agents/agent_a");
  expect(updates).toHaveLength(1);
  expect(updates[0]?.body).toMatchObject({
    name: null,
    instructions: null,
    metadata: { team: "acceptance" },
  });
  expect(browserErrors).toEqual([]);
});

test("supports keyboard creation, traps focus, and returns focus on Escape", async ({ page, request }) => {
  await openAgents(page, request);
  const trigger = page.getByRole("button", { name: "New Agent" });
  await trigger.click();
  await expect(page.getByLabel("Name")).toBeFocused();

  const close = page.getByRole("button", { name: "Close dialog" });
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Create Agent" })).toBeFocused();

  await page.getByLabel("Name").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const detailTrigger = page.getByRole("button", { name: /Open details for Lifecycle Agent/ });
  await detailTrigger.focus();
  await detailTrigger.evaluate((button) => button.click());
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Lifecycle Agent", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detailTrigger).toBeFocused();
  await expect(page.locator(".modal-backdrop")).toHaveCount(0);

  await trigger.click();
  const createMetadata = page.locator(".agent-metadata-input");
  const createName = page.locator('input[data-agent-initial-focus="true"]');
  await expect(createName).toBeFocused();
  await createMetadata.fill('{"owner":"local-test"}');
  await expect(createMetadata).toHaveValue('{"owner":"local-test"}');
  await expect(createName).toHaveValue("");
  await createName.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const requests = await fixtureRequests(request);
  const creates = requests.filter((entry) => entry.method === "POST" && entry.path === "/v1/agents");
  expect(creates).toHaveLength(1);
  expect(creates[0]?.body).toMatchObject({
    name: null,
    instructions: null,
    metadata: { owner: "local-test" },
  });
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

  await page.getByRole("button", { name: "New Agent" }).click();
  const dialog = page.getByRole("dialog");
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(844);
  await expect(page.getByRole("button", { name: "Create Agent" })).toBeInViewport();
  await attachScreenshot(page, testInfo, "narrow-light-create-dialog");
  await page.keyboard.press("Escape");

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
