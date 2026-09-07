import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HELP_TOPICS } from "./topics";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The routes a signed-in person can actually land on, read out of App.tsx.
 *
 * A hard-coded list here would go stale the first time somebody adds a page,
 * and the symptom would be a `?` button that silently renders nothing - the
 * one failure mode nobody notices, because a missing button looks like a
 * design decision. Reading the route table makes a new page without help a
 * failing build.
 */
async function authenticatedRoutes(): Promise<string[]> {
  const app = await readFile(join(SRC, "App.tsx"), "utf8");

  // Everything from the RequireAuth guard to the end of the protected block.
  const guarded = app.slice(app.indexOf("<RequireAuth />"));
  const routes = [...guarded.matchAll(/<Route[^>]*\spath="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((path) => path.startsWith("/"));

  // Routes that render no page of their own. /a/:tag is the label deep link:
  // it resolves the tag and redirects, so nobody is ever looking at it, and a
  // help topic for it could not be opened.
  const REDIRECTS = new Set(["/a/:tag"]);

  return [...new Set(["/", ...routes])].filter((path) => !REDIRECTS.has(path));
}

describe("the help topics", () => {
  it("cover every page a signed-in person can open", async () => {
    const routes = await authenticatedRoutes();
    const missing = routes.filter((route) => !HELP_TOPICS[route]);
    expect(missing, `routes with no help topic: ${missing.join(", ")}`).toEqual([]);
  });

  it("found a believable number of routes, so the scanner still works", async () => {
    // Without this the test above passes vacuously the day App.tsx is
    // restructured and the regex stops matching.
    expect((await authenticatedRoutes()).length).toBeGreaterThan(10);
  });

  it("document nothing that is not a route", async () => {
    // A topic for a page that no longer exists is dead weight nobody reads,
    // and it hides the fact that its page was removed.
    const routes = new Set(await authenticatedRoutes());
    const stale = Object.keys(HELP_TOPICS).filter((key) => !routes.has(key));
    expect(stale, `topics for no page: ${stale.join(", ")}`).toEqual([]);
  });

  it("give every topic a title and at least one block", () => {
    for (const [route, topic] of Object.entries(HELP_TOPICS)) {
      expect(topic.title.length, `${route} title`).toBeGreaterThan(3);
      expect(topic.blocks.length, `${route} blocks`).toBeGreaterThan(0);
    }
  });

  it("explain the concepts a customer cannot guess", () => {
    const all = JSON.stringify(HELP_TOPICS).toLowerCase();
    for (const concept of [
      "field schema", "dry run", "maintenance", "stock-take", "depreciation",
    ]) {
      expect(all, concept).toContain(concept);
    }
  });

  it("say something specific on every page, not the same filler twice", () => {
    // Copy-pasted help is worse than none: it teaches the reader that the ?
    // is not worth pressing.
    const firstParagraphs = Object.values(HELP_TOPICS).map((topic) => {
      const first = topic.blocks.find((b) => b.kind === "p");
      return first && first.kind === "p" ? first.text : "";
    });
    expect(new Set(firstParagraphs).size).toBe(firstParagraphs.length);
  });

  it("write in whole sentences, so the panel is readable prose", () => {
    for (const [route, topic] of Object.entries(HELP_TOPICS)) {
      for (const block of topic.blocks) {
        if (block.kind === "p" || block.kind === "note") {
          expect(block.text.length, `${route}: "${block.text}"`).toBeGreaterThan(30);
          expect(block.text.trim().endsWith("."), `${route}: "${block.text}"`).toBe(true);
        }
      }
    }
  });
});
