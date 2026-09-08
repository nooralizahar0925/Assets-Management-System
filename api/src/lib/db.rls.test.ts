import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "pg";
import { pool, withTenant } from "./db";
import { randomUUID } from "node:crypto";

const orgA = randomUUID();
const orgB = randomUUID();

beforeAll(async () => {
  // Creating a tenant is a bootstrap operation, not a tenant operation. The
  // ams_app role deliberately cannot do it: organizations has FORCE ROW LEVEL
  // SECURITY and its policy has no WITH CHECK, so an app-role insert is denied.
  // Provisioning therefore runs over the owner connection, as it does in the
  // seed script and the sign-up path.
  const owner = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ??
      "postgres://ams:ams@localhost:5433/ams_test",
  });
  await owner.connect();
  // The slug is derived from the run's random id. A fixed slug would collide
  // with the previous run's row, ON CONFLICT DO NOTHING would skip the insert,
  // and every assertion below would fail against an org that does not exist.
  await owner.query(
    `INSERT INTO organizations (id, name, slug) VALUES
       ($1::uuid, 'Org A', 'org-a-' || $1::text),
       ($2::uuid, 'Org B', 'org-b-' || $2::text)`,
    [orgA, orgB],
  );
  await owner.end();
});

describe("row-level security", () => {
  it("hides another tenant's assets", async () => {
    await withTenant(orgA, (c) =>
      c.query(
        `INSERT INTO assets (org_id, asset_tag, name, status)
         VALUES ($1, 'A-1', 'Org A laptop', 'available')`,
        [orgA],
      ),
    );

    const seenByA = await withTenant(orgA, async (c) =>
      (await c.query("SELECT asset_tag FROM assets")).rows,
    );
    const seenByB = await withTenant(orgB, async (c) =>
      (await c.query("SELECT asset_tag FROM assets")).rows,
    );

    expect(seenByA.map((r) => r.asset_tag)).toContain("A-1");
    expect(seenByB).toHaveLength(0);
  });

  it("refuses to write a row belonging to another tenant", async () => {
    await expect(
      withTenant(orgA, (c) =>
        c.query(
          `INSERT INTO assets (org_id, asset_tag, name, status)
           VALUES ($1, 'X-1', 'smuggled', 'available')`,
          [orgB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

// Spec §11 — these tables carry no MVP behaviour, but the constraint that makes
// rental safe must be proven the day it is created, not the day it is used.
describe("rental-ready schema", () => {
  it("refuses two overlapping live reservations for one asset", async () => {
    // The assertion is on the Postgres error's code and constraint name, not on
    // a string match. An earlier version matched /reservations_no_double_book/
    // against the thrown value inside a catch — but a failing assertion's own
    // message contains that same text, so the test passed even when the
    // constraint was absent. It was verified vacuous by renaming the constraint
    // in the regex and watching it still pass.
    const err = await withTenant(orgA, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO assets (org_id, asset_tag, name, status)
         VALUES ($1, 'RES-1', 'Scaffold tower', 'available') RETURNING id`,
        [orgA],
      );
      const assetId = rows[0].id;
      await c.query(
        `INSERT INTO reservations (org_id, asset_id, period, state)
         VALUES ($1, $2, tstzrange('2026-10-12', '2026-10-19'), 'confirmed')`,
        [orgA, assetId],
      );
      try {
        await c.query(
          `INSERT INTO reservations (org_id, asset_id, period, state)
           VALUES ($1, $2, tstzrange('2026-10-15', '2026-10-22'), 'held')`,
          [orgA, assetId],
        );
        return null;
      } catch (e) {
        return e as { code?: string; constraint?: string };
      }
    });

    expect(err).not.toBeNull();
    // 23P01 is exclusion_violation. Anything else — a syntax error, a missing
    // table — must fail this test rather than satisfy it.
    expect(err?.code).toBe("23P01");
    expect(err?.constraint).toBe("reservations_no_double_book");
  });

  it("allows a second reservation once the first is cancelled", async () => {
    await withTenant(orgA, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO assets (org_id, asset_tag, name, status)
         VALUES ($1, 'RES-2', 'Generator', 'available') RETURNING id`,
        [orgA],
      );
      const assetId = rows[0].id;
      await c.query(
        `INSERT INTO reservations (org_id, asset_id, period, state)
         VALUES ($1, $2, tstzrange('2026-11-01', '2026-11-05'), 'cancelled')`,
        [orgA, assetId],
      );
      const second = await c.query(
        `INSERT INTO reservations (org_id, asset_id, period, state)
         VALUES ($1, $2, tstzrange('2026-11-02', '2026-11-06'), 'held')
         RETURNING id`,
        [orgA, assetId],
      );
      expect(second.rows).toHaveLength(1);
    });
  });
});

// The policies use the throwing form of current_setting, so a handler that
// forgets withTenant fails loudly instead of returning an empty register that
// looks like a legitimately empty tenant.
//
// Two different errors are possible and both are correct. On a connection that
// has never run withTenant the parameter is unknown, so current_setting raises
// "unrecognized configuration parameter". Once withTenant has run on that
// pooled connection, set_config has made app.org_id a known GUC, and after the
// transaction ends it reverts to the empty string rather than becoming unknown
// again - so the ::uuid cast is what raises instead. Which one a given test run
// sees depends on pool reuse, so the assertion accepts either. What is being
// asserted is that it raises at all.
const GUARD_MISSING = /unrecognized configuration parameter|invalid input syntax for type uuid/i;

describe("a forgotten tenant guard", () => {
  it("raises rather than returning an empty result", async () => {
    await expect(pool.query("SELECT * FROM assets")).rejects.toThrow(GUARD_MISSING);
  });

  it("raises on a write too", async () => {
    await expect(
      pool.query(
        `INSERT INTO assets (org_id, asset_tag, name, status)
         VALUES ($1, 'NOGUARD-1', 'unguarded', 'available')`,
        [orgA],
      ),
    ).rejects.toThrow(GUARD_MISSING);
  });
});

/**
 * An anti-drift guard rather than a test of any one table.
 *
 * Every table carrying org_id is tenant data, and each needs three separate
 * things: row-level security enabled, FORCE so the owner cannot bypass it, and
 * a policy. Miss any one and that table leaks across tenants - silently, and
 * only in production, because a single-tenant test sees nothing wrong.
 *
 * Written when migration 014 added asset_book_values and it turned out nothing
 * would have noticed if its policy had been forgotten.
 */
describe("every tenant table is protected", () => {
  it("has row-level security enabled, forced, and a policy", async () => {
    const owner = new Client({
      connectionString:
        process.env.MIGRATION_DATABASE_URL ??
        "postgres://ams:ams@localhost:5433/ams_test",
    });
    await owner.connect();
    try {
      const { rows } = await owner.query<{
        table_name: string;
        enabled: boolean;
        forced: boolean;
        policies: number;
      }>(
        `SELECT c.relname AS table_name,
                c.relrowsecurity      AS enabled,
                c.relforcerowsecurity AS forced,
                (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid)
                  AS policies
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind = 'r'
            AND EXISTS (
              SELECT 1 FROM information_schema.columns col
               WHERE col.table_schema = 'public'
                 AND col.table_name = c.relname
                 AND col.column_name = 'org_id'
            )
          ORDER BY c.relname`,
      );

      expect(rows.length).toBeGreaterThan(5);

      const unprotected = rows.filter(
        (r) => !r.enabled || !r.forced || r.policies === 0,
      );
      expect(
        unprotected.map(
          (r) =>
            `${r.table_name} (enabled=${r.enabled} forced=${r.forced} policies=${r.policies})`,
        ),
      ).toEqual([]);
    } finally {
      await owner.end();
    }
  });
});
