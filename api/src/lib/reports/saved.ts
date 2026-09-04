import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { REPORTS } from "./definitions";

export const SavedReportInput = z.object({
  name: z.string().min(1).max(120),
  report_key: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});
export type SavedReportInput = z.infer<typeof SavedReportInput>;

export interface SavedReport {
  id: string;
  name: string;
  report_key: string;
  params: Record<string, unknown>;
  created_at: string;
}

export class UnknownReportError extends Error {}
export class DuplicateSavedReportError extends Error {}

export const listSavedReports = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<SavedReport>(
      `SELECT id, name, report_key, params, created_at
         FROM saved_reports ORDER BY lower(name)`,
    )).rows,
  );

export const getSavedReport = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<SavedReport>(
      `SELECT id, name, report_key, params, created_at
         FROM saved_reports WHERE id = $1`,
      [id],
    )).rows[0] ?? null,
  );

export async function createSavedReport(
  ctx: Ctx,
  input: SavedReportInput,
): Promise<SavedReport> {
  const parsed = SavedReportInput.parse(input);

  // Validated here rather than at the boundary so any future import path gets
  // the same check: a saved report pointing at a report that does not exist is
  // a scheduled email that fails silently every week.
  if (!REPORTS[parsed.report_key]) {
    throw new UnknownReportError(`unknown report: ${parsed.report_key}`);
  }

  return withTenant(ctx.orgId, async (c) => {
    try {
      const { rows } = await c.query<SavedReport>(
        `INSERT INTO saved_reports (org_id, name, report_key, params, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, report_key, params, created_at`,
        [
          ctx.orgId, parsed.name, parsed.report_key,
          JSON.stringify(parsed.params),
          ctx.actor.type === "user" ? ctx.actor.id : null,
        ],
      );
      return rows[0];
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new DuplicateSavedReportError(
          `A saved report called "${parsed.name}" already exists.`,
        );
      }
      throw err;
    }
  });
}

export const deleteSavedReport = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query("DELETE FROM saved_reports WHERE id = $1 RETURNING id", [id]))
      .rows.length > 0,
  );
