import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

/**
 * A type alias rather than an interface on purpose.
 *
 * The API client's params type carries an index signature, and TypeScript will
 * not assign an interface to one - an interface can be augmented after the
 * fact, so its shape is not final. A type alias is, so this passes straight
 * into api.get without a cast.
 */
export type AssetQuery = {
  q: string;
  status: string[];
  category_id: string;
  location_id: string;
  assignee_id: string;
  sort: string;
  page: number;
  per_page: number;
}

const DEFAULT_SORT = "-created_at";

/**
 * Filter state lives in the URL, so a filtered register is a shareable link and the
 * back button restores the previous view instead of resetting it.
 */
export function useAssetQuery() {
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useMemo<AssetQuery>(() => ({
    q: searchParams.get("q") ?? "",
    status: searchParams.getAll("status"),
    category_id: searchParams.get("category_id") ?? "",
    location_id: searchParams.get("location_id") ?? "",
    assignee_id: searchParams.get("assignee_id") ?? "",
    sort: searchParams.get("sort") ?? DEFAULT_SORT,
    page: Math.max(1, Number(searchParams.get("page")) || 1),
    per_page: Math.min(200, Number(searchParams.get("per_page")) || 25),
  }), [searchParams]);

  const write = useCallback((next: Partial<AssetQuery>, resetPage: boolean) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      params.delete(key);
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, item);
      } else if (value !== "" && value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    // Changing a filter while on page 7 of the old result set shows nothing.
    if (resetPage) params.delete("page");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  return {
    query,
    setFilter: useCallback(
      (key: keyof AssetQuery, value: string | string[]) => write({ [key]: value }, true),
      [write],
    ),
    setSort: useCallback((sort: string) => write({ sort }, true), [write]),
    setPage: useCallback((page: number) => write({ page }, false), [write]),
    clear: useCallback(() => write({
      q: "", status: [], category_id: "", location_id: "", assignee_id: "",
    }, true), [write]),
  };
}
