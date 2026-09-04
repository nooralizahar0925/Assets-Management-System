import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { dispatch } from "../notify/dispatch";
import { recordEvent } from "../domain/audit";

export interface OverdueRow {
  assignment_id: string;
  asset_id: string;
  asset_name: string;
  asset_tag: string;
  assignee_id: string | null;
  assignee_label: string | null;
  due_at: string;
  days_late: number;
}

export const findOverdue = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<OverdueRow>(
      `SELECT a.id AS assignment_id, s.id AS asset_id, s.name AS asset_name,
              s.asset_tag, a.assignee_id, a.assignee_label, a.due_at,
              floor(extract(epoch FROM now() - a.due_at) / 86400)::int AS days_late
         FROM assignments a
         JOIN assets s ON s.id = a.asset_id
        WHERE a.checked_in_at IS NULL
          AND a.due_at IS NOT NULL
          AND a.due_at < now()
          AND s.deleted_at IS NULL
        ORDER BY a.due_at`,
    )).rows,
  );

/**
 * One notification per overdue assignment per day. The de-duplication key is an
 * audit event, so a job that runs hourly does not send hourly email.
 */
export async function runOverdueJob(ctx: Ctx): Promise<{ notified: number }> {
  const overdue = await findOverdue(ctx);
  let notified = 0;

  for (const row of overdue) {
    const alreadySent = await withTenant(ctx.orgId, async (c) =>
      (await c.query(
        `SELECT 1 FROM audit_events
          WHERE asset_id = $1 AND event = 'asset.overdue_notified'
            AND created_at > date_trunc('day', now())
          LIMIT 1`,
        [row.asset_id],
      )).rowCount === 1,
    );
    if (alreadySent) continue;

    await dispatch(ctx, "asset.overdue", {
      assetId: row.asset_id,
      assigneeId: row.assignee_id,
      asset: { name: row.asset_name, asset_tag: row.asset_tag },
      assignment: { due_at: row.due_at, days_late: row.days_late },
    });

    await withTenant(ctx.orgId, (c) =>
      recordEvent(c, ctx, {
        assetId: row.asset_id,
        event: "asset.overdue_notified",
        note: `${row.days_late} day(s) overdue`,
      }),
    );
    notified++;
  }
  return { notified };
}
