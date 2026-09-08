import { z } from "zod";
import { withTenant } from "../db";
import { recordEvent } from "./audit";
import type { Ctx } from "../http/handler";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const ScheduleInput = z.object({
  asset_id: z.string().uuid(),
  description: z.string().min(1).max(200),
  every_days: z.number().int().positive().nullish(),
  every_hours: z.number().int().positive().nullish(),
  /** The meter reading when the schedule is set up. */
  current_hours: z.number().int().min(0).nullish(),
  next_due_at: z.string().regex(DATE).nullish(),
  active: z.boolean().default(true),
}).refine(
  (v) => v.every_days != null || v.every_hours != null,
  { message: "A schedule needs an interval in days or in running hours." },
);
export type ScheduleInput = z.input<typeof ScheduleInput>;

export const ServiceInput = z.object({
  at: z.string().regex(DATE),
  hours: z.number().int().min(0).nullish(),
  note: z.string().max(2000).nullish(),
  cost: z.number().min(0).nullish(),
});
export type ServiceInput = z.input<typeof ServiceInput>;

export interface MaintenanceSchedule {
  id: string;
  asset_id: string;
  asset_name?: string;
  description: string;
  every_days: number | null;
  every_hours: number | null;
  next_due_at: string | null;
  next_due_hours: number | null;
  current_hours: number | null;
  last_service_at: string | null;
  active: boolean;
}

export interface MaintenanceEvent {
  id: string;
  asset_id: string;
  serviced_at: string;
  hours: number | null;
  note: string | null;
  cost: string | null;
}

const SCHEDULE_COLUMNS = `s.id, s.asset_id, a.name AS asset_name, s.description,
  s.every_days, s.every_hours, s.next_due_at::text AS next_due_at,
  s.next_due_hours, s.current_hours, s.last_service_at::text AS last_service_at,
  s.active`;

const addDays = (from: string, days: number) =>
  new Date(new Date(`${from}T00:00:00Z`).getTime() + days * 86_400_000)
    .toISOString().slice(0, 10);

const todayIso = () => new Date().toISOString().slice(0, 10);

export async function createSchedule(
  ctx: Ctx,
  raw: ScheduleInput,
): Promise<MaintenanceSchedule> {
  const input = ScheduleInput.parse(raw);

  // A day schedule with no explicit start becomes due one interval from now;
  // an hour schedule one interval past the current reading.
  const nextDueAt = input.every_days
    ? input.next_due_at ?? addDays(todayIso(), input.every_days)
    : null;
  const currentHours = input.current_hours ?? (input.every_hours ? 0 : null);
  const nextDueHours = input.every_hours
    ? (currentHours ?? 0) + input.every_hours
    : null;

  return withTenant(ctx.orgId, async (c) =>
    (await c.query<MaintenanceSchedule>(
      `WITH inserted AS (
         INSERT INTO maintenance_schedules
           (org_id, asset_id, description, every_days, every_hours,
            next_due_at, next_due_hours, current_hours, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *
       )
       SELECT ${SCHEDULE_COLUMNS}
         FROM inserted s JOIN assets a ON a.id = s.asset_id`,
      [
        ctx.orgId, input.asset_id, input.description,
        input.every_days ?? null, input.every_hours ?? null,
        nextDueAt, nextDueHours, currentHours, input.active,
      ],
    )).rows[0],
  );
}

export const listSchedules = (ctx: Ctx, assetId?: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<MaintenanceSchedule>(
      `SELECT ${SCHEDULE_COLUMNS}
         FROM maintenance_schedules s JOIN assets a ON a.id = s.asset_id
        WHERE ($1::uuid IS NULL OR s.asset_id = $1)
          AND a.deleted_at IS NULL
        ORDER BY s.next_due_at NULLS LAST, a.name`,
      [assetId ?? null],
    )).rows,
  );

