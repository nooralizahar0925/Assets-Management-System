import { describe, it, expect } from "vitest";
import { sources } from "../test/sources";

/**
 * The console paints its own dark surface.
 *
 * Every other screen follows the customer's light or dark theme, and the shared
 * form components switch with it: `text-gray-700` on a label, `text-gray-800`
 * in a field, and a `dark:` variant for the other case. The console is dark
 * whatever the document says, so those components rendered gray-800 text on a
 * gray-800 card - an unreadable sign-in form, which is exactly how it shipped:
 * invisible to anyone developing in dark mode, and the first thing the operator
 * sees.
 *
 * The console styles its own fields. This is the check that it keeps doing so,
 * because the import is the natural thing to reach for and the damage is
 * invisible to whoever writes it.
 */

const TENANT_FORM = /from "\.\.\/components\/form\//;

describe("the platform console", () => {
  it("does not borrow the tenant theme's form components", async () => {
    const offenders = (await sources())
      .filter((source) => source.name.startsWith("platform/"))
      .filter((source) => TENANT_FORM.test(source.text))
      .map((source) => source.name);

    expect(
      offenders,
      "these follow the document theme and vanish on the console's dark card; "
      + `use the console's own field styling instead:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("found the console's own files, so the check is not vacuous", async () => {
    const own = (await sources()).filter((s) => s.name.startsWith("platform/"));
    expect(own.length).toBeGreaterThan(5);
  });
});
