import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../../db";
import { createOrg, createUserWithRole } from "../../../test/org";
import { systemCtx } from "../../jobs/context";
import { createAsset } from "../../domain/assets";
import { createCategory } from "../../domain/categories";
import { createLocation } from "../../domain/locations";
import { runDepreciationJob } from "../../jobs/depreciation";
import { REPORTS } from "./index";
import type { Ctx } from "../../http/handler";
import type { ReportRow } from "../types";

let ctx: Ctx;
let siteA: string;
let siteB: string;
let laptopId: string;
let freshId: string;

const report = () => REPORTS["asset-book-value"];

const scopedTo = (locations: string[] | null): Ctx => ({
  ...ctx,
  actor: { ...ctx.actor, locationScope: locations },
});

const rowFor = (rows: ReportRow[], name: string) =>
  rows.find((r) => r.name === name)!;

beforeAll(async () => {
  const orgId = await createOrg("Book Value Org");
  await createUserWithRole(orgId, "Administrator");
  ctx = systemCtx(orgId);

  siteA = (await createLocation(ctx, { name: "Site A" })).id;
  siteB = (await createLocation(ctx, { name: "Site B" })).id;

  const laptops = await createCategory(ctx, {
    name: "Laptops", kind: "it", field_schema: { fields: [] },
  });
  await withTenant(orgId, (c) =>
    c.query(
      `UPDATE categories SET depreciation_method = 'straight_line',
              useful_life_months = 36 WHERE id = $1`,
      [laptops.id],
    ),
  );

  // Bought long enough ago to have several months of snapshots.
  laptopId = (await createAsset(ctx, {
    name: "Depreciated laptop", category_id: laptops.id, location_id: siteA,
    purchase_cost: 36_000_000, purchase_date: "2026-01-05",
  })).id;

  // Bought this month: on the register, but with no closed period yet.
  freshId = (await createAsset(ctx, {
    name: "Brand new laptop", category_id: laptops.id, location_id: siteB,
    purchase_cost: 12_000_000, purchase_date: "2026-04-02",
  })).id;

  await runDepreciationJob(ctx, "2026-04-10");
});

describe("asset-book-value report", () => {
  it("is registered so the gallery and every export format can reach it", () => {
    expect(report()).toBeDefined();
    expect(report().name).toBe("Asset book value");
  });

  it("reports cost less accumulated depreciation on every row", async () => {
    const rows = await report().run(ctx, {});
    for (const row of rows) {
      expect(Number(row.book_value))
        .toBe(Number(row.cost) - Number(row.accumulated));
    }
  });

  it("uses the latest snapshot for an asset with several months recorded", async () => {
    // Three closed months to April: January, February, March.
    const rows = await report().run(ctx, {});
    const laptop = rowFor(rows, "Depreciated laptop");
    expect(Number(laptop.accumulated)).toBe(3_000_000);
    expect(Number(laptop.book_value)).toBe(33_000_000);
    expect(laptop.as_of).toBe("2026-03-31");
  });

  it("returns exactly one row per asset, not one per period", async () => {
    // A plain join would repeat the asset once for every month it has been
    // valued, and the totals would be nonsense.
    const rows = await report().run(ctx, {});
    const names = rows.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("shows an asset with no closed period yet at its full cost", async () => {
    // Something bought this month is still on the register and still worth
    // what was paid for it; dropping it would understate the total.
    const rows = await report().run(ctx, {});
    const fresh = rowFor(rows, "Brand new laptop");
    expect(Number(fresh.accumulated)).toBe(0);
    expect(Number(fresh.book_value)).toBe(12_000_000);
    expect(fresh.as_of).toBeNull();
  });

  it("totals each money column", async () => {
    const rows = await report().run(ctx, {});
    const totals = report().totals!(rows)!;
    expect(Number(totals.cost)).toBe(48_000_000);
    expect(Number(totals.accumulated)).toBe(3_000_000);
    expect(Number(totals.book_value)).toBe(45_000_000);
  });

  it("shows a branch-scoped reader only their own branches", async () => {
    // A report is exactly the artefact somebody circulates without checking
    // who could see it.
    const rows = await report().run(scopedTo([siteB]), {});
    expect(rows.map((r) => r.name)).toEqual(["Brand new laptop"]);
  });

  it("honours a category filter like every other asset report", async () => {
    const other = await createCategory(ctx, {
      name: "Furniture", kind: "equipment", field_schema: { fields: [] },
    });
    await createAsset(ctx, {
      name: "Desk", category_id: other.id, location_id: siteA,
      purchase_cost: 2_000_000, purchase_date: "2026-01-05",
    });

    const rows = await report().run(ctx, { category_id: other.id });
    expect(rows.map((r) => r.name)).toEqual(["Desk"]);
  });

  it("leaves out assets with no purchase cost, which have no book value", async () => {
    await createAsset(ctx, { name: "Unpriced", location_id: siteA });
    const rows = await report().run(ctx, {});
    expect(rows.some((r) => r.name === "Unpriced")).toBe(false);
  });
});
