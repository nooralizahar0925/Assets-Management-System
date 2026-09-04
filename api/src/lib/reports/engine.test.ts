import { describe, it, expect, beforeAll } from "vitest";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset } from "../domain/assets";
import { createCategory } from "../domain/categories";
import { createLocation } from "../domain/locations";
import { checkOut } from "../domain/assignments";
import { REPORTS, runReport, describeFilters } from "./engine";
import { renderCsv } from "./renderers/csv";

let orgId: string;
let userId: string;
let ctx: Ctx;
let itId: string;
let siteA: string;
let siteB: string;

const scopedTo = (locations: string[] | null): Ctx => ({
  ...ctx,
  actor: { ...ctx.actor, locationScope: locations },
});

beforeAll(async () => {
  orgId = await createOrg("Report Org");
  const rep = await createUserWithRole(orgId, "Manager", { name: "Rep" });
  userId = rep.id;
  ctx = {
    orgId,
    actor: {
      type: "user", id: userId, label: "Rep", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };

  itId = (await createCategory(ctx, {
    name: "IT", kind: "it",
    field_schema: { fields: [
      { key: "warranty_end", label: "Warranty", type: "date", required: false },
    ] },
  })).id;
  siteA = (await createLocation(ctx, { name: "Site A" })).id;
  siteB = (await createLocation(ctx, { name: "Site B" })).id;

  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await createAsset(ctx, {
    name: "Laptop A", category_id: itId, location_id: siteA,
    purchase_cost: 10_000_000, purchase_date: "2026-01-15",
    custom: { warranty_end: soon },
  });
  await createAsset(ctx, {
    name: "Laptop B", category_id: itId, location_id: siteA,
    purchase_cost: 20_000_000, purchase_date: "2026-02-20",
  });
  const issued = await createAsset(ctx, {
    name: "Tablet", category_id: itId, location_id: siteB,
  });
  await checkOut(ctx, issued.id, {
    assignee_type: "user", assignee_id: userId, due_at: "2026-08-01T00:00:00Z",
  });
});

describe("REPORTS", () => {
  it("registers every report in the catalogue", () => {
    expect(Object.keys(REPORTS).sort()).toEqual([
      "acquisition-value", "assets-by-category", "assets-by-location",
      "assets-by-status", "assignments-active", "assignments-overdue",
      "audit-activity", "expiring", "utilisation",
    ]);
  });

  it("gives every report a chart spec and typed columns", () => {
    for (const [key, def] of Object.entries(REPORTS)) {
      expect(def.columns.length, key).toBeGreaterThan(0);
      expect(def.chart, key).toHaveProperty("type");
      for (const column of def.columns) {
        expect(["string", "number", "date", "money", "percent"], key)
          .toContain(column.type);
      }
    }
  });

  it("points every chart at columns the report actually returns", () => {
    for (const [key, def] of Object.entries(REPORTS)) {
      if (def.chart.type === "none") continue;
      const keys = def.columns.map((c) => c.key);
      expect(keys, key).toContain(def.chart.categoryKey);
      for (const valueKey of def.chart.valueKeys) expect(keys, key).toContain(valueKey);
    }
  });

  it("runs every report without error, even with no matching data", async () => {
    // A report that throws on an empty register is a report nobody can open on
    // their first day.
    const emptyOrg = await createOrg("Empty Report Org");
    for (const key of Object.keys(REPORTS)) {
      const result = await runReport({ ...ctx, orgId: emptyOrg }, key, {});
      expect(Array.isArray(result.rows), key).toBe(true);
    }
  });
});

describe("runReport", () => {
  it("groups assets by status with counts", async () => {
    const result = await runReport(ctx, "assets-by-status", {});
    const available = result.rows.find((r) => r.status === "available");
    expect(available).toMatchObject({ count: 2 });
  });

  it("groups by category with a value total", async () => {
    const result = await runReport(ctx, "assets-by-category", {});
    const row = result.rows.find((r) => r.category === "IT");
    expect(row!.count).toBe(3);
    expect(Number(row!.value)).toBe(30_000_000);
  });

  it("returns a totals row where the report defines one", async () => {
    const result = await runReport(ctx, "assets-by-category", {});
    expect(result.totals).toMatchObject({ count: 3 });
  });

  it("lists only overdue assignments in the overdue report", async () => {
    const result = await runReport(ctx, "assignments-overdue", {});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].asset_name).toBe("Tablet");
    expect(Number(result.rows[0].days_late)).toBeGreaterThan(0);
  });

  it("honours the days parameter on the expiring report", async () => {
    const wide = await runReport(ctx, "expiring", { days: 90 });
    const narrow = await runReport(ctx, "expiring", { days: 7 });
    expect(wide.rows.length).toBeGreaterThan(narrow.rows.length);
  });

  it("filters by category", async () => {
    const other = await createCategory(ctx, {
      name: "Media", kind: "media", field_schema: { fields: [] },
    });
    const result = await runReport(ctx, "assets-by-status", { category_id: other.id });
    expect(result.rows).toHaveLength(0);
  });

  it("buckets acquisition value by month", async () => {
    const result = await runReport(ctx, "acquisition-value", {});
    expect(result.rows.map((r) => r.month)).toEqual(["2026-01", "2026-02"]);
    expect(Number(result.rows[1].value)).toBe(20_000_000);
  });

  it("carries the metadata a renderer needs", async () => {
    const result = await runReport(ctx, "assets-by-status", {});
    expect(result).toMatchObject({ key: "assets-by-status", name: expect.any(String) });
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.columns.length).toBeGreaterThan(0);
  });

  it("rejects an unknown report key", async () => {
    await expect(runReport(ctx, "not-a-report", {})).rejects.toThrow(/unknown report/i);
  });
});

