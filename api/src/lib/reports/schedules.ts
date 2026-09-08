import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { systemCtx } from "../jobs/context";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import { putObject } from "../storage/s3";
import { enqueueTemplated } from "../email/outbox";
import { logError } from "../http/logger";
import { runReport } from "./engine";
import type { ReportParams, ReportResult } from "./types";
import { renderCsv } from "./renderers/csv";
import { renderXlsx } from "./renderers/xlsx";
import { renderPdf } from "./renderers/pdf";
import { renderPng } from "./renderers/svg";

export const SCHEDULE_FORMATS = ["csv", "xlsx", "pdf", "png"] as const;
export const CADENCES = ["daily", "weekly", "monthly"] as const;

export const ScheduleInput = z.object({
  saved_report_id: z.string().uuid(),
  format: z.enum(SCHEDULE_FORMATS).default("pdf"),
  cadence: z.enum(CADENCES).default("weekly"),
  day_of_week: z.number().int().min(0).max(6).nullish(),
  // Capped at 28 so a monthly schedule fires in February too.
  day_of_month: z.number().int().min(1).max(28).nullish(),
  hour_utc: z.number().int().min(0).max(23).default(8),
  recipients: z.array(z.string().email()).min(1),
  active: z.boolean().default(true),
});
export type ScheduleInput = z.infer<typeof ScheduleInput>;

export interface Schedule {
  id: string;
  org_id: string;
  saved_report_id: string;
  format: (typeof SCHEDULE_FORMATS)[number];
  cadence: (typeof CADENCES)[number];
  day_of_week: number | null;
  day_of_month: number | null;
  hour_utc: number;
  recipients: string[];
  active: boolean;
  last_run_at: string | null;
  report_key?: string;
  report_name?: string;
  params?: Record<string, unknown>;
}

const SELECT = `
  SELECT s.id, s.org_id, s.saved_report_id, s.format, s.cadence, s.day_of_week,
         s.day_of_month, s.hour_utc, s.recipients, s.active, s.last_run_at,
         r.report_key, r.name AS report_name, r.params
    FROM report_schedules s
    JOIN saved_reports r ON r.id = s.saved_report_id`;

export const listSchedules = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Schedule>(`${SELECT} ORDER BY r.name`)).rows,
  );

// async for the same reason as createAsset: validation must reject, not throw.
export const createSchedule = async (ctx: Ctx, input: ScheduleInput) => {
  const parsed = ScheduleInput.parse(input);
  return withTenant(ctx.orgId, async (c) =>
    (await c.query<Schedule>(
      `INSERT INTO report_schedules
         (org_id, saved_report_id, format, cadence, day_of_week, day_of_month,
          hour_utc, recipients, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, org_id, saved_report_id, format, cadence, day_of_week,
                 day_of_month, hour_utc, recipients, active, last_run_at`,
      [
        ctx.orgId, parsed.saved_report_id, parsed.format, parsed.cadence,
        parsed.day_of_week ?? null, parsed.day_of_month ?? null, parsed.hour_utc,
        JSON.stringify(parsed.recipients), parsed.active,
      ],
    )).rows[0],
  );
};

export const updateSchedule = (ctx: Ctx, id: string, patch: Partial<ScheduleInput>) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Schedule>(
      `UPDATE report_schedules SET
         format       = coalesce($2, format),
         cadence      = coalesce($3, cadence),
         day_of_week  = coalesce($4, day_of_week),
         day_of_month = coalesce($5, day_of_month),
         hour_utc     = coalesce($6, hour_utc),
         recipients   = coalesce($7, recipients),
         active       = coalesce($8, active)
       WHERE id = $1
       RETURNING id, org_id, saved_report_id, format, cadence, day_of_week,
                 day_of_month, hour_utc, recipients, active, last_run_at`,
      [
        id, patch.format ?? null, patch.cadence ?? null, patch.day_of_week ?? null,
        patch.day_of_month ?? null, patch.hour_utc ?? null,
        patch.recipients ? JSON.stringify(patch.recipients) : null,
        patch.active ?? null,
      ],
    )).rows[0] ?? null,
  );

