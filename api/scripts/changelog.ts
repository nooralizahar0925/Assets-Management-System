/**
 * Turns commits into a changelog and a set of release notes.
 *
 * Generated rather than written by hand, which is why the Conventional Commits
 * rule is not cosmetic: a `feat:` prefix on a bug fix produces a wrong release
 * note for real users, and a missing `release-note:` trailer means a change
 * nobody is told about.
 *
 * Two audiences, one source. CHANGELOG.md is for people working on this and
 * lists every commit; the release notes are for people using it and carry only
 * the sentences an author wrote for them.
 */

export type CommitType =
  | "feat" | "fix" | "perf" | "refactor" | "docs" | "test" | "chore" | "ci"
  | "build" | "style" | "revert";

export interface ParsedCommit {
  sha: string;
  type: CommitType;
  scope: string | null;
  subject: string;
  breaking: boolean;
  releaseNote: string | null;
}

/** Field and record separators, so a multi-line body cannot break parsing. */
export const FIELD = "\x1f";
export const RECORD = "\x1e";

/** The format `git log` must be asked for to produce parseable output. */
export const GIT_LOG_FORMAT =
  `--format=%H${FIELD}%s${FIELD}%(trailers:key=release-note,valueonly)${FIELD}%b${RECORD}`;

const HEADER = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/;

export function parseCommits(log: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];

  for (const record of log.split(RECORD)) {
    const trimmed = record.trim();
    if (!trimmed) continue;

    const [sha = "", subject = "", note = "", body = ""] = trimmed.split(FIELD);
    const match = HEADER.exec(subject.trim());
    // Not a conventional commit - a merge, or something written by hand. It is
    // not a change anyone reads about, so it is left out rather than guessed at.
    if (!match) continue;

    const [, type, scope, bang, text] = match;

    commits.push({
      sha: sha.trim(),
      type: type as CommitType,
      scope: scope ?? null,
      subject: text,
      // Either marker counts. The bang is the convention; the body line is what
      // people actually remember to write.
      breaking: Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body),
      // A trailer folds across lines. Rejoining is not cosmetic: publishing
      // half a sentence is worse than publishing nothing.
      releaseNote: note.trim()
        ? note.split("\n").map((l) => l.trim()).filter(Boolean).join(" ")
        : null,
    });
  }

  return commits;
}

export interface ChangelogGroups {
  breaking: ParsedCommit[];
  features: ParsedCommit[];
  fixes: ParsedCommit[];
  other: ParsedCommit[];
}

export function groupForChangelog(commits: ParsedCommit[]): ChangelogGroups {
  return {
    // A breaking feature appears under both headings on purpose: a reader
    // scanning for new capability and a reader scanning for what will break
    // are two different people, and each needs to see it.
    breaking: commits.filter((c) => c.breaking),
    features: commits.filter((c) => c.type === "feat"),
    fixes: commits.filter((c) => c.type === "fix"),
    other: commits.filter((c) => c.type !== "feat" && c.type !== "fix"),
  };
}

const bump = (version: string, part: 0 | 1 | 2): string => {
  const parts = version.replace(/^v/, "").split(".").map(Number);
  parts[part] += 1;
  for (let i = part + 1; i < 3; i += 1) parts[i] = 0;
  return parts.join(".");
};

/**
 * The next version, from what actually changed.
 *
 * A release containing only chores still bumps the patch: the image is
 * different, and two deployments that report the same version but differ is
 * how a support conversation goes wrong.
 */
export function nextVersion(current: string, commits: ParsedCommit[]): string {
  if (commits.some((c) => c.breaking)) return bump(current, 0);
  if (commits.some((c) => c.type === "feat")) return bump(current, 1);
  return bump(current, 2);
}

/** How a commit type reads to somebody using the system. */
const NOTE_TYPE: Partial<Record<CommitType, "feature" | "fix" | "improvement">> = {
  feat: "feature",
  fix: "fix",
  perf: "improvement",
  refactor: "improvement",
};

export interface ReleaseNote {
  type: "feature" | "fix" | "improvement";
  summary: string;
}

/**
 * The user-facing notes.
 *
 * Only commits carrying a `release-note:` trailer appear. A dependency bump is
 * real work and belongs in the changelog, but nobody using the system needs to
 * be told about it - and a subject line like "add qr code scanning" describes
 * the code rather than what anyone can now do.
 */
export function buildReleaseNotes(commits: ParsedCommit[]): ReleaseNote[] {
  return commits
    .filter((c) => c.releaseNote)
    .map((c) => ({
      type: NOTE_TYPE[c.type] ?? "improvement",
      summary: c.releaseNote!,
    }));
}

const line = (c: ParsedCommit) =>
  `- ${c.scope ? `**${c.scope}:** ` : ""}${c.subject} (${c.sha.slice(0, 7)})`;

const section = (title: string, commits: ParsedCommit[]) =>
  commits.length === 0 ? "" : `\n### ${title}\n\n${commits.map(line).join("\n")}\n`;

/** One CHANGELOG.md section, for the people working on this. */
export function renderChangelog(
  version: string,
  date: string,
  commits: ParsedCommit[],
): string {
  const groups = groupForChangelog(commits);

  return [
    `## ${version} - ${date}\n`,
    // Breaking first: somebody skimming to decide whether an upgrade is safe
    // must not have to read past the new features to find out.
    section("Breaking changes", groups.breaking),
    section("Features", groups.features),
    section("Fixes", groups.fixes),
    section("Other", groups.other),
  ].join("").trimEnd() + "\n";
}
