import { Pool, type PoolClient } from "pg";

/**
 * The platform connection: one pool, one purpose.
 *
 * `ams_platform` holds BYPASSRLS, so this pool can read every tenant. That is
 * the job - the console lists customers - and it is exactly why it is a
 * separate pool with a separate credential rather than a flag on the tenant
 * one. A handler that got hold of the wrong pool would silently lose tenant
 * isolation, and nothing would fail until it was somebody else's data on the
 * screen.
 *
 * Nothing outside src/lib/platform and the console's own routes should import
 * this.
 */
const pool = new Pool({
  connectionString: process.env.PLATFORM_DATABASE_URL,
  // Small on purpose. The console is used by one or two people, while the
  // tenant pool serves every customer; sizing them the same would let the
  // console's connections crowd out the product's.
  max: Number(process.env.PLATFORM_POOL_MAX ?? 4),
});

export async function withPlatform<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    // If the connection is gone, ROLLBACK throws too - and that error would
    // replace the one that actually explains the failure.
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
