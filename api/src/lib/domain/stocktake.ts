import { z } from "zod";
import { withTenant } from "../db";
import { recordEvent } from "./audit";
import type { Ctx } from "../http/handler";

export class SessionClosedError extends Error {}
export class SessionNotFoundError extends Error {}

export const SessionInput = z.object({
  location_id: z.string().uuid(),
  name: z.string().min(1).max(120),
});
export type SessionInput = z.infer<typeof SessionInput>;

export type SessionStatus = "open" | "closed" | "abandoned";

export interface StocktakeSession {
  id: string;
  location_id: string | null;
  location_name?: string | null;
  name: string;
  status: SessionStatus;
  opened_at: string;
  closed_at: string | null;
  expected_ids: string[];
  counted?: number;
}

export type CountOutcome =
  | "expected"        // the register said it was here, and it is
  | "unexpected"      // it is here, but the register placed it elsewhere
  | "already_counted" // scanned twice; not an error
  | "unknown_tag";    // matches no asset in this organisation

export interface CountResult {
  outcome: CountOutcome;
  asset?: { id: string; name: string; asset_tag: string };
}

interface AssetRef { id: string; name: string; asset_tag: string }

export interface Reconciliation {
  expected: number;
  counted: number;
  missing: AssetRef[];
  unexpected: AssetRef[];
}

const SESSION_COLUMNS = `s.id, s.location_id, l.name AS location_name, s.name,
  s.status, s.opened_at, s.closed_at, s.expected_ids`;

/**
 * Starts a count, recording what the register believes is at the location.
 *
 * The expected set is frozen here rather than computed at reconciliation. An
 * asset moved to another site while counting is in progress would otherwise
 * appear missing, and a report full of false alarms is one nobody acts on.
 *
 * Retired and lost assets are left out: they are not expected to be found, and
 * listing them as missing every quarter is noise.
 */
export async function openSession(
  ctx: Ctx,
  raw: SessionInput,
): Promise<StocktakeSession> {
  const input = SessionInput.parse(raw);

  return withTenant(ctx.orgId, async (c) => {
    const { rows: expected } = await c.query<{ id: string }>(
      `SELECT id FROM assets
        WHERE location_id = $1
          AND deleted_at IS NULL
          AND status NOT IN ('retired', 'lost')`,
      [input.location_id],
    );

    const { rows } = await c.query<StocktakeSession>(
      `WITH inserted AS (
         INSERT INTO stocktake_sessions
           (org_id, location_id, name, opened_by, expected_ids)
         VALUES ($1, $2, $3, $4, $5::uuid[])
         RETURNING *
       )
       SELECT ${SESSION_COLUMNS}
         FROM inserted s LEFT JOIN locations l ON l.id = s.location_id`,
      [
        ctx.orgId, input.location_id, input.name,
        ctx.actor.type === "user" ? ctx.actor.id : null,
        expected.map((r) => r.id),
      ],
    );
    return rows[0];
  });
}

export const getSession = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<StocktakeSession>(
      `SELECT ${SESSION_COLUMNS},
              (SELECT count(*)::int FROM stocktake_lines WHERE session_id = s.id)
                AS counted
         FROM stocktake_sessions s
         LEFT JOIN locations l ON l.id = s.location_id
        WHERE s.id = $1`,
      [id],
    )).rows[0] ?? null,
  );

export const listSessions = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<StocktakeSession>(
      `SELECT ${SESSION_COLUMNS},
              (SELECT count(*)::int FROM stocktake_lines WHERE session_id = s.id)
                AS counted
         FROM stocktake_sessions s
         LEFT JOIN locations l ON l.id = s.location_id
        ORDER BY s.opened_at DESC`,
    )).rows,
  );

/**
 * Records one scan.
 *
 * Every outcome is a normal result rather than an error, because the person
 * doing this is holding a scanner and walking. A rescan, a tag from another
 * site and an unreadable label are all things that happen during a count, and
 * each needs an answer the counter can act on immediately.
 */
