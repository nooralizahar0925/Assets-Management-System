import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset, updateAsset } from "./assets";
import { createCategory } from "./categories";
import { createLocation } from "./locations";
import { runDepreciationJob } from "../jobs/depreciation";
import { checkOut, checkIn } from "./assignments";
import { getDashboardSummary } from "./dashboard";

let orgId: string;
let userId: string;
let ctx: Ctx;
let headOfficeId: string;
let depotId: string;

const scopedTo = (locations: string[] | null): Ctx => ({
  ...ctx,
  actor: { ...ctx.actor, locationScope: locations },
});

beforeAll(async () => {
  orgId = await createOrg("Dashboard Org");
  const dash = await createUserWithRole(orgId, "Manager", { name: "Dash" });
  userId = dash.id;
  ctx = {
    orgId,
    actor: {
      type: "user", id: userId, label: "Dash", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };

  const itCat = await createCategory(ctx, {
    name: "IT", kind: "it",
    field_schema: { fields: [
      { key: "warranty_end", label: "Warranty", type: "date", required: false },
    ] },
  });
  const plant = await createCategory(ctx, {
    name: "Plant", kind: "equipment", field_schema: { fields: [] },
  });
  headOfficeId = (await createLocation(ctx, { name: "Head Office" })).id;
  depotId = (await createLocation(ctx, { name: "Depot" })).id;

  const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  await createAsset(ctx, {
    name: "Laptop 1", category_id: itCat.id, location_id: headOfficeId,
    purchase_cost: 15_000_000, currency: "IDR", custom: { warranty_end: soon },
  });
  await createAsset(ctx, {
    name: "Laptop 2", category_id: itCat.id, location_id: headOfficeId,
    purchase_cost: 12_000_000, currency: "IDR",
  });
  const generator = await createAsset(ctx, {
    name: "Generator", category_id: plant.id, location_id: depotId,
    purchase_cost: 80_000_000, currency: "IDR",
  });
  await updateAsset(ctx, generator.id, { status: "maintenance" });

  const issued = await createAsset(ctx, {
    name: "Issued tablet", category_id: itCat.id, location_id: depotId,
  });
  await checkOut(ctx, issued.id, {
    assignee_type: "user", assignee_id: userId, due_at: "2026-08-01T00:00:00Z",
  });
});

describe("getDashboardSummary", () => {
  it("counts every live asset", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.totals.assets).toBe(4);
  });

  it("counts open assignments and overdue ones separately", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.totals.active_assignments).toBe(1);
    expect(summary.totals.overdue).toBe(1);
  });

  it("counts assets in maintenance", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.totals.maintenance).toBe(1);
  });

  it("sums purchase value", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(Number(summary.totals.total_value)).toBe(107_000_000);
  });

  it("reports book value as cost until anything has been depreciated", async () => {
    // Nothing in this fixture carries a depreciation policy, so written-down
    // value and cost are the same figure. A tile that showed zero here would
    // read as a register worth nothing.
    const summary = await getDashboardSummary(ctx);
    expect(Number(summary.totals.book_value)).toBe(107_000_000);
  });

  it("subtracts accumulated depreciation from book value", async () => {
    const cat = await createCategory(ctx, {
      name: "Depreciating", kind: "it", field_schema: { fields: [] },
    });
    await withTenant(orgId, (c) =>
      c.query(
        `UPDATE categories SET depreciation_method = 'straight_line',
                useful_life_months = 10 WHERE id = $1`,
        [cat.id],
      ),
    );
    const asset = await createAsset(ctx, {
      name: "Writes down", category_id: cat.id,
      purchase_cost: 10_000_000, purchase_date: "2026-01-05",
    });
    await runDepreciationJob(ctx, "2026-04-10");

    const summary = await getDashboardSummary(ctx);
    // Cost rises by the new asset; book value rises by cost less three months.
    expect(Number(summary.totals.total_value)).toBe(117_000_000);
    expect(Number(summary.totals.book_value)).toBe(114_000_000);

    await withTenant(orgId, (c) =>
      c.query("DELETE FROM assets WHERE id = $1", [asset.id]),
    );
  });

  it("breaks the register down by status", async () => {
    const summary = await getDashboardSummary(ctx);
    const byStatus = Object.fromEntries(summary.by_status.map((s) => [s.status, s.count]));
    expect(byStatus).toMatchObject({ available: 2, in_use: 1, maintenance: 1 });
  });

  it("breaks the register down by category with value", async () => {
    const summary = await getDashboardSummary(ctx);
    const itRow = summary.by_category.find((c) => c.category === "IT");
    expect(itRow).toMatchObject({ count: 3 });
    expect(Number(itRow!.value)).toBe(27_000_000);
  });

  it("breaks the register down by location", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.by_location.find((l) => l.location === "Head Office")?.count).toBe(2);
  });

  it("lists recent activity newest first", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.recent_activity.length).toBeGreaterThan(0);
    expect(summary.recent_activity[0].created_at >= summary.recent_activity[1].created_at)
      .toBe(true);
  });

  it("surfaces assets expiring soon", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.expiring_soon.map((e) => e.name)).toContain("Laptop 1");
  });

  it("reports utilisation as a percentage in use", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.utilisation.in_use_pct).toBe(25);
  });

  it("returns zeroes rather than nulls for an empty organisation", async () => {
    const emptyOrg = await createOrg("Empty Org");
    const summary = await getDashboardSummary({ ...ctx, orgId: emptyOrg });
    expect(summary.totals).toMatchObject({
      assets: 0, active_assignments: 0, overdue: 0, maintenance: 0,
    });
    expect(Number(summary.totals.total_value)).toBe(0);
    expect(summary.utilisation.in_use_pct).toBe(0);
    expect(summary.by_status).toEqual([]);
    expect(summary.recent_activity).toEqual([]);
  });
});

