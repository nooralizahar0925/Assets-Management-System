import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "pg";
import { withTenant } from "../db";
import { createOrg } from "../../test/org";
import { SYSTEM_ROLES } from "./permissions";
import { seedRolesForOrg } from "../../../scripts/seed-permissions";

let orgA: string;
let orgB: string;

beforeAll(async () => {
  orgA = await createOrg("Roles Org A");
  orgB = await createOrg("Roles Org B");
});

describe("roles are tenant data", () => {
  it("gives a new organisation its own copy of the system roles", async () => {
    const names = await withTenant(orgA, async (c) =>
      (await c.query<{ name: string }>("SELECT name FROM roles ORDER BY name")).rows,
    );
    expect(names.map((r) => r.name)).toEqual(Object.keys(SYSTEM_ROLES).sort());
  });

  it("hides one company's custom role from another", async () => {
    await withTenant(orgA, (c) =>
      c.query(
        "INSERT INTO roles (org_id, name, description) VALUES ($1, 'Night Shift', 'x')",
        [orgA],
      ),
    );
    const seenByB = await withTenant(orgB, async (c) =>
      (await c.query("SELECT name FROM roles WHERE name = 'Night Shift'")).rows,
    );
    expect(seenByB).toHaveLength(0);
  });

  it("lets two companies use the same role name independently", async () => {
    // Names are unique per organisation, not globally.
    for (const org of [orgA, orgB]) {
      await withTenant(org, (c) =>
        c.query("INSERT INTO roles (org_id, name) VALUES ($1, 'Auditor')", [org]),
      );
    }
    const inB = await withTenant(orgB, async (c) =>
      (await c.query("SELECT name FROM roles WHERE name = 'Auditor'")).rows,
    );
    expect(inB).toHaveLength(1);
  });

  it("refuses a duplicate role name within one company, case-insensitively", async () => {
    await expect(
      withTenant(orgA, async (c) => {
        await c.query("INSERT INTO roles (org_id, name) VALUES ($1, 'Duplicated')", [orgA]);
        await c.query("INSERT INTO roles (org_id, name) VALUES ($1, 'duplicated')", [orgA]);
      }),
    ).rejects.toThrow(/roles_org_name_idx|duplicate key/i);
  });

  it("marks the seeded roles as system roles", async () => {
    const rows = await withTenant(orgA, async (c) =>
      (await c.query<{ is_system: boolean }>(
        "SELECT is_system FROM roles WHERE name = 'Administrator'",
      )).rows,
    );
    expect(rows[0].is_system).toBe(true);
  });

  it("refuses to delete a system role", async () => {
    await expect(
      withTenant(orgA, (c) =>
        c.query("DELETE FROM roles WHERE name = 'Administrator'"),
      ),
    ).rejects.toThrow(/system role/i);
  });

  it("allows deleting a custom role", async () => {
    await withTenant(orgA, async (c) => {
      await c.query("INSERT INTO roles (org_id, name) VALUES ($1, 'Temporary')", [orgA]);
      const { rowCount } = await c.query(
        "DELETE FROM roles WHERE name = 'Temporary'",
      );
      expect(rowCount).toBe(1);
    });
  });

  it("refuses a role permission that is not in the vocabulary", async () => {
    await expect(
      withTenant(orgA, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "SELECT id FROM roles WHERE name = 'Viewer'",
        );
        await c.query(
          `INSERT INTO role_permissions (org_id, role_id, permission_key)
           VALUES ($1, $2, 'assets:teleport')`,
          [orgA, rows[0].id],
        );
      }),
    ).rejects.toThrow(/foreign key|permission/i);
  });
});

describe("the users.role backfill", () => {
  it("gives a user carrying only the legacy enum a role_id when it runs", async () => {
    // The real scenario: users existed before 008, holding users.role and no
    // role_id. The backfill is part of seedRolesForOrg and is idempotent, so
    // running it again after inserting such a user reproduces the migration.
    const email = `backfill-${orgA}@roles.test`;

    await withTenant(orgA, (c) =>
      c.query(
        `INSERT INTO users (org_id, email, password_hash, name, role)
         VALUES ($1, $2, 'x', 'Backfilled', 'technician')`,
        [orgA, email],
      ),
    );

    const before = await withTenant(orgA, async (c) =>
      (await c.query<{ role_id: string | null }>(
        "SELECT role_id FROM users WHERE email = $1", [email],
      )).rows[0],
    );
    expect(before.role_id).toBeNull();

    const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    try {
      await seedRolesForOrg(owner, orgA);
    } finally {
      await owner.end();
    }

    const after = await withTenant(orgA, async (c) =>
      (await c.query<{ name: string | null }>(
        `SELECT r.name FROM users u LEFT JOIN roles r ON r.id = u.role_id
          WHERE u.email = $1`,
        [email],
      )).rows[0],
    );
    expect(after.name).toBe("Technician");
  });

  it("does not overwrite a role_id that is already set", async () => {
    // The backfill runs on every migrate, so it must never undo an assignment
    // an administrator made through the API.
    const email = `assigned-${orgA}@roles.test`;
    const viewerId = await withTenant(orgA, async (c) =>
      (await c.query<{ id: string }>(
        "SELECT id FROM roles WHERE org_id = $1 AND name = 'Viewer'", [orgA],
      )).rows[0].id,
    );

    await withTenant(orgA, (c) =>
      c.query(
        `INSERT INTO users (org_id, email, password_hash, name, role, role_id)
         VALUES ($1, $2, 'x', 'Assigned', 'admin', $3)`,
        [orgA, email, viewerId],
      ),
    );

    const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    try {
      await seedRolesForOrg(owner, orgA);
    } finally {
      await owner.end();
    }

    const after = await withTenant(orgA, async (c) =>
      (await c.query<{ name: string }>(
        `SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id
          WHERE u.email = $1`,
        [email],
      )).rows[0],
    );
    // The enum says admin; the explicit assignment says Viewer and must win.
    expect(after.name).toBe("Viewer");
  });
});
