import type { Ctx } from "../../http/handler";
import type { ReportParams, ReportRow } from "../types";

/**
 * Shared WHERE fragment so every report filters identically - including the
 * caller's branch scope.
 *
 * Scope belongs here rather than in each report: a report that forgot it would
 * quietly show a branch-limited user the whole company, and a report is exactly
 * the artefact somebody circulates without checking who could see it.
 *
 * `alias` is the assets table's alias in the calling query, supplied by the
 * report itself - never derived from request input.
 */
export function assetFilters(
  ctx: Ctx,
  params: ReportParams,
  values: unknown[],
  alias = "a",
): string {
  const clauses = [`${alias}.deleted_at IS NULL`];

  if (params.category_id) {
    clauses.push(`${alias}.category_id = $${values.push(params.category_id)}`);
  }
  if (params.location_id) {
    clauses.push(`${alias}.location_id = $${values.push(params.location_id)}`);
  }
  if (params.status?.length) {
    clauses.push(`${alias}.status = ANY($${values.push(params.status)}::asset_status[])`);
  }
  if (params.from) {
    clauses.push(`${alias}.created_at >= $${values.push(params.from)}::timestamptz`);
  }
  if (params.to) {
    clauses.push(`${alias}.created_at <= $${values.push(params.to)}::timestamptz`);
  }
  if (ctx.actor.locationScope !== null) {
    clauses.push(
      `${alias}.location_id = ANY($${values.push(ctx.actor.locationScope)}::uuid[])`,
    );
  }

  return clauses.join(" AND ");
}

export const sumBy = (rows: ReportRow[], key: string) =>
  rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
