import { describe, it, expect, beforeAll } from "vitest";
import { Client, type QueryResultRow } from "pg";
import { seed, SEED_USERS, SEED_STRAINED, invokedAsScript } from "./seed";
import { needsAttention } from "../src/lib/platform/attention";

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
  await query("DELETE FROM organizations WHERE slug = ANY($1)",
    [["demo", SEED_STRAINED.slug]]);
  await query("DELETE FROM platform_admins WHERE lower(email) = lower($1)",
    [SEED_STRAINED.operator]);
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

describe("what the seed leaves for the platform console", () => {
  // Without these the console opens onto an empty page: no operator to sign in
  // as, no customer on a plan, and a "needs attention" list with nothing on it.
  // A console nobody can demonstrate is a console nobody checks.

  it("creates the operator account the console is opened with", async () => {
    const rows = await query<{ n: number }>(
      "SELECT count(*)::int AS n FROM platform_admins WHERE lower(email) = lower($1)",
      [SEED_STRAINED.operator],
    );
    expect(rows[0].n).toBe(1);
  });

  it("puts the demo organisation on a plan", async () => {
    // With no plan it is entitled to the register and nothing else, so half the
    // interface is hidden and the demo shows less than the product does.
    const rows = await query<{ plan_code: string | null }>(
      "SELECT plan_code FROM organizations WHERE id = $1", [orgId],
    );
    expect(rows[0].plan_code).toBe("professional");
  });

  it("creates a second customer, so the list is a list", async () => {
    const rows = await query<{ plan_code: string | null }>(
      "SELECT plan_code FROM organizations WHERE slug = $1", [SEED_STRAINED.slug],
    );
    expect(rows[0]?.plan_code).toBe("starter");
  });

  it("leaves that customer over a limit and days from the end of a trial",
    async () => {
      // Both of the things an operator would actually ring somebody about, on
      // one customer, visible the moment the console is opened.
      const rows = await query<{ id: string }>(
        "SELECT id FROM organizations WHERE slug = $1", [SEED_STRAINED.slug],
      );
      const item = (await needsAttention())
        .find((candidate) => candidate.org_id === rows[0].id);

      expect(item).toBeDefined();
      expect(item!.reasons.map((r) => r.kind).sort())
        .toEqual(["over-limit", "trial-ending"]);
    });

  it("never resets the operator password on a later run", async () => {
    // The one row in this database that is somebody's live credential. A seed
    // left in a start-up script that reset it on every boot would hand the
    // whole deployment back to whoever last read the default.
    const before = await query<{ password_hash: string }>(
      "SELECT password_hash FROM platform_admins WHERE lower(email) = lower($1)",
      [SEED_STRAINED.operator],
    );
    await seed();
    const after = await query<{ password_hash: string }>(
      "SELECT password_hash FROM platform_admins WHERE lower(email) = lower($1)",
      [SEED_STRAINED.operator],
    );

    expect(after[0].password_hash).toBe(before[0].password_hash);
  }, 60_000);

  it("gives that customer somebody who can sign in", async () => {
    const rows = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users u
         JOIN organizations o ON o.id = u.org_id
        WHERE o.slug = $1 AND u.role_id IS NOT NULL`,
      [SEED_STRAINED.slug],
    );
    expect(rows[0].n).toBeGreaterThan(0);
  });
});

describe("running the seed as a script", () => {
  it("recognises the bundle a real deployment runs", () => {
    // `npm run seed:prod` runs dist-scripts/seed.js. A guard that only knew
    // about seed.ts made that command exit zero having done nothing at all -
    // no output, no rows, and no way to tell from the outside. It is the
    // command docs/deployment.md tells an operator to run.
    expect(invokedAsScript("dist-scripts/seed.js")).toBe(true);
    expect(invokedAsScript("/app/dist-scripts/seed.js")).toBe(true);
    // Doubled, or the escapes eat the separators and this asserts nothing.
    expect(invokedAsScript("C:\\app\\dist-scripts\\seed.js")).toBe(true);
  });

  it("recognises the TypeScript a developer runs", () => {
    expect(invokedAsScript("scripts/seed.ts")).toBe(true);
    expect(invokedAsScript("seed.ts")).toBe(true);
  });

  it("does not fire for anything else", () => {
    // Importing this module from a test must not seed, and must certainly not
    // call process.exit in the middle of a suite.
    expect(invokedAsScript(undefined)).toBe(false);
    expect(invokedAsScript("/usr/lib/node_modules/vitest/vitest.mjs")).toBe(false);
    expect(invokedAsScript("scripts/seed-permissions.ts")).toBe(false);
    expect(invokedAsScript("scripts/reseed.js")).toBe(false);
  });
});