describe("branch scope", () => {
  it("counts only the caller's branch", async () => {
    // A dashboard showing org-wide totals to someone whose register shows one
    // branch is not a summary of anything they can act on.
    const summary = await getDashboardSummary(scopedTo([headOfficeId]));
    expect(summary.totals.assets).toBe(2);
    expect(Number(summary.totals.total_value)).toBe(27_000_000);
  });

  it("scopes the breakdowns too", async () => {
    const summary = await getDashboardSummary(scopedTo([headOfficeId]));
    expect(summary.by_location.map((l) => l.location)).toEqual(["Head Office"]);
    expect(summary.by_category.map((c) => c.category)).toEqual(["IT"]);
  });

  it("scopes open assignments and utilisation", async () => {
    const summary = await getDashboardSummary(scopedTo([headOfficeId]));
    expect(summary.totals.active_assignments).toBe(0);
    expect(summary.totals.overdue).toBe(0);
    expect(summary.utilisation.in_use_pct).toBe(0);
  });

  it("shows the other branch its own figures", async () => {
    const summary = await getDashboardSummary(scopedTo([depotId]));
    expect(summary.totals.assets).toBe(2);
    expect(summary.totals.active_assignments).toBe(1);
    expect(summary.totals.maintenance).toBe(1);
  });
});

describe("the onboarding counts", () => {
  it("counts what has actually been set up, not what somebody ticked", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.setup.categories).toBeGreaterThan(0);
    expect(summary.setup.users).toBeGreaterThan(0);
  });

  it("counts assignments ever opened, not the ones open now", async () => {
    // A checklist item that un-ticks itself when the asset comes back would
    // tell a customer they had never checked anything out.
    const before = (await getDashboardSummary(ctx)).setup.checkouts;
    const asset = await createAsset(ctx, { name: "Counted Once" });
    await checkOut(ctx, asset.id, { assignee_type: "external", assignee_label: "Rina" });
    await checkIn(ctx, asset.id, {});
    const after = (await getDashboardSummary(ctx)).setup.checkouts;
    expect(after).toBe(before + 1);
  });

  it("does not count a dry run as an import", async () => {
    // A preview writes nothing, so claiming the register has been imported
    // would be a lie the customer cannot see through.
    expect((await getDashboardSummary(ctx)).setup.imports).toBe(0);
  });
});
