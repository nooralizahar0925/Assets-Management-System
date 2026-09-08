import { api } from "./client";

export type SessionStatus = "open" | "closed" | "abandoned";

export interface StocktakeSession {
  id: string;
  location_id: string | null;
  location_name?: string | null;
  name: string;
  status: SessionStatus;
  opened_at: string;
  closed_at: string | null;
  expected_ids: string[];
  counted?: number;
}

export interface AssetRef {
  id: string;
  name: string;
  asset_tag: string;
}

export interface Reconciliation {
  expected: number;
  counted: number;
  missing: AssetRef[];
  unexpected: AssetRef[];
}

export type CountOutcome =
  | "expected"
  | "unexpected"
  | "already_counted"
  | "unknown_tag";

export interface CountResult {
  outcome: CountOutcome;
  asset?: AssetRef;
}

export const stocktakeApi = {
  list: () => api.get<StocktakeSession[]>("/api/v1/stocktakes"),

  open: (input: { location_id: string; name: string }) =>
    api.post<StocktakeSession>("/api/v1/stocktakes", input),

  /** The reconciliation travels with the session, so one refresh shows both. */
  get: (id: string) =>
    api.get<{ session: StocktakeSession; reconciliation: Reconciliation }>(
      `/api/v1/stocktakes/${id}`,
    ),

  count: (id: string, tag: string) =>
    api.post<CountResult>(`/api/v1/stocktakes/${id}/count`, { tag }),

  close: (id: string, adjust: boolean) =>
    api.post<{ adjusted: number }>(`/api/v1/stocktakes/${id}/close`, { adjust }),
};
