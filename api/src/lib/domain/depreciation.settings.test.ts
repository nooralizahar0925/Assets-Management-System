import { describe, it, expect, beforeAll } from "vitest";
import { createOrg, createUserWithRole } from "@/test/org";
import { systemCtx } from "@/lib/jobs/context";
import { createCategory, updateCategory, getCategory } from "./categories";
import { createAsset, updateAsset, getAsset } from "./assets";
import { resolvePolicy } from "./depreciation.repo";
import type { Ctx } from "@/lib/http/handler";

let ctx: Ctx;
let laptopsId: string;

beforeAll(async () => {
  const orgId = await createOrg("Depreciation Settings Org");
  await createUserWithRole(orgId, "Administrator");
  ctx = systemCtx(orgId);

  laptopsId = (await createCategory(ctx, {
    name: "Laptops", kind: "it", field_schema: { fields: [] },
    depreciation_method: "straight_line",
    useful_life_months: 36,
    salvage_pct: 10,
  })).id;
});

describe("category depreciation settings", () => {
  it("stores the policy given at creation", async () => {
    const category = await getCategory(ctx, laptopsId);
    expect(category!.depreciation_method).toBe("straight_line");
    expect(category!.useful_life_months).toBe(36);
    expect(Number(category!.salvage_pct)).toBe(10);
  });

  it("defaults to depreciating nothing", async () => {
    const plain = await createCategory(ctx, {
      name: "Consumables", kind: "equipment", field_schema: { fields: [] },
    });
    expect(plain.depreciation_method).toBe("none");
  });

  it("replaces the whole policy when one is supplied", async () => {
    // The policy is edited as a unit, so switching to reducing balance must
    // clear the useful life rather than leave a stale one behind.
    const id = (await createCategory(ctx, {
      name: "Forklifts", kind: "equipment", field_schema: { fields: [] },
      depreciation_method: "straight_line", useful_life_months: 60,
    })).id;

    await updateCategory(ctx, id, {
      depreciation_method: "reducing_balance",
      declining_rate_pct: 20,
    });

    const after = await getCategory(ctx, id);
    expect(after!.depreciation_method).toBe("reducing_balance");
    expect(after!.useful_life_months).toBeNull();
    expect(Number(after!.declining_rate_pct)).toBe(20);
  });

  it("leaves the policy alone when a patch does not mention it", async () => {
    await updateCategory(ctx, laptopsId, { name: "Laptops and tablets" });
    const after = await getCategory(ctx, laptopsId);
    expect(after!.name).toBe("Laptops and tablets");
    expect(after!.depreciation_method).toBe("straight_line");
    expect(after!.useful_life_months).toBe(36);
  });

  it("refuses a useful life of zero", async () => {
    await expect(createCategory(ctx, {
      name: "Bad life", kind: "it", field_schema: { fields: [] },
      depreciation_method: "straight_line", useful_life_months: 0,
    })).rejects.toThrow();
  });

  it("refuses a salvage percentage above 100", async () => {
    await expect(createCategory(ctx, {
      name: "Bad salvage", kind: "it", field_schema: { fields: [] },
      depreciation_method: "straight_line", useful_life_months: 12,
      salvage_pct: 120,
    })).rejects.toThrow();
  });
});

describe("asset depreciation override", () => {
  it("inherits its category by default", async () => {
    const asset = await createAsset(ctx, {
      name: "Inheriting", category_id: laptopsId, purchase_cost: 10_000_000,
    });
    expect((await resolvePolicy(ctx, asset.id)).useful_life_months).toBe(36);
  });

  it("stores an override supplied at creation", async () => {
    const asset = await createAsset(ctx, {
      name: "Second hand", category_id: laptopsId, purchase_cost: 4_000_000,
      depreciation: {
        method: "straight_line", useful_life_months: 12,
        salvage_pct: 0, declining_rate_pct: null,
      },
    });
    expect((await resolvePolicy(ctx, asset.id)).useful_life_months).toBe(12);
  });

  it("clears the override when sent null, returning the asset to its category", async () => {
    // An override that cannot be undone is a trap: the coalesce pattern the
    // rest of the patch uses cannot express "back to inheriting".
    const asset = await createAsset(ctx, {
      name: "Reverts", category_id: laptopsId, purchase_cost: 4_000_000,
      depreciation: {
        method: "straight_line", useful_life_months: 12,
        salvage_pct: 0, declining_rate_pct: null,
      },
    });
    expect((await resolvePolicy(ctx, asset.id)).useful_life_months).toBe(12);

    await updateAsset(ctx, asset.id, { depreciation: null });

    const policy = await resolvePolicy(ctx, asset.id);
    expect(policy.useful_life_months).toBe(36);
    expect(policy.salvage_pct).toBe(10);
  });

  it("leaves an override alone when a patch does not mention it", async () => {
    const asset = await createAsset(ctx, {
      name: "Untouched override", category_id: laptopsId, purchase_cost: 4_000_000,
      depreciation: {
        method: "straight_line", useful_life_months: 6,
        salvage_pct: 0, declining_rate_pct: null,
      },
    });

    await updateAsset(ctx, asset.id, { name: "Renamed only" });

    expect((await resolvePolicy(ctx, asset.id)).useful_life_months).toBe(6);
  });

  it("records a service date separate from the purchase date", async () => {
    // An asset can be bought in one month and brought into service in another.
    const asset = await createAsset(ctx, {
      name: "Late into service", category_id: laptopsId,
      purchase_cost: 9_000_000, purchase_date: "2026-03-01",
      depreciation_start: "2026-06-01",
    });
    const stored = await getAsset(ctx, asset.id);
    expect(stored!.depreciation_start).toBe("2026-06-01");
  });
});
