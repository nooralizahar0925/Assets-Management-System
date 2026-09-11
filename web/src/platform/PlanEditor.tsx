import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import {
  platformApi, type Feature, type Plan, type PlanInput,
} from "../api/platform";
import { ApiError } from "../api/client";

/**
 * What is for sale.
 *
 * A plan is a row rather than code because prices move, tiers get renamed and
 * a one-off is introduced for a single campaign - none of which should need a
 * deploy. The features a plan may name are code, because a feature means
 * something only where a handler checks it, so the catalogue arrives with the
 * plans and the operator picks from it rather than typing keys.
 *
 * The customer count beside each plan is the thing that makes this page safe
 * to use: repricing a plan two customers are on is a different decision from
 * repricing one nobody has bought, and deleting the first will be refused.
 */

const CYCLES = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
  { value: "once", label: "One-off" },
] as const;

const LIMITS = [
  { key: "max_assets", label: "Assets" },
  { key: "max_users", label: "People" },
  { key: "max_storage_mb", label: "Storage (MB)" },
] as const;

const ALWAYS_ON = ["core"];

/** Held as text so an empty box stays empty rather than becoming a zero. */
type Draft = Omit<PlanInput, "price_minor" | "sort_order" | "limits"> & {
  price_minor: string;
  sort_order: string;
  limits: Record<string, string>;
};

const BLANK: Draft = {
  code: "", name: "", description: "", price_minor: "0", currency: "IDR",
  billing_cycle: "monthly", features: [...ALWAYS_ON], limits: {},
  active: true, sort_order: "0",
};

const toDraft = (plan: Plan): Draft => ({
  ...plan,
  price_minor: String(plan.price_minor),
  sort_order: String(plan.sort_order),
  limits: Object.fromEntries(
    Object.entries(plan.limits ?? {}).map(([k, v]) => [k, String(v)]),
  ),
});

const fromDraft = (draft: Draft): PlanInput => ({
  ...draft,
  price_minor: Number(draft.price_minor) || 0,
  sort_order: Number(draft.sort_order) || 0,
  // A blank box means "no limit", not "a limit of zero" - which would refuse
  // every write the moment the plan was saved.
  limits: Object.fromEntries(
    Object.entries(draft.limits)
      .filter(([, v]) => v.trim() !== "")
      .map(([k, v]) => [k, Number(v)]),
  ),
  features: [...new Set([...ALWAYS_ON, ...draft.features])],
});

const omitCode = (input: PlanInput): Omit<PlanInput, "code"> => {
  const copy: Partial<PlanInput> = { ...input };
  delete copy.code;
  return copy as Omit<PlanInput, "code">;
};

const money = (amount: number, currency: string) =>
  `${currency} ${amount.toLocaleString("en-GB")}`;

