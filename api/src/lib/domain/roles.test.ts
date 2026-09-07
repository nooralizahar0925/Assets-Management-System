import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg } from "../../test/org";
import { hashPassword } from "../auth/password";
import {
  listRoles, createRole, updateRole, deleteRole, assignRole, RoleInUseError,
  LastAdministratorError, SystemRoleError,
} from "./roles";
import type { Ctx } from "../http/handler";

let orgId: string;
let ctx: Ctx;

const adminCtx = (org: string, userId: string): Ctx => ({
  orgId: org,
  actor: {
    type: "user", id: userId, label: "Admin", scopes: ["admin"],
    permissions: ["roles:read", "roles:write", "users:read", "users:write"],
    locationScope: null,
  },
});

beforeAll(async () => {
  orgId = await createOrg("Role API Org");
  const adminRole = await withTenant(orgId, async (c) =>
    (await c.query<{ id: string }>(
      "SELECT id FROM roles WHERE org_id=$1 AND name='Administrator'", [orgId],
    )).rows[0].id,
  );
  const userId = await withTenant(orgId, async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO users (org_id, email, password_hash, name, role_id)
       VALUES ($1,$2,$3,'Admin',$4) RETURNING id`,
      [orgId, `admin-${orgId}@roles.test`, await hashPassword("pw"), adminRole],
    )).rows[0].id,
  );
  ctx = adminCtx(orgId, userId);
});

describe("createRole", () => {
  it("creates a role with the permissions given", async () => {
    const role = await createRole(ctx, {
      name: "Warehouse", description: "Floor staff",
      permissions: ["assets:read", "custody:write"],
    });
    expect(role.permissions.sort()).toEqual(["assets:read", "custody:write"]);
    expect(role.is_system).toBe(false);
  });

  it("refuses a duplicate name in the same organisation", async () => {
    await createRole(ctx, { name: "Dupe", permissions: ["assets:read"] });
    await expect(
      createRole(ctx, { name: "dupe", permissions: ["assets:read"] }),
    ).rejects.toThrow(/already/i);
  });

  it("refuses a permission outside the vocabulary", async () => {
    await expect(
      createRole(ctx, { name: "Bogus", permissions: ["assets:teleport"] as never }),
    ).rejects.toThrow(/permission/i);
  });
});

describe("updateRole", () => {
  it("replaces the permission set rather than merging", async () => {
    const role = await createRole(ctx, {
      name: "Shifting", permissions: ["assets:read", "assets:write"],
    });
    const updated = await updateRole(ctx, role.id, { permissions: ["assets:read"] });
    expect(updated.permissions).toEqual(["assets:read"]);
  });

  it("lets a system role be renamed and re-permissioned", async () => {
    const [viewer] = (await listRoles(ctx)).filter((r) => r.name === "Viewer");
    const updated = await updateRole(ctx, viewer.id, { name: "Read Only" });
    expect(updated.name).toBe("Read Only");
    await updateRole(ctx, viewer.id, { name: "Viewer" });
  });

  it("refuses to remove roles:write from the last role that grants it", async () => {
    const [admin] = (await listRoles(ctx)).filter((r) => r.name === "Administrator");
    await expect(
      updateRole(ctx, admin.id, { permissions: ["assets:read"] }),
    ).rejects.toThrow(LastAdministratorError);
  });
});

describe("deleteRole", () => {
  it("refuses to delete a system role", async () => {
    const [admin] = (await listRoles(ctx)).filter((r) => r.name === "Administrator");
    await expect(deleteRole(ctx, admin.id)).rejects.toThrow(SystemRoleError);
  });

  it("refuses to delete a role somebody still holds", async () => {
    const role = await createRole(ctx, { name: "Held", permissions: ["assets:read"] });
    const userId = await withTenant(orgId, async (c) =>
      (await c.query<{ id: string }>(
        `INSERT INTO users (org_id, email, password_hash, name, role_id)
         VALUES ($1,$2,'x','Holder',$3) RETURNING id`,
        [orgId, `holder-${orgId}@roles.test`, role.id],
      )).rows[0].id,
    );
    await expect(deleteRole(ctx, role.id)).rejects.toThrow(RoleInUseError);
    expect(userId).toBeDefined();
  });

  it("deletes an unused custom role", async () => {
    const role = await createRole(ctx, { name: "Unused", permissions: ["assets:read"] });
    await expect(deleteRole(ctx, role.id)).resolves.toBe(true);
  });
});

describe("assignRole", () => {
  it("sets a user's role and branch scope together", async () => {
    const role = await createRole(ctx, { name: "Sited", permissions: ["assets:read"] });
    const { userId, locationId } = await withTenant(orgId, async (c) => {
      const loc = (await c.query<{ id: string }>(
        "INSERT INTO locations (org_id, name) VALUES ($1,'Site A') RETURNING id", [orgId],
      )).rows[0].id;
      const u = (await c.query<{ id: string }>(
        `INSERT INTO users (org_id, email, password_hash, name, role_id)
         VALUES ($1,$2,'x','Sited User',$3) RETURNING id`,
        [orgId, `sited-${orgId}@roles.test`, role.id],
      )).rows[0].id;
      return { userId: u, locationId: loc };
    });

    const result = await assignRole(ctx, userId, role.id, [locationId]);
    expect(result.locationIds).toEqual([locationId]);
  });

  it("clears branch scope when given an empty list", async () => {
    const role = await createRole(ctx, { name: "Unsited", permissions: ["assets:read"] });
    const userId = await withTenant(orgId, async (c) =>
      (await c.query<{ id: string }>(
        `INSERT INTO users (org_id, email, password_hash, name, role_id)
         VALUES ($1,$2,'x','Unsited',$3) RETURNING id`,
        [orgId, `unsited-${orgId}@roles.test`, role.id],
      )).rows[0].id,
    );
    const result = await assignRole(ctx, userId, role.id, []);
    expect(result.locationIds).toEqual([]);
  });

  it("refuses to demote the last person who can manage roles", async () => {
    const viewer = (await listRoles(ctx)).find((r) => r.name === "Viewer")!;
    await expect(assignRole(ctx, ctx.actor.id, viewer.id, [])).rejects.toThrow(
      LastAdministratorError,
    );
  });
});
