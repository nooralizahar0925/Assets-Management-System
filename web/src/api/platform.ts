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

export const platformApi = {
  signIn: (email: string, password: string) =>
    api.post<PlatformActor>("/api/platform/auth/login", { email, password }),

  signOut: () => api.post("/api/platform/auth/logout"),

  me: () => api.get<PlatformActor>("/api/platform/auth/me"),

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
};
