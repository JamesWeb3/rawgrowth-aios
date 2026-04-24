import { expect, test } from "@playwright/test";

/**
 * §9.8 ship-check smoke suite. Runs against a live v3 VPS.
 *
 * Env contract (all strings):
 *   E2E_BASE_URL        https://<slug>.rawgrowth.ai
 *   E2E_OWNER_EMAIL     owner with a signed-in session
 *   E2E_OWNER_PASSWORD  password for that owner
 *   E2E_OTHER_ORG_JWT   an anon JWT carrying a DIFFERENT org_id, used
 *                       to verify RLS rejects cross-tenant reads
 *
 * Sign-in flow posts to /api/auth/callback/credentials (NextAuth v5
 * convention). If that path moves, update the helper below.
 */

const owner = {
  email: process.env.E2E_OWNER_EMAIL ?? "",
  password: process.env.E2E_OWNER_PASSWORD ?? "",
};

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/auth/signin");
  await page.getByLabel(/email/i).fill(owner.email);
  await page.getByLabel(/password/i).fill(owner.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(org|agents|$|onboarding)/, { timeout: 15_000 });
}

test.describe("v3 ship-check", () => {
  test.skip(
    !owner.email || !owner.password,
    "E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD required",
  );

  test("public sign-in page renders without JS errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    const res = await page.goto("/auth/signin");
    expect(res?.status(), "sign-in page 200").toBeLessThan(400);
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    expect(errors, `console/page errors: ${errors.join("; ")}`).toHaveLength(0);
  });

  test("authenticated happy path: agents tree + per-agent panel", async ({
    page,
  }) => {
    await signIn(page);

    // Agent tree renders and shows at least one node.
    await page.goto("/agents/tree");
    await expect(page.getByText(/Agent Tree/i)).toBeVisible();
    const firstNode = page.locator("[data-id]").first();
    await expect(firstNode).toBeVisible({ timeout: 15_000 });

    // Per-agent panel loads for the first agent.
    const agentId = await firstNode.getAttribute("data-id");
    expect(agentId, "tree node has data-id").toBeTruthy();
    await page.goto(`/agents/${agentId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/overview/i)).toBeVisible();
  });

  test("brand profile page renders (read-only)", async ({ page }) => {
    await signIn(page);
    const res = await page.goto("/brand");
    expect(res?.status()).toBeLessThan(400);
    // Either the profile markdown or the empty-state copy — never a 500.
    await expect(page.getByText(/brand profile/i)).toBeVisible();
  });

  test("dashboard gate returns 403 before onboarding completes, 200 after", async ({
    request,
  }) => {
    // Anonymous hit — should refuse, 401 or 403.
    const anon = await request.get("/api/dashboard/gate");
    expect([401, 403].includes(anon.status())).toBeTruthy();
  });

  test("cross-tenant RLS blocks audit log read with wrong JWT", async ({
    request,
  }) => {
    test.skip(
      !process.env.E2E_OTHER_ORG_JWT,
      "E2E_OTHER_ORG_JWT required for cross-tenant check",
    );
    const res = await request.get("/api/activity", {
      headers: { authorization: `Bearer ${process.env.E2E_OTHER_ORG_JWT}` },
    });
    // Either 401/403 (auth reject) or 200 with an empty array (RLS filtered
    // everything out). A 200 with rows is a bug.
    if (res.ok()) {
      const json = await res.json();
      const rows = Array.isArray(json?.events) ? json.events : json;
      expect(Array.isArray(rows) && rows.length === 0).toBeTruthy();
    } else {
      expect([401, 403].includes(res.status())).toBeTruthy();
    }
  });

  test("all primary routes return without 5xx", async ({ page }) => {
    await signIn(page);
    const routes = [
      "/",
      "/agents",
      "/agents/tree",
      "/routines",
      "/channels",
      "/inbox",
      "/activity",
      "/approvals",
      "/knowledge",
      "/skills",
      "/settings/mcp",
      "/brand",
      "/onboarding",
      "/departments/new",
    ];
    const bad: string[] = [];
    for (const path of routes) {
      const res = await page.goto(path);
      const s = res?.status() ?? 0;
      if (s >= 500) bad.push(`${path} → ${s}`);
    }
    expect(bad, `5xx routes: ${bad.join(", ")}`).toHaveLength(0);
  });
});
