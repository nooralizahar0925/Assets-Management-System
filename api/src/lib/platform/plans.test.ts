import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withPlatform } from "./db";
import { createOrg } from "../../test/org";
import {
  effectiveEntitlements, listPlans, upsertPlan, deletePlan, PlanInUseError,
} from "./plans";

/**
 * What one customer may actually do.
 *
 * The plan grants and an override adjusts, in both directions. Getting this
 * wrong one way sells somebody something they cannot use; the other way hands
 * them something they have not paid for. Both are worth a test.
 */

let orgId: string;

beforeAll(async () => {
  orgId = await createOrg("Entitlements Org");

  await upsertPlan({
    code: "test-basic",
    name: "Test Basic",
    description: "For the tests.",
    price_minor: 250_000,
    currency: "IDR",
    billing_cycle: "monthly",
    features: ["import", "labels", "reports"],
    limits: { max_assets: 500, max_users: 10 },
    active: true,
    sort_order: 1,
  });
});

beforeEach(async () => {
  await withPlatform((c) =>
    c.query("DELETE FROM org_entitlements WHERE org_id = $1", [orgId]),
  );
  await withPlatform((c) =>
    c.query(
      "UPDATE organizations SET plan_code = NULL, limit_overrides = '{}'::jsonb WHERE id = $1",
      [orgId],
    ),
  );
});

const setPlan = (code: string | null) =>
  withPlatform((c) =>
    c.query("UPDATE organizations SET plan_code = $2 WHERE id = $1", [orgId, code]),
  );

const override = (feature: string, enabled: boolean) =>
  withPlatform((c) =>
    c.query(
      `INSERT INTO org_entitlements (org_id, feature_key, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (org_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled`,
      [orgId, feature, enabled],
    ),
  );

describe("resolving what a customer has", () => {
  it("gives an organisation with no plan the register and nothing else", async () => {
    // A customer being set up, or one whose trial is still being arranged.
    // They can sign in and use the product; they cannot use what is sold.
    const { features, plan_code } = await effectiveEntitlements(orgId);
    expect(features).toEqual(["core"]);
    expect(plan_code).toBeNull();
  });

  it("gives a plan's features, plus the register", async () => {
    await setPlan("test-basic");
    const { features } = await effectiveEntitlements(orgId);
    expect(features).toEqual(["core", "import", "labels", "reports"]);
  });

  it("adds a feature promised to one customer without changing their plan", async () => {
    // What you agree to in the meeting to win the deal.
    await setPlan("test-basic");
    await override("stocktake", true);

    const { features, plan_code } = await effectiveEntitlements(orgId);
    expect(features).toContain("stocktake");
    expect(plan_code).toBe("test-basic");
  });

  it("withdraws a feature the plan grants", async () => {
    // An override of false is as meaningful as one of true, and is how a
    // feature is taken back without moving somebody off what they pay for.
    await setPlan("test-basic");
    await override("labels", false);

    const { features } = await effectiveEntitlements(orgId);
    expect(features).not.toContain("labels");
    expect(features).toContain("import");
  });

  it("will not let the register itself be switched off", async () => {
    // An account that can sign in and do nothing at all is a support call,
    // not a plan.
    await setPlan("test-basic");
    await override("core", false);

    const { features } = await effectiveEntitlements(orgId);
    expect(features).toContain("core");
  });

  it("returns the features in a stable order", async () => {
    // The console diffs these, and an unstable order makes every read look
    // like a change.
    await setPlan("test-basic");
    await override("webhooks", true);

    const first = await effectiveEntitlements(orgId);
    const second = await effectiveEntitlements(orgId);
    expect(first.features).toEqual(second.features);
    expect(first.features).toEqual([...first.features].sort());
  });

  it("has nothing to say about an organisation that does not exist", async () => {
    const { features, plan_code } = await effectiveEntitlements(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(features).toEqual(["core"]);
    expect(plan_code).toBeNull();
  });
});

describe("resolving limits", () => {
  it("takes them from the plan", async () => {
    await setPlan("test-basic");
    const { limits } = await effectiveEntitlements(orgId);
    expect(limits).toEqual({ max_assets: 500, max_users: 10 });
  });

  it("lets one customer's limit be raised without a new plan", async () => {
    await setPlan("test-basic");
    await withPlatform((c) =>
      c.query(
        `UPDATE organizations SET limit_overrides = '{"max_assets": 5000}'::jsonb
          WHERE id = $1`,
        [orgId],
      ),
    );

    const { limits } = await effectiveEntitlements(orgId);
    expect(limits.max_assets).toBe(5000);
    // The limits it does not mention still come from the plan.
    expect(limits.max_users).toBe(10);
  });

  it("treats an absent limit as unlimited, not as zero", async () => {
    // The difference between "we did not cap this" and "you may have none".
    await setPlan("test-basic");
    const { limits } = await effectiveEntitlements(orgId);
    expect(limits.max_storage_mb).toBeUndefined();
  });

  it("has no limits at all for an organisation with no plan", async () => {
    const { limits } = await effectiveEntitlements(orgId);
    expect(limits).toEqual({});
  });
});

describe("the plan catalogue", () => {
  it("lists the plans on offer", async () => {
    const plans = await listPlans();
    expect(plans.map((p) => p.code)).toContain("test-basic");
  });

  it("keeps a price in minor units, as an integer", async () => {
    // 250000 is Rp 250,000. Never a float, for the same reason an asset's
    // value is not one.
    const plan = (await listPlans()).find((p) => p.code === "test-basic")!;
    expect(plan.price_minor).toBe(250_000);
    expect(Number.isInteger(plan.price_minor)).toBe(true);
  });

  it("refuses to delete a plan somebody is on", async () => {
    // Deleting it would leave that customer with no plan and nothing beyond
    // the register, which is an outage they did not ask for.
    await setPlan("test-basic");
    await expect(deletePlan("test-basic")).rejects.toBeInstanceOf(PlanInUseError);
  });

  it("says how many customers are on it when it refuses", async () => {
    await setPlan("test-basic");
    await expect(deletePlan("test-basic")).rejects.toThrow(/1/);
  });

  it("updates a plan in place rather than making a second one", async () => {
    await upsertPlan({
      code: "test-basic",
      name: "Test Basic Renamed",
      description: "For the tests.",
      price_minor: 300_000,
      currency: "IDR",
      billing_cycle: "monthly",
      features: ["import", "labels", "reports"],
      limits: { max_assets: 500, max_users: 10 },
      active: true,
      sort_order: 1,
    });

    const matching = (await listPlans()).filter((p) => p.code === "test-basic");
    expect(matching).toHaveLength(1);
    expect(matching[0].name).toBe("Test Basic Renamed");
  });

  it("refuses a plan naming a feature that does not exist", async () => {
    // The plan would sell something no handler checks, and the customer would
    // find out by trying to use it.
    await expect(upsertPlan({
      code: "test-nonsense",
      name: "Nonsense",
      description: "",
      price_minor: 0,
      currency: "IDR",
      billing_cycle: "monthly",
      features: ["teleportation"],
      limits: {},
      active: true,
      sort_order: 99,
    })).rejects.toThrow(/teleportation/);
  });
});
