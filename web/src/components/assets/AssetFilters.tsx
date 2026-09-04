import { useEffect, useState } from "react";
import Input from "../form/input/InputField";
import Label from "../form/Label";
import { useDebounced } from "../../hooks/useDebounced";
import type { Category, LocationNode, OrgUser, AssetStatus } from "../../api/types";
import type { AssetQuery } from "../../hooks/useAssetQuery";

const STATUSES: { value: AssetStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "in_use", label: "In use" },
  { value: "maintenance", label: "Maintenance" },
  { value: "retired", label: "Retired" },
  { value: "lost", label: "Lost" },
];

interface Props {
  query: AssetQuery;
  categories: Category[];
  locations: LocationNode[];
  users: OrgUser[];
  onFilter: (key: keyof AssetQuery, value: string | string[]) => void;
  onClear: () => void;
}

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export default function AssetFilters({
  query, categories, locations, users, onFilter, onClear,
}: Props) {
  const [search, setSearch] = useState(query.q);
  const debounced = useDebounced(search, 300);

  useEffect(() => {
    if (debounced !== query.q) onFilter("q", debounced);
    // Only react to the debounced value; query.q changing from outside is handled below.
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSearch(query.q);
  }, [query.q]);

  const toggleStatus = (status: string) => {
    const next = query.status.includes(status)
      ? query.status.filter((s) => s !== status)
      : [...query.status, status];
    onFilter("status", next);
  };

  const activeCount =
    (query.q ? 1 : 0) + query.status.length +
    (query.category_id ? 1 : 0) + (query.location_id ? 1 : 0) +
    (query.assignee_id ? 1 : 0);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Label htmlFor="asset-search">Search</Label>
          <Input
            id="asset-search" type="text"
            placeholder="Name, serial number or asset tag"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="filter-category">Category</Label>
          <select
            id="filter-category" className={selectClass}
            value={query.category_id}
            onChange={(e) => onFilter("category_id", e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="filter-location">Location</Label>
          <select
            id="filter-location" className={selectClass}
            value={query.location_id}
            onChange={(e) => onFilter("location_id", e.target.value)}
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {" ".repeat(l.depth * 2)}{l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="filter-assignee">Held by</Label>
          <select
            id="filter-assignee" className={selectClass}
            value={query.assignee_id}
            onChange={(e) => onFilter("assignee_id", e.target.value)}
          >
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-theme-xs text-gray-500 dark:text-gray-400">Status</span>
        {STATUSES.map((status) => {
          const active = query.status.includes(status.value);
          return (
            <button
              key={status.value}
              type="button"
              aria-pressed={active}
              onClick={() => toggleStatus(status.value)}
              className={`rounded-full px-3 py-1 text-theme-xs font-medium transition ${
                active
                  ? "bg-brand-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.05] dark:text-gray-300 dark:hover:bg-white/[0.08]"
              }`}
            >
              {status.label}
            </button>
          );
        })}
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto text-theme-xs font-medium text-brand-500 hover:text-brand-600"
          >
            Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </div>
  );
}
