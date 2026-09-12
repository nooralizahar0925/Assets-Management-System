import { describe, it, expect } from "vitest";
import { sources } from "../test/sources";


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


describe("date formatting", () => {
  it("happens in one place", async () => {
    const offenders: string[] = [];

    for (const { name, text } of await sources()) {
      if (name === "lib/datetime.ts") continue;

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
    expect((await sources()).length).toBeGreaterThan(50);
  });
});