export const listServices = (ctx: Ctx, assetId: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<MaintenanceEvent>(
      `SELECT id, asset_id, serviced_at::text AS serviced_at, hours, note, cost
         FROM maintenance_events
        WHERE asset_id = $1
        ORDER BY serviced_at DESC, created_at DESC`,
      [assetId],
    )).rows,
  );

/** Updates the meter, which is what makes an hour-based schedule come due. */
export const reportHours = (ctx: Ctx, scheduleId: string, hours: number) =>
  withTenant(ctx.orgId, async (c) => {
    await c.query(
      "UPDATE maintenance_schedules SET current_hours = $2 WHERE id = $1",
      [scheduleId, hours],
    );
  });

/**
 * Schedules needing attention within `withinDays`.
 *
 * A day schedule is due when its date falls inside the window; an hour
 * schedule when the reported meter has reached its threshold. Hours have no
 * window: a machine either has run the hours or it has not.
 */
export const dueSchedules = (ctx: Ctx, withinDays: number) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<MaintenanceSchedule>(
      `SELECT ${SCHEDULE_COLUMNS}
         FROM maintenance_schedules s JOIN assets a ON a.id = s.asset_id
        WHERE s.active
          AND a.deleted_at IS NULL
          AND a.status NOT IN ('retired', 'lost')
          AND (
            (s.next_due_at IS NOT NULL
              AND s.next_due_at <= current_date + ($1 || ' days')::interval)
            OR
            (s.next_due_hours IS NOT NULL
              AND s.current_hours IS NOT NULL
              AND s.current_hours >= s.next_due_hours)
          )
        ORDER BY s.next_due_at NULLS LAST`,
      [withinDays],
    )).rows,
  );

/**
 * Records a completed service and rolls the schedule forward.
 *
 * Forward **from the completion**, not from the previous due date. Rolling from
 * the due date means one late service compresses every interval after it: a
 * quarterly service done three weeks late would fall due again nine weeks
 * later, then sooner still.
 */
export async function completeService(
  ctx: Ctx,
  scheduleId: string,
  raw: ServiceInput,
): Promise<MaintenanceSchedule> {
  const input = ServiceInput.parse(raw);

  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<MaintenanceSchedule>(
      `SELECT ${SCHEDULE_COLUMNS}
         FROM maintenance_schedules s JOIN assets a ON a.id = s.asset_id
        WHERE s.id = $1`,
      [scheduleId],
    );
    const schedule = rows[0];
    if (!schedule) throw new Error(`No such maintenance schedule: ${scheduleId}`);

    const hours = input.hours ?? schedule.current_hours;
    const nextDueAt = schedule.every_days
      ? addDays(input.at, schedule.every_days)
      : schedule.next_due_at;
    const nextDueHours = schedule.every_hours
      ? (hours ?? 0) + schedule.every_hours
      : schedule.next_due_hours;

    await c.query(
      `INSERT INTO maintenance_events
         (org_id, schedule_id, asset_id, serviced_at, hours, note, cost)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        ctx.orgId, scheduleId, schedule.asset_id, input.at,
        input.hours ?? null, input.note ?? null, input.cost ?? null,
      ],
    );

    await c.query(
      `UPDATE maintenance_schedules
          SET last_service_at = $2, next_due_at = $3,
              next_due_hours = $4, current_hours = coalesce($5, current_hours)
        WHERE id = $1`,
      [scheduleId, input.at, nextDueAt, nextDueHours, input.hours ?? null],
    );

    await recordEvent(c, ctx, {
      assetId: schedule.asset_id,
      event: "asset.serviced",
      changes: {
        next_due_at: { from: schedule.next_due_at, to: nextDueAt },
      },
      note: input.note ?? schedule.description,
    });

    const { rows: after } = await c.query<MaintenanceSchedule>(
      `SELECT ${SCHEDULE_COLUMNS}
         FROM maintenance_schedules s JOIN assets a ON a.id = s.asset_id
        WHERE s.id = $1`,
      [scheduleId],
    );
    return after[0];
  });
}