export const deleteSchedule = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query("DELETE FROM report_schedules WHERE id = $1 RETURNING id", [id]))
      .rows.length > 0,
  );

/**
 * Fires at most once per scheduled hour. The runner ticks more often than
 * hourly, so the last_run_at guard is what keeps a report from being emailed
 * twice - the same reasoning as the audit marker on the overdue job.
 */
export function isDue(schedule: Schedule, now = new Date()): boolean {
  if (now.getUTCHours() !== schedule.hour_utc) return false;
  if (schedule.cadence === "weekly" && now.getUTCDay() !== schedule.day_of_week) {
    return false;
  }
  if (schedule.cadence === "monthly" && now.getUTCDate() !== schedule.day_of_month) {
    return false;
  }

  if (schedule.last_run_at) {
    const last = new Date(schedule.last_run_at);
    const sameHour =
      last.getUTCFullYear() === now.getUTCFullYear() &&
      last.getUTCMonth() === now.getUTCMonth() &&
      last.getUTCDate() === now.getUTCDate() &&
      last.getUTCHours() === now.getUTCHours();
    if (sameHour) return false;
  }
  return true;
}

async function renderTo(
  result: ReportResult,
  format: Schedule["format"],
): Promise<{ body: Buffer; contentType: string; extension: string }> {
  const response =
    format === "csv" ? renderCsv(result)
    : format === "xlsx" ? await renderXlsx(result)
    : format === "png" ? await renderPng(result)
    : await renderPdf(result);

  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    extension: format,
  };
}


/** Runs every organisation's due schedules and queues them for delivery. */
export async function runDueSchedules(now = new Date()): Promise<{ delivered: number }> {
  // Pre-tenant enumeration - see migration 013.
  const orgs = await query<{ id: string; name: string }>(
    "SELECT * FROM scheduler_list_organizations()",
  );
  let delivered = 0;

  for (const org of orgs) {
    const ctx = systemCtx(org.id, org.name);

    let schedules: Schedule[];
    try {
      schedules = await withTenant(org.id, async (c) =>
        (await c.query<Schedule>(`${SELECT} WHERE s.active = true`)).rows,
      );
    } catch (err) {
      logError(`reading report schedules for org ${org.id}`, err);
      continue;
    }

    for (const schedule of schedules) {
      if (!isDue(schedule, now)) continue;
      try {
        const result = await runReport(
          ctx, schedule.report_key!, (schedule.params ?? {}) as ReportParams,
        );
        const file = await renderTo(result, schedule.format);

        // Attachments travel through object storage, so a large workbook never
        // sits in a database row or in memory between queue and send.
        const date = result.generated_at.slice(0, 10);
        const filename = `${result.key}-${date}.${file.extension}`;
        const objectKey = `${org.id}/reports/${randomUUID()}-${filename}`;
        await putObject(objectKey, file.body, file.contentType);

        await enqueueTemplated(
          ctx, "report.scheduled", schedule.recipients,
          {
            report: {
              name: schedule.report_name,
              format: schedule.format.toUpperCase(),
              period: result.filter_summary,
              generated_at: result.generated_at,
            },
            org: { name: org.name },
          },
          {
            event: "report.scheduled",
            attachments: [
              { filename, object_key: objectKey, content_type: file.contentType },
            ],
          },
        );

        // Stamped only after the message is queued, so a failure mid-render
        // retries on the next tick rather than silently skipping a period.
        await withTenant(org.id, (c) =>
          c.query("UPDATE report_schedules SET last_run_at = now() WHERE id = $1",
            [schedule.id]),
        );
        delivered++;
      } catch (err) {
        logError(`report schedule ${schedule.id}`, err);
      }
    }
  }
  return { delivered };
}
