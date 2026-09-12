import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "pg";
import { createOrg, createUserWithRole } from "@/test/org";
import { systemCtx } from "@/lib/jobs/context";
import { createAsset, getAsset } from "@/lib/domain/assets";
import { checkOut } from "@/lib/domain/assignments";
import { dumpDatabase, restoreDatabase } from "./dump";
import { backupKey, putBackup, getBackup, listBackups, pruneBackups } from "./store";
import type { Ctx } from "@/lib/http/handler";

/**
 * The database *as pg_dump sees it*, which is not always as this process sees
 * it.
 *
 * On a developer machine pg_dump runs inside the database container, because
 * the host has no PostgreSQL client - so it must be given the container's own
 * address, not the published port. On CI the client is installed on the runner
 * and the published port is the only one that works.
 *
 * This used to be a hard-coded internal address, which meant the command was
 * configurable and the address it should use was not. The two are one decision
 * and now travel together: whoever sets PG_DUMP_COMMAND sets this too.
 */
const DUMP_URL = process.env.PG_DUMP_DATABASE_URL
  ?? "postgres://ams:ams@localhost:5432/ams_test";

/** The same address, pointed at another database on the same server. */
function databaseNamed(name: string): string {
  const url = new URL(DUMP_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

let ctx: Ctx;
let assetId: string;
let userId: string;

const owner = async () => {
  const c = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ??
      "postgres://ams:ams@localhost:5443/ams_test",
  });
  await c.connect();
  return c;
};

beforeAll(async () => {
  const orgId = await createOrg("Backup Drill Org");
  const user = await createUserWithRole(orgId, "Administrator");
  userId = user.id;
  ctx = systemCtx(orgId);

  const asset = await createAsset(ctx, {
    name: "Backed-up forklift", purchase_cost: 400_000_000,
  });
  assetId = asset.id;

  // Custody history, because a backup that restores rows but loses the story
  // of who had what is not a restore anyone would accept.
  await checkOut(ctx, assetId, {
    assignee_type: "user", assignee_id: userId, note: "Before the backup",
  });
});

describe("backup storage", () => {
  it("names an archive so the newest sorts first", () => {
    const older = backupKey(new Date("2026-09-01T02:00:00Z"));
    const newer = backupKey(new Date("2026-09-07T02:00:00Z"));
    expect([older, newer].sort((a, b) => b.localeCompare(a))[0]).toBe(newer);
    expect(newer).toMatch(/^2026-09-07T02-00-00Z\.dump$/);
  });

  it("stores and reads back the exact bytes", async () => {
    const key = backupKey(new Date("2026-01-01T00:00:00Z"));
    const payload = Buffer.from("not a real archive, but the same bytes");
    await putBackup(key, payload);
    expect((await getBackup(key)).equals(payload)).toBe(true);
  });

  it("keeps the newest and prunes the rest", async () => {
    for (const day of ["02", "03", "04", "05"]) {
      await putBackup(
        backupKey(new Date(`2026-02-${day}T00:00:00Z`)),
        Buffer.from(day),
      );
    }

    const removed = await pruneBackups(2);
    expect(removed.length).toBeGreaterThan(0);

    const left = await listBackups();
    expect(left).toHaveLength(2);
    // Newest survive: retention counts backups rather than days, so a system
    // that has been down for a fortnight still has its last good one.
    expect(left[0].key > left[1].key).toBe(true);
  });
});

describe("the restore drill", () => {
  it("takes a backup and rebuilds the register in a clean database", async () => {
    // A backup that has never been restored is a hope, not a backup.
    //
    // The restore goes into a scratch database rather than over ams_test. An
    // earlier version restored in place and broke every test that ran after it,
    // which is the same reason the runbook tells an operator to restore
    // somewhere harmless first and look before touching the real one.
    const scratch = "ams_restore_drill";
    const adminUrl = "postgres://ams:ams@localhost:5443/ams_test";
    const scratchUrl = `postgres://ams:ams@localhost:5443/${scratch}`;
    const scratchDumpUrl = databaseNamed(scratch);

    const archive = await dumpDatabase(DUMP_URL);
    expect(archive.length).toBeGreaterThan(1000);

    const key = backupKey();
    await putBackup(key, archive);

    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${scratch}`);
    await admin.query(`CREATE DATABASE ${scratch}`);
    await admin.end();

    const restored = new Client({ connectionString: scratchUrl });
    try {
      await restoreDatabase(scratchDumpUrl, await getBackup(key));
      await restored.connect();

      const asset = await restored.query<{ name: string }>(
        "SELECT name FROM assets WHERE id = $1", [assetId],
      );
      expect(asset.rows[0]?.name).toBe("Backed-up forklift");

      // Rows without their history is not a restore anyone would accept.
      const custody = await restored.query<{ checkout_note: string }>(
        "SELECT checkout_note FROM assignments WHERE asset_id = $1", [assetId],
      );
      expect(custody.rows[0]?.checkout_note).toBe("Before the backup");

      // The application role must be able to use what came back. An archive
      // taken with --no-privileges restores every row and no GRANT, so the
      // database answers SELECT 1 and then fails on the first write with
      // "permission denied for sequence". Re-running migrations does not
      // repair it, because they are already recorded as applied.
      const grants = await restored.query<{ ok: boolean }>(
        `SELECT has_table_privilege('ams_app', 'assets', 'INSERT')
                AND has_table_privilege('ams_app', 'audit_events', 'INSERT') AS ok`,
      );
      expect(grants.rows[0]?.ok).toBe(true);
    } finally {
      // Close first, and drop WITH FORCE: an assertion that throws mid-test
      // leaves this connection open, and the drop would then fail and hide the
      // failure that actually mattered.
      await restored.end().catch(() => undefined);

      const cleanup = new Client({ connectionString: adminUrl });
      await cleanup.connect();
      await cleanup.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
      await cleanup.end();
    }
  }, 180_000);
});
