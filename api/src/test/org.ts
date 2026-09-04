import { Client } from "pg";
import { randomUUID } from "node:crypto";

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
    await owner.query(
      "INSERT INTO organizations (id, name, slug) VALUES ($1::uuid, $2, $3)",
      [id, name, `org-${id}`],
    );
  } finally {
    await owner.end();
  }
  return id;
}
