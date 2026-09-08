import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import ReportTable from "../../components/reports/ReportTable";
import ReportFilters, { type ReportParams } from "../../components/reports/ReportFilters";
import ScheduleDialog from "../../components/reports/ScheduleDialog";
import { useModal } from "../../hooks/useModal";
import { reportsApi } from "../../api/reports";
import { useAuth } from "../../context/AuthContext";
import type { ReportResult } from "../../api/types";
import { formatDateTime } from "../../lib/datetime";

// ApexCharts is 590 kB. The table is the report; the chart illustrates it, and
// several reports declare no chart at all, so it loads separately.
const ReportChart = lazy(() => import("../../components/reports/ReportChart"));

/** The URL is the report's state, so a filtered view can be linked and saved. */
function paramsFromSearch(search: URLSearchParams): ReportParams {
  const status = search.getAll("status");
  return {
    category_id: search.get("category_id") ?? undefined,
    location_id: search.get("location_id") ?? undefined,
    status: status.length ? status : undefined,
    from: search.get("from") ?? undefined,
    to: search.get("to") ?? undefined,
  };
}

function searchFromParams(params: ReportParams): URLSearchParams {
  const search = new URLSearchParams();
  if (params.category_id) search.set("category_id", params.category_id);
  if (params.location_id) search.set("location_id", params.location_id);
  for (const status of params.status ?? []) search.append("status", status);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  return search;
}

export default function ReportViewer() {
  const { key = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();
  const scheduleModal = useModal();

  const [result, setResult] = useState<ReportResult | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = Object.fromEntries(searchParams);

  const load = useCallback(() => {
    setError(null);
    reportsApi.run(key, params)
      .then(setResult)
      .catch(() => setError("Could not run this report."));
    // params is derived from searchParams; depending on the string keeps this stable.
  }, [key, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(load, [load]);

  async function saveView() {
    const name = window.prompt("Name this saved report");
    if (!name) return;
    const saved = await reportsApi.save({ name, report_key: key, params });
    setSavedId(saved.id);
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
        {error}
      </div>
    );
  }
  if (!result) return <p className="p-8 text-sm text-gray-500">Running report…</p>;

  const download = (format: "csv" | "xlsx" | "pdf" | "png") =>
    void reportsApi.download(key, params, format);

  const buttonClass =
    "rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset " +
    "ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 " +
    "dark:hover:bg-white/[0.03]";

  return (
    <>
      <PageMeta title={`${result.name} | AMS`} description={result.description} />
      <PageBreadcrumb pageTitle={result.name} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{result.description}</p>
          <p className="text-theme-xs text-gray-400">
            {result.filter_summary} · {result.rows.length.toLocaleString("en-GB")} rows ·
            generated {formatDateTime(result.generated_at)}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          {(["csv", "xlsx", "pdf", "png"] as const).map((format) => (
            <button key={format} type="button" className={buttonClass}
                    onClick={() => download(format)}>
              {format.toUpperCase()}
            </button>
          ))}
          <button type="button" className={buttonClass} onClick={() => void saveView()}>
            Save this view
          </button>
          {can("reports:schedule") && savedId && (
            <button
              type="button"
              onClick={scheduleModal.openModal}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Schedule by email
            </button>
          )}
        </div>
      </div>

      <div className="space-y-5">
        <ComponentCard title="Filters" desc="Narrow the report, then save or export the result.">
          <ReportFilters
            value={paramsFromSearch(searchParams)}
            onApply={(next) => setSearchParams(searchFromParams(next))}
          />
        </ComponentCard>

        {result.chart.type !== "none" && (
          <ComponentCard title="Chart">
            <Suspense
              fallback={
                <div className="h-[320px] animate-pulse rounded-xl bg-gray-100 dark:bg-white/[0.03]" />
              }
            >
              <ReportChart result={result} />
            </Suspense>
          </ComponentCard>
        )}
        <ComponentCard title="Data">
          <ReportTable result={result} />
        </ComponentCard>
      </div>

      {savedId && (
        <ScheduleDialog
          savedReportId={savedId}
          isOpen={scheduleModal.isOpen}
          onClose={scheduleModal.closeModal}
          onDone={scheduleModal.closeModal}
        />
      )}
    </>
  );
}
