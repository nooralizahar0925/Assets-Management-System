import { withTenant } from "./db";
import { problem } from "./http/problem";
import type { Ctx } from "./http/handler";
import { effectiveEntitlements, type Limits } from "./platform/plans";
import { FEATURES, type FeatureKey } from "./platform/features";

/**
 * What the tenant API asks about a customer's plan.
 *
 * One rule holds everywhere in here: **a limit refuses a write and never a
 * read**. A customer over their cap must always be able to look at what they
 * have and export it. A limit that blocks reading is not a limit, it is a way
 * of holding somebody's data hostage until they pay - and the first time they
 * need that data in a hurry is exactly when they will not forgive it.
 */

const CACHE_MS = 30_000;
const cache = new Map<string, { value: Awaited<ReturnType<typeof effectiveEntitlements>>; at: number }>();

/**
 * Cached briefly, per organisation.
 *
 * This is on the path of every gated write, and resolving it is two queries
 * against the platform connection - a pool deliberately kept small. Thirty
 * seconds is short enough that an operator who changes a plan sees it take
 * effect while they are still looking at the screen, and long enough that a
 * busy tenant is not re-reading it hundreds of times a minute.
 */
async function entitlementsFor(orgId: string) {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const value = await effectiveEntitlements(orgId);
  cache.set(orgId, { value, at: Date.now() });
  return value;
}

/** Used by the console when it changes something, and by the tests. */
export const forgetEntitlements = (orgId?: string) =>
  orgId ? cache.delete(orgId) : cache.clear();

export async function hasFeature(ctx: Ctx, key: FeatureKey): Promise<boolean> {
  const { features } = await entitlementsFor(ctx.orgId);
  return features.includes(key);
}

/**
 * A refusal to return, or null to carry on.
 *
 * Shaped this way so a handler reads as one line after requireAuth, which is
 * what keeps the gates from being forgotten on the next endpoint.
 */
export async function requireFeature(
  ctx: Ctx,
  key: FeatureKey,
): Promise<Response | null> {
  if (await hasFeature(ctx, key)) return null;

  // The label, not the key. The reader is somebody using the product, and
  // "stocktake is not enabled" reads like a fault rather than a plan.
  const label = FEATURES.find((f) => f.key === key)?.label ?? key;

  return problem(403, "feature-not-enabled", "Not included in this plan", {
    detail:
      `${label} is not included in this organisation's plan. Whoever manages `
      + "the subscription can add it.",
  });
}

type CountableLimit = "max_assets" | "max_users";

const LIMIT_LABEL: Record<CountableLimit, string> = {
  max_assets: "assets",
  max_users: "people",
};

/** Counts only what is live: deleting something has to actually make room. */
async function currentUsage(ctx: Ctx, limit: CountableLimit): Promise<number> {
  return withTenant(ctx.orgId, async (c) => {
    const sql = limit === "max_assets"
      ? "SELECT count(*) AS n FROM assets WHERE deleted_at IS NULL"
      : "SELECT count(*) AS n FROM users";
    return Number((await c.query<{ n: string }>(sql)).rows[0].n);
  });
}

/**
 * Refuses a write that would take a customer past their plan's limit.
 *
 * `adding` is how many the write would create, so an import is checked once
 * for the whole file rather than row by row. Half an import is the worst
 * outcome available: the customer cannot tell what landed, and re-running
 * double-imports the part that did.
 *
 * 402 rather than 403. A permission failure and a commercial one are different
 * problems with different remedies - one is fixed by an administrator, the
 * other by whoever pays - and a client that cannot tell them apart will tell
 * the customer the wrong thing.
 */
export async function assertWithinLimit(
  ctx: Ctx,
  limit: CountableLimit,
  adding = 1,
): Promise<Response | null> {
  const { limits } = await entitlementsFor(ctx.orgId);
  const cap = (limits as Limits)[limit];

  // An absent limit means unlimited, not zero.
  if (cap === undefined) return null;

  const current = await currentUsage(ctx, limit);
  if (current + adding <= cap) return null;

  const label = LIMIT_LABEL[limit];
  return problem(402, "plan-limit", "Plan limit reached", {
    detail:
      `This organisation's plan allows ${cap} ${label}, and it already has `
      + `${current}. Remove some, or ask whoever manages the subscription to `
      + "change plan. Everything already here stays readable and exportable.",
  });
}
