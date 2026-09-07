import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { dispatch } from "../notify/dispatch";
import { recordEvent } from "../domain/audit";

export interface ExpiringRow {
  id: string;
  name: string;
  asset_tag: string;
  custom: Record<string, unknown>;
  expires_on: string;
  days_left: number;
}

/**
 * Reads an ISO date out of the JSONB `custom` column. The cast is guarded by a regex
 * so a hand-typed value like "soon" cannot abort the query for every other row.
 */
export const findExpiring = (ctx: Ctx, field: string, days: number) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<ExpiringRow>(
      `SELECT id, name, asset_tag, custom,
              (custom ->> $1)::date AS expires_on,
              ((custom ->> $1)::date - current_date) AS days_left
         FROM assets
        WHERE deleted_at IS NULL
          AND status NOT IN ('retired', 'lost')
          AND custom ->> $1 ~ '^\\d{4}-\\d{2}-\\d{2}$'
          AND (custom ->> $1)::date BETWEEN current_date
                                        AND current_date + ($2 || ' days')::interval
        ORDER BY (custom ->> $1)::date`,
      [field, String(days)],
    )).rows,
  );

const WINDOW_DAYS = Number(process.env.EXPIRY_WINDOW_DAYS ?? 90);

const JOBS = [
  { field: "warranty_end", event: "warranty.expiring", key: "warranty" },
  { field: "license_expiry", event: "licence.expiring", key: "licence" },
  { field: "next_service_at", event: "maintenance.due", key: "maintenance" },
] as const;

/** Drops assets that have an active maintenance schedule of their own. */
async function withoutScheduledAssets<T extends { id: string }>(
  ctx: Ctx,
  rows: T[],
): Promise<T[]> {
  if (rows.length === 0) return rows;

  const scheduled = await withTenant(ctx.orgId, async (c) =>
    (await c.query<{ asset_id: string }>(
      `SELECT DISTINCT asset_id FROM maintenance_schedules
        WHERE active AND asset_id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)],
    )).rows.map((r) => r.asset_id),
  );

  const has = new Set(scheduled);
  return rows.filter((r) => !has.has(r.id));
}

export async function runExpiryJobs(
  ctx: Ctx,
): Promise<{ warranty: number; licence: number; maintenance: number }> {
  const counts = { warranty: 0, licence: 0, maintenance: 0 };

  for (const job of JOBS) {
    let rows = await findExpiring(ctx, job.field, WINDOW_DAYS);

    // A recurring schedule supersedes the one-off `next_service_at` field: it
    // knows when the service was last done and when the next is due, which a
    // single date cannot. Without this both would chase the same asset, and
    // the field would keep pointing at a date in the past after each service.
    if (job.key === "maintenance") {
      rows = await withoutScheduledAssets(ctx, rows);
    }

    for (const row of rows) {
      const marker = `${job.event}.notified`;
      // Once per asset per window, not once per day — an expiry notice repeated
      // daily for 90 days trains people to ignore it.
      const alreadySent = await withTenant(ctx.orgId, async (c) =>
        (await c.query(
          `SELECT 1 FROM audit_events
            WHERE asset_id = $1 AND event = $2
              AND created_at > now() - ($3 || ' days')::interval
            LIMIT 1`,
          [row.id, marker, String(WINDOW_DAYS)],
        )).rowCount === 1,
      );
      if (alreadySent) continue;

      await dispatch(ctx, job.event, {
        assetId: row.id,
        asset: { name: row.name, asset_tag: row.asset_tag, custom: row.custom },
        expires_on: row.expires_on,
        days_left: row.days_left,
      });
      await withTenant(ctx.orgId, (c) =>
        recordEvent(c, ctx, {
          assetId: row.id, event: marker,
          note: `${job.field} on ${row.expires_on} (${row.days_left} days)`,
        }),
      );
      counts[job.key]++;
    }
  }
  return counts;
}
