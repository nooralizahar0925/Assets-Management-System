import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { systemCtx } from "@/lib/jobs/context";
import { runDepreciationJob } from "./depreciation";
import { bookValueNow } from "@/lib/domain/depreciation.repo";
import { createCategory } from "@/lib/domain/categories";
import { createAsset } from "@/lib/domain/assets";
import type { Ctx } from "@/lib/http/handler";

let ctx: Ctx;
let assetId: string;

beforeAll(async () => {
  const orgId = await createOrg("Snapshot Org");
  await createUserWithRole(orgId, "Administrator");
  ctx = systemCtx(orgId);

  const cat = await createCategory(ctx, {
    name: "Laptops", kind: "it", field_schema: { fields: [] },
  });
  await withTenant(orgId, (c) =>
    c.query(
      `UPDATE categories SET depreciation_method = 'straight_line',
              useful_life_months = 36 WHERE id = $1`,
      [cat.id],
    ),
  );

  const asset = await createAsset(ctx, {
    name: "ThinkPad", category_id: cat.id,
    purchase_cost: 36_000_000, purchase_date: "2026-01-05",
  });
  assetId = asset.id;
});

const rows = () =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<{ period_end: string; charge: string; closing_value: string }>(
      `SELECT period_end::text, charge, closing_value
         FROM asset_book_values WHERE asset_id = $1 ORDER BY period_end`,
      [assetId],
    )).rows,
  );

describe("runDepreciationJob", () => {
  it("writes one row per closed month", async () => {
    const summary = await runDepreciationJob(ctx, "2026-03-15");
    expect(summary.assets).toBe(1);
    expect(summary.periods).toBe(2);

    expect((await rows()).map((r) => r.period_end))
      .toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("never writes the month it is run in, which is not closed yet", async () => {
    // A snapshot that changes when you re-run it in the same month is not a
    // snapshot.
    expect((await rows()).some((r) => r.period_end.startsWith("2026-03"))).toBe(false);
  });

  it("is idempotent: a second run in the same month writes nothing", async () => {
    const before = (await rows()).length;
    const summary = await runDepreciationJob(ctx, "2026-03-20");
    expect(summary.periods).toBe(0);
    expect((await rows()).length).toBe(before);
  });

  it("backfills a gap, so a scheduler that was down leaves no hole", async () => {
    await runDepreciationJob(ctx, "2026-07-02");
    expect((await rows()).map((r) => r.period_end)).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31",
      "2026-04-30", "2026-05-31", "2026-06-30",
    ]);
  });

  it("records a closing value that falls by the monthly charge", async () => {
    const written = await rows();
    expect(Number(written[0].closing_value)).toBe(35_000_000);
    expect(Number(written[1].closing_value)).toBe(34_000_000);
    expect(Number(written[0].charge)).toBe(1_000_000);
  });

  it("counts the assets it considered even when it writes nothing", async () => {
    const summary = await runDepreciationJob(ctx, "2026-07-05");
    expect(summary.assets).toBe(1);
    expect(summary.periods).toBe(0);
  });
});

describe("bookValueNow", () => {
  it("is calculated live, not read from the last snapshot", async () => {
    // The interface shows today's value; reports use the frozen month-end
    // figures. Reading the newest snapshot here would be stale for most of the
    // month - snapshots stop at June above, and this is August.
    expect(await bookValueNow(ctx, assetId, "2026-08-15")).toBe(28_000_000);
  });

  it("returns the purchase cost for an asset that does not depreciate", async () => {
    const plain = await createCategory(ctx, {
      name: "Consumables", kind: "equipment", field_schema: { fields: [] },
    });
    const asset = await createAsset(ctx, {
      name: "Cable", category_id: plain.id, purchase_cost: 250_000,
      purchase_date: "2026-01-05",
    });
    expect(await bookValueNow(ctx, asset.id, "2026-08-15")).toBe(250_000);
  });

  it("returns zero for an asset with no cost recorded", async () => {
    const asset = await createAsset(ctx, { name: "Unpriced" });
    expect(await bookValueNow(ctx, asset.id, "2026-08-15")).toBe(0);
  });
});
