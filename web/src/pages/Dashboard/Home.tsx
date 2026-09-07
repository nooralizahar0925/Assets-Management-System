import { Suspense, lazy, useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import ComponentCard from "../../components/common/ComponentCard";
import KpiTiles from "../../components/dashboard/KpiTiles";

// ApexCharts is 590 kB - larger than the rest of the application put together.
// The KPI tiles are what people read first, and an empty register draws no
// charts at all, so the charting library arrives on its own after the page.
const StatusDonut = lazy(() => import("../../components/dashboard/StatusDonut"));
const CategoryBars = lazy(() => import("../../components/dashboard/CategoryBars"));
import RecentActivity from "../../components/dashboard/RecentActivity";
import ExpiringSoon from "../../components/dashboard/ExpiringSoon";
import { dashboardApi } from "../../api/dashboard";
import { useAuth } from "../../context/AuthContext";
import type { DashboardSummary } from "../../api/types";

/** Holds the card's height while the charting library loads, so nothing jumps. */
const ChartPlaceholder = () => (
  <div className="h-[300px] animate-pulse rounded-xl bg-gray-100 dark:bg-white/[0.03]" />
);

export default function Home() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { can } = useAuth();

  useEffect(() => {
    dashboardApi.summary()
      .then(setSummary)
      .catch(() => setError("Could not load the dashboard."));
  }, []);

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
        {error}
      </div>
    );
  }
  if (!summary) {
    return <p className="p-8 text-sm text-gray-500">Loading dashboard…</p>;
  }

  // A brand-new organisation gets an onboarding path, not six zeroes. Only the
  // steps this person is allowed to take: sending someone to Import when the
  // API would refuse them is worse than saying nothing.
  if (summary.totals.assets === 0) {
    const steps = [
      { to: "/import", label: "Import a spreadsheet", allowed: can("assets:import") },
      { to: "/categories", label: "Set up categories", allowed: can("categories:write") },
      { to: "/assets/new", label: "Add one asset", allowed: can("assets:write") },
    ].filter((step) => step.allowed);

    return (
      <>
        <PageMeta title="Dashboard | AMS" description="Asset management dashboard" />
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            Welcome — your register is empty
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
            {steps.length > 0
              ? "Start by setting up the categories your assets fall into, then bring in your existing register from a spreadsheet."
              : "Nothing has been added yet. Once your colleagues bring the register in, it will appear here."}
          </p>
          {steps.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {steps.map((step, index) => (
                <Link
                  key={step.to}
                  to={step.to}
                  className={
                    index === 0
                      ? "rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
                      : "rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
                  }
                >
                  {step.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title="Dashboard | AMS" description="Asset management dashboard" />

      <div className="space-y-5">
        <KpiTiles totals={summary.totals} utilisation={summary.utilisation} />

        <div className="grid gap-5 lg:grid-cols-2">
          <ComponentCard title="By status" desc="Where the register sits right now.">
            <Suspense fallback={<ChartPlaceholder />}>
              <StatusDonut data={summary.by_status} />
            </Suspense>
          </ComponentCard>
          <ComponentCard title="By category" desc="How the register splits across asset types.">
            <Suspense fallback={<ChartPlaceholder />}>
              <CategoryBars data={summary.by_category} />
            </Suspense>
          </ComponentCard>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <ComponentCard title="Recent activity" desc="The last fifteen recorded events.">
            <RecentActivity events={summary.recent_activity} />
          </ComponentCard>
          <ComponentCard title="Expiring soon" desc="Warranties, licences and services due in 90 days.">
            <ExpiringSoon items={summary.expiring_soon} />
          </ComponentCard>
        </div>
      </div>
    </>
  );
}
