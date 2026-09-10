import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { seedRolesForOrg } from "../../scripts/seed-permissions";

/**
 * Provisions a tenant for a test.
 *
 * Creating an organisation is a bootstrap operation, not a tenant operation, so
 * fixtures use the owner connection - the same way the seed script and the
 * sign-up path do. Migration 004 revokes INSERT, UPDATE and DELETE on
 * organizations from ams_app outright, which is what actually prevents the
 * application from doing this.
 *
 * (An earlier comment here claimed the absent WITH CHECK was what blocked it.
 * That is wrong: when a policy has no WITH CHECK, Postgres uses its USING
 * expression as the check, so ams_app inside withTenant could have inserted an
 * organization whose id matched its own org. The revoked grant is the real
 * boundary.)
 */
export async function createOrg(name = "Test Org"): Promise<string> {
  const id = randomUUID();
  const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
  try {
    // The slug carries the run's random id so a re-run cannot collide with the
    // previous run's row and silently leave the fixture missing.
    // On a plan that includes everything, because that is what a customer
    // looks like: a fixture with no plan has only the register, and every
    // test of a sold feature would fail with "not included in this plan"
    // rather than testing what it means to. Tests that care about
    // entitlements set their own plan.
    await owner.query(
      `INSERT INTO organizations (id, name, slug, plan_code)
       VALUES ($1::uuid, $2, $3,
               (SELECT code FROM plans WHERE code = 'enterprise'))`,
      [id, name, `org-${id}`],
    );
    // A real organisation gets the system roles at sign-up, so a fixture that
    // skipped them would test a world no customer ever sees.
    await seedRolesForOrg(owner, id);
  } finally {
    await owner.end();
  }
  return id;
}

export interface TestUser {
  id: string;
  email: string;
}

/**
 * Creates a user holding one of the seeded system roles.
 *
 * Permissions resolve from role_id alone. A fixture whose role name does not
 * match a seeded role produces a user with no permissions at all, which is a
 * confusing way for an unrelated test to fail - so the name is checked.
 */
export async function createUserWithRole(
  orgId: string,
  roleName: string,
  opts: { name?: string; email?: string; password?: string } = {},
): Promise<TestUser> {
  const { hashPassword } = await import("../lib/auth/password");
  const { withTenant } = await import("../lib/db");

  const email = opts.email ?? `${roleName.toLowerCase()}-${randomUUID()}@test.local`;
  const name = opts.name ?? String(roleName);
  const passwordHash = await hashPassword(opts.password ?? "pw");

  const id = await withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "SELECT id FROM roles WHERE org_id = $1 AND lower(name) = lower($2)",
      [orgId, roleName],
    );
    const roleId = rows[0]?.id;
    if (!roleId) {
      throw new Error(
        `No role named "${roleName}" in this organisation. A user without a ` +
          "role has no permissions, and every assertion in the test would " +
          "fail for that reason rather than the one being tested.",
      );
    }

    const inserted = await c.query<{ id: string }>(
      `INSERT INTO users (org_id, email, password_hash, name, role_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orgId, email, passwordHash, name, roleId],
    );
    return inserted.rows[0].id;
  });

  return { id, email };
}
