import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import type { Ctx } from "../http/handler";
import { createAsset, getAsset, updateAsset, softDeleteAsset } from "./assets";
import { createCategory } from "./categories";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";

let orgId: string;
let ctx: Ctx;
let categoryId: string;

beforeAll(async () => {
  orgId = await createOrg("Asset Org");
  const admin = await createUserWithRole(orgId, "Administrator");

  // A domain-level Ctx, built directly rather than resolved from a request:
  // these tests exercise the domain module, not the guard.
  ctx = {
    orgId,
    actor: {
      type: "user",
      id: admin.id,
      label: "Tester",
      scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };

  categoryId = (await createCategory(ctx, {
    name: "IT Equipment",
    kind: "it",
    field_schema: { fields: [
      { key: "os", label: "OS", type: "string", required: false },
      { key: "ram_gb", label: "RAM", type: "number", required: false },
    ] },
  })).id;
});

const auditFor = (assetId: string) =>
  withTenant(orgId, async (c) =>
    (await c.query<{ event: string; changes: Record<string, unknown> }>(
      "SELECT event, changes FROM audit_events WHERE asset_id = $1", [assetId],
    )).rows,
  );

describe("createAsset", () => {
  it("generates a sequential asset tag when none is supplied", async () => {
    const a = await createAsset(ctx, { name: "Laptop A", category_id: categoryId });
    const b = await createAsset(ctx, { name: "Laptop B", category_id: categoryId });
    expect(a.asset_tag).toMatch(/^AMS-\d{6}$/);
    expect(Number(b.asset_tag.slice(4))).toBe(Number(a.asset_tag.slice(4)) + 1);
  });

  it("defaults status to available", async () => {
    const a = await createAsset(ctx, { name: "Laptop C", category_id: categoryId });
    expect(a.status).toBe("available");
  });

  it("stores validated custom fields", async () => {
    const a = await createAsset(ctx, {
      name: "Laptop D", category_id: categoryId,
      custom: { os: "Ubuntu 24.04", ram_gb: 32 },
    });
    expect(a.custom).toEqual({ os: "Ubuntu 24.04", ram_gb: 32 });
  });

  it("rejects a custom field of the wrong type", async () => {
    await expect(createAsset(ctx, {
      name: "Laptop E", category_id: categoryId, custom: { ram_gb: "loads" },
    })).rejects.toThrow(/ram_gb/);
  });

  it("rejects a duplicate serial number in the same org", async () => {
    await createAsset(ctx, { name: "Unique", category_id: categoryId, serial_no: "SN-1" });
    await expect(createAsset(ctx, {
      name: "Clone", category_id: categoryId, serial_no: "SN-1",
    })).rejects.toMatchObject({ code: "23505" });
  });

  it("writes an asset.created audit event", async () => {
    const a = await createAsset(ctx, { name: "Audited", category_id: categoryId });
    expect((await auditFor(a.id)).map((r) => r.event)).toContain("asset.created");
  });
});

describe("updateAsset", () => {
  it("merges custom fields rather than replacing the object", async () => {
    const a = await createAsset(ctx, {
      name: "Merge me", category_id: categoryId,
      custom: { os: "Windows 11", ram_gb: 8 },
    });
    const updated = await updateAsset(ctx, a.id, { custom: { ram_gb: 16 } });
    expect(updated!.custom).toEqual({ os: "Windows 11", ram_gb: 16 });
  });

  it("records the before/after diff in the audit trail", async () => {
    const a = await createAsset(ctx, { name: "Before", category_id: categoryId });
    await updateAsset(ctx, a.id, { name: "After" });
    const updated = (await auditFor(a.id)).find((r) => r.event === "asset.updated");
    expect(updated?.changes).toMatchObject({ name: { from: "Before", to: "After" } });
  });

  it("returns null for an unknown id", async () => {
    await expect(updateAsset(ctx, randomUUID(), { name: "Ghost" })).resolves.toBeNull();
  });

  it("writes no audit event when nothing actually changed", async () => {
    const a = await createAsset(ctx, { name: "Unchanged", category_id: categoryId });
    await updateAsset(ctx, a.id, { name: "Unchanged" });
    const events = (await auditFor(a.id)).filter((r) => r.event === "asset.updated");
    expect(events).toHaveLength(0);
  });
});

describe("softDeleteAsset", () => {
  it("hides the asset from reads but keeps the row", async () => {
    const a = await createAsset(ctx, { name: "Doomed", category_id: categoryId });
    await expect(softDeleteAsset(ctx, a.id)).resolves.toBe(true);
    await expect(getAsset(ctx, a.id)).resolves.toBeNull();

    const rows = await withTenant(orgId, async (c) =>
      (await c.query<{ deleted_at: string | null }>(
        "SELECT deleted_at FROM assets WHERE id = $1", [a.id],
      )).rows,
    );
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("keeps the audit trail of a deleted asset", async () => {
    // Asset records are evidence. Deleting must not destroy the history.
    const a = await createAsset(ctx, { name: "Evidence", category_id: categoryId });
    await softDeleteAsset(ctx, a.id);
    const events = (await auditFor(a.id)).map((r) => r.event);
    expect(events).toContain("asset.created");
    expect(events).toContain("asset.deleted");
  });

  it("frees the asset tag for reuse", async () => {
    const a = await createAsset(ctx, {
      name: "Tagged", category_id: categoryId, asset_tag: "REUSE-1",
    });
    await softDeleteAsset(ctx, a.id);
    const b = await createAsset(ctx, {
      name: "Reused", category_id: categoryId, asset_tag: "REUSE-1",
    });
    expect(b.asset_tag).toBe("REUSE-1");
  });

  it("is not repeatable", async () => {
    const a = await createAsset(ctx, { name: "Once", category_id: categoryId });
    await expect(softDeleteAsset(ctx, a.id)).resolves.toBe(true);
    await expect(softDeleteAsset(ctx, a.id)).resolves.toBe(false);
  });
});
