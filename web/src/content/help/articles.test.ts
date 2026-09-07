import { describe, it, expect } from "vitest";
import { ARTICLES, SECTIONS, searchArticles } from "./articles";
import { HELP_TOPICS } from "./topics";

describe("the help articles", () => {
  it("put every article in a declared section", () => {
    for (const article of ARTICLES) {
      expect(SECTIONS, article.slug).toContain(article.section);
    }
  });

  it("fill every declared section", () => {
    // A section heading with nothing under it is a promise the help centre
    // does not keep.
    const used = new Set(ARTICLES.map((a) => a.section));
    const empty = SECTIONS.filter((section) => !used.has(section));
    expect(empty, `sections with no article: ${empty.join(", ")}`).toEqual([]);
  });

  it("have no duplicate slugs", () => {
    const slugs = ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("resolve every article a help panel links to", () => {
    // The ? panel links onward by slug. A broken link there is a dead end in
    // the middle of somebody asking for help.
    const slugs = new Set(ARTICLES.map((a) => a.slug));
    const broken = Object.entries(HELP_TOPICS)
      .filter(([, topic]) => topic.article && !slugs.has(topic.article))
      .map(([route, topic]) => `${route} -> ${topic.article}`);
    expect(broken, `panels linking nowhere: ${broken.join(", ")}`).toEqual([]);
  });

  it("give every article a summary worth reading in a list", () => {
    for (const article of ARTICLES) {
      expect(article.summary.length, article.slug).toBeGreaterThan(30);
      expect(article.blocks.length, article.slug).toBeGreaterThan(1);
      expect(article.keywords.length, article.slug).toBeGreaterThan(2);
    }
  });
});

describe("searching the articles", () => {
  it("matches on the title", () => {
    expect(searchArticles("import").map((a) => a.slug)).toContain("importing");
  });

  it("matches on a keyword the title does not contain", () => {
    // Somebody looking for "barcode" is looking for the scanning article, and
    // the word "barcode" is nowhere in its title.
    expect(searchArticles("barcode").map((a) => a.slug)).toContain("scanning");
  });

  it("finds the stock-take article from the word people actually use", () => {
    expect(searchArticles("stocktake").map((a) => a.slug)).toContain("stock-takes");
  });

  it("is case and whitespace insensitive", () => {
    expect(searchArticles("  ChECK Out ").length).toBeGreaterThan(0);
  });

  it("returns everything for an empty query", () => {
    expect(searchArticles("").length).toBe(ARTICLES.length);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchArticles("zzzznotathing")).toEqual([]);
  });
});

describe("what the articles claim about the system", () => {
  it("does not describe roles as a fixed list", () => {
    // Roles are tenant-owned and renameable, and can be scoped to branches.
    // Telling a customer they get Admin, Manager, Technician and Viewer - as
    // the plan's draft did - documents a product we deliberately do not ship.
    const roles = ARTICLES.find((a) => a.slug === "roles-and-access")!;
    const text = JSON.stringify(roles).toLowerCase();
    expect(text).toContain("permission");
    expect(text).not.toContain("one of four roles");
  });

  it("tells the reader that access can be limited to particular branches", () => {
    const roles = ARTICLES.find((a) => a.slug === "roles-and-access")!;
    expect(JSON.stringify(roles).toLowerCase()).toContain("branch");
  });
});
