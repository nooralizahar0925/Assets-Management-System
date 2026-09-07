import { restoreDatabase } from "../src/lib/backup/dump";
import { getBackup, listBackups } from "../src/lib/backup/store";

/**
 * Restores one archive over a target database.
 *
 * The target is passed explicitly rather than read from the environment. A
 * restore is destructive, and a script that picks its own target from whatever
 * happens to be set is one command away from overwriting production with
 * staging.
 *
 * Usage: npm run restore -- --key 2026-09-07T02-00-00Z.dump --into <url>
 *        npm run restore -- --list
 */
async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };

  if (args.includes("--list")) {
    for (const entry of await listBackups()) {
      process.stdout.write(
        `${entry.key}\t${(entry.size / 1_048_576).toFixed(1)} MB\t${entry.modified.toISOString()}\n`,
      );
    }
    return;
  }

  const key = valueOf("--key");
  const into = valueOf("--into");
  if (!key || !into) {
    throw new Error(
      "Both --key and --into are required. Run with --list to see what exists.",
    );
  }
  if (!args.includes("--yes")) {
    throw new Error(
      `This will overwrite everything in the target database. Re-run with --yes ` +
        `to confirm restoring ${key}.`,
    );
  }

  const started = Date.now();
  await restoreDatabase(into, await getBackup(key));

  process.stdout.write(JSON.stringify({
    level: "info", event: "restore.completed", key,
    duration_ms: Date.now() - started,
  }) + "\n");
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  },
);
