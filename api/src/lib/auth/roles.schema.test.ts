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

describe("the retired users.role column", () => {
  it("is gone, along with the type it used", async () => {
    // Migration 021 completed the add-backfill-switch-drop cycle that 008
    // started. A column nothing reads is not harmless: the next person to see
    // it writes to it, and then two places disagree about what a user is.
    const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    try {
      const column = await owner.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'users' AND column_name = 'role'`,
      );
      expect(column.rowCount).toBe(0);

      const type = await owner.query(
        "SELECT 1 FROM pg_type WHERE typname = 'user_role'",
      );
      expect(type.rowCount).toBe(0);
    } finally {
      await owner.end();
    }
  });

  it("leaves a user with no role holding no permissions at all", async () => {
    // The safe failure. Nothing now infers a permission from anywhere but
    // role_id, so an unassigned user can do nothing rather than quietly
    // inheriting whatever the enum used to say.
    const email = `roleless-${orgA}@roles.test`;
    const id = await withTenant(orgA, async (c) =>
      (await c.query<{ id: string }>(
        `INSERT INTO users (org_id, email, password_hash, name)
         VALUES ($1, $2, 'x', 'Roleless') RETURNING id`,
        [orgA, email],
      )).rows[0].id,
    );

    const permissions = await withTenant(orgA, async (c) =>
      (await c.query("SELECT * FROM auth_lookup_permissions($1)", [id])).rows,
    );
    expect(permissions).toEqual([]);
  });
});
