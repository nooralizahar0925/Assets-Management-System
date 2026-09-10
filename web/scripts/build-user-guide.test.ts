import { describe, it, expect } from "vitest";
import { renderUserGuide } from "./build-user-guide";
import { ARTICLES, SECTIONS } from "../src/content/help/articles";

describe("the printable user guide", () => {
  const md = renderUserGuide(ARTICLES);

  it("includes every article", () => {
    // The point of generating it: the printed manual cannot be missing a
    // chapter the in-app help has.
    for (const article of ARTICLES) {
      expect(md, article.slug).toContain(article.title);
    }
  });

  it("groups articles under their section headings", () => {
    for (const section of SECTIONS) {
      expect(md, section).toContain(`## ${section}`);
    }
  });

  it("renders steps as a numbered list and lists as bullets", () => {
    expect(md).toMatch(/^1\. /m);
    expect(md).toMatch(/^- /m);
  });

  it("renders a note as a blockquote rather than losing its emphasis", () => {
    expect(md).toMatch(/^> \*\*Note:\*\* /m);
  });

  it("opens with a title and a contents list", () => {
    expect(md.startsWith("# ")).toBe(true);
    expect(md).toContain("## Contents");
  });

  it("links every contents entry to a heading that exists", () => {
    // A table of contents whose links go nowhere is worse than none in a PDF,
    // where the reader cannot search their way out of it.
    const anchors = new Set(
      [...md.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]),
    );
    const links = [...md.matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);

    expect(links.length).toBeGreaterThan(5);
    const broken = links.filter((link) => !anchors.has(link));
    expect(broken, `contents links with no heading: ${broken.join(", ")}`).toEqual([]);
  });

  it("says it is generated, so nobody edits it by hand", () => {
    // In a comment now rather than a paragraph: the warning is for whoever
    // maintains the guide, and the guide is read by customers.
    const comment = md.match(/<!--[\s\S]*?-->/)?.[0] ?? "";
    expect(comment).toMatch(/generated/i);
    expect(comment).toContain("npm run docs:guide");
  });

  it("leaves no block unrendered", () => {
    // Every block kind must produce text. A silently skipped kind would drop a
    // paragraph from the manual with nothing to show that it had happened.
    const words = ARTICLES.flatMap((a) =>
      a.blocks.map((block) => {
        switch (block.kind) {
          case "p":
          case "note":
            return block.text;
          case "term":
            return block.definition;
          default:
            return block.items[0];
        }
      }),
    );
    for (const text of words) expect(md).toContain(text);
  });
});

describe("the checked-in guide", () => {
  it("matches what the articles would generate today", async () => {
    // The generated file is committed so it can be read on GitHub and printed
    // without a toolchain. That only works if it is regenerated when the
    // articles change, and nobody remembers to - so the build remembers.
    const { readFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const guide = join(
      dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "user-guide.md",
    );
    const onDisk = (await readFile(guide, "utf8")).replace(/\r\n/g, "\n");

    expect(
      onDisk,
      "docs/user-guide.md is stale - run `npm run docs:guide` in web/",
    ).toBe(renderUserGuide(ARTICLES).replace(/\r\n/g, "\n"));
  });
});

describe("what the guide does not say", () => {
  const md = renderUserGuide(ARTICLES);

  it("keeps the maintainer's note out of the reader's way", () => {
    // It was a paragraph at the top of a document handed to customers,
    // telling them our source layout and our build commands. It is still
    // there for whoever maintains the guide - as a comment every renderer
    // drops.
    const beforeContents = md.slice(0, md.indexOf("## Contents"));
    const visible = beforeContents.replace(/<!--[\s\S]*?-->/g, "");

    expect(visible).not.toContain("npm run");
    expect(visible).not.toContain("web/src");
    expect(visible).not.toContain(".ts");
  });

  it("mentions no address, port or command anywhere", async () => {
    // A customer's deployment is at their own address. Naming ours - or a
    // developer's localhost - is at best noise and at worst a support call.
    for (const pattern of [/localhost/i, /127\.0\.0\.1/, /:\d{4}\b/, /docker/i]) {
      expect(md.replace(/<!--[\s\S]*?-->/g, ""), String(pattern))
        .not.toMatch(pattern);
    }
  });
});
