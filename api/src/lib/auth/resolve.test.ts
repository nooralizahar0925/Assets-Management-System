import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg } from "../../test/org";
import { hashPassword } from "./password";
import { permissionsForUser } from "./resolve";

let orgId: string;
let adminId: string;
let techId: string;
let scopedId: string;
let jakarta: string;
let bekasi: string;

async function roleId(org: string, name: string): Promise<string> {
  return withTenant(org, async (c) =>
    (await c.query<{ id: string }>(
      "SELECT id FROM roles WHERE org_id = $1 AND name = $2", [org, name],
    )).rows[0].id,
  );
}

async function createUser(org: string, name: string, role: string): Promise<string> {
  const rid = await roleId(org, role);
  return withTenant(org, async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO users (org_id, email, password_hash, name, role_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [org, `${name}-${org}@resolve.test`, await hashPassword("pw"), name, rid],
    )).rows[0].id,
  );
}

beforeAll(async () => {
  orgId = await createOrg("Resolve Org");
  [jakarta, bekasi] = await withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO locations (org_id, name) VALUES ($1,'Jakarta'), ($1,'Bekasi')
       RETURNING id`,
      [orgId],
    );
    return [rows[0].id, rows[1].id];
  });

  adminId = await createUser(orgId, "admin", "Administrator");
  techId = await createUser(orgId, "tech", "Technician");
  scopedId = await createUser(orgId, "scoped", "Technician");

  await withTenant(orgId, (c) =>
    c.query(
      `INSERT INTO user_location_scopes (org_id, user_id, location_id)
       VALUES ($1, $2, $3)`,
      [orgId, scopedId, bekasi],
    ),
  );
});

describe("permissionsForUser", () => {
  it("resolves an administrator to every permission", async () => {
    const { permissions } = await permissionsForUser(adminId);
    expect(permissions).toContain("roles:write");
    expect(permissions).toContain("assets:delete");
    expect(permissions).toContain("settings:write");
  });

  it("resolves a technician to their role's grants and no more", async () => {
    const { permissions } = await permissionsForUser(techId);
    expect(permissions).toContain("assets:write");
    expect(permissions).toContain("custody:write");
    expect(permissions).not.toContain("roles:write");
    expect(permissions).not.toContain("users:write");
  });

  it("reports an unscoped user as organisation-wide", async () => {
    const { locationScope } = await permissionsForUser(techId);
    expect(locationScope).toBeNull();
  });

  it("reports a scoped user's branches", async () => {
    const { locationScope } = await permissionsForUser(scopedId);
    expect(locationScope).toEqual([bekasi]);
  });

  it("does not widen a scoped user's permissions", async () => {
    // Branch scope narrows where a permission applies; it never adds one.
    const scoped = await permissionsForUser(scopedId);
    const unscoped = await permissionsForUser(techId);
    expect([...scoped.permissions].sort()).toEqual([...unscoped.permissions].sort());
  });

  it("resolves a user with no role to no permissions at all", async () => {
    const orphan = await withTenant(orgId, async (c) =>
      (await c.query<{ id: string }>(
        `INSERT INTO users (org_id, email, password_hash, name)
         VALUES ($1, $2, 'x', 'Orphan') RETURNING id`,
        [orgId, `orphan-${orgId}@resolve.test`],
      )).rows[0].id,
    );
    const { permissions } = await permissionsForUser(orphan);
    expect(permissions).toEqual([]);
  });

  it("follows a change to the role immediately", async () => {
    // Permissions are resolved per request, not baked into the session, so
    // revoking a grant takes effect on the next call rather than at next login.
    const before = await permissionsForUser(techId);
    expect(before.permissions).toContain("labels:print");

    const rid = await roleId(orgId, "Technician");
    await withTenant(orgId, (c) =>
      c.query(
        "DELETE FROM role_permissions WHERE role_id = $1 AND permission_key = 'labels:print'",
        [rid],
      ),
    );

    const after = await permissionsForUser(techId);
    expect(after.permissions).not.toContain("labels:print");

    await withTenant(orgId, (c) =>
      c.query(
        `INSERT INTO role_permissions (org_id, role_id, permission_key)
         VALUES ($1, $2, 'labels:print')`,
        [orgId, rid],
      ),
    );
  });
});
