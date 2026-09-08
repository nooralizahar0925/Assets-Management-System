import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { matchPath } from "react-router";

const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * Every internal link in the application, checked against the route table.
 *
 * A link to a route that does not exist renders perfectly, looks right, and
 * lands the person on the not-found page - so it survives review and is found
 * by a customer. The route table is the only authority on what exists, so this
 * reads both out of the source rather than trusting a list.
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

async function routes(): Promise<string[]> {
  const app = await readFile(join(SRC, "App.tsx"), "utf8");
  const found: string[] = [];
  // A child route's path is relative to its parent - the developer portal's
  // pages are declared as path="errors" under path="/developers". Reading only
  // the absolute ones would leave every link to them looking broken, which is
  // the sort of false alarm that gets a test deleted.
  let parent = "";

  for (const match of app.matchAll(/<Route[^>]*\spath="([^"]+)"/g)) {
    const path = match[1];
    if (path.startsWith("/")) {
      parent = path;
      found.push(path);
    } else {
      found.push(`${parent}/${path}`);
    }
  }

  return [...new Set(found)];
}

interface Link {
  target: string;
  file: string;
}

/**
 * Link targets, with interpolations replaced by a placeholder.
 *
 * `` to={`/assets/${id}`} `` becomes `/assets/x`, which is what the route
 * table has to match. Anything whose *first* segment is interpolated is a
 * computed target this cannot check and is skipped rather than guessed at.
 */
async function internalLinks(): Promise<Link[]> {
  const links: Link[] = [];

  for (const file of await sourceFiles(SRC)) {
    const text = await readFile(file, "utf8");
    const name = file.slice(SRC.length + 1).replace(/\\/g, "/");

    const patterns = [
      /\bto="(\/[^"]*)"/g,                    // <Link to="/assets">
      /\bto=\{`(\/[^`]*)`\}/g,                // <Link to={`/assets/${id}`}>
      /\bnavigate\(\s*"(\/[^"]*)"/g,          // navigate("/signin")
      /\bnavigate\(\s*`(\/[^`]*)`/g,          // navigate(`/assets/${id}`)
      /\bpath:\s*"(\/[^"]*)"/g,               // the sidebar's nav items
    ];

    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        // Drop the query string: /assets?q=… is still the /assets route.
        const target = match[1].split("?")[0].replace(/\$\{[^}]*\}/g, "x");
        if (target.startsWith("/x")) continue;
        // /api/... is a server endpoint quoted in documentation prose, not a
        // page of this application.
        if (target.startsWith("/api/")) continue;
        links.push({ target, file: name });
      }
    }
  }

  return links;
}

describe("every internal link", () => {
  it("points at a route this application serves", async () => {
    const table = await routes();
    const broken = (await internalLinks())
      .filter(({ target }) =>
        !table.some((route) => matchPath({ path: route, end: true }, target)))
      .map(({ target, file }) => `${target} (${file})`);

    expect([...new Set(broken)], `links to nowhere: ${broken.join(", ")}`).toEqual([]);
  });

  it("found the links and the routes, so the scanner still works", async () => {
    // Both halves have to be non-trivial, or the test above passes vacuously.
    expect((await routes()).length).toBeGreaterThan(15);
    expect((await internalLinks()).length).toBeGreaterThan(20);
  });
});
