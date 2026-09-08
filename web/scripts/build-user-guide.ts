import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ARTICLES, SECTIONS, type Article } from "../src/content/help/articles";
import type { Block } from "../src/content/help/blocks";

/**
 * The printable user guide, generated from the in-app help centre.
 *
 * The spec asks for "the help-centre content as one printable document". A
 * hand-written manual and an in-app help centre agree on the day they are
 * written and never again, and the manual is the one a customer prints and
 * keeps - so it is generated, and a test asserts every article reaches it.
 */

function renderBlock(block: Block): string {
  switch (block.kind) {
    case "p":
      return block.text;
    case "steps":
      return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
    case "list":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "note":
      return `> **Note:** ${block.text}`;
    case "term":
      return `**${block.term}** — ${block.definition}`;
  }
}

export function renderUserGuide(articles: Article[]): string {
  const out: string[] = [
    "# Assets Management System — User guide",
    "",
    "This document is **generated** from the in-app help centre by `npm run docs:guide`.",
    "Edit `web/src/content/help/articles.ts` and regenerate; anything written here by",
    "hand is lost on the next run.",
    "",
    "## Contents",
    "",
  ];

  const populated = SECTIONS
    .map((section) => ({
      section,
      articles: articles.filter((article) => article.section === section),
    }))
    .filter((group) => group.articles.length > 0);

  for (const group of populated) {
    out.push(`- **${group.section}**`);
    for (const article of group.articles) {
      out.push(`  - [${article.title}](#${article.slug})`);
    }
  }
  out.push("");

  for (const group of populated) {
    out.push(`## ${group.section}`, "");
    for (const article of group.articles) {
      // The anchor goes before the heading rather than inside it: a Markdown
      // renderer that generates its own heading ids would otherwise give the
      // contents links a different target from the one they point at.
      out.push(`<a id="${article.slug}"></a>`, "", `### ${article.title}`, "");
      out.push(`*${article.summary}*`, "");
      for (const block of article.blocks) {
        out.push(renderBlock(block), "");
      }
    }
  }

  return out.join("\n");
}

// Only writes when run directly, so importing this from a test has no side
// effects and cannot rewrite the checked-in guide.
if (process.argv[1] && process.argv[1].endsWith("build-user-guide.ts")) {
  const target = join(
    dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "user-guide.md",
  );
  await writeFile(target, renderUserGuide(ARTICLES), "utf8");
  process.stdout.write(`wrote ${target}\n`);
}
