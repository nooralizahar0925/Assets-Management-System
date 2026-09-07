import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import AssetFilters from "../../components/assets/AssetFilters";
import AssetTable from "../../components/assets/AssetTable";
import EmptyRegister from "../../components/assets/EmptyRegister";
import BulkActionBar from "../../components/assets/BulkActionBar";
import Pagination from "../../components/assets/Pagination";
import { useAssetQuery } from "../../hooks/useAssetQuery";
import { assetsApi } from "../../api/assets";
import { catalogApi } from "../../api/catalog";
import { downloadBlob, api, ApiError } from "../../api/client";
import type { Asset, Category, LocationNode, OrgUser } from "../../api/types";

export default function AssetList() {
  const { query, setFilter, setSort, setPage, clear } = useAssetQuery();

  // "Nothing here yet" and "nothing matches your filters" need different
  // answers, so the empty state has to know which it is looking at.
  const hasFilters = Boolean(
    query.q || query.status.length || query.category_id ||
    query.location_id || query.assignee_id,
  );
  const [assets, setAssets] = useState<Asset[]>([]);
  const [meta, setMeta] = useState({ page: 1, per_page: 25, total: 0, total_pages: 1 });
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await assetsApi.list(query);
      setAssets(page.data);
      setMeta(page.meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load assets.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void Promise.all([
      catalogApi.categories(), catalogApi.locations(), catalogApi.users(),
    ]).then(([c, l, u]) => {
      setCategories(c);
      setLocations(l);
      setUsers(u);
    }).catch(() => undefined);
  }, []);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = (ids: string[]) =>
    setSelected((current) =>
      ids.every((id) => current.has(id)) ? new Set() : new Set(ids),
    );

  async function exportRegister(format: "csv" | "xlsx") {
    // The export honours the filters currently on screen, not the whole register.
    const blob = await api.blob(`/api/v1/exports/assets.${format}`, query);
    downloadBlob(blob, `assets-${new Date().toISOString().slice(0, 10)}.${format}`);
  }

  return (
    <>
      <PageMeta title="Assets | AMS" description="The asset register" />
      <PageBreadcrumb pageTitle="Assets" />

      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {loading ? "Loading…" : `${meta.total.toLocaleString()} assets`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void exportRegister("csv")}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => void exportRegister("xlsx")}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
            >
              Export Excel
            </button>
            <Link
              to="/assets/new"
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Add asset
            </Link>
          </div>
        </div>

        <div data-tour="filters">
          <AssetFilters
            query={query} categories={categories} locations={locations} users={users}
            onFilter={setFilter} onClear={clear}
          />
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
            {error}
          </div>
        )}

        <div data-tour="register" className="space-y-5">
          {!loading && assets.length === 0 ? (
            <EmptyRegister filtered={hasFilters} onClear={clear} />
          ) : (
            <>
              <AssetTable
                assets={assets}
                selected={selected}
                onSelect={toggle}
                onSelectAll={toggleAll}
                sort={query.sort}
                onSort={setSort}
              />

              <Pagination meta={meta} onPage={setPage} />
            </>
          )}
        </div>
      </div>

      <BulkActionBar
        selected={selected}
        onClear={() => setSelected(new Set())}
        onChanged={() => void load()}
      />
    </>
  );
}
