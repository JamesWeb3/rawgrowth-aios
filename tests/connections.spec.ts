import { expect, test } from "@playwright/test";

/**
 * /connections E2E coverage. Locks in the May 7 Composio swap:
 *   - Commit 73adbe2 removed the "Rawgrowth MCP" / "MCP Token" section.
 *   - Commit 902c766 added the composio: provider_config_key prefix +
 *     OAuth redirect handling in the connectors grid.
 *   - Commit 4eb8f0b switched to window.location.assign for the redirect.
 *
 * Probes the page (not just APIs) so a future regression that re-adds
 * the MCP card or breaks the grid render fails CI before shipping. API
 * checks live alongside so a /api/connections/* 500 is caught even if
 * the React tree happens to render.
 */

const owner = {
  email: process.env.E2E_OWNER_EMAIL ?? "chris@rawclaw.demo",
  password: process.env.E2E_OWNER_PASSWORD ?? "rawclaw-demo-2026",
};

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/auth/signin");
  await page.getByLabel(/email/i).fill(owner.email);
  await page.getByLabel(/password/i).fill(owner.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(org|agents|connections|onboarding|$)/, {
    timeout: 20_000,
  });
}

test.describe("/connections page", () => {
  test.skip(
    !owner.email || !owner.password,
    "E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD required",
  );

  test("Rawgrowth MCP / MCP Token section is gone", async ({ page }) => {
    await signIn(page);
    await page.goto("/connections");
    await page.waitForLoadState("domcontentloaded");

    // Per Chris's May 7 video feedback the MCP section must not be
    // visible to clients on /connections. Admin token rotation moved
    // to /admin/provisioning.
    await expect(page.getByText(/Rawgrowth MCP/i)).toHaveCount(0);
    await expect(page.getByText(/MCP Token/i)).toHaveCount(0);
  });

  test("connectors grid renders the full Composio catalog", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/connections");

    // Each card carries either a "Connect", "Request" or "Connected"
    // affordance. The seeded catalog has 50+ apps. A regression that
    // collapses the grid (empty state, error boundary, etc.) trips on
    // this single count assertion.
    const cards = page.locator(
      'button:has-text("Connect"), button:has-text("Request"), span:has-text("Connected")',
    );
    await expect.poll(() => cards.count(), { timeout: 15_000 }).toBeGreaterThan(
      50,
    );
  });

  test("composio POST returns 200 with redirectUrl, pending, or message", async ({
    page,
    request,
  }) => {
    // Hit the composio init route directly with a known non-native key
    // (whatsapp). Two valid shapes:
    //   - { ok: true, redirectUrl } when COMPOSIO_API_KEY is wired.
    //   - { ok: true, pending: true, message } in the interest-log
    //     fallback. Anything 5xx, or 200 without one of those fields,
    //     is a bug.
    await signIn(page);
    const r = await request.post("/api/connections/composio", {
      data: { key: "whatsapp" },
      headers: { "content-type": "application/json" },
    });
    expect(r.status(), `status=${r.status()}`).toBe(200);
    const body = (await r.json()) as {
      ok?: boolean;
      redirectUrl?: string;
      pending?: boolean;
      message?: string;
    };
    expect(body.ok).toBe(true);
    expect(
      Boolean(body.redirectUrl) ||
        Boolean(body.pending) ||
        Boolean(body.message),
    ).toBe(true);
  });

  test("composio POST rejects unknown app keys with 404", async ({
    page,
    request,
  }) => {
    await signIn(page);
    const r = await request.post("/api/connections/composio", {
      data: { key: "definitely-not-a-real-app-9c5e4f" },
      headers: { "content-type": "application/json" },
    });
    expect(r.status()).toBe(404);
  });

  test("composio POST without 'key' returns 400 (not 500)", async ({
    page,
    request,
  }) => {
    await signIn(page);
    const r = await request.post("/api/connections/composio", {
      data: {},
      headers: { "content-type": "application/json" },
    });
    expect(r.status()).toBe(400);
  });

  test("hard-path connection APIs do not 500 for the signed-in owner", async ({
    page,
    request,
  }) => {
    await signIn(page);
    const paths = [
      "/api/connections",
      "/api/connections/claude",
      "/api/connections/slack",
    ];
    for (const p of paths) {
      const r = await request.get(p);
      expect(r.status(), `GET ${p} status=${r.status()}`).toBeLessThan(500);
    }
  });

  test("supabase POST validates PAT prefix instead of throwing", async ({
    page,
    request,
  }) => {
    // The route gates on token.startsWith("sbp_"). A bad token must
    // 400 with the helpful message, never 500.
    await signIn(page);
    const r = await request.post("/api/connections/supabase", {
      data: { token: "not-a-pat" },
      headers: { "content-type": "application/json" },
    });
    expect(r.status()).toBe(400);
  });

  test("telegram seed-agent POST without body returns 400 (not 500)", async ({
    page,
    request,
  }) => {
    await signIn(page);
    const r = await request.post("/api/connections/telegram/seed-agent", {
      data: {},
      headers: { "content-type": "application/json" },
    });
    // 400 (validation) or 401 (no org context) are both acceptable.
    // 500 means the route threw before the validation gate ran.
    expect([400, 401].includes(r.status())).toBeTruthy();
  });
});
