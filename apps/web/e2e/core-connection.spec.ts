import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const fixtureBaseUrl = `http://127.0.0.1:${process.env.AGENTS_FIXTURE_PORT ?? 18092}`;
const probeRequestPattern = /\/v1\/agents\?limit=1$/;

interface ProbeInstrumentationWindow extends Window {
  __probeAbortCount?: number;
  __probeCallCount?: number;
  __resolveFirstProbe?: (() => void) | null;
}

async function resetFixture(request: APIRequestContext) {
  const response = await request.post(`${fixtureBaseUrl}/__fixture/reset`);
  expect(response.ok()).toBe(true);
}

async function boot(page: Page, request: APIRequestContext) {
  await resetFixture(request);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Configure Agent Core connection" })).toBeVisible();
}

async function openConnection(page: Page) {
  const trigger = page.getByRole("button", { name: "Configure Agent Core connection" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Connect an Agent Core" });
  await expect(dialog).toBeVisible();
  return { dialog, trigger };
}

test("migrates a stale local token without sending browser authorization when proxy auth is disabled", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("agents-core-web.core-base-url", "/v1");
    sessionStorage.setItem("agents-core-web.core-token", "historical-local-token");
  });
  let browserAuthorizationSeen = false;
  page.on("request", (browserRequest) => {
    const url = new URL(browserRequest.url());
    if (url.pathname.startsWith("/v1/") && browserRequest.headers().authorization) {
      browserAuthorizationSeen = true;
    }
  });
  await page.route(probeRequestPattern, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ object: "list", data: [], has_more: false, first_id: null, last_id: null }),
  }));

  await boot(page, request);
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("agents-core-web.core-token"))).toBeNull();
  const { dialog } = await openConnection(page);
  await expect(dialog).toContainText("Server-managed key not detected");
  await expect(dialog.getByRole("radio", { name: /Local Parsar Core/ })).toBeChecked();
  await expect(dialog.getByLabel("Bearer token")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Test connection" }).click();
  await expect(dialog.getByRole("status")).toContainText("Core API authenticated");
  expect(browserAuthorizationSeen).toBe(false);

  await dialog.getByRole("radio", { name: /Other compatible Core/ }).click();
  await expect(dialog.getByLabel("Bearer token")).toHaveValue("");
});

test("switches real connection modes and fences stale probes when the draft changes or reopens", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const target = window as ProbeInstrumentationWindow;
    const originalFetch = window.fetch.bind(window);
    let holdFirstProbe = true;
    target.__probeAbortCount = 0;
    target.__probeCallCount = 0;
    target.__resolveFirstProbe = null;

    window.fetch = (input, init) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      const candidate = new URL(url, window.location.href);
      const isProbe = candidate.pathname.endsWith("/v1/agents")
        && candidate.searchParams.get("limit") === "1"
        && [...candidate.searchParams].length === 1;
      if (isProbe) target.__probeCallCount = (target.__probeCallCount ?? 0) + 1;
      if (holdFirstProbe && isProbe) {
        holdFirstProbe = false;
        init?.signal?.addEventListener("abort", () => {
          target.__probeAbortCount = (target.__probeAbortCount ?? 0) + 1;
        }, { once: true });
        return new Promise<Response>((resolve) => {
          target.__resolveFirstProbe = () => resolve(new Response(JSON.stringify({
            object: "list",
            data: [],
            has_more: false,
            first_id: null,
            last_id: null,
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }));
        });
      }
      return originalFetch(input, init);
    };
  });
  await boot(page, request);
  const { dialog } = await openConnection(page);
  const local = dialog.getByRole("radio", { name: /Local Parsar Core/ });
  const advanced = dialog.getByRole("radio", { name: /Other compatible Core/ });
  const testConnection = dialog.getByRole("button", { name: "Test connection" });

  await expect(local).toBeChecked();
  await expect(dialog.getByLabel("Compatible Core base URL")).toHaveCount(0);
  await expect(dialog.getByLabel("Bearer token")).toHaveCount(0);
  await testConnection.click();
  await expect(dialog.getByRole("status")).toContainText("Testing Core connection…");
  await expect.poll(() => page.evaluate(() => (
    (window as ProbeInstrumentationWindow).__probeCallCount ?? 0
  ))).toBe(1);
  await expect.poll(() => page.evaluate(() => (
    typeof (window as ProbeInstrumentationWindow).__resolveFirstProbe
  ))).toBe("function");

  await advanced.click();
  await expect(advanced).toBeChecked();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    (window as ProbeInstrumentationWindow).__probeAbortCount ?? 0
  ))).toBe(1);
  await page.evaluate(() => (window as ProbeInstrumentationWindow).__resolveFirstProbe?.());
  await expect(dialog.getByText("Core API authenticated")).toHaveCount(0);

  const directBase = `${new URL(page.url()).origin}/v1`;
  const baseUrl = dialog.getByLabel("Compatible Core base URL");
  const token = dialog.getByLabel("Bearer token");
  await baseUrl.fill(directBase);
  await token.fill("current-tab-token");
  await testConnection.click();
  await expect(dialog.getByRole("status")).toContainText("Core API authenticated");

  await token.fill("changed-current-tab-token");
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await testConnection.click();
  await expect(dialog.getByRole("status")).toContainText("Core API authenticated");

  await baseUrl.fill(`${directBase}/`);
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await testConnection.click();
  await expect(dialog.getByRole("status")).toContainText("Core API authenticated");

  await local.click();
  await expect(local).toBeChecked();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await testConnection.click();
  await expect(dialog.getByRole("status")).toContainText("Core API authenticated");

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog", { name: "Connect an Agent Core" })).toHaveCount(0);
  const reopened = (await openConnection(page)).dialog;
  await expect(reopened.getByRole("radio", { name: /Local Parsar Core/ })).toBeChecked();
  await expect(reopened.getByRole("status")).toHaveCount(0);
  await expect(reopened.getByRole("alert")).toHaveCount(0);
});