describe("branch scope", () => {
  it("scopes an asset breakdown to the caller's branch", async () => {
    const result = await runReport(scopedTo([siteA]), "assets-by-location", {});
    expect(result.rows.map((r) => r.location)).toEqual(["Site A"]);
    expect(result.rows[0].count).toBe(2);
  });

  it("scopes the overdue report, which joins assignments to assets", async () => {
    // The Tablet is at Site B, so a Site A caller must not see it is late.
    const atA = await runReport(scopedTo([siteA]), "assignments-overdue", {});
    expect(atA.rows).toHaveLength(0);

    const atB = await runReport(scopedTo([siteB]), "assignments-overdue", {});
    expect(atB.rows).toHaveLength(1);
  });

  it("scopes the active assignment report", async () => {
    const atA = await runReport(scopedTo([siteA]), "assignments-active", {});
    expect(atA.rows).toHaveLength(0);
  });

  it("scopes the expiring report", async () => {
    const atA = await runReport(scopedTo([siteA]), "expiring", { days: 90 });
    const atB = await runReport(scopedTo([siteB]), "expiring", { days: 90 });
    expect(atA.rows.length).toBeGreaterThan(0);
    expect(atB.rows).toHaveLength(0);
  });

  it("scopes activity over time, which reads the audit trail", async () => {
    const unscoped = await runReport(ctx, "audit-activity", {});
    const scoped = await runReport(scopedTo([siteB]), "audit-activity", {});
    const total = (rows: { events: unknown }[]) =>
      rows.reduce((n, r) => n + Number(r.events), 0);
    expect(total(unscoped.rows as { events: unknown }[]))
      .toBeGreaterThan(total(scoped.rows as { events: unknown }[]));
  });

  it("scopes utilisation", async () => {
    const atA = await runReport(scopedTo([siteA]), "utilisation", {});
    expect(atA.rows.map((r) => r.name).sort()).toEqual(["Laptop A", "Laptop B"]);
  });
});

describe("describeFilters", () => {
  it("states the filter set in words for a report header", () => {
    expect(describeFilters({ days: 90 })).toBe("Next 90 days");
    expect(describeFilters({})).toBe("All assets");
    expect(describeFilters({ from: "2026-01-01", to: "2026-06-30" }))
      .toContain("1 Jan 2026");
  });
});

describe("renderCsv", () => {
  it("emits a header row of column labels", async () => {
    const result = await runReport(ctx, "assets-by-status", {});
    const body = await renderCsv(result).text();
    expect(body.split("\n")[0]).toBe("Status,Assets,Value");
  });

  it("quotes a value containing a comma", async () => {
    const result = await runReport(ctx, "assets-by-status", {});
    result.rows.push({ status: "Odd, name", count: 1, value: "0" });
    const body = await renderCsv(result).text();
    expect(body).toContain('"Odd, name"');
  });

  it("escapes an embedded quote by doubling it", async () => {
    const result = await runReport(ctx, "assets-by-status", {});
    result.rows.push({ status: 'He said "hi"', count: 1, value: "0" });
    expect(await renderCsv(result).text()).toContain('"He said ""hi"""');
  });

  it("writes the totals row when the report has one", async () => {
    const result = await runReport(ctx, "assets-by-category", {});
    const lines = (await renderCsv(result).text()).trim().split("\n");
    expect(lines[lines.length - 1]).toContain("Total");
  });

  it("sets a downloadable content type and filename", async () => {
    const res = renderCsv(await runReport(ctx, "assets-by-status", {}));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("assets-by-status");
  });
});
