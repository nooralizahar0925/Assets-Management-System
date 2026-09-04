import { Pool, type PoolClient, type QueryResultRow } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10),
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/** Runs `fn` inside a transaction with the tenant guard set for RLS. */
export async function withTenant<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    // If the connection is gone, ROLLBACK throws too - and that error would
    // replace the one that actually explains the failure.
    try {
      await client.query("ROLLBACK");
    } catch {
      // Deliberately swallowed; the original error is the useful one.
    }
    throw err;
  } finally {
    client.release();
  }
}
