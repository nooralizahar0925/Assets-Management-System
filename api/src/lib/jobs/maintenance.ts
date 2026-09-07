import { withTenant } from "../db";
import { dispatch } from "../notify/dispatch";
import { dueSchedules } from "../domain/maintenance";
import type { Ctx } from "../http/handler";

/** How far ahead a service is worth warning about. */
const WINDOW_DAYS = Number(process.env.MAINTENANCE_WINDOW_DAYS ?? 14);

/**
 * Tells people what needs servicing.
 *
 * Notified once per schedule per window rather than once per night: a notice
 * repeated every evening for a fortnight teaches people to filter it, and then
 * the one that matters is filtered too. The marker is an audit event, the same
 * mechanism the expiry sweep uses.
 */
export async function runMaintenanceJob(ctx: Ctx): Promise<{ notified: number }> {
  const due = await dueSchedules(ctx, WINDOW_DAYS);
  let notified = 0;

  for (const schedule of due) {
    const alreadySent = await withTenant(ctx.orgId, async (c) =>
      (await c.query(
        `SELECT 1 FROM audit_events
          WHERE asset_id = $1 AND event = 'maintenance.due.notified'
            AND created_at > now() - ($2 || ' days')::interval
          LIMIT 1`,
        [schedule.asset_id, WINDOW_DAYS],
      )).rowCount,
    );
    if (alreadySent) continue;

    await dispatch(ctx, "maintenance.due", {
      asset_id: schedule.asset_id,
      asset_name: schedule.asset_name ?? "",
      description: schedule.description,
      due_on: schedule.next_due_at ?? "",
      due_hours: schedule.next_due_hours ?? "",
    });

    await withTenant(ctx.orgId, async (c) => {
      await c.query(
        `INSERT INTO audit_events
           (org_id, asset_id, actor_type, actor_label, event, changes, note)
         VALUES ($1, $2, 'system', 'Scheduler', 'maintenance.due.notified', '{}', $3)`,
        [ctx.orgId, schedule.asset_id, schedule.description],
      );
    });

    notified += 1;
  }

  return { notified };
}
