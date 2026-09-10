import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withPlatform } from "@/lib/platform/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { forgetEntitlements } from "@/lib/entitlements";
import { GET as STOCKTAKES } from "./stocktakes/route";
import { GET as MAINTENANCE } from "./maintenance/schedules/route";
import { GET as WEBHOOKS } from "./webhooks/route";
import { GET as REPORTS } from "./reports/route";
import { GET as RUN_REPORT } from "./reports/[key]/route";
import { POST as CREATE_ASSET, GET as LIST_ASSETS } from "./assets/route";

/**
 * Feature gates, through the real routes.
 *
 * The unit tests prove requireFeature computes the right answer, and the
 * source scanner proves a gate exists for every feature sold. Neither proves a
 * handler reaches its gate - which is the half that has been wrong before in
 * this project, more than once.
 */

let orgId: string;
let session: string;

beforeAll(async () => {
  orgId = await createOrg("Feature Gates Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  session = await createSession(admin.id, orgId);
});

const setPlan = async (code: string | null) => {
  await withPlatform((c) =>
    c.query("UPDATE organizations SET plan_code = $2 WHERE id = $1", [orgId, code]),
  );
  forgetEntitlements(orgId);
};

const request = (path: string, method = "GET", body?: unknown) =>
  new Request(`http://api.test${path}`, {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => setPlan("starter"));

describe("a feature the plan does not include", () => {
  it("refuses stock-takes with a 403 naming the feature", async () => {
    const res = await STOCKTAKES(request("/api/v1/stocktakes"));
    expect(res.status).toBe(403);

    const body = await res.json() as { type: string; detail: string };
    expect(body.type).toContain("feature-not-enabled");
    // The label, not the key: the reader is a customer, not a developer.
    expect(body.detail).toMatch(/Stock-takes/);
  });

  it("refuses maintenance", async () => {
    expect((await MAINTENANCE(request("/api/v1/maintenance/schedules"))).status)
      .toBe(403);
  });

  it("refuses webhooks", async () => {
    expect((await WEBHOOKS(request("/api/v1/webhooks"))).status).toBe(403);
  });

  it("refuses configuring depreciation on an asset", async () => {
    // The feature is setting a policy, not owning something with a value.
    const res = await CREATE_ASSET(request("/api/v1/assets", "POST", {
      name: "Written down",
      depreciation: {
        method: "straight_line", useful_life_months: 36,
        salvage_pct: 0, declining_rate_pct: null,
      },
    }));
    expect(res.status).toBe(403);
  });

  it("still creates an asset that sets no policy", async () => {
    const res = await CREATE_ASSET(request("/api/v1/assets", "POST", {
      name: "Ordinary asset", purchase_cost: 1_000_000,
    }));
    expect(res.status).toBe(201);
  });

  it("leaves the book-value report out of the gallery", async () => {
    // Offering something and refusing it when chosen is worse than not
    // offering it.
    const body = await (await REPORTS(request("/api/v1/reports"))).json() as {
      data: { key: string }[];
    };
    expect(body.data.map((r) => r.key)).not.toContain("asset-book-value");
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("refuses the book-value report even when asked for directly", async () => {
    // Hiding it in the gallery is courtesy; refusing it is the enforcement.
    const res = await RUN_REPORT(
      request("/api/v1/reports/asset-book-value"),
      { params: Promise.resolve({ key: "asset-book-value" }) },
    );
    expect(res.status).toBe(403);
  });

  it("never refuses the register itself", async () => {
    expect((await LIST_ASSETS(request("/api/v1/assets"))).status).toBe(200);
  });
});

describe("a feature the plan does include", () => {
  beforeEach(() => setPlan("professional"));

  it("allows stock-takes", async () => {
    expect((await STOCKTAKES(request("/api/v1/stocktakes"))).status).toBe(200);
  });

  it("allows maintenance", async () => {
    expect((await MAINTENANCE(request("/api/v1/maintenance/schedules"))).status)
      .toBe(200);
  });

  it("allows the book-value report, and lists it", async () => {
    const body = await (await REPORTS(request("/api/v1/reports"))).json() as {
      data: { key: string }[];
    };
    expect(body.data.map((r) => r.key)).toContain("asset-book-value");
  });

  it("still refuses webhooks, which Professional does not include", async () => {
    // The point of features being separate from each other.
    expect((await WEBHOOKS(request("/api/v1/webhooks"))).status).toBe(403);
  });
});

describe("an organisation with no plan at all", () => {
  beforeEach(() => setPlan(null));

  it("can still use the register", async () => {
    expect((await LIST_ASSETS(request("/api/v1/assets"))).status).toBe(200);
  });

  it("cannot use anything that is sold", async () => {
    expect((await STOCKTAKES(request("/api/v1/stocktakes"))).status).toBe(403);
    expect((await MAINTENANCE(request("/api/v1/maintenance/schedules"))).status)
      .toBe(403);
  });
});
