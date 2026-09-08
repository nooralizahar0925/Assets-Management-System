import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Client } from "pg";
import { createOrg, createUserWithRole } from "@/test/org";
import type { Ctx } from "../http/handler";
import {
  getVersionInfo, listReleases, publishRelease, markSeen, countUnseen,
} from "./releases";

let ctx: Ctx;
let userId: string;
const originalEnv = { ...process.env };

beforeAll(async () => {
  const orgId = await createOrg("Releases Org");
  const user = await createUserWithRole(orgId, "Manager");
  userId = user.id;
  ctx = {
    orgId,
    actor: {
      type: "user", id: userId, label: "Rina", scopes: ["admin"],
      permissions: [], locationScope: null,
    },
  };
});

/**
 * Cleanup runs over the owner connection. `user_release_seen` has row-level
 * security, and the application role holds only SELECT on `releases` - it is
 * written by the release pipeline, not by handlers.
 */
const owner = async () => {
  const c = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ??
      "postgres://ams:ams@localhost:5433/ams_test",
  });
  await c.connect();
  return c;
};

beforeEach(async () => {
  const c = await owner();
  await c.query("DELETE FROM user_release_seen WHERE user_id = $1", [userId]);
  await c.query("DELETE FROM releases");
  await c.end();
});

afterAll(() => {
  process.env.APP_VERSION = originalEnv.APP_VERSION;
  process.env.GIT_SHA = originalEnv.GIT_SHA;
  process.env.BUILD_TIME = originalEnv.BUILD_TIME;
});

const release = (version: string, title: string, at: string) =>
  publishRelease({
    version, title, released_at: at,
    entries: [{ type: "feature", summary: `Something in ${version}.` }],
  });

describe("getVersionInfo", () => {
  it("reports the build it is actually running", async () => {
    // A support conversation should start from a known build rather than a
    // guess about which deploy someone is on.
    process.env.APP_VERSION = "1.5.0";
    process.env.GIT_SHA = "3f9a1c2";
    process.env.BUILD_TIME = "2026-09-07T02:00:00Z";

    const info = await getVersionInfo();
    expect(info.version).toBe("1.5.0");
    expect(info.git_sha).toBe("3f9a1c2");
    expect(info.built_at).toBe("2026-09-07T02:00:00Z");
  });

  it("names the migration the database is on", async () => {
    // Version alone does not say whether the schema matches: two containers on
    // the same build can face databases at different heads.
    const info = await getVersionInfo();
    expect(info.migration).toMatch(/^\d{3}_.*\.sql$/);
  });

  it("says so plainly when the build is unstamped", async () => {
    // A development container has no build args. Reporting "unknown" is
    // honest; inventing a version would make a support answer wrong.
    delete process.env.APP_VERSION;
    delete process.env.GIT_SHA;

    const info = await getVersionInfo();
    expect(info.version).toBe("unknown");
    expect(info.git_sha).toBe("unknown");
  });
});

describe("releases", () => {
  it("lists newest first, which is the order anyone reads them in", async () => {
    await release("1.0.0", "First", "2026-08-01");
    await release("1.2.0", "Latest", "2026-09-01");
    await release("1.1.0", "Middle", "2026-08-15");

    expect((await listReleases()).map((r) => r.version))
      .toEqual(["1.2.0", "1.1.0", "1.0.0"]);
  });

  it("carries the entries a person actually reads", async () => {
    await publishRelease({
      version: "2.0.0", title: "Scanning", released_at: "2026-09-01",
      entries: [
        { type: "feature", summary: "Scan a QR code to open an asset." },
        { type: "fix", summary: "Overdue reminders no longer send twice." },
      ],
    });

    const [latest] = await listReleases();
    expect(latest.entries).toHaveLength(2);
    expect(latest.entries[0].summary).toContain("Scan a QR code");
  });

  it("replaces a release published twice rather than duplicating it", async () => {
    // A release pipeline that runs again must not produce two 1.0.0 entries.
    await release("1.0.0", "First go", "2026-08-01");
    await release("1.0.0", "Corrected", "2026-08-01");

    const all = await listReleases();
    expect(all).toHaveLength(1);
    expect(all[0].title).toBe("Corrected");
  });

  it("refuses a version that is not a version", async () => {
    await expect(publishRelease({
      version: "latest", title: "No", released_at: "2026-09-01", entries: [],
    })).rejects.toThrow();
  });
});

describe("what a person has already read", () => {
  it("counts everything as unseen to begin with", async () => {
    await release("1.0.0", "First", "2026-08-01");
    await release("1.1.0", "Second", "2026-08-15");

    expect(await countUnseen(ctx)).toBe(2);
  });

  it("stops counting a release once it has been seen", async () => {
    await release("1.0.0", "First", "2026-08-01");
    await release("1.1.0", "Second", "2026-08-15");

    await markSeen(ctx, "1.1.0");
    expect(await countUnseen(ctx)).toBe(1);
  });

  it("is not confused by the same release being marked twice", async () => {
    await release("1.0.0", "First", "2026-08-01");
    await markSeen(ctx, "1.0.0");
    await markSeen(ctx, "1.0.0");

    expect(await countUnseen(ctx)).toBe(0);
  });

  it("ignores a version nobody published", async () => {
    await release("1.0.0", "First", "2026-08-01");
    await markSeen(ctx, "9.9.9");
    expect(await countUnseen(ctx)).toBe(1);
  });

  it("keeps one person's reading separate from another's", async () => {
    // The dot in the sidebar is per-person: one colleague reading the notes
    // must not clear it for everyone.
    await release("1.0.0", "First", "2026-08-01");
    await markSeen(ctx, "1.0.0");

    const colleague = await createUserWithRole(ctx.orgId, "Viewer");
    const theirCtx: Ctx = {
      ...ctx,
      actor: { ...ctx.actor, id: colleague.id, label: "Budi" },
    };
    expect(await countUnseen(theirCtx)).toBe(1);
  });
});
