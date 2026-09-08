import { describe, it, expect } from "vitest";
import {
  parseCommits, groupForChangelog, nextVersion, buildReleaseNotes, renderChangelog,
} from "./changelog";

/**
 * The shape `git log` is asked for: unit-separated fields, record-separated
 * commits. Newlines cannot separate records here - a release note runs to
 * several lines, and splitting on newline would tear it in half.
 */
const commit = (sha: string, subject: string, note = "", body = "") =>
  [sha, subject, note, body].join("\x1f");

const LOG = [
  commit(
    "abc1234", "feat(assets): add qr code scanning",
    "Scan a QR code to open an asset instantly.",
  ),
  commit(
    "def5678", "fix(email): stop duplicate overdue reminders",
    "Overdue reminders no longer send twice in one day.",
  ),
  commit("ghi9012", "chore(deps): bump vite"),
  commit(
    "jkl3456", "feat(api)!: rename asset.tag to asset.asset_tag",
    "The asset tag field is now named asset_tag.",
    "BREAKING CHANGE: `tag` is now `asset_tag`.",
  ),
  commit(
    "mno7890", "perf(reports): stream large exports",
    "Large report downloads start immediately instead of waiting.",
  ),
].join("\x1e");

describe("parseCommits", () => {
  it("reads type, scope and subject from each commit", () => {
    const commits = parseCommits(LOG);
    expect(commits[0]).toMatchObject({
      type: "feat", scope: "assets", subject: "add qr code scanning",
    });
  });

  it("keeps a commit with no scope", () => {
    const commits = parseCommits(commit("aaa1111", "fix: tidy a thing"));
    expect(commits[0]).toMatchObject({ type: "fix", scope: null });
  });

  it("notices a breaking change from the bang", () => {
    const breaking = parseCommits(LOG).find((c) => c.sha === "jkl3456");
    expect(breaking?.breaking).toBe(true);
  });

  it("notices a breaking change declared only in the body", () => {
    const commits = parseCommits(commit(
      "bbb2222", "fix(api): correct the tag field", "",
      "BREAKING CHANGE: clients must read asset_tag.",
    ));
    expect(commits[0].breaking).toBe(true);
  });

  it("carries the release note a human wrote", () => {
    const commits = parseCommits(LOG);
    expect(commits[0].releaseNote).toBe("Scan a QR code to open an asset instantly.");
  });

  it("survives a release note that runs to several lines", () => {
    // Trailers fold across lines, and the generator has to reassemble them
    // rather than publish half a sentence.
    const commits = parseCommits(commit(
      "ccc3333", "feat(web): a thing",
      "The first line of the note\n and its continuation.",
    ));
    expect(commits[0].releaseNote).toBe("The first line of the note and its continuation.");
  });

  it("ignores anything that is not a conventional commit", () => {
    // A merge commit is not a change anyone reads about.
    const commits = parseCommits([
      commit("ddd4444", "Merge branch 'main' into feature"),
      commit("eee5555", "feat(x): a real change"),
    ].join("\x1e"));
    expect(commits.map((c) => c.sha)).toEqual(["eee5555"]);
  });
});

describe("nextVersion", () => {
  it("bumps the major for a breaking change", () => {
    expect(nextVersion("1.4.2", parseCommits(LOG))).toBe("2.0.0");
  });

  it("bumps the minor for a feature", () => {
    const commits = parseCommits(commit("a", "feat(x): something new"));
    expect(nextVersion("1.4.2", commits)).toBe("1.5.0");
  });

  it("bumps the patch for a fix", () => {
    const commits = parseCommits(commit("a", "fix(x): something broken"));
    expect(nextVersion("1.4.2", commits)).toBe("1.4.3");
  });

  it("bumps the patch when nothing user-facing happened", () => {
    // A release of only chores is still a release: the image changed.
    const commits = parseCommits(commit("a", "chore(deps): bump something"));
    expect(nextVersion("1.4.2", commits)).toBe("1.4.3");
  });
});

describe("groupForChangelog", () => {
  it("separates features, fixes, breaking changes and the rest", () => {
    const groups = groupForChangelog(parseCommits(LOG));
    expect(groups.features.map((c) => c.sha)).toContain("abc1234");
    expect(groups.fixes.map((c) => c.sha)).toContain("def5678");
    expect(groups.breaking.map((c) => c.sha)).toContain("jkl3456");
    expect(groups.other.map((c) => c.sha)).toContain("ghi9012");
  });

  it("lists a breaking feature under both, because both matter", () => {
    const groups = groupForChangelog(parseCommits(LOG));
    expect(groups.features.map((c) => c.sha)).toContain("jkl3456");
    expect(groups.breaking.map((c) => c.sha)).toContain("jkl3456");
  });
});

describe("buildReleaseNotes", () => {
  it("uses the note a person wrote, not the commit subject", () => {
    // The subject describes the code. The note describes what somebody can now
    // do, which is the only thing worth showing a user.
    const [first] = buildReleaseNotes(parseCommits(LOG));
    expect(first.summary).toBe("Scan a QR code to open an asset instantly.");
    expect(first.summary).not.toContain("add qr code scanning");
  });

  it("maps commit types to words a user understands", () => {
    const notes = buildReleaseNotes(parseCommits(LOG));
    expect(notes.find((n) => n.summary.includes("Scan a QR"))?.type).toBe("feature");
    expect(notes.find((n) => n.summary.includes("twice in one day"))?.type).toBe("fix");
    expect(notes.find((n) => n.summary.includes("start immediately"))?.type)
      .toBe("improvement");
  });

  it("leaves out commits with no release note", () => {
    // A dependency bump is real work and belongs in the changelog, but nobody
    // using the system needs to be told about it.
    const notes = buildReleaseNotes(parseCommits(LOG));
    expect(notes.some((n) => n.summary.includes("vite"))).toBe(false);
  });
});

describe("renderChangelog", () => {
  const section = renderChangelog("1.5.0", "2026-09-07", parseCommits(LOG));

  it("heads the section with the version and date", () => {
    expect(section).toContain("## 1.5.0 - 2026-09-07");
  });

  it("puts breaking changes first, where they cannot be missed", () => {
    const breaking = section.indexOf("Breaking");
    const features = section.indexOf("Features");
    expect(breaking).toBeGreaterThan(-1);
    expect(breaking).toBeLessThan(features);
  });

  it("credits each entry with its commit, so a line can be traced", () => {
    expect(section).toContain("abc1234");
  });

  it("keeps chores out of the way but still records them", () => {
    expect(section).toContain("bump vite");
  });
});
