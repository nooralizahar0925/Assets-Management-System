import { api, downloadBlob, type Params } from "./client";
import type { ChartSpec, ReportColumn, ReportResult } from "./types";

export interface ReportSummary {
  key: string;
  name: string;
  description: string;
  columns: ReportColumn[];
  chart: ChartSpec;
  formats: string[];
}

export interface SavedReport {
  id: string;
  name: string;
  report_key: string;
  params: Record<string, unknown>;
  created_at: string;
}

export interface ReportSchedule {
  id: string;
  saved_report_id: string;
  report_name?: string;
  format: "csv" | "xlsx" | "pdf" | "png";
  cadence: "daily" | "weekly" | "monthly";
  day_of_week: number | null;
  day_of_month: number | null;
  hour_utc: number;
  recipients: string[];
  active: boolean;
  last_run_at: string | null;
}

export const reportsApi = {
  list: () => api.get<ReportSummary[]>("/api/v1/reports"),

  run: (key: string, params: Params) =>
    api.get<ReportResult>(`/api/v1/reports/${key}`, { ...params, format: "json" }),

  download: async (
    key: string,
    params: Params,
    format: "csv" | "xlsx" | "pdf" | "png",
  ) => {
    const blob = await api.blob(`/api/v1/reports/${key}`, { ...params, format });
    downloadBlob(blob, `${key}-${new Date().toISOString().slice(0, 10)}.${format}`);
  },

  saved: () => api.get<SavedReport[]>("/api/v1/saved-reports"),
  save: (input: { name: string; report_key: string; params: Record<string, unknown> }) =>
    api.post<SavedReport>("/api/v1/saved-reports", input),
  removeSaved: (id: string) => api.del(`/api/v1/saved-reports/${id}`),

  schedules: () => api.get<ReportSchedule[]>("/api/admin/report-schedules"),
  schedule: (input: Omit<ReportSchedule, "id" | "last_run_at" | "report_name">) =>
    api.post<ReportSchedule>("/api/admin/report-schedules", input),
  removeSchedule: (id: string) => api.del(`/api/admin/report-schedules/${id}`),
};