test("announces loading, authenticated access, and each safe failure state from one GET", async ({
  page,
  request,
}) => {
  const replies = [
    { status: 200, body: { object: "list", data: [], has_more: false, first_id: null, last_id: null } },
    { status: 202, body: { object: "list", data: [], has_more: false, first_id: null, last_id: null } },
    { status: 401, body: { error: { code: "invalid_api_key", message: "safe fixture failure" } } },
    { status: 400, body: { error: { code: "invalid_beta_header", message: "safe fixture failure" } } },
    { status: 503, body: { error: { code: "unavailable", message: "safe fixture failure" } } },
    { abort: true },
  ];
  const methods: string[] = [];

  await page.route(probeRequestPattern, async (route) => {
    methods.push(route.request().method());
    const reply = replies.shift();
    if (!reply) return route.abort("failed");
    await new Promise((resolve) => setTimeout(resolve, 50));
    if ("abort" in reply) return route.abort("failed");
    return route.fulfill({
      status: reply.status,
      contentType: "application/json",
      body: JSON.stringify(reply.body),
    });
  });

  await boot(page, request);
  const { dialog } = await openConnection(page);
  const action = dialog.getByRole("button", { name: "Test connection" });
  const cases: Array<{ role: "status" | "alert"; text: string }> = [
    { role: "status", text: "Core API authenticated" },
    { role: "alert", text: "Agents API protocol mismatch" },
    { role: "alert", text: "Authentication failed" },
    { role: "alert", text: "Agents API protocol mismatch" },
    { role: "alert", text: "Core returned HTTP 503" },
    { role: "alert", text: "Core unreachable" },
  ];

  for (const expected of cases) {
    await action.click();
    const loading = dialog.getByRole("status");
    await expect(loading).toHaveAttribute("aria-live", "polite");
    await expect(loading).toContainText("Testing Core connection…");
    const terminal = dialog.getByRole(expected.role);
    await expect(terminal).toContainText(expected.text);
    await expect(terminal).toContainText("Execution readiness: Unknown / not verified");
  }

  expect(methods).toEqual(["GET", "GET", "GET", "GET", "GET", "GET"]);
  expect(replies).toHaveLength(0);
});

test("supports keyboard mode selection, traps focus, and returns focus on Escape", async ({ page, request }) => {
  await boot(page, request);
  const { dialog, trigger } = await openConnection(page);
  const local = dialog.getByRole("radio", { name: /Local Parsar Core/ });
  const advanced = dialog.getByRole("radio", { name: /Other compatible Core/ });
  const apply = dialog.getByRole("button", { name: "Apply connection" });
  const close = dialog.getByRole("button", { name: "Close dialog" });

  await expect(local).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(advanced).toBeChecked();
  await expect(advanced).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(local).toBeChecked();
  await expect(local).toBeFocused();

  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(apply).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Connect an Agent Core" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("keeps both connection modes operable without horizontal overflow at 390 px", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, request);
  const { dialog } = await openConnection(page);
  const apply = dialog.getByRole("button", { name: "Apply connection" });
  const cancel = dialog.getByRole("button", { name: "Cancel" });

  const assertContained = async () => {
    const metrics = await page.evaluate(() => ({
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(metrics.bodyWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(metrics.viewportWidth);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(metrics.viewportHeight);
    const widths = await dialog.evaluate((card) => {
      const body = card.querySelector<HTMLElement>(".modal-body");
      return {
        cardClient: card.clientWidth,
        cardScroll: card.scrollWidth,
        bodyClient: body?.clientWidth ?? 0,
        bodyScroll: body?.scrollWidth ?? 0,
      };
    });
    expect(widths.cardScroll).toBeLessThanOrEqual(widths.cardClient);
    expect(widths.bodyScroll).toBeLessThanOrEqual(widths.bodyClient);
    await expect(apply).toBeInViewport();
    await expect(cancel).toBeInViewport();
  };

  await assertContained();
  const testConnection = dialog.getByRole("button", { name: "Test connection" });
  await testConnection.scrollIntoViewIfNeeded();
  await expect(testConnection).toBeInViewport();

  await dialog.getByRole("radio", { name: /Other compatible Core/ }).click();
  await dialog.getByLabel("Compatible Core base URL").fill(`${new URL(page.url()).origin}/v1`);
  await assertContained();
  await dialog.getByLabel("Compatible Core base URL").scrollIntoViewIfNeeded();
  await expect(dialog.getByLabel("Compatible Core base URL")).toBeInViewport();
});
