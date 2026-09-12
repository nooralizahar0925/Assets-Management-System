import { readdir, readFile } from "node:fs/promises";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every non-test source file under src, read once.
 *
 * Several tests here are source scanners: they read the code looking for what
 * it actually does, because a hand-maintained list of error slugs or webhook
 * events is wrong the first time somebody forgets to update it. Each of them
 * used to carry its own copy of this walk and run it once per test, so a suite
 * of six scanners read the whole tree eleven times - sequentially, one file at
 * a time. On a loaded machine that occasionally crossed the 5s default timeout
 * and failed a test that had found nothing wrong.
 *
 * Read concurrently, and memoised for the module that asks - which in Vitest is
 * one test file, so the scanners in it share a single pass.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface Source {
  /** Posix-style and relative to src, so assertions read the same everywhere. */
  name: string;
  text: string;
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
        ? [full]
        : [];
    }),
  );
  return nested.flat();
}

let pending: Promise<Source[]> | null = null;

export function sources(): Promise<Source[]> {
  pending ??= (async () => {
    const paths = await walk(SRC);
    return Promise.all(
      paths.map(async (path) => ({
        name: relative(SRC, path).split(sep).join("/"),
        text: await readFile(path, "utf8"),
      })),
    );
  })();
  return pending;
}

/** Comments stripped, for scanners that would otherwise read their own prose. */
export const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
