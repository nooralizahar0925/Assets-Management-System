import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Nobody formats a date by hand any more.
 *
 * A customer was shown "2026-10-01T09:00:00Z" as a due date. The cause was not
 * one careless line: it was eighteen calls to toLocaleString with three
 * different argument lists and a few places that printed the value straight
 * out of the API, so there was no single thing to fix and no way to tell which
 * screens were wrong without opening all of them.
 *
 * This is what stops that happening again. Formatting lives in lib/datetime,
 * and a new bespoke one fails here rather than shipping.
 */

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const relative = (file: string) => file.slice(SRC.length + 1).replace(/\\/g, "/");

describe("date formatting", () => {
  it("happens in one place", async () => {
    const offenders: string[] = [];

    for (const file of await sourceFiles(SRC)) {
      const name = relative(file);
      if (name === "lib/datetime.ts") continue;

      const text = await readFile(file, "utf8");

      // Formatting a date, rather than a number. Number#toLocaleString is
      // fine and common - it is how the counts get their thousands separators.
      for (const match of text.matchAll(/new Date\([^)]*\)\.toLocale\w*\(/g)) {
        offenders.push(`${name}: ${match[0]}`);
      }
      for (const match of text.matchAll(/\.toLocaleDateString\(|\.toLocaleTimeString\(/g)) {
        offenders.push(`${name}: ${match[0]}`);
      }
    }

    expect(
      offenders,
      `format dates with lib/datetime instead:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("found the source files, so the check is not passing on an empty list", async () => {
    expect((await sourceFiles(SRC)).length).toBeGreaterThan(50);
  });
});
