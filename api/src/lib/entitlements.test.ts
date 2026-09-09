import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withPlatform } from "./platform/db";
import { withTenant } from "./db";
import { createOrg, createUserWithRole } from "../test/org";
import { PERMISSIONS, type PermissionKey } from "./auth/permissions";
import type { Ctx } from "./http/handler";
import { createAsset } from "./domain/assets";
import {
  hasFeature, requireFeature, assertWithinLimit, forgetEntitlements,
} from "./entitlements";

/**
 * What the tenant API asks about a customer's plan.
 *
 * The rule this file exists to hold: a limit refuses a write and never a read.
 * A customer over their cap must always be able to get their data out, or the
 * limit stops being a limit and becomes a way of holding data hostage.
 */

let orgId: string;
let ctx: Ctx;

beforeAll(async () => {
  orgId = await createOrg("Limits Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  ctx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
});

const setPlan = async (code: string | null) => {
  await withPlatform((c) =>
    c.query("UPDATE organizations SET plan_code = $2 WHERE id = $1", [orgId, code]),
  );
  forgetEntitlements(orgId);
};

const setLimits = async (limits: Record<string, number>) => {
  await withPlatform((c) =>
    c.query(
      "UPDATE organizations SET limit_overrides = $2::jsonb WHERE id = $1",
      [orgId, JSON.stringify(limits)],
    ),
  );
  forgetEntitlements(orgId);
};

beforeEach(async () => {
  await setLimits({});
  await setPlan(null);
});

describe("asking what a customer has", () => {
  it("says no to a feature their plan does not include", async () => {
    await setPlan("starter");
    expect(await hasFeature(ctx, "stocktake")).toBe(false);
  });

  it("says yes to one it does", async () => {
    await setPlan("professional");
    expect(await hasFeature(ctx, "stocktake")).toBe(true);
  });

  it("always says yes to the register itself", async () => {
    await setPlan(null);
    expect(await hasFeature(ctx, "core")).toBe(true);
  });

  it("refuses with a problem naming the feature, not a bare 403", async () => {
    await setPlan("starter");
    const refusal = await requireFeature(ctx, "webhooks");

    expect(refusal).toBeInstanceOf(Response);
    const body = await (refusal as Response).json() as {
      type: string; detail: string;
    };
    expect(body.type).toContain("feature-not-enabled");
    // The label, not the key: the reader is a customer, not a developer.
    expect(body.detail).toMatch(/Webhooks/);
  });

  it("returns null when the feature is enabled, so a handler can carry on", async () => {
    await setPlan("professional");
    expect(await requireFeature(ctx, "stocktake")).toBeNull();
  });
});

describe("holding a customer to their limits", () => {
  beforeEach(async () => {
    // Through the tenant connection: the platform role holds only SELECT on
    // assets, deliberately, so the console can count what a customer has
    // without being able to touch it.
    await withTenant(orgId, (c) => c.query("DELETE FROM assets"));
  });

  it("allows a write while there is room", async () => {
    await setLimits({ max_assets: 5 });
    expect(await assertWithinLimit(ctx, "max_assets")).toBeNull();
  });

  it("refuses the write that would cross the cap", async () => {
    await setLimits({ max_assets: 2 });
    await createAsset(ctx, { name: "One" });
    await createAsset(ctx, { name: "Two" });

    const refusal = await assertWithinLimit(ctx, "max_assets");
    expect(refusal).toBeInstanceOf(Response);
    expect((refusal as Response).status).toBe(402);
  });

  it("names the limit and the current count, so the reader knows what to do", async () => {
    // "Plan limit reached" alone leaves somebody guessing which limit, how far
    // over, and whether deleting one thing would help.
    await setLimits({ max_assets: 2 });
    await createAsset(ctx, { name: "One" });
    await createAsset(ctx, { name: "Two" });

    const body = await (await assertWithinLimit(ctx, "max_assets") as Response)
      .json() as { detail: string };

    expect(body.detail).toMatch(/2/);
    expect(body.detail).toMatch(/assets/i);
  });

  it("counts only live assets, so deleting one really does make room", async () => {
    // Otherwise the message tells them to delete something and deleting it
    // changes nothing, which is worse than refusing without advice.
    await setLimits({ max_assets: 2 });
    const first = await createAsset(ctx, { name: "One" });
    await createAsset(ctx, { name: "Two" });
    expect(await assertWithinLimit(ctx, "max_assets")).not.toBeNull();

    await withTenant(orgId, (c) =>
      c.query("UPDATE assets SET deleted_at = now() WHERE id = $1", [first.id]),
    );
    forgetEntitlements(orgId);

    expect(await assertWithinLimit(ctx, "max_assets")).toBeNull();
  });

  it("refuses a batch that would cross the cap, before any of it is written", async () => {
    // Half an import is the worst outcome: the customer cannot tell what
    // landed, and re-running double-imports the part that did.
    await setLimits({ max_assets: 10 });
    await createAsset(ctx, { name: "One" });

    expect(await assertWithinLimit(ctx, "max_assets", 5)).toBeNull();
    expect(await assertWithinLimit(ctx, "max_assets", 50)).not.toBeNull();
  });

  it("allows everything when the plan sets no limit", async () => {
    await setPlan("enterprise");
    await setLimits({});
    for (let i = 0; i < 3; i += 1) await createAsset(ctx, { name: `Free ${i}` });

    expect(await assertWithinLimit(ctx, "max_assets")).toBeNull();
  });

  it("counts people against the user limit", async () => {
    await setLimits({ max_users: 1 });
    // The organisation already has its administrator.
    expect(await assertWithinLimit(ctx, "max_users")).not.toBeNull();

    await setLimits({ max_users: 50 });
    expect(await assertWithinLimit(ctx, "max_users")).toBeNull();
  });
});
