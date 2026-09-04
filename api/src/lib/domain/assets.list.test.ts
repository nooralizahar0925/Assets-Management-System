import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset, listAssets } from "./assets";
import { createCategory } from "./categories";

let orgId: string;
let ctx: Ctx;
let itId: string;
let plantId: string;
let jakarta: string;
let bekasi: string;

const page = { page: 1, perPage: 50, offset: 0 };
const sort = { column: "name", direction: "ASC" as const };

const ctxScopedTo = (locations: string[] | null): Ctx => ({
  ...ctx,
  actor: { ...ctx.actor, locationScope: locations },
});

beforeAll(async () => {
  orgId = await createOrg("List Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  ctx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "T", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };

  [jakarta, bekasi] = await withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO locations (org_id, name) VALUES ($1,'Jakarta'), ($1,'Bekasi')
       RETURNING id`,
      [orgId],
    );
    return [rows[0].id, rows[1].id];
  });

  itId = (await createCategory(ctx, {
    name: "IT", kind: "it",
    field_schema: { fields: [{ key: "os", label: "OS", type: "string", required: false }] },
  })).id;
  plantId = (await createCategory(ctx, {
    name: "Plant", kind: "equipment", field_schema: { fields: [] },
  })).id;

  await createAsset(ctx, { name: "Dell Latitude 5540", category_id: itId,
    serial_no: "DL5540-001", status: "in_use", location_id: jakarta,
    custom: { os: "Windows 11" } });
  await createAsset(ctx, { name: "MacBook Pro 16", category_id: itId,
    serial_no: "MBP16-002", status: "available", location_id: bekasi,
    custom: { os: "macOS" } });
  await createAsset(ctx, { name: "Cummins Generator", category_id: plantId,
    serial_no: "GEN-003", status: "maintenance", location_id: bekasi });
});

describe("listAssets", () => {
  it("returns everything with no filters", async () => {
    const { rows, total } = await listAssets(ctx, {}, page, sort);
    expect(total).toBe(3);
    expect(rows).toHaveLength(3);
  });

  it("matches a partial name, case-insensitively", async () => {
    const { rows } = await listAssets(ctx, { q: "macbook" }, page, sort);
    expect(rows.map((r) => r.name)).toEqual(["MacBook Pro 16"]);
  });

  it("matches on serial number", async () => {
    const { rows } = await listAssets(ctx, { q: "GEN-003" }, page, sort);
    expect(rows[0].name).toBe("Cummins Generator");
  });

  it("matches on asset tag", async () => {
    const all = await listAssets(ctx, {}, page, sort);
    const tag = all.rows[0].asset_tag;
    const { rows } = await listAssets(ctx, { q: tag }, page, sort);
    expect(rows.map((r) => r.asset_tag)).toContain(tag);
  });

  it("filters by a single status", async () => {
    const { rows } = await listAssets(ctx, { status: ["available"] }, page, sort);
    expect(rows.map((r) => r.status)).toEqual(["available"]);
  });

  it("filters by several statuses at once", async () => {
    const { total } = await listAssets(ctx, { status: ["available", "in_use"] }, page, sort);
    expect(total).toBe(2);
  });

  it("filters by category", async () => {
    const { total } = await listAssets(ctx, { categoryId: itId }, page, sort);
    expect(total).toBe(2);
  });

  it("filters by location", async () => {
    const { total } = await listAssets(ctx, { locationId: bekasi }, page, sort);
    expect(total).toBe(2);
  });

  it("filters on a custom JSONB field", async () => {
    const { rows } = await listAssets(ctx, { custom: { os: "macOS" } }, page, sort);
    expect(rows.map((r) => r.name)).toEqual(["MacBook Pro 16"]);
  });

  it("combines a search term with a status filter", async () => {
    const { total } = await listAssets(ctx, { q: "o", status: ["maintenance"] }, page, sort);
    expect(total).toBe(1);
  });

  it("sorts descending when asked", async () => {
    const { rows } = await listAssets(ctx, {}, page, { column: "name", direction: "DESC" });
    expect(rows[0].name).toBe("MacBook Pro 16");
  });

  it("paginates and reports the unpaginated total", async () => {
    const { rows, total } = await listAssets(ctx, {}, { page: 2, perPage: 2, offset: 2 }, sort);
    expect(total).toBe(3);
    expect(rows).toHaveLength(1);
  });
});

describe("branch scope in list queries", () => {
  it("shows everything to an unscoped caller", async () => {
    const { total } = await listAssets(ctxScopedTo(null), {}, page, sort);
    expect(total).toBe(3);
  });

  it("shows a scoped caller only their branch", async () => {
    const { rows, total } = await listAssets(ctxScopedTo([bekasi]), {}, page, sort);
    expect(total).toBe(2);
    expect(rows.map((r) => r.name).sort()).toEqual([
      "Cummins Generator", "MacBook Pro 16",
    ]);
  });

  it("scopes the total, not just the page", async () => {
    // A total that ignored the scope would leak how many assets exist
    // elsewhere, and would page past the end of what the caller can see.
    const { total } = await listAssets(
      ctxScopedTo([jakarta]), {}, { page: 1, perPage: 1, offset: 0 }, sort,
    );
    expect(total).toBe(1);
  });

  it("intersects branch scope with an explicit location filter", async () => {
    // Asking for Jakarta while scoped to Bekasi must return nothing, not
    // Jakarta's assets.
    const { total } = await listAssets(
      ctxScopedTo([bekasi]), { locationId: jakarta }, page, sort,
    );
    expect(total).toBe(0);
  });

  it("hides assets with no location from a scoped caller", async () => {
    await createAsset(ctx, { name: "Unplaced Thing", category_id: itId });
    const { rows } = await listAssets(ctxScopedTo([bekasi, jakarta]), {}, page, sort);
    expect(rows.map((r) => r.name)).not.toContain("Unplaced Thing");
    // ...but an unscoped caller still sees it.
    const all = await listAssets(ctxScopedTo(null), {}, page, sort);
    expect(all.rows.map((r) => r.name)).toContain("Unplaced Thing");
  });
});

describe("soft deletion", () => {
  it("excludes soft-deleted assets", async () => {
    const before = (await listAssets(ctx, {}, page, sort)).total;
    await withTenant(orgId, (c) =>
      c.query(
        "UPDATE assets SET deleted_at = now() WHERE name = 'Cummins Generator'",
      ),
    );
    const { total } = await listAssets(ctx, {}, page, sort);
    expect(total).toBe(before - 1);
  });
});
