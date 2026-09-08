import { z } from "zod";
import { withPlatform } from "./db";
import { ALWAYS_ON, isFeatureKey } from "./features";

/**
 * Plans, and what one organisation is actually entitled to.
 *
 * A plan is a row because it is a commercial decision that changes without a
 * deploy: prices move, a tier gets renamed, a new one is introduced for one
 * campaign. The *features* it references are code, because a feature means
 * something only where a handler checks it.
 */

export interface Limits {
  max_assets?: number;
  max_users?: number;
  max_storage_mb?: number;
}

export interface Plan {
  code: string;
  name: string;
  description: string;
  /** Minor units, integer. 250000 is Rp 250,000. */
  price_minor: number;
  currency: string;
  billing_cycle: "monthly" | "yearly" | "once";
  features: string[];
  limits: Limits;
  active: boolean;
  sort_order: number;
}

export const LimitsInput = z.object({
  max_assets: z.number().int().positive().optional(),
  max_users: z.number().int().positive().optional(),
  max_storage_mb: z.number().int().positive().optional(),
});

export const PlanInput = z.object({
  code: z.string().min(1).max(40).regex(/^[a-z0-9-]+$/, {
    message: "Lower case, digits and hyphens: it appears in URLs and exports.",
  }),
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(""),
  price_minor: z.number().int().nonnegative(),
  currency: z.string().length(3).default("IDR"),
  billing_cycle: z.enum(["monthly", "yearly", "once"]).default("monthly"),
  features: z.array(z.string()).default([]),
  limits: LimitsInput.default({}),
  active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});
export type PlanInput = z.input<typeof PlanInput>;

export class UnknownFeatureError extends Error {}
export class PlanInUseError extends Error {}

const SELECT = `SELECT code, name, description, price_minor::int AS price_minor,
                       currency, billing_cycle, features, limits, active, sort_order
                  FROM plans`;

export const listPlans = () =>
  withPlatform(async (c) =>
    (await c.query<Plan>(`${SELECT} ORDER BY sort_order, name`)).rows,
  );

export const getPlan = (code: string) =>
  withPlatform(async (c) =>
    (await c.query<Plan>(`${SELECT} WHERE code = $1`, [code])).rows[0] ?? null,
  );

/**
 * Creates or replaces a plan.
 *
 * The feature keys are checked here rather than by a foreign key, because the
 * catalogue lives in code. A plan naming a feature nothing enforces would sell
 * something the customer discovers is missing by trying to use it.
 */
export async function upsertPlan(input: PlanInput): Promise<Plan> {
  const plan = PlanInput.parse(input);

  const unknown = plan.features.filter((key) => !isFeatureKey(key));
  if (unknown.length > 0) {
    throw new UnknownFeatureError(
      `No such feature: ${unknown.join(", ")}. A plan can only sell what a `
      + "handler checks - see src/lib/platform/features.ts.",
    );
  }

  return withPlatform(async (c) =>
    (await c.query<Plan>(
      `INSERT INTO plans (code, name, description, price_minor, currency,
                          billing_cycle, features, limits, active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         price_minor = EXCLUDED.price_minor,
         currency = EXCLUDED.currency,
         billing_cycle = EXCLUDED.billing_cycle,
         features = EXCLUDED.features,
         limits = EXCLUDED.limits,
         active = EXCLUDED.active,
         sort_order = EXCLUDED.sort_order
       RETURNING code, name, description, price_minor::int AS price_minor,
                 currency, billing_cycle, features, limits, active, sort_order`,
      [
        plan.code, plan.name, plan.description, plan.price_minor, plan.currency,
        plan.billing_cycle, plan.features, JSON.stringify(plan.limits),
        plan.active, plan.sort_order,
      ],
    )).rows[0],
  );
}

/**
 * Removes a plan nobody is on.
 *
 * Refused otherwise: deleting it would leave those customers with no plan and
 * nothing beyond the register, which is an outage they did not ask for. Move
 * them first, or deactivate the plan so it stops being offered while the
 * customers on it keep working.
 */
export async function deletePlan(code: string): Promise<boolean> {
  return withPlatform(async (c) => {
    const inUse = Number((await c.query<{ n: string }>(
      "SELECT count(*) AS n FROM organizations WHERE plan_code = $1", [code],
    )).rows[0].n);

    if (inUse > 0) {
      throw new PlanInUseError(
        `${inUse} organisation${inUse === 1 ? " is" : "s are"} on "${code}". `
        + "Move them to another plan first, or deactivate this one so it is no "
        + "longer offered while they keep working.",
      );
    }

    const { rowCount } = await c.query("DELETE FROM plans WHERE code = $1", [code]);
    return rowCount === 1;
  });
}

export interface Entitlements {
  features: string[];
  limits: Limits;
  plan_code: string | null;
}

/**
 * What one organisation may actually do.
 *
 * The plan grants; an override adds or takes away. An override of `false` is
 * as meaningful as `true` - it is how a feature is withdrawn from one customer
 * without moving them off the plan they pay for. The register survives any
 * override, because an account that can sign in and do nothing at all is a
 * support call rather than a plan.
 */
export async function effectiveEntitlements(orgId: string): Promise<Entitlements> {
  return withPlatform(async (c) => {
    const org = (await c.query<{ plan_code: string | null; limit_overrides: Limits }>(
      "SELECT plan_code, limit_overrides FROM organizations WHERE id = $1",
      [orgId],
    )).rows[0];

    if (!org) return { features: [...ALWAYS_ON], limits: {}, plan_code: null };

    const plan = org.plan_code
      ? (await c.query<{ features: string[]; limits: Limits }>(
          "SELECT features, limits FROM plans WHERE code = $1", [org.plan_code],
        )).rows[0]
      : undefined;

    const overrides = (await c.query<{ feature_key: string; enabled: boolean }>(
      "SELECT feature_key, enabled FROM org_entitlements WHERE org_id = $1",
      [orgId],
    )).rows;

    const features = new Set<string>([...ALWAYS_ON, ...(plan?.features ?? [])]);
    for (const row of overrides) {
      if (row.enabled) features.add(row.feature_key);
      else features.delete(row.feature_key);
    }
    for (const key of ALWAYS_ON) features.add(key);

    return {
      // Sorted, because the console diffs these and an unstable order would
      // make every read look like a change.
      features: [...features].sort(),
      limits: { ...(plan?.limits ?? {}), ...(org.limit_overrides ?? {}) },
      plan_code: org.plan_code,
    };
  });
}
