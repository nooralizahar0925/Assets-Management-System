import Label from "../form/Label";
import Input from "../form/input/InputField";

export interface DepreciationPolicy {
  method: "none" | "straight_line" | "reducing_balance";
  useful_life_months: number | null;
  salvage_pct: number;
  declining_rate_pct: number | null;
}

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

const METHODS: { value: DepreciationPolicy["method"]; label: string }[] = [
  { value: "none", label: "Does not depreciate" },
  { value: "straight_line", label: "Straight line" },
  { value: "reducing_balance", label: "Reducing balance" },
];

export const NO_DEPRECIATION: DepreciationPolicy = {
  method: "none",
  useful_life_months: null,
  salvage_pct: 0,
  declining_rate_pct: null,
};

interface Props {
  /** null on an asset means "inherit"; on a category it means the same as none. */
  value: DepreciationPolicy | null;
  /** Supplied on an asset: what its category would give it. */
  inherited?: DepreciationPolicy;
  onChange: (value: DepreciationPolicy | null) => void;
}

const describe = (policy: DepreciationPolicy): string => {
  if (policy.method === "none") return "does not depreciate";
  if (policy.method === "straight_line") {
    return `straight line over ${policy.useful_life_months ?? "?"} months`;
  }
  return `reducing balance at ${policy.declining_rate_pct ?? "?"}% a year`;
};

/**
 * The depreciation policy editor, used in two places.
 *
 * On a category it sets the rule for that kind of asset. On an asset it shows
 * what the category would give and lets that be overridden - with a way back,
 * because an override that cannot be undone is a trap.
 */
export default function DepreciationFields({ value, inherited, onChange }: Props) {
  // An asset with no override of its own: show what it inherits, and offer to
  // depart from it.
  if (inherited && value === null) {
    return (
      <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Depreciates {describe(inherited)}, from its category.
        </p>
        <button
          type="button"
          onClick={() => onChange({ ...inherited })}
          className="mt-3 rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
        >
          Override for this asset
        </button>
      </div>
    );
  }

  const policy = value ?? NO_DEPRECIATION;
  const set = (patch: Partial<DepreciationPolicy>) =>
    onChange({ ...policy, ...patch });

  const lifeInvalid =
    policy.method === "straight_line"
    && policy.useful_life_months !== null
    && policy.useful_life_months < 1;
  const salvageInvalid = policy.salvage_pct < 0 || policy.salvage_pct > 100;
  const rateInvalid =
    policy.method === "reducing_balance"
    && policy.declining_rate_pct !== null
    && (policy.declining_rate_pct <= 0 || policy.declining_rate_pct > 100);

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      {(lifeInvalid || salvageInvalid || rateInvalid) && (
        <div
          role="alert"
          className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10"
        >
          {lifeInvalid && "A useful life must be at least one month. "}
          {salvageInvalid && "Residual value must be between 0 and 100 percent. "}
          {rateInvalid && "A rate must be between 0 and 100 percent."}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="depreciation-method">Method</Label>
          <select
            id="depreciation-method" className={selectClass} value={policy.method}
            onChange={(e) => {
              const method = e.target.value as DepreciationPolicy["method"];
              // Clear whatever the new method does not use, so a stale life is
              // never stored beside a method that ignores it.
              set({
                method,
                useful_life_months:
                  method === "straight_line" ? policy.useful_life_months : null,
                declining_rate_pct:
                  method === "reducing_balance" ? policy.declining_rate_pct : null,
              });
            }}
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        {policy.method === "straight_line" && (
          <div>
            <Label htmlFor="depreciation-life">Useful life (months)</Label>
            <Input
              id="depreciation-life" type="number" min="1"
              value={policy.useful_life_months === null
                ? "" : String(policy.useful_life_months)}
              error={lifeInvalid}
              onChange={(e) => set({
                useful_life_months:
                  e.target.value === "" ? null : Number(e.target.value),
              })}
            />
          </div>
        )}

        {policy.method === "reducing_balance" && (
          <div>
            <Label htmlFor="depreciation-rate">Rate per year (%)</Label>
            <Input
              id="depreciation-rate" type="number" min="0" max="100"
              value={policy.declining_rate_pct === null
                ? "" : String(policy.declining_rate_pct)}
              error={rateInvalid}
              onChange={(e) => set({
                declining_rate_pct:
                  e.target.value === "" ? null : Number(e.target.value),
              })}
            />
          </div>
        )}

        {policy.method !== "none" && (
          <div>
            <Label htmlFor="depreciation-salvage">Residual value (%)</Label>
            <Input
              id="depreciation-salvage" type="number" min="0" max="100"
              value={String(policy.salvage_pct)}
              error={salvageInvalid}
              onChange={(e) => set({ salvage_pct: Number(e.target.value || 0) })}
            />
            <p className="mt-1 text-theme-xs text-gray-400">
              What it is still worth at the end of its life. Depreciation stops here.
            </p>
          </div>
        )}
      </div>

      {inherited && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-theme-xs text-brand-500 hover:text-brand-600"
        >
          Use the category&rsquo;s policy instead
        </button>
      )}
    </div>
  );
}
