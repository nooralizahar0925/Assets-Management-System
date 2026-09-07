import { useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import {
  reportsApi, type ReportSummary, type SavedReport, type ReportSchedule,
} from "../../api/reports";
import { useAuth } from "../../context/AuthContext";

export default function ReportGallery() {
  const { can } = useAuth();
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);

  // The schedules endpoint requires reports:schedule, not the "admin" API scope.
  const canSchedule = can("reports:schedule");

  useEffect(() => {
    void reportsApi.list().then(setReports).catch(() => undefined);
    void reportsApi.saved().then(setSaved).catch(() => undefined);
    if (canSchedule) {
      void reportsApi.schedules().then(setSchedules).catch(() => undefined);
    }
  }, [canSchedule]);

  return (
    <>
      <PageMeta title="Reports | AMS" description="Reports and exports" />
      <PageBreadcrumb pageTitle="Reports" />

      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => (
            <Link
              key={report.key}
              to={`/reports/${report.key}`}
              className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-500/40"
            >
              <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
                {report.name}
              </h3>
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                {report.description}
              </p>
              <p className="mt-3 text-theme-xs uppercase tracking-wide text-gray-400">
                {report.formats.join(" · ")}
              </p>
            </Link>
          ))}
        </div>

        {saved.length > 0 && (
          <ComponentCard title="Saved reports" desc="Your named filter sets.">
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {saved.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0">
                  <Link
                    to={`/reports/${item.report_key}?${new URLSearchParams(
                      item.params as Record<string, string>,
                    )}`}
                    className="text-sm font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                  >
                    {item.name}
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      await reportsApi.removeSaved(item.id);
                      setSaved((current) => current.filter((s) => s.id !== item.id));
                    }}
                    className="ml-auto text-theme-xs text-gray-400 hover:text-error-500"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </ComponentCard>
        )}

        {canSchedule && schedules.length > 0 && (
          <ComponentCard title="Scheduled deliveries" desc="Reports emailed automatically.">
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {schedules.map((schedule) => (
                <li key={schedule.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {schedule.report_name ?? "Report"}
                  </span>
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400">
                    {schedule.cadence} · {String(schedule.hour_utc).padStart(2, "0")}:00 UTC ·{" "}
                    {schedule.format.toUpperCase()} · {schedule.recipients.join(", ")}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await reportsApi.removeSchedule(schedule.id);
                      setSchedules((current) => current.filter((s) => s.id !== schedule.id));
                    }}
                    className="ml-auto text-theme-xs text-gray-400 hover:text-error-500"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </ComponentCard>
        )}
      </div>
    </>
  );
}
