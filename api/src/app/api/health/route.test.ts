import { describe, it, expect, afterEach } from "vitest";
import { query } from "@/lib/db";
import { GET } from "./route";

interface Health {
  status: string;
  db: boolean;
  migrations: { applied: string | null; expected: string | null; current: boolean };
  pool: { max: number; in_use: number; idle: number; waiting: number };
}

const read = async () => {
  const res = await GET();
  return { status: res.status, body: (await res.json()) as Health };
};

/** Restores anything a test removed from schema_migrations. */
let removed: string | null = null;

afterEach(async () => {
  if (removed) {
    const { Client } = await import("pg");
    const owner = new Client({
      connectionString:
        process.env.MIGRATION_DATABASE_URL ??
        "postgres://ams:ams@localhost:5443/ams_test",
    });
    await owner.connect();
    await owner.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [removed]);
    await owner.end();
    removed = null;
  }
});

describe("GET /api/health", () => {
  it("reports healthy when the database is reachable and current", async () => {
    const { status, body } = await read();
    expect(status).toBe(200);
    expect(body.db).toBe(true);
    expect(body.migrations.current).toBe(true);
  });

  it("names the migration it is running against", async () => {
    // A deploy that reports only "ok" cannot tell you which schema it has.
    const { body } = await read();
    expect(body.migrations.applied).toMatch(/^\d{3}_.*\.sql$/);
    expect(body.migrations.applied).toBe(body.migrations.expected);
  });

  it("reports the connection pool, so exhaustion is visible before it bites", async () => {
    const { body } = await read();
    expect(body.pool.max).toBeGreaterThan(0);
    expect(body.pool.in_use).toBeGreaterThanOrEqual(0);
    expect(typeof body.pool.waiting).toBe("number");
  });

  it("answers 503 when the database has fallen behind the code", async () => {
    // This is exactly when a container should stop receiving traffic: it will
    // query columns the database does not have yet.
    const { Client } = await import("pg");
    const owner = new Client({
      connectionString:
        process.env.MIGRATION_DATABASE_URL ??
        "postgres://ams:ams@localhost:5443/ams_test",
    });
    await owner.connect();
    const { rows } = await owner.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1",
    );
    removed = rows[0].filename;
    await owner.query("DELETE FROM schema_migrations WHERE filename = $1", [removed]);
    await owner.end();

    const { status, body } = await read();
    expect(status).toBe(503);
    expect(body.migrations.current).toBe(false);
    expect(body.migrations.applied).not.toBe(body.migrations.expected);
  });

  it("does not need a tenant context, so it works before anyone signs in", async () => {
    // The load balancer calls this with no credential at all.
    await query("SELECT 1");
    const { status } = await read();
    expect(status).toBe(200);
  });
});