export default function PlanEditor() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);

  /** The code this draft is editing, or null when it is a new plan. */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    const body = await platformApi.plans();
    setPlans(body.data);
    setFeatures(body.features);
  }, []);

  useEffect(() => {
    void load().catch(() => setFailedToLoad(true));
  }, [load]);

  useEffect(() => {
    let live = true;
    platformApi.organisations()
      .then((body) => {
        if (!live) return;
        const tally: Record<string, number> = {};
        for (const row of body.data) {
          if (row.plan_code) tally[row.plan_code] = (tally[row.plan_code] ?? 0) + 1;
        }
        setCounts(tally);
      })
      // Not knowing the counts is worse than knowing them and better than not
      // being able to edit a plan at all, so this failure stays quiet.
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  const change = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const toggleFeature = (key: string, on: boolean) =>
    setDraft((current) => {
      if (!current) return current;
      const next = current.features.filter((f) => f !== key);
      return { ...current, features: on ? [...next, key] : next };
    });

  const failed = (err: unknown, fallback: string) => {
    setError(err instanceof ApiError ? err.problem.detail ?? err.message : fallback);
    setSaved(null);
  };

  async function save() {
    if (!draft) return;
    const input = fromDraft(draft);

    try {
      if (editing === null) await platformApi.createPlan(input);
      // The code addresses the row and is never in the body: the server takes
      // its identity from the URL, so sending a different one would be ignored
      // at best and confusing to read in the audit at worst.
      else await platformApi.updatePlan(editing, omitCode(input));
      await load();
      setDraft(null);
      setEditing(null);
      setError(null);
      setSaved("Saved.");
    } catch (err) {
      failed(err, "That plan could not be saved.");
    }
  }

  async function remove() {
    if (editing === null) return;
    const on = counts[editing] ?? 0;

    if (!window.confirm(
      on > 0
        ? `${on} customer${on === 1 ? " is" : "s are"} on this plan. Deleting it `
          + "will be refused - move them first, or untick \"offered to new "
          + "customers\" to retire it while they keep working. Try anyway?"
        : "Delete this plan? Nobody is on it, so nothing breaks, but it is gone "
          + "for good.",
    )) return;

    try {
      await platformApi.deletePlan(editing);
      await load();
      setDraft(null);
      setEditing(null);
      setError(null);
      setSaved("Plan deleted.");
    } catch (err) {
      failed(err, "That plan could not be deleted.");
    }
  }

  if (failedToLoad) {
    return (
      <p
        role="alert"
        className="rounded-xl border border-error-500/40 bg-error-500/10 px-4 py-3 text-sm text-error-300"
      >
        The plans could not be loaded.
      </p>
    );
  }

  const field =
    "mt-1 h-10 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm text-gray-100 disabled:opacity-50";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <Link to="/platform" className="text-theme-xs text-gray-400 hover:text-gray-200">
            ← Needs attention
          </Link>
          <h1 className="mt-1 text-title-sm font-bold text-white">Plans</h1>
          <p className="text-theme-xs text-gray-500">
            What is for sale, what each one includes, and what it costs.
          </p>
        </div>

        <button
          type="button"
          onClick={() => { setEditing(null); setDraft({ ...BLANK }); }}
          className="ml-auto rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          New plan
        </button>
      </div>

      {saved && <p role="status" className="text-theme-xs text-success-400">{saved}</p>}
      {error && <p role="alert" className="text-theme-xs text-error-300">{error}</p>}

      {draft && (
        <section className="rounded-xl border border-gray-700 bg-gray-800/40 p-5">
          <h2 className="text-base font-semibold text-white">
            {editing === null ? "New plan" : `Editing ${editing}`}
          </h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-theme-xs text-gray-400">
              Code
              <input
                value={draft.code}
                // The code is the identity. Changing it on an existing plan
                // would create a second one and strand everybody on the first.
                disabled={editing !== null}
                onChange={(e) => change({ code: e.target.value })}
                placeholder="starter"
                className={field}
              />
              <span className="mt-1 block text-theme-xs text-gray-500">
                Lower case, digits and hyphens. It appears in URLs and exports,
                and cannot be changed later.
              </span>
            </label>

            <label className="text-theme-xs text-gray-400">
              Name
              <input
                value={draft.name}
                onChange={(e) => change({ name: e.target.value })}
                placeholder="Starter"
                className={field}
              />
            </label>

            <label className="text-theme-xs text-gray-400">
              Price
              <input
                type="number"
                min={0}
                value={draft.price_minor}
                onChange={(e) => change({ price_minor: e.target.value })}
                className={field}
              />
            </label>

            <label className="text-theme-xs text-gray-400">
              Currency
              <input
                value={draft.currency}
                maxLength={3}
                onChange={(e) => change({ currency: e.target.value.toUpperCase() })}
                className={field}
              />
            </label>

            <label className="text-theme-xs text-gray-400">
              Billing cycle
              <select
                value={draft.billing_cycle}
                onChange={(e) =>
                  change({ billing_cycle: e.target.value as Draft["billing_cycle"] })
                }
                className={field}
              >
                {CYCLES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>

            <label className="text-theme-xs text-gray-400">
              Order in the list
              <input
                type="number"
                value={draft.sort_order}
                onChange={(e) => change({ sort_order: e.target.value })}
                className={field}
              />
            </label>
          </div>

          <label className="mt-4 block text-theme-xs text-gray-400">
            Description
            <textarea
              rows={2}
              value={draft.description}
              onChange={(e) => change({ description: e.target.value })}
              placeholder="Who this is for, in the words a customer would use."
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-gray-100"
            />
          </label>

          <fieldset className="mt-6">
            <legend className="text-sm font-medium text-white">Included</legend>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {features.map((feature) => {
                const always = ALWAYS_ON.includes(feature.key);
                return (
                  <li key={feature.key}>
                    <label className="flex items-start gap-3 rounded-lg border border-gray-800 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={always || draft.features.includes(feature.key)}
                        disabled={always}
                        onChange={(e) => toggleFeature(feature.key, e.target.checked)}
                        className="mt-1 h-4 w-4"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm text-gray-100">
                          {feature.label}
                        </span>
                        <span className="block text-theme-xs text-gray-500">
                          {always ? "In every plan." : feature.description}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <fieldset className="mt-6">
            <legend className="text-sm font-medium text-white">Limits</legend>
            <p className="mt-1 text-theme-xs text-gray-400">
              Leave one blank for no limit. A limit refuses new records once it
              is reached; it never hides what is already there or stops an
              export.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              {LIMITS.map((limit) => (
                <label key={limit.key} className="text-theme-xs text-gray-400">
                  {limit.label}
                  <input
                    type="number"
                    min={1}
                    value={draft.limits[limit.key] ?? ""}
                    onChange={(e) =>
                      change({
                        limits: { ...draft.limits, [limit.key]: e.target.value },
                      })
                    }
                    placeholder="No limit"
                    className={field}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-6 flex items-center gap-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => change({ active: e.target.checked })}
              className="h-4 w-4"
            />
            Offered to new customers
            <span className="text-theme-xs text-gray-500">
              Untick to retire a plan. Customers already on it keep working.
            </span>
          </label>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              Save plan
            </button>
            <button
              type="button"
              onClick={() => { setDraft(null); setEditing(null); }}
              className="rounded-lg px-4 py-2 text-sm text-gray-300 ring-1 ring-inset ring-gray-700 hover:bg-white/5"
            >
              Cancel
            </button>

            {editing !== null && (
              <button
                type="button"
                onClick={() => void remove()}
                className="ml-auto rounded-lg px-4 py-2 text-sm text-error-300 ring-1 ring-inset ring-error-500/40 hover:bg-error-500/10"
              >
                Delete plan
              </button>
            )}
          </div>
        </section>
      )}

      <ul className="space-y-3">
        {plans.map((plan) => {
          const on = counts[plan.code] ?? 0;
          const included = features
            .filter((f) => plan.features.includes(f.key) && !ALWAYS_ON.includes(f.key))
            .map((f) => f.label);

          return (
            <li key={plan.code} className="rounded-xl border border-gray-800 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-100">{plan.name}</p>
                  <p className="text-theme-xs text-gray-500">{plan.code}</p>
                </div>

                <p className="text-sm text-gray-200">
                  {money(plan.price_minor, plan.currency)}
                </p>
                <p className="text-theme-xs text-gray-500">
                  {CYCLES.find((c) => c.value === plan.billing_cycle)?.label
                    .toLowerCase() ?? plan.billing_cycle}
                </p>

                <p className="text-theme-xs text-gray-400">
                  {on === 0
                    ? "No customers"
                    : `${on} customer${on === 1 ? "" : "s"}`}
                </p>

                {!plan.active && (
                  <span className="rounded-full bg-gray-500/15 px-2 py-0.5 text-theme-xs text-gray-300">
                    Retired
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => { setEditing(plan.code); setDraft(toDraft(plan)); }}
                  className="ml-auto rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-300 ring-1 ring-inset ring-gray-700 hover:bg-white/5"
                >
                  Edit {plan.name}
                </button>
              </div>

              <p className="mt-2 text-theme-xs text-gray-400">
                Asset register
                {included.length > 0 && ` · ${included.join(" · ")}`}
              </p>
            </li>
          );
        })}
      </ul>

      {plans.length === 0 && !failedToLoad && (
        <div className="rounded-xl border border-gray-800 bg-gray-800/50 px-6 py-16 text-center">
          <h2 className="text-base font-semibold text-white">Nothing is for sale yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-400">
            Until there is a plan, a new customer can be given the register and
            nothing else. Make one.
          </p>
        </div>
      )}
    </div>
  );
}
