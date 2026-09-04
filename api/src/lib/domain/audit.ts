import type { PoolClient } from "pg";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";

export interface AuditEvent {
  id: string;
  asset_id: string | null;
  actor_type: string;
  actor_label: string | null;
  event: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  note: string | null;
  created_at: string;
}

export async function recordEvent(
  client: PoolClient,
  ctx: Ctx,
  input: {
    assetId: string | null;
    event: string;
    changes?: Record<string, unknown>;
    note?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (org_id, asset_id, actor_type, actor_id, actor_label, event, changes, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ctx.orgId,
      input.assetId,
      ctx.actor.type,
      // A system actor has no user or key row to point at.
      ctx.actor.type === "system" ? null : ctx.actor.id,
      ctx.actor.label,
      input.event,
      JSON.stringify(input.changes ?? {}),
      input.note ?? null,
    ],
  );
}

/** Builds a {field: {from, to}} diff, ignoring unchanged and undefined values. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    const a = JSON.stringify(before[key] ?? null);
    const b = JSON.stringify(after[key] ?? null);
    if (a !== b) out[key] = { from: before[key] ?? null, to: after[key] };
  }
  return out;
}

export const listAssetHistory = (ctx: Ctx, assetId: string, limit = 200) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<AuditEvent>(
      `SELECT id, asset_id, actor_type, actor_label, event, changes, note, created_at
         FROM audit_events
        WHERE asset_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [assetId, limit],
    )).rows,
  );
