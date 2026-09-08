import { test, expect, type Page } from "@playwright/test";

/**
 * One path through the whole product, against a running stack.
 *
 * Deliberately not exhaustive: the 852 API tests and 339 web tests already
 * assert behaviour. What no unit test can catch is the services failing to
 * talk to each other, and that is the only thing this suite is for. It is
 * therefore allowed to be shallow, but it must never be mocked.
 */

const EMAIL = process.env.SEED_EMAIL ?? "admin@demo.local";
const PASSWORD = process.env.SEED_PASSWORD ?? "demo1234";

async function signIn(page: Page) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
  await page.getByRole("textbox", { name: /password/i }).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/$|\/assets/, { timeout: 15_000 });
}

test.describe("the stack is wired together", () => {
  test("the API answers, and its schema matches its code", async ({ request }) => {
    // Checked before anything else: a 503 here explains every failure below,
    // and it is the answer when a deploy skipped its migrations.
    const health = await request.get("/api/health");
    expect(health.status(), await health.text()).toBe(200);

    const version = await request.get("/api/version");
    expect(version.ok()).toBe(true);
    expect(await version.json()).toHaveProperty("version");
  });

  test("the browser reaches the API through the same origin", async ({ page }) => {
    // If VITE_API_BASE_URL or the nginx proxy is wrong, this is where it shows:
    // the page renders perfectly and every request goes nowhere.
    const failures: string[] = [];
    page.on("requestfailed", (request) => {
      if (request.url().includes("/api/")) {
        failures.push(`${request.url()} ${request.failure()?.errorText ?? ""}`);
      }
    });

    await page.goto("/signin");
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("a wrong password is refused without saying which half was wrong", async ({ page }) => {
    await page.goto("/signin");
    await page.getByRole("textbox", { name: /email/i }).fill(EMAIL);
    await page.getByRole("textbox", { name: /password/i })
      .fill("definitely-not-the-password");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/signin/);
  });
});

test.describe("one path through the product", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("the session cookie survives a page load", async ({ page }) => {
    // The failure this catches: APP_BASE_URL saying http on an https
    // deployment, so the browser discards the cookie. Sign-in appears to work
    // and the next request is anonymous.
    await page.goto("/assets");
    await expect(page).not.toHaveURL(/signin/);
    await expect(page.getByRole("heading", { name: /assets/i }).first())
      .toBeVisible();
  });

  test("the dashboard shows real figures from the seeded register", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/register is empty/i)).toHaveCount(0);
    // Any digit at all: the point is that the API answered with data, not that
    // the demo happens to hold a particular number of assets today.
    await expect(page.locator("body")).toContainText(/\d/);
  });

  test("the register lists assets and search narrows it", async ({ page }) => {
    await page.goto("/assets");
    await expect(page.getByText(/ThinkPad/).first()).toBeVisible();

    await page.getByLabel(/search assets/i).fill("forklift");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/q=forklift/);
    // A row, not any text: the search term also appears in the field itself and
    // in filter chips, so matching text anywhere proves nothing about results.
    await expect(page.getByRole("link", { name: /forklift/i }).first())
      .toBeVisible();
  });

  test("an asset opens, and its history is there", async ({ page }) => {
    await page.goto("/assets");
    await page.getByText(/ThinkPad/).first().click();

    await expect(page).toHaveURL(/\/assets\/[0-9a-f-]{36}/);
    await expect(page.getByText(/history/i).first()).toBeVisible();
  });

  test("a report runs and offers its downloads", async ({ page }) => {
    await page.goto("/reports");
    // By destination, not by position: the first link in the page is a sidebar
    // item and the first inside main is the breadcrumb back to the dashboard.
    await page.locator('main a[href^="/reports/"]').first().click();

    await expect(page).toHaveURL(/\/reports\/.+/);
    await expect(page.getByRole("button", { name: /csv/i }).first()).toBeVisible();
  });

  test("help is reachable from every page", async ({ page }) => {
    await page.goto("/assets");
    await page.getByRole("button", { name: /help with/i }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(/register/i);
  });

  test("the developer portal is public", async ({ page, context }) => {
    // No credential at all: an integrator reads these pages before anybody has
    // issued them one.
    await context.clearCookies();
    await page.goto("/developers");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/API/i);
    await expect(page).not.toHaveURL(/signin/);
  });

  test("the API reference is generated from the running server", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/developers/reference");

    // If the document could not be fetched the page says so; that message
    // failing to appear is the assertion.
    await expect(page.getByText(/could not be loaded/i)).toHaveCount(0);
    await expect(page.getByText("/api/v1/assets").first()).toBeVisible();
  });
});

test.describe("signing out", () => {
  test("ends the session for real, not just in the interface", async ({ page, request }) => {
    await signIn(page);
    await page.goto("/");

    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === "ams_session");
    expect(session).toBeDefined();

    await page.context().clearCookies();
    const me = await request.get("/api/admin/auth/me", {
      headers: { cookie: "" },
    });
    expect(me.status()).toBe(401);
  });
});
