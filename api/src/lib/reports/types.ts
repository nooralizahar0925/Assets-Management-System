import type { Ctx } from "../http/handler";

export interface ReportParams {
  from?: string;
  to?: string;
  category_id?: string;
  location_id?: string;
  status?: string[];
  days?: number;
  limit?: number;
}

export type ColumnType = "string" | "number" | "date" | "money" | "percent";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

/**
 * The chart is described once, here, and drawn by both ApexCharts in the browser
 * and the server-side SVG renderer. A chart added to a report appears in the
 * dashboard, the PDF and the PNG at the same time.
 */
export interface ChartSpec {
  type: "donut" | "bar" | "column" | "line" | "none";
  categoryKey: string;
  valueKeys: string[];
  valueLabel: string;
}

export type ReportRow = Record<string, string | number | null>;

export interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  columns: ReportColumn[];
  chart: ChartSpec;
  run(ctx: Ctx, params: ReportParams): Promise<ReportRow[]>;
  totals?(rows: ReportRow[]): ReportRow | null;
}

export interface ReportResult {
  key: string;
  name: string;
  description: string;
  generated_at: string;
  params: ReportParams;
  filter_summary: string;
  columns: ReportColumn[];
  chart: ChartSpec;
  rows: ReportRow[];
  totals: ReportRow | null;
}
