import type { Ctx } from "../http/handler";
import { REPORTS } from "./definitions";
import type { ReportParams, ReportResult } from "./types";

export { REPORTS };
export * from "./types";

const asDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });

/** A human sentence describing the filter set, printed in the PDF and XLSX headers. */
export function describeFilters(params: ReportParams): string {
  const parts: string[] = [];
  if (params.days) parts.push(`Next ${params.days} days`);
  if (params.from && params.to) parts.push(`${asDate(params.from)} - ${asDate(params.to)}`);
  else if (params.from) parts.push(`From ${asDate(params.from)}`);
  else if (params.to) parts.push(`Up to ${asDate(params.to)}`);
  if (params.status?.length) parts.push(`Status: ${params.status.join(", ")}`);
  if (params.category_id) parts.push("Filtered by category");
  if (params.location_id) parts.push("Filtered by location");
  return parts.length ? parts.join(" \u00b7 ") : "All assets";
}

export async function runReport(
  ctx: Ctx,
  key: string,
  params: ReportParams,
): Promise<ReportResult> {
  const definition = REPORTS[key];
  if (!definition) throw new Error(`unknown report: ${key}`);

  const rows = await definition.run(ctx, params);
  return {
    key: definition.key,
    name: definition.name,
    description: definition.description,
    generated_at: new Date().toISOString(),
    params,
    filter_summary: describeFilters(params),
    columns: definition.columns,
    chart: definition.chart,
    rows,
    totals: definition.totals?.(rows) ?? null,
  };
}

export function parseReportParams(url: URL): ReportParams {
  const status = url.searchParams.getAll("status").flatMap((s) => s.split(","))
    .filter(Boolean);
  const days = Number(url.searchParams.get("days"));
  const limit = Number(url.searchParams.get("limit"));
  return {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    category_id: url.searchParams.get("category_id") ?? undefined,
    location_id: url.searchParams.get("location_id") ?? undefined,
    status: status.length ? status : undefined,
    days: Number.isFinite(days) && days > 0 ? Math.min(days, 3650) : undefined,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : undefined,
  };
}
