import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { systemCtx } from "@/lib/jobs/context";
import { resolvePolicy, listDepreciableAssets } from "./depreciation.repo";
import { createCategory } from "./categories";
import { createAsset } from "./assets";
import type { Ctx } from "@/lib/http/handler";

let ctx: Ctx;
let laptopsId: string;

beforeAll(async () => {
  const orgId = await createOrg("Depreciation Org");
  await createUserWithRole(orgId, "Administrator");
  ctx = systemCtx(orgId);

  const laptops = await createCategory(ctx, {
    name: "Laptops", kind: "it", field_schema: { fields: [] },
  });
  laptopsId = laptops.id;

  await withTenant(orgId, (c) =>
    c.query(
      `UPDATE categories
          SET depreciation_method = 'straight_line',
              useful_life_months = 36,
              salvage_pct = 10
        WHERE id = $1`,
      [laptopsId],
    ),
  );
});

describe("resolvePolicy", () => {
  it("takes the category's policy when the asset sets none", async () => {
    const asset = await createAsset(ctx, {
      name: "Inherits", category_id: laptopsId,
      purchase_cost: 12_000_000, purchase_date: "2026-01-10",
    });

    const policy = await resolvePolicy(ctx, asset.id);
    expect(policy.method).toBe("straight_line");
    expect(policy.useful_life_months).toBe(36);
    expect(policy.salvage_pct).toBe(10);
  });

  it("lets an asset override its category", async () => {
    // The one machine bought second-hand does not have the same life left as
    // the rest of the category.
    const asset = await createAsset(ctx, {
      name: "Overrides", category_id: laptopsId,
      purchase_cost: 4_000_000, purchase_date: "2026-01-10",
    });
    await withTenant(ctx.orgId, (c) =>
      c.query("UPDATE assets SET useful_life_months = 12 WHERE id = $1", [asset.id]),
    );

    const policy = await resolvePolicy(ctx, asset.id);
    expect(policy.useful_life_months).toBe(12);
    // Unset fields still come from the category: an override of one field must
    // not silently reset the other three.
    expect(policy.method).toBe("straight_line");
    expect(policy.salvage_pct).toBe(10);
  });

  it("reports no method for an asset in a category that depreciates nothing", async () => {
    const other = await createCategory(ctx, {
      name: "Consumables", kind: "equipment", field_schema: { fields: [] },
    });
    const asset = await createAsset(ctx, {
      name: "Not depreciated", category_id: other.id, purchase_cost: 50_000,
    });

    expect((await resolvePolicy(ctx, asset.id)).method).toBe("none");
  });

  it("reports no method for an asset that has no category at all", async () => {
    const asset = await createAsset(ctx, { name: "Uncategorised", purchase_cost: 900_000 });
    expect((await resolvePolicy(ctx, asset.id)).method).toBe("none");
  });
});

describe("listDepreciableAssets", () => {
  it("skips assets with no cost, because there is nothing to write down", async () => {
    await createAsset(ctx, {
      name: "No cost", category_id: laptopsId, purchase_date: "2026-01-10",
    });
    const rows = await listDepreciableAssets(ctx);
    expect(rows.every((r) => Number(r.cost) > 0)).toBe(true);
    expect(rows.some((r) => r.name === "No cost")).toBe(false);
  });

  it("falls back to the purchase date when no start date is set", async () => {
    const asset = await createAsset(ctx, {
      name: "Starts at purchase", category_id: laptopsId,
      purchase_cost: 9_000_000, purchase_date: "2026-03-01",
    });
    const row = (await listDepreciableAssets(ctx)).find((r) => r.id === asset.id)!;
    expect(row.start).toBe("2026-03-01");
  });

  it("prefers an explicit start date over the purchase date", async () => {
    // An asset can be bought in one month and brought into service in another,
    // and depreciation follows use.
    const asset = await createAsset(ctx, {
      name: "Late into service", category_id: laptopsId,
      purchase_cost: 9_000_000, purchase_date: "2026-03-01",
    });
    await withTenant(ctx.orgId, (c) =>
      c.query("UPDATE assets SET depreciation_start = '2026-06-01' WHERE id = $1",
        [asset.id]),
    );
    const row = (await listDepreciableAssets(ctx)).find((r) => r.id === asset.id)!;
    expect(row.start).toBe("2026-06-01");
  });

  it("skips a retired asset, which stops depreciating when it leaves the register", async () => {
    const asset = await createAsset(ctx, {
      name: "Retired", category_id: laptopsId,
      purchase_cost: 9_000_000, purchase_date: "2026-01-10", status: "retired",
    });
    const rows = await listDepreciableAssets(ctx);
    expect(rows.some((r) => r.id === asset.id)).toBe(false);
  });

  it("skips an asset whose category depreciates nothing", async () => {
    const rows = await listDepreciableAssets(ctx);
    expect(rows.some((r) => r.name === "Not depreciated")).toBe(false);
  });

  it("carries each asset's resolved policy, so the caller needs no second query", async () => {
    const row = (await listDepreciableAssets(ctx)).find((r) => r.name === "Overrides")!;
    expect(row.policy.method).toBe("straight_line");
    expect(row.policy.useful_life_months).toBe(12);
    expect(row.policy.salvage_pct).toBe(10);
  });
});
