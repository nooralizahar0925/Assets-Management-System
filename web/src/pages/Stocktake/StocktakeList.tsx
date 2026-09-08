import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Badge from "../../components/ui/badge/Badge";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { useAuth } from "../../context/AuthContext";
import { stocktakeApi, type StocktakeSession } from "../../api/stocktake";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";
import type { LocationNode } from "../../api/types";
import { formatDate } from "../../lib/datetime";

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export default function StocktakeList() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<StocktakeSession[]>([]);
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [locationId, setLocationId] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canRead = can("stocktake:read");
  const canWrite = can("stocktake:write");

  const load = useCallback(() => {
    if (!canRead) return;
    void stocktakeApi.list().then(setSessions).catch(() => undefined);
    void catalogApi.locations()
      .then((all) =>
        // A branch-scoped counter can only open a count at their own sites;
        // the API refuses the rest anyway.
        setLocations(
          user?.location_scope
            ? all.filter((l) => user.location_scope!.includes(l.id))
            : all,
        ),
      )
      .catch(() => undefined);
  }, [canRead, user]);

  useEffect(load, [load]);

  async function start() {
    if (!locationId || !name.trim()) return;
    setError(null);
    try {
      const session = await stocktakeApi.open({ location_id: locationId, name });
      navigate(`/stocktakes/${session.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not start this count.",
      );
    }
  }

  if (!canRead) {
    return (
      <>
        <PageMeta title="Stock-takes | AMS" description="Counting sessions" />
        <PageBreadcrumb pageTitle="Stock-takes" />
        <div
          role="alert"
          className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            Stock-takes are run by the people who look after the stock
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500 dark:text-gray-400">
            Your role does not include counting sessions.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title="Stock-takes | AMS" description="Counting sessions" />
      <PageBreadcrumb pageTitle="Stock-takes" />

      <div className={canWrite ? "grid gap-5 lg:grid-cols-3" : ""}>
        <div className={canWrite ? "lg:col-span-2" : ""}>
          <ComponentCard
            title="Counts"
            desc="What was counted, when, and what it found."
          >
            {sessions.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                {canWrite
                  ? "No counts yet. Start one on the right."
                  : "No counts have been run yet."}
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {sessions.map((session) => (
                  <li key={session.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                    <div className="min-w-0">
                      <Link
                        to={`/stocktakes/${session.id}`}
                        className="text-sm font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                      >
                        {session.name}
                      </Link>
                      <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                        {session.location_name ?? "Unknown location"} ·{" "}
                        {formatDate(session.opened_at)}
                      </p>
                    </div>
                    <Badge color={session.status === "open" ? "info" : "light"} size="sm">
                      {session.status === "open" ? "In progress" : "Closed"}
                    </Badge>
                    <span className="ml-auto text-theme-xs text-gray-500 dark:text-gray-400">
                      {session.counted ?? 0} of {session.expected_ids.length} counted
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ComponentCard>
        </div>

        {canWrite && (
          <ComponentCard title="Start a count">
            <div className="space-y-4">
              {error && (
                <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
                  {error}
                </div>
              )}

              <div>
                <Label htmlFor="stocktake-location">Location</Label>
                <select
                  id="stocktake-location" className={selectClass} value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">Choose a location</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.path}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="stocktake-name">Name</Label>
                <Input
                  id="stocktake-name" type="text" value={name}
                  placeholder="Q1 warehouse count"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <button
                type="button" onClick={() => void start()}
                disabled={!locationId || !name.trim()}
                className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
              >
                Start counting
              </button>
              <p className="text-theme-xs text-gray-400">
                What the register expects to be here is recorded when the count
                starts, so anything moved afterwards is not reported missing.
              </p>
            </div>
          </ComponentCard>
        )}
      </div>
    </>
  );
}
