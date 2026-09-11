import { z } from "zod";
import { requirePlatform } from "@/lib/platform/auth";
import { recordPlatformAction } from "@/lib/platform/audit";
import { withPlatform } from "@/lib/platform/db";
import { deleteOrg, SlugMismatchError } from "@/lib/platform/provision";
import { effectiveEntitlements } from "@/lib/platform/plans";
import { orgUsage } from "@/lib/platform/usage";
import { forgetEntitlements } from "@/lib/entitlements";
import { validationProblem, notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

type Params = { params: Promise<{ id: string }> };

export const GET = safe(async (req: Request, { params }: Params) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  const id = (await params).id;
  const org = await withPlatform(async (c) =>
    (await c.query(
      `SELECT id, name, slug, plan_code, price_minor, notes, suspended_at,
              contract_starts, renews_on, trial_ends_at, limit_overrides,
              created_at
         FROM organizations WHERE id = $1`,
      [id],
    )).rows[0],
  );
  if (!org) return notFound("organisation");

  // Entitlements and usage travel with it. What this customer can do is the
  // plan plus their own exceptions - neither alone answers the question - and
  // a limit means nothing on screen without the number it is measured against.
  const [entitlements, usage, overrides] = await Promise.all([
    effectiveEntitlements(id),
    orgUsage(id),
    withPlatform(async (c) =>
      (await c.query(
        `SELECT feature_key, enabled, note, set_at
           FROM org_entitlements WHERE org_id = $1 ORDER BY feature_key`,
        [id],
      )).rows,
    ),
  ]);

  return Response.json({ ...org, entitlements, usage, overrides });
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const Patch = z.object({
  name: z.string().min(1).max(200).optional(),
  plan_code: z.string().nullable().optional(),
  price_minor: z.number().int().nonnegative().nullable().optional(),
  contract_starts: z.string().regex(ISO_DATE).nullable().optional(),
  renews_on: z.string().regex(ISO_DATE).nullable().optional(),
  trial_ends_at: z.string().regex(ISO_DATE).nullable().optional(),
  notes: z.string().max(2000).optional(),
  limit_overrides: z.record(z.number().int().positive()).optional(),
});

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  const parsed = Patch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const id = (await params).id;
  const patch = parsed.data;

  // Each nullable field is guarded by "was it mentioned at all", because for
  // these, null is a value: clearing a renewal date is a thing an operator
  // does deliberately, and coalesce cannot tell that from an absent field.
  //
  // The slug is not patchable. It appears in URLs and in exports the customer
  // already holds.
  const updated = await withPlatform(async (c) =>
    (await c.query<{ slug: string }>(
      `UPDATE organizations SET
         name            = coalesce($2, name),
         plan_code       = CASE WHEN $3::boolean THEN $4 ELSE plan_code END,
         price_minor     = CASE WHEN $5::boolean THEN $6::bigint ELSE price_minor END,
         contract_starts = CASE WHEN $7::boolean THEN $8::date ELSE contract_starts END,
         renews_on       = CASE WHEN $9::boolean THEN $10::date ELSE renews_on END,
         trial_ends_at   = CASE WHEN $11::boolean THEN $12::date ELSE trial_ends_at END,
         notes           = coalesce($13, notes),
         limit_overrides = coalesce($14::jsonb, limit_overrides)
       WHERE id = $1
       RETURNING slug`,
      [
        id, patch.name ?? null,
        "plan_code" in patch, patch.plan_code ?? null,
        "price_minor" in patch, patch.price_minor ?? null,
        "contract_starts" in patch, patch.contract_starts ?? null,
        "renews_on" in patch, patch.renews_on ?? null,
        "trial_ends_at" in patch, patch.trial_ends_at ?? null,
        patch.notes ?? null,
        patch.limit_overrides ? JSON.stringify(patch.limit_overrides) : null,
      ],
    )).rows[0],
  );
  if (!updated) return notFound("organisation");

  // A change of plan or of limits changes what the tenant API allows, and the
  // cache would otherwise hold the old answer for another half minute.
  forgetEntitlements(id);

  await recordPlatformAction(actor, "org.updated", {
    orgId: id, orgSlug: updated.slug, changed: Object.keys(patch),
  });

  return Response.json({
    slug: updated.slug,
    entitlements: await effectiveEntitlements(id),
  });
});

const Confirm = z.object({ slug: z.string().min(1) });

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  const parsed = Confirm.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    const removed = await deleteOrg(actor, (await params).id, parsed.data.slug);
    return removed ? new Response(null, { status: 204 }) : notFound("organisation");
  } catch (err) {
    if (err instanceof SlugMismatchError) {
      return problem(409, "conflict", "Confirmation did not match", {
        detail: err.message,
      });
    }
    throw err;
  }
});
