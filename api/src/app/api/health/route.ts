import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { query, pool } from "@/lib/db";

/**
 * A health check the load balancer can act on.
 *
 * `SELECT 1` alone says the database answers, which is the least interesting
 * thing that can be wrong. A container running code that expects migration 017
 * against a database still on 015 answers `SELECT 1` perfectly and then fails
 * on the first request that touches a missing column - so the schema is
 * checked too, and a container behind its own migrations reports itself unfit
 * rather than taking traffic.
 */

/** The image ships its migrations beside the build; see the Dockerfile. */
const MIGRATIONS_DIR = join(process.cwd(), "migrations");

async function newestMigrationFile(): Promise<string | null> {
  try {
    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    return files[files.length - 1] ?? null;
  } catch {
    // No migrations directory - a development runner started from elsewhere.
    // Not a reason to fail the check, since nothing can be compared.
    return null;
  }
}

async function newestApplied(): Promise<string | null> {
  const rows = await query<{ filename: string }>(
    "SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1",
  );
  return rows[0]?.filename ?? null;
}

export async function GET() {
  let db = false;
  let applied: string | null = null;

  try {
    await query("SELECT 1");
    db = true;
    applied = await newestApplied();
  } catch {
    db = false;
  }

  const expected = await newestMigrationFile();
  // Unknown expectation means nothing to compare, not a failure.
  const current = !db ? false : expected === null || applied === expected;

  const healthy = db && current;

  return Response.json(
    {
      status: healthy ? "ok" : "unhealthy",
      db,
      migrations: { applied, expected, current },
      pool: {
        max: pool.options.max ?? 0,
        in_use: pool.totalCount - pool.idleCount,
        idle: pool.idleCount,
        // Requests queued for a connection: the number that climbs first when
        // the pool is undersized for the load.
        waiting: pool.waitingCount,
      },
    },
    { status: healthy ? 200 : 503 },
  );
}
