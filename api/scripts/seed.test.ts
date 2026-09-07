import { describe, it, expect, beforeAll } from "vitest";
import { Client, type QueryResultRow } from "pg";
import { seed, SEED_USERS } from "./seed";

/**
 * The seed is the first thing a new developer runs and the last thing anybody
 * looks at again. It was previously proved by a script run by hand, which is
 * the same as not being proved: the register it produces is what the dashboard,
 * the charts and every report are judged on the first time somebody sees them.
 */

let orgId: string;

async function query<T extends QueryResultRow>(
  sql: string, values: unknown[] = [],
): Promise<T[]> {
  const owner = new Client({
    connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  });
  await owner.connect();
  try {
    return (await owner.query<T>(sql, values)).rows;
  } finally {
    await owner.end();
  }
}

const count = async (table: string): Promise<number> => {
  const rows = await query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [orgId],
  );
  return rows[0].n;
};

beforeAll(async () => {
  // The seed is idempotent by design, so a demo organisation left behind by an
  // earlier run would be measured instead of a fresh one - and the test would
  // pass or fail on data this version never produced. Every tenant table
  // references organizations ON DELETE CASCADE.
  await query("DELETE FROM organizations WHERE slug = $1", ["demo"]);
  ({ orgId } = await seed());
}, 60_000);

describe("the demo seed", () => {
  it("creates a register with enough in it to be worth looking at", async () => {
    expect(await count("assets")).toBeGreaterThan(20);
    expect(await count("categories")).toBeGreaterThan(2);
    expect(await count("locations")).toBeGreaterThan(3);
  });

  it("puts assets in every status, so no chart is empty", async () => {
    // A seed where everything is "available" makes the status donut a circle
    // and the whole dashboard look broken on first sight.
    const rows = await query<{ status: string }>(
      "SELECT DISTINCT status::text AS status FROM assets WHERE org_id = $1", [orgId],
    );
    expect(rows.map((r) => r.status).sort())
      .toEqual(["available", "in_use", "lost", "maintenance", "retired"]);
  });

  it("creates one account per role", async () => {
    expect(Object.keys(SEED_USERS).sort())
      .toEqual(["admin", "manager", "technician", "viewer"]);

    const rows = await query<{ email: string }>(
      "SELECT email FROM users WHERE org_id = $1 ORDER BY email", [orgId],
    );
    expect(rows.map((r) => r.email).sort())
      .toEqual(Object.values(SEED_USERS).slice().sort());
  });

  it("gives every account a role that actually grants something", async () => {
    // A user with role_id null has no permissions at all, and every screen
    // tells them they are not allowed - which reads as a broken product.
    const rows = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users u
        WHERE u.org_id = $1
          AND (u.role_id IS NULL
               OR NOT EXISTS (SELECT 1 FROM role_permissions rp
                               WHERE rp.role_id = u.role_id))`,
      [orgId],
    );
    expect(rows[0].n).toBe(0);
  });

  it("leaves an assignment overdue, so the overdue report has something to show", async () => {
    const rows = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM assignments
        WHERE org_id = $1 AND checked_in_at IS NULL AND due_at < now()`,
      [orgId],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it("gives the organisation its notification rules", async () => {
    expect(await count("notification_rules")).toBeGreaterThan(5);
  });

  it("does not double the data when run again", async () => {
    // It is run repeatedly in development and before the smoke suite. Two
    // copies of the demo register would be noticed slowly and confusingly.
    const before = await count("assets");
    const again = await seed();

    expect(again.seeded).toBe(false);
    expect(again.orgId).toBe(orgId);
    expect(await count("assets")).toBe(before);
  }, 60_000);
});
