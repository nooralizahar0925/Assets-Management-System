import { spawn } from "node:child_process";

/**
 * Running pg_dump and pg_restore.
 *
 * Both stream through stdout and stdin rather than writing a file, so nothing
 * depends on a path existing inside whichever container holds the binary, and
 * a backup never lands on a disk it was not meant to touch.
 *
 * The command is overridable because pg_dump is not always on the same host as
 * the application: the runtime image carries the client, but a developer's
 * machine often does not, and the tests reach it through the database
 * container. Version matters - pg_dump refuses to dump a server newer than
 * itself - so the command has to be able to point at the right one.
 */

const words = (value: string | undefined, fallback: string): string[] =>
  (value ?? fallback).trim().split(/\s+/);

export const dumpCommand = () => words(process.env.PG_DUMP_COMMAND, "pg_dump");
export const restoreCommand = () => words(process.env.PG_RESTORE_COMMAND, "pg_restore");

export class DumpFailedError extends Error {}

function run(
  command: string[],
  args: string[],
  input?: Buffer,
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const [bin, ...prefix] = command;
    const child = spawn(bin, [...prefix, ...args], {
      // The password travels in the connection string, so nothing extra is
      // needed in the environment - and nothing extra should be, since a child
      // process inherits far more than it needs by default.
      env: { ...process.env },
    });

    const out: Buffer[] = [];
    let err = "";

    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString(); });

    child.on("error", (cause) => reject(
      new DumpFailedError(`Could not run ${bin}: ${cause.message}`),
    ));
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err });
      else reject(new DumpFailedError(`${bin} exited ${code}: ${err.trim()}`));
    });

    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

/**
 * A custom-format dump: compressed, and restorable table by table.
 *
 * Privileges are deliberately included. Dumping with --no-privileges produces
 * an archive that restores every row and no GRANT, so the application role
 * comes back unable to touch its own tables - and re-running migrations does
 * not repair it, because they are already recorded as applied. A drill caught
 * exactly that: the restored database answered SELECT 1 and then failed on
 * "permission denied for sequence login_attempts_id_seq".
 *
 * Ownership is not included: the restoring role becomes the owner, so an
 * archive can be restored into a cluster whose owner has a different name.
 */
export async function dumpDatabase(databaseUrl: string): Promise<Buffer> {
  const { stdout } = await run(dumpCommand(), [
    "--format=custom",
    "--no-owner",
    `--dbname=${databaseUrl}`,
  ]);
  if (stdout.length === 0) {
    throw new DumpFailedError("pg_dump produced an empty archive.");
  }
  return stdout;
}

/**
 * Restores an archive over a target database.
 *
 * `--clean --if-exists` because a restore is normally into a database that
 * already has the wrong contents, and failing halfway through leaves something
 * worse than either version.
 */
export async function restoreDatabase(
  databaseUrl: string,
  archive: Buffer,
): Promise<void> {
  await run(restoreCommand(), [
    "--clean",
    "--if-exists",
    "--no-owner",
    `--dbname=${databaseUrl}`,
  ], archive);
}
