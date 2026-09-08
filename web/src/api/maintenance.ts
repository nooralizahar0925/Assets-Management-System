import { api } from "./client";
import { formatDate } from "../lib/datetime";

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

export interface ScheduleInput {
  asset_id: string;
  description: string;
  every_days?: number | null;
  every_hours?: number | null;
  current_hours?: number | null;
  next_due_at?: string | null;
}

export interface ServiceInput {
  at: string;
  hours?: number | null;
  note?: string | null;
  cost?: number | null;
}

export const maintenanceApi = {
  schedules: (assetId?: string) =>
    api.get<MaintenanceSchedule[]>(
      "/api/v1/maintenance/schedules",
      assetId ? { asset_id: assetId } : undefined,
    ),

  createSchedule: (input: ScheduleInput) =>
    api.post<MaintenanceSchedule>("/api/v1/maintenance/schedules", input),

  complete: (id: string, input: ServiceInput) =>
    api.post<MaintenanceSchedule>(
      `/api/v1/maintenance/schedules/${id}/complete`, input,
    ),

  services: (assetId: string) =>
    api.get<MaintenanceEvent[]>("/api/v1/maintenance/services", { asset_id: assetId }),
};

/** How a schedule reads on screen: a date, a meter, or both. */
export function describeDue(schedule: MaintenanceSchedule): string {
  const parts: string[] = [];
  if (schedule.next_due_at) {
    parts.push(formatDate(schedule.next_due_at));
  }
  if (schedule.next_due_hours !== null) {
    const now = schedule.current_hours ?? 0;
    parts.push(`${schedule.next_due_hours} hours (now ${now})`);
  }
  return parts.join(" · ") || "No due date";
}

/** Negative means overdue; null when the schedule runs on hours alone. */
export function daysUntilDue(schedule: MaintenanceSchedule): number | null {
  if (!schedule.next_due_at) return null;
  const due = new Date(`${schedule.next_due_at}T00:00:00Z`).getTime();
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((due - today) / 86_400_000);
}
