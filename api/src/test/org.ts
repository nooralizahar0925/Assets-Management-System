import { Client } from "pg";
import { randomUUID } from "node:crypto";

/**
 * Provisions a tenant for a test.
 *
 * Creating an organisation is a bootstrap operation, not a tenant operation:
 * organizations has FORCE ROW LEVEL SECURITY and its policy has no WITH CHECK,
 * so the ams_app role cannot insert one. Fixtures therefore use the owner
 * connection, the same way the seed script and the sign-up path do.
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
