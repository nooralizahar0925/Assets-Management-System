import { test, expect, type Page } from "@playwright/test";

/**
 * No raw timestamps in front of a customer.
 *
 * A due date was being shown as "2026-10-01T09:00:00Z". The source guard in
 * web/src/lib/datetime.guard.test.ts stops anybody hand-rolling a formatter
 * again, but it cannot catch a value printed straight out of the API - which is
 * how three of the places found that day were wrong. Only looking at the
 * rendered page catches those, so this looks.
 */

const EMAIL = process.env.SEED_EMAIL ?? "admin@demo.local";
const PASSWORD = process.env.SEED_PASSWORD ?? "demo1234";

/** `2026-10-01T09:00:00Z` and friends, as they would appear to a reader. */
const RAW_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g;

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
  await page.getByRole("textbox", { name: /password/i }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$|\/assets/, { timeout: 15_000 });
}

test.describe("dates as people read them", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const path of ["/", "/assets", "/maintenance", "/stocktakes", "/whats-new"]) {
    test(`${path} shows no raw timestamp`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const found = (await page.locator("body").innerText()).match(RAW_TIMESTAMP) ?? [];
      expect(found, `${path} shows: ${found.join(", ")}`).toEqual([]);
    });
  }

  test("an asset's own page, where the custom fields and history are", async ({ page }) => {
    // The likeliest place for one to reappear: custom field values and audit
    // entries are both rendered without knowing what type they hold.
    await page.goto("/assets");
    await page.getByRole("link", { name: /ThinkPad/i }).first().click();
    await page.waitForLoadState("networkidle");

    const text = await page.locator("body").innerText();
    const found = text.match(RAW_TIMESTAMP) ?? [];
    expect(found, `asset detail shows: ${found.join(", ")}`).toEqual([]);

    // And the dates that are there are readable, rather than simply absent.
    expect(text).toMatch(/\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}/);
  });
});
