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

/**
 * Negative means overdue; null when the schedule runs on hours alone.
 *
 * Counted in the reader's calendar. Both sides of this used to be built in UTC,
 * which is a different date from the one on the reader's wall for part of every
 * day - east of UTC in the morning, west of it in the evening. A service due
 * today then read as due tomorrow, and one a day late read as due today, to
 * everybody in Jakarta before about seven in the morning.
 */
export function daysUntilDue(schedule: MaintenanceSchedule): number | null {
  if (!schedule.next_due_at) return null;

  // Parsed field by field: `new Date("2026-09-13")` is parsed as UTC midnight,
  // which puts it on the previous day for anybody west of UTC and reintroduces
  // exactly the bug this function had.
  const [year, month, day] = schedule.next_due_at.split("-").map(Number);
  const due = new Date(year, month - 1, day).getTime();

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // Rounded, not truncated: a daylight-saving change makes one of these days
  // 23 or 25 hours long, and a truncated division loses or gains a day.
  return Math.round((due - today) / 86_400_000);
}
