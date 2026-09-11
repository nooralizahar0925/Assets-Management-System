import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { platformApi, type OrganisationRow } from "../api/platform";
import { formatDate, relativeDays } from "../lib/datetime";

/**
 * Every customer on this deployment.
 *
 * The list answers one question first - which of these needs something doing -
 * so status is a word rather than a colour, and a trial about to lapse says how
 * long it has left rather than a date the reader has to subtract from today.
 */

type Status = "suspended" | "trial-ending" | "no-plan" | "active";

function statusOf(org: OrganisationRow): Status {
  if (org.suspended_at) return "suspended";
  if (org.trial_ends_at) {
    const days = (new Date(org.trial_ends_at).getTime() - Date.now()) / 86_400_000;
    if (days <= 14) return "trial-ending";
  }
  if (!org.plan_code) return "no-plan";
  return "active";
}

const STATUS_LABEL: Record<Status, string> = {
  suspended: "Suspended",
  "trial-ending": "Trial ending",
  "no-plan": "No plan",
  active: "Active",
};

// Colour carries the same meaning as the word, never instead of it: colour
// alone fails a colour-blind reader, and it fails in a printed screenshot.
const STATUS_STYLE: Record<Status, string> = {
  suspended: "bg-error-500/15 text-error-300",
  "trial-ending": "bg-warning-500/15 text-warning-300",
  "no-plan": "bg-gray-500/15 text-gray-300",
  active: "bg-success-500/15 text-success-300",
};

export default function Organisations() {
  const [rows, setRows] = useState<OrganisationRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    platformApi
      .organisations()
      .then((body) => { if (live) setRows(body.data); })
      .catch(() => { if (live) setFailed(true); })
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((org) => {
      if (status !== "all" && statusOf(org) !== status) return false;
      if (!needle) return true;
      return `${org.name} ${org.slug}`.toLowerCase().includes(needle);
    });
  }, [rows, search, status]);

  if (failed) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-error-500/40 bg-error-500/10 px-4 py-3 text-sm text-error-300"
      >
        The customer list could not be loaded.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-title-sm font-bold text-white">Customers</h1>
        <span className="text-sm text-gray-400">
          {rows.length} organisation{rows.length === 1 ? "" : "s"}
        </span>

        <input
          type="search"
          aria-label="Search customers"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name or slug"
          className="ml-auto h-10 w-full max-w-xs rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100 placeholder:text-gray-500"
        />

        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value as Status | "all")}
          className="h-10 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100"
        >
          <option value="all">Every status</option>
          <option value="active">Active</option>
          <option value="trial-ending">Trial ending</option>
          <option value="no-plan">No plan</option>
          <option value="suspended">Suspended</option>
        </select>

        <Link
          to="/platform/new"
          className="h-10 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          New customer
        </Link>
      </div>

      {loaded && rows.length === 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-800/50 px-6 py-16 text-center">
          <h2 className="text-base font-semibold text-white">No customers yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
            Create the first one and hand its administrator the password it
            gives you. Everything else - their plan, their limits, their
            people - follows from there.
          </p>
          <Link
            to="/platform/new"
            className="mt-6 inline-block rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
          >
            Create a customer
          </Link>
        </div>
      )}

      {loaded && rows.length > 0 && visible.length === 0 && (
        <p className="py-12 text-center text-sm text-gray-400">
          No customer matches that.
        </p>
      )}

      {visible.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-800/60 text-theme-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3 font-medium">Organisation</th>
                <th className="px-4 py-3 font-medium">Plan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Assets</th>
                <th className="px-4 py-3 text-right font-medium">People</th>
                <th className="px-4 py-3 font-medium">Renews</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((org) => {
                const state = statusOf(org);
                return (
                  <tr
                    key={org.id}
                    className="border-t border-gray-800 hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3">
                      {/*
                        Not a link yet: the page for one customer arrives with
                        the next step, and a row that navigates to a not-found
                        page is worse than a row that does nothing.
                      */}
                      <span className="font-medium text-gray-100">{org.name}</span>
                      <span className="block text-theme-xs text-gray-500">
                        {org.slug}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">
                      {org.plan_code ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-theme-xs font-medium ${STATUS_STYLE[state]}`}
                      >
                        {STATUS_LABEL[state]}
                      </span>
                      {state === "trial-ending" && org.trial_ends_at && (
                        <span className="ml-2 text-theme-xs text-gray-400">
                          {relativeDays(org.trial_ends_at)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {org.assets.toLocaleString("en-GB")}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-300">
                      {org.users.toLocaleString("en-GB")}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {formatDate(org.renews_on)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
