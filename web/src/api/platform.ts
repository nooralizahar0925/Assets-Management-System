import { api } from "./client";

/**
 * The platform console's own client.
 *
 * Separate from every other client in here on purpose: these endpoints answer
 * to a different cookie and a different session, and mixing them with the
 * tenant client would make it far too easy to call one believing it was the
 * other.
 */

export interface PlatformActor {
  id: string;
  email: string;
  name: string;
}

export interface OrganisationRow {
  id: string;
  name: string;
  slug: string;
  plan_code: string | null;
  suspended_at: string | null;
  trial_ends_at: string | null;
  renews_on: string | null;
  created_at: string;
  assets: number;
  users: number;
}

export interface Plan {
  code: string;
  name: string;
  description: string;
  price_minor: number;
  currency: string;
  billing_cycle: "monthly" | "yearly" | "once";
  features: string[];
  limits: Record<string, number>;
  active: boolean;
  sort_order: number;
}

/**
 * What the plan editor sends.
 *
 * The same shape as a plan minus nothing: the server merges a PATCH onto the
 * plan it already holds, but sending the whole thing means what the operator
 * sees on screen is exactly what is saved, with no field quietly kept from an
 * earlier version of the form.
 */
export type PlanInput = Omit<Plan, "limits"> & { limits: Record<string, number> };

export interface Feature {
  key: string;
  group: string;
  label: string;
  description: string;
}

export interface ProvisionedOrganisation {
  orgId: string;
  slug: string;
  adminEmail: string;
  /** Shown once, to be handed over. Never stored anywhere. */
  password: string;
}

export interface Entitlements {
  features: string[];
  limits: Record<string, number>;
  plan_code: string | null;
}

export interface Override {
  feature_key: string;
  enabled: boolean;
  note: string;
  set_at: string;
}

export interface Usage {
  assets: number;
  users: number;
  pending_invitations: number;
  storage_mb: number;
}

export interface OrganisationDetail {
  id: string;
  name: string;
  slug: string;
  plan_code: string | null;
  price_minor: number | null;
  notes: string | null;
  suspended_at: string | null;
  contract_starts: string | null;
  renews_on: string | null;
  trial_ends_at: string | null;
  limit_overrides: Record<string, number>;
  created_at: string;
  entitlements: Entitlements;
  usage: Usage;
  overrides: Override[];
}

export interface OrganisationPatch {
  name?: string;
  plan_code?: string | null;
  price_minor?: number | null;
  contract_starts?: string | null;
  renews_on?: string | null;
  trial_ends_at?: string | null;
  notes?: string;
  limit_overrides?: Record<string, number>;
}

export type ReasonKind =
  | "trial-ending" | "renewal-due" | "over-limit"
  | "no-plan" | "long-suspended" | "dormant";

export interface AttentionItem {
  org_id: string;
  name: string;
  slug: string;
  reasons: { kind: ReasonKind; detail: string }[];
}

export const platformApi = {
  signIn: (email: string, password: string) =>
    api.post<PlatformActor>("/api/platform/auth/login", { email, password }),

  signOut: () => api.post("/api/platform/auth/logout"),

  me: () => api.get<PlatformActor>("/api/platform/auth/me"),

  attention: () =>
    api.getEnvelope<{ data: AttentionItem[] }>("/api/platform/attention"),

  organisations: () =>
    api.getEnvelope<{ data: OrganisationRow[] }>("/api/platform/orgs"),

  provision: (input: {
    name: string;
    slug: string;
    adminName: string;
    adminEmail: string;
    planCode: string | null;
    trialDays: number | null;
  }) => api.post<ProvisionedOrganisation>("/api/platform/orgs", input),

  plans: () =>
    api.getEnvelope<{ data: Plan[]; features: Feature[] }>("/api/platform/plans"),

  createPlan: (input: PlanInput) =>
    api.post<Plan>("/api/platform/plans", input),

  /** The code is the identity and is never in the body; it addresses the row. */
  updatePlan: (code: string, patch: Omit<PlanInput, "code">) =>
    api.patch<Plan>(`/api/platform/plans/${encodeURIComponent(code)}`, patch),

  deletePlan: (code: string) =>
    api.del(`/api/platform/plans/${encodeURIComponent(code)}`),

  organisation: (id: string) =>
    api.get<OrganisationDetail>(`/api/platform/orgs/${id}`),

  updateOrganisation: (id: string, patch: OrganisationPatch) =>
    api.patch<{ slug: string; entitlements: Entitlements }>(
      `/api/platform/orgs/${id}`, patch,
    ),

  setEntitlements: (
    id: string,
    overrides: { feature_key: string; enabled: boolean; note: string }[],
  ) => api.put<Entitlements>(`/api/platform/orgs/${id}/entitlements`, { overrides }),

  suspend: (id: string, reason: string) =>
    api.post(`/api/platform/orgs/${id}/suspend`, { reason }),

  resume: (id: string) => api.del(`/api/platform/orgs/${id}/suspend`),

  /** The slug is typed by the operator and compared on the server. */
  remove: (id: string, slug: string) =>
    api.delWithBody(`/api/platform/orgs/${id}`, { slug }),
};
