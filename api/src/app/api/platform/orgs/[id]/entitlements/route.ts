import { z } from "zod";
import { requirePlatform } from "@/lib/platform/auth";
import { recordPlatformAction } from "@/lib/platform/audit";
import { withPlatform } from "@/lib/platform/db";
import { effectiveEntitlements } from "@/lib/platform/plans";
import { isFeatureKey, ALWAYS_ON } from "@/lib/platform/features";
import { forgetEntitlements } from "@/lib/entitlements";
import { validationProblem, notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({
  overrides: z.array(z.object({
    feature_key: z.string(),
    enabled: z.boolean(),
    note: z.string().max(500).default(""),
  })).max(50),
});

/**
 * Replaces this customer's exceptions to their plan.
 *
 * The whole set, not a patch: the console shows every feature at once and
 * knows what it means to leave, and a per-feature endpoint would let two
 * half-finished edits leave a customer somewhere neither operator intended.
 */
export const PUT = safe(async (req: Request, { params }: Params) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const unknown = parsed.data.overrides
    .map((o) => o.feature_key)
    .filter((key) => !isFeatureKey(key));
  if (unknown.length > 0) {
    return problem(422, "validation", "Validation failed", {
      detail:
        `No such feature: ${unknown.join(", ")}. An override for something no `
        + "handler checks would grant nothing and confuse whoever read it next.",
    });
  }

  // Refusing to switch off the register here as well as in the resolver: the
  // resolver puts it back regardless, and storing an override that is silently
  // ignored would tell the next operator a lie about what they had done.
  const refused = parsed.data.overrides
    .filter((o) => !o.enabled && (ALWAYS_ON as readonly string[]).includes(o.feature_key));
  if (refused.length > 0) {
    return problem(422, "validation", "Validation failed", {
      detail:
        "The asset register cannot be switched off. An account that can sign "
        + "in and do nothing at all is a support call, not a plan.",
    });
  }

  const id = (await params).id;

  const org = await withPlatform(async (c) => {
    const found = (await c.query<{ slug: string }>(
      "SELECT slug FROM organizations WHERE id = $1", [id],
    )).rows[0];
    if (!found) return null;

    const before = (await c.query<{ feature_key: string; enabled: boolean }>(
      "SELECT feature_key, enabled FROM org_entitlements WHERE org_id = $1", [id],
    )).rows;

    await c.query("DELETE FROM org_entitlements WHERE org_id = $1", [id]);
    for (const override of parsed.data.overrides) {
      await c.query(
        `INSERT INTO org_entitlements
           (org_id, feature_key, enabled, note, set_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, override.feature_key, override.enabled, override.note, actor.id],
      );
    }

    return { slug: found.slug, before };
  });

  if (!org) return notFound("organisation");

  // The tenant API caches entitlements for half a minute. Clearing it here is
  // what makes the change take effect while the operator is still looking at
  // the screen rather than a minute after they have moved on.
  forgetEntitlements(id);

  await recordPlatformAction(actor, "org.entitlements_changed", {
    orgId: id,
    orgSlug: org.slug,
    from: org.before,
    to: parsed.data.overrides,
  });

  return Response.json(await effectiveEntitlements(id));
});
