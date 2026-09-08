import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Badge from "../../components/ui/badge/Badge";
import { useAuth } from "../../context/AuthContext";
import {
  maintenanceApi, describeDue, daysUntilDue, type MaintenanceSchedule,
} from "../../api/maintenance";
import { formatDate } from "../../lib/datetime";

/**
 * Overdue first, then what is coming.
 *
 * An hour-based schedule has no date to sort by, so it sits with the upcoming
 * work unless its meter has already passed the threshold.
 */
function partition(schedules: MaintenanceSchedule[]) {
  const overdue: MaintenanceSchedule[] = [];
  const upcoming: MaintenanceSchedule[] = [];

  for (const schedule of schedules) {
    if (!schedule.active) continue;
    const days = daysUntilDue(schedule);
    const hoursReached =
      schedule.next_due_hours !== null
      && (schedule.current_hours ?? 0) >= schedule.next_due_hours;

    if ((days !== null && days < 0) || hoursReached) overdue.push(schedule);
    else upcoming.push(schedule);
  }
  return { overdue, upcoming };
}

function ScheduleRow({ schedule }: { schedule: MaintenanceSchedule }) {
  const days = daysUntilDue(schedule);
  return (
    <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
      <div className="min-w-0">
        <Link
          to={`/assets/${schedule.asset_id}`}
          className="text-sm font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
        >
          {schedule.asset_name ?? "Asset"}
        </Link>
        <p className="text-theme-xs text-gray-500 dark:text-gray-400">
          {schedule.description} · due {describeDue(schedule)}
        </p>
      </div>
      {days !== null && (
        <Badge color={days < 0 ? "error" : days <= 7 ? "warning" : "light"} size="sm">
          {days < 0
            ? `${Math.abs(days)} days overdue`
            : days === 0 ? "Due today" : `In ${days} days`}
        </Badge>
      )}
      {schedule.last_service_at && (
        <span className="ml-auto text-theme-xs text-gray-400">
          Last serviced {formatDate(schedule.last_service_at)}
        </span>
      )}
    </li>
  );
}

export default function MaintenanceList() {
  const { can } = useAuth();
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);

  const canRead = can("maintenance:read");

  const load = useCallback(() => {
    if (!canRead) return;
    void maintenanceApi.schedules().then(setSchedules).catch(() => undefined);
  }, [canRead]);

  useEffect(load, [load]);

  if (!canRead) {
    return (
      <>
        <PageMeta title="Maintenance | AMS" description="Service schedules" />
        <PageBreadcrumb pageTitle="Maintenance" />
        <div
          role="alert"
          className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            Maintenance is looked after by the people who service the assets
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500 dark:text-gray-400">
            Your role does not include service schedules.
          </p>
        </div>
      </>
    );
  }

  const { overdue, upcoming } = partition(schedules);

  return (
    <>
      <PageMeta title="Maintenance | AMS" description="Service schedules" />
      <PageBreadcrumb pageTitle="Maintenance" />

      <div className="space-y-5">
        <ComponentCard
          title={`Overdue (${overdue.length})`}
          desc="Past their date, or past their hours."
        >
          {overdue.length === 0 ? (
            <p className="py-6 text-center text-sm text-success-600">
              Nothing is overdue.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {overdue.map((s) => <ScheduleRow key={s.id} schedule={s} />)}
            </ul>
          )}
        </ComponentCard>

        <ComponentCard title="Coming up" desc="Scheduled work that is not due yet.">
          {upcoming.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              No service schedules yet. Add one from an asset&rsquo;s page.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {upcoming.map((s) => <ScheduleRow key={s.id} schedule={s} />)}
            </ul>
          )}
        </ComponentCard>
      </div>
    </>
  );
}
