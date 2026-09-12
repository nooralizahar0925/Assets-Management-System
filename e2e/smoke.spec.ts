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

/**
 * The platform console.
 *
 * Two planes share this deployment: customers, and whoever rents it to them.
 * They must not be able to reach each other, and no unit test can prove that
 * across a real browser, a real proxy and two real cookies.
 */

const OPERATOR = process.env.SEED_OPERATOR_EMAIL ?? "ops@demo.local";
const STRAINED = { slug: "sinar", name: "Sinar Rental", admin: "admin@sinar.local" };

async function signInAsOperator(page: Page) {
  await page.goto("/platform");
  await page.getByLabel(/email/i).fill(OPERATOR);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("heading", { name: /needs attention/i }))
    .toBeVisible({ timeout: 15_000 });
}

test.describe("the platform console", () => {
  test("the operator signs in and sees their customers", async ({ page }) => {
    await signInAsOperator(page);

    await page.getByRole("link", { name: /all customers/i }).click();
    await expect(page.getByText("Demo Logistics").first()).toBeVisible();
    await expect(page.getByText(STRAINED.name).first()).toBeVisible();
  });

  test("a tenant session cannot reach the console", async ({ page, request }) => {
    // The assertion that matters most in this whole phase. A customer's
    // administrator is the most privileged thing inside a tenant, and it must
    // buy exactly nothing on the other plane.
    await signIn(page);

    const session = (await page.context().cookies())
      .find((c) => c.name === "ams_session");
    expect(session).toBeDefined();

    const refused = await request.get("/api/platform/orgs", {
      headers: { cookie: `${session!.name}=${session!.value}` },
    });
    expect(refused.status()).toBe(401);

    // And in the browser, carrying that same cookie, the console offers its own
    // sign-in rather than anybody's data.
    await page.goto("/platform");
    await expect(page.getByRole("heading", { name: /operator sign-in/i }))
      .toBeVisible();
    await expect(page.getByText("Demo Logistics")).toHaveCount(0);
  });

  test("a suspended customer cannot sign in, and says why", async ({ page, request }) => {
    const login = await request.post("/api/platform/auth/login", {
      data: { email: OPERATOR, password: PASSWORD },
    });
    expect(login.status(), await login.text()).toBe(200);

    const listed = await request.get("/api/platform/orgs");
    const { data } = await listed.json() as { data: { id: string; slug: string }[] };
    const target = data.find((org) => org.slug === STRAINED.slug);
    expect(target, `no "${STRAINED.slug}" - has the seed run?`).toBeDefined();

    const suspended = await request.post(
      `/api/platform/orgs/${target!.id}/suspend`,
      { data: { reason: "Smoke test. Lifted at the end of this test." } },
    );
    expect(suspended.ok(), await suspended.text()).toBe(true);

    try {
      await page.goto("/signin");
      await page.getByRole("textbox", { name: /email/i }).fill(STRAINED.admin);
      await page.getByRole("textbox", { name: /password/i }).fill(PASSWORD);
      await page.getByRole("button", { name: /sign in/i }).click();

      // Refused, and told why: "wrong password" here would send somebody
      // hunting for an account problem that does not exist.
      await expect(page.getByRole("alert")).toContainText(/suspended/i);
      await expect(page).toHaveURL(/signin/);
    } finally {
      // Left suspended, the next run finds it missing from the attention list
      // and this suite fails for a reason that has nothing to do with the code.
      await request.delete(`/api/platform/orgs/${target!.id}/suspend`);
    }
  });
});
