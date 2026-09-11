import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  platformApi, type Feature, type OrganisationDetail, type Plan,
} from "../api/platform";
import { ApiError } from "../api/client";
import { formatDate, relativeDays } from "../lib/datetime";

/**
 * One customer, on one page.
 *
 * Everything an operator needs to answer "what is going on with this one" and
 * to change it: what they are on, what they have, what they are near, and the
 * two actions there is no undoing without regret.
 */

const LIMIT_LABEL: Record<string, string> = {
  max_assets: "Assets",
  max_users: "People",
  max_storage_mb: "Storage (MB)",
};

const usageFor = (detail: OrganisationDetail, key: string): number => {
  if (key === "max_assets") return detail.usage.assets;
  if (key === "max_users") return detail.usage.users + detail.usage.pending_invitations;
  if (key === "max_storage_mb") return detail.usage.storage_mb;
  return 0;
};

export default function Organisation() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<OrganisationDetail | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    try {
      const org = await platformApi.organisation(id);
      setDetail(org);
      setNotes(org.notes ?? "");
    } catch {
      setError("That customer could not be loaded.");
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let live = true;
    platformApi.plans()
      .then((body) => {
        if (!live) return;
        setPlans(body.data);
        setFeatures(body.features);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  const say = (message: string) => {
    setSaved(message);
    setError(null);
  };

  const failed = (err: unknown, fallback: string) => {
    setError(err instanceof ApiError ? err.problem.detail ?? err.message : fallback);
    setSaved(null);
  };

  async function patch(change: Parameters<typeof platformApi.updateOrganisation>[1]) {
    try {
      await platformApi.updateOrganisation(id, change);
      await load();
      say("Saved.");
    } catch (err) {
      failed(err, "That change could not be saved.");
    }
  }

  async function toggleFeature(key: string, next: boolean) {
    if (!detail) return;

    // The whole set is sent, because the endpoint replaces rather than merges:
    // the console is the only thing that knows what the operator means to
    // leave alone.
    const others = detail.overrides.filter((o) => o.feature_key !== key);
    const fromPlan = plans.find((p) => p.code === detail.plan_code)
      ?.features.includes(key) ?? false;

    // An override that agrees with the plan is noise: it says nothing and
    // would sit there implying somebody decided something.
    const overrides = next === fromPlan
      ? others
      : [...others, { feature_key: key, enabled: next, note: "" }];

    try {
      await platformApi.setEntitlements(
        id, overrides.map((o) => ({ ...o, note: o.note ?? "" })),
      );
      await load();
      say(next ? "Feature turned on." : "Feature turned off.");
    } catch (err) {
      failed(err, "That feature could not be changed.");
    }
  }

  async function suspend() {
    const reason = window.prompt(
      "Why is this customer being suspended? It goes in the record, and "
      + "somebody will want to know months from now.",
    );
    if (!reason?.trim()) return;

    try {
      await platformApi.suspend(id, reason.trim());
      await load();
      say("Suspended. Their data is untouched.");
    } catch (err) {
      failed(err, "They could not be suspended.");
    }
  }

  async function resume() {
    try {
      await platformApi.resume(id);
      await load();
      say("Access restored.");
    } catch (err) {
      failed(err, "Access could not be restored.");
    }
  }

  async function remove() {
    if (!detail) return;
    try {
      await platformApi.remove(id, confirmSlug.trim());
      navigate("/platform");
    } catch (err) {
      failed(err, "That customer could not be removed.");
    }
  }

  if (error && !detail) {
    return <p role="alert" className="text-sm text-error-300">{error}</p>;
  }
  if (!detail) return <p className="text-sm text-gray-400">Loading…</p>;

  const plan = plans.find((p) => p.code === detail.plan_code);
  const limitKeys = [...new Set([
    ...Object.keys(plan?.limits ?? {}),
    ...Object.keys(detail.limit_overrides ?? {}),
  ])];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <Link to="/platform" className="text-theme-xs text-gray-400 hover:text-gray-200">
            ← All customers
          </Link>
          <h1 className="mt-1 text-title-sm font-bold text-white">{detail.name}</h1>
          <p className="text-theme-xs text-gray-500">
            {detail.slug} · created {formatDate(detail.created_at)}
          </p>
        </div>

        {detail.suspended_at && (
          <span className="rounded-full bg-error-500/15 px-3 py-1 text-theme-xs font-medium text-error-300">
            Suspended {formatDate(detail.suspended_at)}
          </span>
        )}
      </div>

      {saved && <p role="status" className="text-theme-xs text-success-400">{saved}</p>}
      {error && <p role="alert" className="text-theme-xs text-error-300">{error}</p>}

      <section className="rounded-xl border border-gray-800 p-5">
        <h2 className="text-base font-semibold text-white">Commercial</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-theme-xs text-gray-400">
            Plan
            <select
              value={detail.plan_code ?? ""}
              onChange={(e) => void patch({ plan_code: e.target.value || null })}
              className="mt-1 h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100"
            >
              <option value="">No plan</option>
              {plans.map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
          </label>

          <label className="text-theme-xs text-gray-400">
            Renews on
            <input
              type="date"
              value={detail.renews_on ?? ""}
              onChange={(e) => void patch({ renews_on: e.target.value || null })}
              className="mt-1 h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100"
            />
          </label>

          <label className="text-theme-xs text-gray-400">
            Contract starts
            <input
              type="date"
              value={detail.contract_starts ?? ""}
              onChange={(e) => void patch({ contract_starts: e.target.value || null })}
              className="mt-1 h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100"
            />
          </label>

          <label className="text-theme-xs text-gray-400">
            Trial ends
            <input
              type="date"
              value={detail.trial_ends_at ?? ""}
              onChange={(e) => void patch({ trial_ends_at: e.target.value || null })}
              className="mt-1 h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100"
            />
            {detail.trial_ends_at && (
              <span className="mt-1 block text-theme-xs text-gray-500">
                {relativeDays(detail.trial_ends_at)}
              </span>
            )}
          </label>
        </div>

        <label className="mt-4 block text-theme-xs text-gray-400">
          Notes
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== (detail.notes ?? "")) void patch({ notes });
            }}
            placeholder="Who to ring, what was agreed, anything future-you will want."
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-gray-100"
          />
        </label>
      </section>

      <section className="rounded-xl border border-gray-800 p-5">
        <h2 className="text-base font-semibold text-white">Features</h2>
        <p className="mt-1 text-theme-xs text-gray-400">
          What this customer can use. An exception here overrides their plan in
          either direction.
        </p>

        <ul className="mt-4 space-y-2">
          {features.map((feature) => {
            const on = detail.entitlements.features.includes(feature.key);
            const override = detail.overrides.find(
              (o) => o.feature_key === feature.key,
            );
            const source = override
              ? (override.enabled
                  ? "Turned on for this customer"
                  : "Turned off for this customer")
              : on
                ? `From the ${plan?.name ?? "plan"}`
                : "Not in their plan";

            return (
              <li
                key={feature.key}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-800 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-gray-100">{feature.label}</p>
                  <p className="text-theme-xs text-gray-500">
                    {source}
                    {override?.note ? ` · ${override.note}` : ""}
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={feature.label}
                  disabled={feature.key === "core"}
                  onClick={() => void toggleFeature(feature.key, !on)}
                  className={`ml-auto h-6 w-11 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    on ? "bg-brand-500" : "bg-gray-700"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`block h-5 w-5 rounded-full bg-white transition ${
                      on ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-gray-800 p-5">
        <h2 className="text-base font-semibold text-white">Limits</h2>
        <p className="mt-1 text-theme-xs text-gray-400">
          Shown against what they hold now. Writes are refused past a limit;
          reading and exporting never are.
        </p>

        {limitKeys.length === 0 && (
          <p className="mt-4 text-sm text-gray-400">
            No limits. This customer can hold as much as they like.
          </p>
        )}

        <ul className="mt-4 space-y-3">
          {limitKeys.map((key) => {
            const cap = detail.entitlements.limits[key];
            const used = usageFor(detail, key);
            const over = cap !== undefined && used > cap;

            return (
              <li key={key} className="flex flex-wrap items-center gap-3">
                <span className="w-32 text-sm text-gray-300">
                  {LIMIT_LABEL[key] ?? key}
                </span>
                <span className={`text-sm ${over ? "text-error-300" : "text-gray-400"}`}>
                  {used.toLocaleString("en-GB")} of{" "}
                  {cap === undefined ? "unlimited" : cap.toLocaleString("en-GB")}
                  {over && " — over their limit"}
                </span>
                <input
                  type="text"
                  aria-label={`${LIMIT_LABEL[key] ?? key} limit`}
                  defaultValue={detail.limit_overrides?.[key] ?? ""}
                  placeholder={String(plan?.limits?.[key] ?? "from plan")}
                  onBlur={(e) => {
                    const raw = e.target.value.trim();
                    const next = { ...detail.limit_overrides };
                    if (!raw) delete next[key];
                    else next[key] = Number(raw);
                    void patch({ limit_overrides: next });
                  }}
                  className="ml-auto h-9 w-28 rounded-lg border border-gray-700 bg-gray-800 px-2 text-sm text-gray-100"
                />
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-error-500/30 p-5">
        <h2 className="text-base font-semibold text-white">Access</h2>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {detail.suspended_at ? (
            <button
              type="button"
              onClick={() => void resume()}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Restore access
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void suspend()}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-warning-300 ring-1 ring-inset ring-warning-500/40 hover:bg-warning-500/10"
            >
              Suspend access
            </button>
          )}
          <p className="text-theme-xs text-gray-500">
            Suspending stops their people signing in. Their data is untouched
            and comes back the moment access is restored.
          </p>
        </div>

        <div className="mt-6 border-t border-gray-800 pt-5">
          <h3 className="text-sm font-medium text-error-300">Remove this customer</h3>
          <p className="mt-1 text-theme-xs text-gray-400">
            Everything they have goes: assets, history, people. There is no
            undo. Type <code className="text-gray-200">{detail.slug}</code> to
            confirm.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="text"
              aria-label="Type the slug to confirm"
              value={confirmSlug}
              onChange={(e) => setConfirmSlug(e.target.value)}
              className="h-10 w-56 rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100"
            />
            <button
              type="button"
              disabled={confirmSlug.trim() !== detail.slug}
              onClick={() => void remove()}
              className="rounded-lg bg-error-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-error-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Remove permanently
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
