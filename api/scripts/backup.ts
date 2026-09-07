import { dumpDatabase } from "../src/lib/backup/dump";
import { backupKey, putBackup, pruneBackups, listBackups } from "../src/lib/backup/store";

/**
 * Takes a backup and prunes old ones.
 *
 * Uses the owner connection, never DATABASE_URL: the application role cannot
 * read every table by design, so a dump taken as ams_app would be quietly
 * incomplete - which is the worst possible kind of backup.
 */
const KEEP = Number(process.env.BACKUP_KEEP ?? 14);

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error(
      "MIGRATION_DATABASE_URL is not set. A backup must be taken with the " +
        "owner connection; the application role cannot see every table.",
    );
  }

  const started = Date.now();
  const archive = await dumpDatabase(url);
  const key = backupKey();
  await putBackup(key, archive);

  const pruned = await pruneBackups(KEEP);
  const kept = await listBackups();

  process.stdout.write(JSON.stringify({
    level: "info",
    event: "backup.completed",
    key,
    bytes: archive.length,
    duration_ms: Date.now() - started,
    pruned: pruned.length,
    retained: kept.length,
  }) + "\n");
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  },
);
