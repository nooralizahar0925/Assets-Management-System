import { describe, it, expect } from "vitest";
import { ERROR_CATALOG, errorTypeUri } from "./catalog";
import { problem } from "./problem";
import { sources, withoutComments } from "../../test/sources";

/**
 * Every slug the API can actually return, read out of the source.
 *
 * This is the point of the whole file: a hand-maintained list of error types is
 * wrong the first time somebody adds a `problem(409, "asset-checked-out", …)`
 * and forgets the documentation. Reading the source instead turns that from a
 * stale page into a failing build.
 */
async function slugsInSource(): Promise<Set<string>> {
  const slugs = new Set<string>();
  for (const source of await sources()) {
    // Comments are stripped first. Without that, a doc comment explaining the
    // catalogue by example - as this file's own does - registers as a real
    // error slug, and writing documentation breaks the build.
    const text = withoutComments(source.text);
    for (const match of text.matchAll(/\bproblem\(\s*\d+\s*,\s*"([a-z0-9-]+)"/g)) {
      slugs.add(match[1]);
    }
  }
  return slugs;
}

describe("the error catalogue", () => {
  it("documents every error the API can return", async () => {
    const used = await slugsInSource();
    const documented = new Set(ERROR_CATALOG.map((e) => e.slug));

    const missing = [...used].filter((slug) => !documented.has(slug)).sort();
    expect(missing, `undocumented error slugs: ${missing.join(", ")}`).toEqual([]);
  });

  it("documents nothing the API cannot return", async () => {
    // A catalogue describing an error nobody can trigger sends a reader
    // looking for a cause that does not exist.
    const used = await slugsInSource();
    const stale = ERROR_CATALOG.map((e) => e.slug)
      .filter((slug) => !used.has(slug)).sort();
    expect(stale, `documented but unreachable: ${stale.join(", ")}`).toEqual([]);
  });

  it("found a believable number of slugs, so the scanner still works", async () => {
    // If the regex stopped matching, both tests above would pass vacuously.
    expect((await slugsInSource()).size).toBeGreaterThan(5);
  });

  it("gives every entry a status, a cause and a remedy", () => {
    for (const entry of ERROR_CATALOG) {
      expect(entry.status, entry.slug).toBeGreaterThanOrEqual(400);
      expect(entry.title.length, entry.slug).toBeGreaterThan(0);
      expect(entry.when.length, entry.slug).toBeGreaterThan(20);
      expect(entry.fix.length, entry.slug).toBeGreaterThan(20);
    }
  });

  it("has no duplicate slugs", () => {
    const slugs = ERROR_CATALOG.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("builds the same type URI the API actually emits", async () => {
    // Documenting a URI that differs from the one on the wire would make the
    // catalogue unsearchable by the thing a caller has in front of them.
    const res = problem(409, "conflict", "Conflict");
    const body = (await res.json()) as { type: string };
    expect(body.type).toBe(errorTypeUri("conflict"));
  });

  it("tells the reader how to trace a 500 rather than only apologising", () => {
    const internal = ERROR_CATALOG.find((e) => e.slug === "internal")!;
    expect(internal.fix).toContain("X-Request-Id");
  });
});
