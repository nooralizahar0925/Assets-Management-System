import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { seedPermissions } from "./seed-permissions";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const isProduction = process.env.NODE_ENV === "production";

/**
 * `--test` points the runner at the throwaway database from
 * docker-compose.test.yml, matching the defaults in src/test/setup.ts.
 *
 * It is an explicit flag rather than an implicit fallback: a runner that
 * silently picked a database when none was configured would eventually migrate
 * the wrong one. Setting the variable inline is also not portable - it works in
 * bash and not in PowerShell - so the flag is what makes `npm run migrate:test`
 * work everywhere.
 */
if (process.argv.includes("--test")) {
  const port = process.env.TEST_DB_PORT ?? "5443";
  process.env.MIGRATION_DATABASE_URL ??= `postgres://ams:ams@localhost:${port}/ams_test`;
}

/**
 * Sets the application role's password from the environment.
 *
 * Migration 004 creates ams_app with no password, so this is what makes the
 * role usable. Keeping the secret here rather than in the migration means it is
 * never committed, and that setting APP_DB_PASSWORD actually rotates the
 * credential instead of silently disagreeing with a literal in the SQL.
 *
 * Holding this role's credentials defeats row-level security completely - the
 * holder can set app.org_id to any tenant - so refusing to invent one in
 * production is the whole point.
 */
async function setAppRolePassword(client: Client): Promise<void> {
  const password = process.env.APP_DB_PASSWORD;

  if (!password) {
    if (isProduction) {
      throw new Error(
        "APP_DB_PASSWORD is not set. Refusing to fall back to a well-known " +
          "password for the application database role in production.",
      );
    }
    process.stdout.write(
      "APP_DB_PASSWORD not set - using the development default for ams_app\n",
    );
  }

  // ALTER ROLE takes no bind parameter for the password, so the statement is
  // built by the server: format(%L) does the quoting and escaping, and the
  // password still travels as a bound parameter rather than being pasted into
  // SQL by us.
  const { rows } = await client.query<{ sql: string }>(
    "SELECT format('ALTER ROLE ams_app WITH LOGIN PASSWORD %L', $1::text) AS sql",
    [password ?? "ams_app"],
  );
  await client.query(rows[0].sql);
}

/**
 * The platform role's password, on the same terms as the application role's.
 *
 * ams_platform holds BYPASSRLS: whoever has this credential can read every
 * tenant in the database. Refusing to invent one in production matters more
 * here than it does for ams_app, not less.
 *
 * Returns early when the role does not exist, because this runs before
 * migration 022 has created it on a database seeing these migrations for the
 * first time.
 */
async function setPlatformRolePassword(client: Client): Promise<void> {
  const exists = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname = 'ams_platform'",
  );
  if (exists.rowCount === 0) return;

  const password = process.env.PLATFORM_DB_PASSWORD;

  if (!password) {
    if (isProduction) {
      throw new Error(
        "PLATFORM_DB_PASSWORD is not set. Refusing to fall back to a " +
          "well-known password for a role that can read every tenant.",
      );
    }
    process.stdout.write(
      "PLATFORM_DB_PASSWORD not set - using the development default for ams_platform\n",
    );
  }

  const { rows } = await client.query<{ sql: string }>(
    "SELECT format('ALTER ROLE ams_platform WITH LOGIN PASSWORD %L', $1::text) AS sql",
    [password ?? "ams_platform"],
  );
  await client.query(rows[0].sql);
}

/**
 * The auth lookup functions in migration 006 are SECURITY DEFINER and must be
 * able to read tables carrying FORCE ROW LEVEL SECURITY, which applies to the
 * table owner too. That only works if their owner bypasses RLS.
 *
 * Without this check the failure is silent and expensive: the functions return
 * zero rows, so every login returns 401 and every session resolves to null,
 * with nothing in the logs to say why.
 */
async function assertOwnerBypassesRls(client: Client): Promise<void> {
  const { rows } = await client.query<{ ok: boolean }>(
    `SELECT (rolsuper OR rolbypassrls) AS ok
       FROM pg_roles WHERE rolname = current_user`,
  );
  if (!rows[0]?.ok) {
    throw new Error(
      `Migration role "${process.env.PGUSER ?? "current_user"}" has neither ` +
        "SUPERUSER nor BYPASSRLS. The auth lookup functions in 006 would own " +
        "no way past FORCE ROW LEVEL SECURITY, and every login would fail " +
        "silently. Grant BYPASSRLS to the migration role and re-run.",
    );
  }
}

async function main() {
  const client = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  });
  await client.connect();

  await assertOwnerBypassesRls(client);

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const applied = new Set(
    (await client.query<{ filename: string }>("SELECT filename FROM schema_migrations"))
      .rows.map((r) => r.filename),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    process.stdout.write(`applying ${file}\n`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }

  // Reconciles the permission vocabulary and the system roles with the code.
  // Runs every time, so adding a permission is a code change picked up by the
  // next deploy rather than a hand-written migration each time.
  await seedPermissions(client);

  // After the role exists, and on every run, so rotating APP_DB_PASSWORD and
  // re-running migrate is all it takes to change the credential.
  await setAppRolePassword(client);
  await setPlatformRolePassword(client);

  await client.end();
  process.stdout.write("migrations up to date\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
