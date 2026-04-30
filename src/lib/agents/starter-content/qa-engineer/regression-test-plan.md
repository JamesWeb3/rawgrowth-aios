# Regression Test Plan

Regression catches the stuff humans miss when shipping fast. Suite is split into smoke (runs every PR) and full (runs nightly + before release).

## Critical paths

These four flows are sacred. If any one breaks, we don't ship:

1. **Sign-in** - email + password, magic link, OAuth (Google), session persistence across reload
2. **Agent hire** - browse roles, select template, configure, hire, agent appears in dashboard
3. **Brand profile generation** - upload reference content, run analysis, brand profile saved, accessible to all agents
4. **Telegram webhook** - inbound message, parse, route to correct agent, response delivered, logged

Each gets a Playwright spec. Each runs on every PR.

## Smoke vs full

| Suite | Runtime | Triggers | Coverage |
|-------|---------|----------|----------|
| Smoke | under 4 min | every PR | 4 critical paths, happy path only |
| Full | 25-40 min | nightly + pre-release | smoke + edge cases + visual regression |

If smoke takes longer than 4 min, we cut tests, not raise the timeout.

## Playwright pattern

Every spec follows this structure:

```ts
import { test, expect } from "@playwright/test";
import { setupOrg, teardownOrg } from "./fixtures";

test.describe("agent hire flow", () => {
  let orgId: string;

  test.beforeEach(async () => {
    orgId = await setupOrg({ seed: "agent-hire" });
  });

  test.afterEach(async () => {
    await teardownOrg(orgId);
  });

  test("hires a marketing manager from template", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Hire agent" }).click();
    await page.getByRole("option", { name: "Marketing Manager" }).click();
    await page.getByRole("button", { name: "Confirm hire" }).click();

    await expect(
      page.getByRole("heading", { name: "Marketing Manager" }),
    ).toBeVisible();
  });
});
```

Rules:

- Locators by role/label, never by class or test-id unless absolutely necessary
- One assertion per test concept (don't chain unrelated asserts)
- No `page.waitForTimeout`. Use `expect().toBeVisible()` with auto-retry.
- No flake-tolerance via `retries: 3`. If it's flaky, fix it. We allow 1 retry max in CI for infra blips.

## Data setup / teardown

- `setupOrg(seed)` creates an isolated org with seeded data, returns `orgId`
- `teardownOrg(orgId)` deletes all rows scoped to that org
- Tests never share data. Parallel-safe.
- Seeds live in `tests/fixtures/seeds/<name>.sql`
- Database is a per-CI-job ephemeral Postgres, not staging

## Bug reproduction protocol

Every prod bug becomes a test before fix:

1. Reproduce locally
2. Write failing Playwright test
3. Fix the code
4. Test passes
5. PR includes both the fix and the test

This is how the suite grows without becoming theater.

## What I reject

- New feature PR with no Playwright spec for the happy path
- Tests with `if` branches (split into multiple tests)
- Skipped tests with TODO comments older than 2 weeks
- "It works on my machine" without Playwright trace attached
