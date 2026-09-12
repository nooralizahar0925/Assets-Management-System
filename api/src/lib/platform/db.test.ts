import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "pg";
import { createOrg } from "../../test/org";
import { withPlatform } from "./db";

/**
 * The platform connection is the one place in this system that can read across
 * tenants. Everything about it is a security boundary rather than plumbing, so
 * that is what these test.
 */

beforeAll(async () => {
  // Something to find. Without this the first test could pass against an empty
  // database and prove nothing at all.
  await createOrg("Platform Visibility Org");
  await createOrg("Second Platform Visibility Org");
});

describe("the platform connection", () => {
  it("sees every tenant at once, which is the entire point", async () => {
    // The tenant pool cannot do this: it is scoped to one app.org_id, and that
    // is precisely the property this connection deliberately does not have.
    const count = await withPlatform(async (c) =>
      Number((await c.query<{ n: string }>(
        "SELECT count(*) AS n FROM organizations",
      )).rows[0].n),
    );
    expect(count).toBeGreaterThan(1);
  });

  it("cannot read a customer's audit trail", async () => {
    // Narrow grants are what stop a bug in the console becoming a data breach.
    // The operator needs counts and contracts, never the contents of anybody's
    // register - and a grant not held is a mistake that cannot be made.
    await expect(
      withPlatform((c) => c.query("SELECT * FROM audit_events LIMIT 1")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot read a customer's attachments", async () => {
    await expect(
      withPlatform((c) => c.query("SELECT * FROM attachments LIMIT 1")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("can count a customer's assets without reading one", async () => {
    // The console shows "620 assets against a limit of 500". It has no reason
    // to know what any of them are, and a column grant is what makes that a
    // fact about the database rather than a habit of the code above it.
    await expect(
      withPlatform((c) => c.query("SELECT count(*) FROM assets")),
    ).resolves.toBeDefined();

    await expect(
      withPlatform((c) => c.query("SELECT name FROM assets LIMIT 1")),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      withPlatform((c) => c.query("SELECT * FROM assets LIMIT 1")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("can tell when somebody last signed in, not who or from where", async () => {
    await expect(
      withPlatform((c) => c.query("SELECT max(created_at) FROM sessions")),
    ).resolves.toBeDefined();

    await expect(
      withPlatform((c) => c.query("SELECT * FROM sessions LIMIT 1")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot read the email outbox", async () => {
    // Queued mail carries customer names, addresses and asset details.
    await expect(
      withPlatform((c) => c.query("SELECT * FROM email_messages LIMIT 1")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot rewrite the record of what the operator did", async () => {
    // INSERT but not UPDATE or DELETE. The point of that trail is that it
    // cannot be tidied up afterwards, including by whoever holds this role.
    await expect(
      withPlatform((c) => c.query("DELETE FROM platform_audit")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("is refused to the tenant application entirely", async () => {
    // The most important assertion here. A total compromise of the customer-
    // facing application must not yield a platform administrator's password
    // hash, a platform session, or the operator's audit trail.
    const app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    try {
      for (const table of ["platform_admins", "platform_sessions", "platform_audit"]) {
        await expect(
          app.query(`SELECT * FROM ${table} LIMIT 1`),
          table,
        ).rejects.toThrow(/permission denied/i);
      }
    } finally {
      await app.end();
    }
  });

  it("lets the tenant application read what it is allowed to do, and no more", async () => {
    // Entitlements have to be readable by the API that enforces them. Prices
    // and contracts do not: those are the operator's business.
    const app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    try {
      await expect(app.query("SELECT code, features FROM plans LIMIT 1"))
        .resolves.toBeDefined();
      await expect(app.query("UPDATE plans SET price_minor = 0"))
        .rejects.toThrow(/permission denied/i);
    } finally {
      await app.end();
    }
  });

  it("rolls back when the work throws", async () => {
    const slug = `rollback-${Date.now()}`;
    await expect(
      withPlatform(async (c) => {
        await c.query(
          "INSERT INTO organizations (name, slug) VALUES ('Rolled Back', $1)",
          [slug],
        );
        throw new Error("something went wrong halfway");
      }),
    ).rejects.toThrow(/halfway/);

    const found = await withPlatform(async (c) =>
      (await c.query("SELECT 1 FROM organizations WHERE slug = $1", [slug])).rows,
    );
    expect(found).toEqual([]);
  });
});
