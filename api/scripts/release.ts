import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseCommits, nextVersion, buildReleaseNotes, renderChangelog, GIT_LOG_FORMAT,
} from "./changelog";

/**
 * Cuts a release: works out the version, writes the changelog, and publishes
 * the notes people read in the application.
 *
 * Usage:
 *   npm run release -- --from v1.4.0                 # preview
 *   npm run release -- --from v1.4.0 --write         # update CHANGELOG.md
 *   npm run release -- --from v1.4.0 --write --publish  # and the in-app notes
 */

const CHANGELOG = join(process.cwd(), "..", "CHANGELOG.md");

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

const has = (flag: string) => process.argv.includes(flag);

function gitLog(from: string | undefined, to: string): string {
  const range = from ? `${from}..${to}` : to;
  return execFileSync("git", ["log", GIT_LOG_FORMAT, range], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** The newest version already in the changelog, or 0.0.0 for a first release. */
function currentVersion(): string {
  if (!existsSync(CHANGELOG)) return "0.0.0";
  const match = /^## (\d+\.\d+\.\d+)/m.exec(readFileSync(CHANGELOG, "utf8"));
  return match?.[1] ?? "0.0.0";
}

async function main() {
  const from = arg("--from");
  const to = arg("--to") ?? "HEAD";

  const commits = parseCommits(gitLog(from, to));
  if (commits.length === 0) {
    process.stdout.write("No conventional commits in that range.\n");
    return;
  }

  const version = arg("--version") ?? nextVersion(currentVersion(), commits);
  const date = new Date().toISOString().slice(0, 10);
  const section = renderChangelog(version, date, commits);
  const notes = buildReleaseNotes(commits);

  process.stdout.write(`${section}\n`);
  process.stdout.write(
    `${commits.length} commits, ${notes.length} of them worth telling a user about.\n`,
  );

  // A commit that changes what somebody sees and says nothing about it is the
  // failure this whole mechanism exists to prevent, so it is named here rather
  // than discovered later.
  const silent = commits.filter(
    (c) => (c.type === "feat" || c.type === "fix") && !c.releaseNote,
  );
  if (silent.length > 0) {
    process.stdout.write(
      `\nWarning: ${silent.length} feat/fix commits carry no release-note trailer:\n`
      + silent.map((c) => `  ${c.sha.slice(0, 7)} ${c.subject}`).join("\n") + "\n",
    );
  }

  if (has("--write")) {
    const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : "# Changelog\n";
    // Newest at the top, under the title: nobody scrolls to the bottom of a
    // changelog to find what just shipped.
    const [title, ...rest] = existing.split("\n## ");
    const body = rest.length > 0 ? `\n## ${rest.join("\n## ")}` : "";
    writeFileSync(CHANGELOG, `${title.trimEnd()}\n\n${section}${body}`, "utf8");
    process.stdout.write(`\nWrote ${version} to CHANGELOG.md\n`);
  }

  if (has("--publish")) {
    const { publishRelease } = await import("../src/lib/domain/releases");
    await publishRelease({
      version,
      title: arg("--title") ?? `Release ${version}`,
      released_at: date,
      entries: notes,
    });
    process.stdout.write(`Published ${version} to the in-app release notes.\n`);
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`${String(err)}\n`);
    process.exit(1);
  },
);
