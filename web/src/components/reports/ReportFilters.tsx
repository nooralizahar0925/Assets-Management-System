import { useEffect, useState } from "react";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import { catalogApi } from "../../api/catalog";
import { useAuth } from "../../context/AuthContext";
import type { Category, LocationNode } from "../../api/types";

/** The five parameters every report definition understands, and no others. */
export interface ReportParams {
  category_id?: string;
  location_id?: string;
  status?: string[];
  from?: string;
  to?: string;
}

const STATUSES = [
  { value: "available", label: "Available" },
  { value: "in_use", label: "In use" },
  { value: "maintenance", label: "In maintenance" },
  { value: "retired", label: "Retired" },
  { value: "lost", label: "Lost" },
];

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  value: ReportParams;
  onApply: (next: ReportParams) => void;
}

export default function ReportFilters({ value, onApply }: Props) {
  const [draft, setDraft] = useState<ReportParams>(value);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const { user } = useAuth();

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    void catalogApi.categories().then(setCategories).catch(() => undefined);
    void catalogApi.locations()
      .then((all) =>
        // A branch-scoped reader can only see their own branches in the results
        // anyway; offering the rest invites a filter that returns nothing.
        setLocations(
          user?.location_scope
            ? all.filter((l) => user.location_scope!.includes(l.id))
            : all,
        ),
      )
      .catch(() => undefined);
  }, [user]);

  const set = <K extends keyof ReportParams>(key: K, next: ReportParams[K]) =>
    setDraft((current) => ({ ...current, [key]: next }));

  return (
    <form
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft);
      }}
    >
      <div>
        <Label htmlFor="report-category">Category</Label>
        <select
          id="report-category" className={selectClass}
          value={draft.category_id ?? ""}
          onChange={(e) => set("category_id", e.target.value || undefined)}
        >
          <option value="">Every category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="report-location">Location</Label>
        <select
          id="report-location" className={selectClass}
          value={draft.location_id ?? ""}
          onChange={(e) => set("location_id", e.target.value || undefined)}
        >
          <option value="">Everywhere</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>{l.path}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="report-status">Status</Label>
        <select
          id="report-status" className={selectClass}
          value={draft.status?.[0] ?? ""}
          onChange={(e) =>
            set("status", e.target.value ? [e.target.value] : undefined)
          }
        >
          <option value="">Any status</option>
          {STATUSES.map((status) => (
            <option key={status.value} value={status.value}>{status.label}</option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="report-from">Added from</Label>
        <Input
          id="report-from" type="date" value={draft.from ?? ""}
          onChange={(e) => set("from", e.target.value || undefined)}
        />
      </div>

      <div>
        <Label htmlFor="report-to">Added to</Label>
        <Input
          id="report-to" type="date" value={draft.to ?? ""}
          onChange={(e) => set("to", e.target.value || undefined)}
        />
      </div>

      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-5">
        <button
          type="submit"
          className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft({});
            onApply({});
          }}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
        >
          Clear
        </button>
      </div>
    </form>
  );
}
