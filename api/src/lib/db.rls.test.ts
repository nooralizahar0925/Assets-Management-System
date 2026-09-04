import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "pg";
import { withTenant } from "./db";
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
    await withTenant(orgA, async (c) => {
      const { rows } = await c.query(
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
      await expect(
        c.query(
          `INSERT INTO reservations (org_id, asset_id, period, state)
           VALUES ($1, $2, tstzrange('2026-10-15', '2026-10-22'), 'held')`,
          [orgA, assetId],
        ),
      ).rejects.toThrow(/reservations_no_double_book/);
    }).catch((err) => {
      // The rejection above is asserted inside the transaction; the surrounding
      // withTenant rolls back, which is the desired cleanup.
      if (!/no_double_book/.test(String(err))) throw err;
    });
  });

  it("allows a second reservation once the first is cancelled", async () => {
    await withTenant(orgA, async (c) => {
      const { rows } = await c.query(
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
