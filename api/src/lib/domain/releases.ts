import { z } from "zod";
import { query, withTenant } from "../db";
import type { Ctx } from "../http/handler";

/**
 * What build this is, and what has changed lately.
 *
 * Users of an asset system notice when a screen changes and are unsettled when
 * nobody told them. The notes are written for them - not generated from commit
 * subjects, which describe the code rather than what anyone can now do.
 */

export interface VersionInfo {
  version: string;
  git_sha: string;
  built_at: string;
  /** The newest migration the database has applied. */
  migration: string | null;
}

/**
 * Provenance comes from build arguments baked into the image, never from a
 * file that could be edited afterwards. "unknown" is deliberate: a development
 * container has no build args, and inventing a version would make a support
 * answer confidently wrong.
 */
export async function getVersionInfo(): Promise<VersionInfo> {
  const rows = await query<{ filename: string }>(
    "SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1",
  );

  return {
    version: process.env.APP_VERSION ?? "unknown",
    git_sha: process.env.GIT_SHA ?? "unknown",
    built_at: process.env.BUILD_TIME ?? "unknown",
    // Version alone does not say whether the schema matches: two containers on
    // the same build can face databases at different heads.
    migration: rows[0]?.filename ?? null,
  };
}

export const ReleaseEntry = z.object({
  type: z.enum(["feature", "improvement", "fix"]),
  summary: z.string().min(1).max(500),
});

export const ReleaseInput = z.object({
  // Semver, so the list sorts and a client can compare. "latest" is not a
  // version; it is a pointer, and pointers do not belong in a history.
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Expected a semantic version."),
  title: z.string().min(1).max(200),
  released_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(ReleaseEntry).default([]),
});
export type ReleaseInput = z.input<typeof ReleaseInput>;

export interface Release {
  version: string;
  title: string;
  released_at: string;
  entries: { type: string; summary: string }[];
}

/** Publishing runs from the release pipeline, over the owner connection. */
export async function publishRelease(raw: ReleaseInput): Promise<Release> {
  const input = ReleaseInput.parse(raw);

  const rows = await query<Release>(
    `INSERT INTO releases (version, title, released_at, entries)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (version) DO UPDATE
       SET title = EXCLUDED.title,
           released_at = EXCLUDED.released_at,
           entries = EXCLUDED.entries
     RETURNING version, title, released_at::text AS released_at, entries`,
    [input.version, input.title, input.released_at, JSON.stringify(input.entries)],
  );
  return rows[0];
}

export const listReleases = (limit = 50) =>
  query<Release>(
    `SELECT version, title, released_at::text AS released_at, entries
       FROM releases ORDER BY released_at DESC, version DESC LIMIT $1`,
    [limit],
  );

/**
 * Records that this person has read a release.
 *
 * A version nobody published is ignored rather than rejected: the client sends
 * whatever it last displayed, and a stale tab should not produce an error.
 */
export const markSeen = (ctx: Ctx, version: string) =>
  withTenant(ctx.orgId, async (c) => {
    await c.query(
      `INSERT INTO user_release_seen (org_id, user_id, version)
       SELECT $1, $2, $3
        WHERE EXISTS (SELECT 1 FROM releases WHERE version = $3)
       ON CONFLICT (user_id, version) DO NOTHING`,
      [ctx.orgId, ctx.actor.id, version],
    );
  });

/** How many releases this person has not read - the dot in the sidebar. */
export const countUnseen = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    Number((await c.query<{ count: string }>(
      `SELECT count(*)::int AS count
         FROM releases r
        WHERE NOT EXISTS (
          SELECT 1 FROM user_release_seen s
           WHERE s.version = r.version AND s.user_id = $1
        )`,
      [ctx.actor.id],
    )).rows[0].count),
  );