export async function countAsset(
  ctx: Ctx,
  sessionId: string,
  tag: string,
): Promise<CountResult> {
  return withTenant(ctx.orgId, async (c) => {
    const { rows: sessions } = await c.query<{
      status: SessionStatus; expected_ids: string[];
    }>(
      "SELECT status, expected_ids FROM stocktake_sessions WHERE id = $1",
      [sessionId],
    );
    const session = sessions[0];
    if (!session) throw new SessionNotFoundError("No such stock-take session.");
    if (session.status !== "open") {
      throw new SessionClosedError("This stock-take has been closed.");
    }

    const { rows: assets } = await c.query<AssetRef>(
      `SELECT id, name, asset_tag FROM assets
        WHERE asset_tag = $1 AND deleted_at IS NULL`,
      [tag],
    );
    const asset = assets[0];

    if (!asset) {
      // Kept as evidence: an unreadable or foreign label is a finding, and
      // dropping it would leave the counter believing the scan registered.
      await c.query(
        `INSERT INTO stocktake_lines (org_id, session_id, asset_id, scanned_tag, counted_by)
         VALUES ($1, $2, NULL, $3, $4)`,
        [ctx.orgId, sessionId, tag, ctx.actor.type === "user" ? ctx.actor.id : null],
      );
      return { outcome: "unknown_tag" };
    }

    const inserted = await c.query(
      `INSERT INTO stocktake_lines (org_id, session_id, asset_id, scanned_tag, counted_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (session_id, asset_id) DO NOTHING`,
      [
        ctx.orgId, sessionId, asset.id, tag,
        ctx.actor.type === "user" ? ctx.actor.id : null,
      ],
    );

    if (inserted.rowCount === 0) return { outcome: "already_counted", asset };

    return {
      outcome: session.expected_ids.includes(asset.id) ? "expected" : "unexpected",
      asset,
    };
  });
}

/** What the count found, against what the register expected. */
export async function reconcile(ctx: Ctx, sessionId: string): Promise<Reconciliation> {
  return withTenant(ctx.orgId, async (c) => {
    const { rows: sessions } = await c.query<{ expected_ids: string[] }>(
      "SELECT expected_ids FROM stocktake_sessions WHERE id = $1", [sessionId],
    );
    if (!sessions[0]) throw new SessionNotFoundError("No such stock-take session.");
    const expected = sessions[0].expected_ids;

    const { rows: counted } = await c.query<AssetRef>(
      `SELECT a.id, a.name, a.asset_tag
         FROM stocktake_lines sl JOIN assets a ON a.id = sl.asset_id
        WHERE sl.session_id = $1`,
      [sessionId],
    );
    const countedIds = new Set(counted.map((a) => a.id));

    const { rows: missing } = await c.query<AssetRef>(
      `SELECT id, name, asset_tag FROM assets
        WHERE id = ANY($1::uuid[]) AND NOT (id = ANY($2::uuid[]))
        ORDER BY name`,
      [expected, [...countedIds]],
    );

    return {
      expected: expected.length,
      counted: counted.length,
      missing,
      unexpected: counted.filter((a) => !expected.includes(a.id)),
    };
  });
}

export interface CloseResult {
  adjusted: number;
}

/**
 * Ends the count, optionally writing its findings back to the register.
 *
 * Adjusting is deliberately a separate decision from closing: marking a dozen
 * assets lost is not something to do by default, and a count is often closed
 * so somebody can go and look again first.
 *
 * Closing twice is refused rather than ignored, so an adjustment cannot run a
 * second time and mark newly-missing assets lost on a stale expected set.
 */
export async function closeSession(
  ctx: Ctx,
  sessionId: string,
  options: { adjust: boolean },
): Promise<CloseResult> {
  const { missing } = await reconcile(ctx, sessionId);

  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<{ status: SessionStatus }>(
      "SELECT status FROM stocktake_sessions WHERE id = $1 FOR UPDATE", [sessionId],
    );
    if (!rows[0]) throw new SessionNotFoundError("No such stock-take session.");
    if (rows[0].status !== "open") {
      throw new SessionClosedError("This stock-take has already been closed.");
    }

    let adjusted = 0;
    if (options.adjust) {
      for (const asset of missing) {
        await c.query(
          "UPDATE assets SET status = 'lost' WHERE id = $1 AND deleted_at IS NULL",
          [asset.id],
        );
        await recordEvent(c, ctx, {
          assetId: asset.id,
          event: "asset.stocktake_lost",
          changes: { status: { from: "available", to: "lost" } },
          note: "Not found during a stock-take.",
        });
        adjusted += 1;
      }
    }

    await c.query(
      "UPDATE stocktake_sessions SET status = 'closed', closed_at = now() WHERE id = $1",
      [sessionId],
    );

    return { adjusted };
  });
}
