import { requirePlatform } from "@/lib/platform/auth";
import { provisionOrg, ProvisionInput, SlugTakenError } from "@/lib/platform/provision";
import { withPlatform } from "@/lib/platform/db";
import { validationProblem, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

interface OrgRow {
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

export const GET = safe(async (req: Request) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  // LATERAL, so an organisation with no assets and no people still appears -
  // and those are exactly the ones worth seeing, because they are the
  // customers who have not started yet.
  const rows = await withPlatform(async (c) =>
    (await c.query<OrgRow>(
      `SELECT o.id, o.name, o.slug, o.plan_code, o.suspended_at,
              o.trial_ends_at, o.renews_on, o.created_at,
              a.count::int AS assets, u.count::int AS users
         FROM organizations o
         LEFT JOIN LATERAL (
           SELECT count(*) FROM assets
            WHERE org_id = o.id AND deleted_at IS NULL
         ) a ON true
         LEFT JOIN LATERAL (
           SELECT count(*) FROM users WHERE org_id = o.id
         ) u ON true
        ORDER BY o.name`,
    )).rows,
  );

  return Response.json({ data: rows });
});

export const POST = safe(async (req: Request) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  const parsed = ProvisionInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    // The password comes back exactly once, to be handed to the customer.
    return Response.json(await provisionOrg(actor, parsed.data), { status: 201 });
  } catch (err) {
    if (err instanceof SlugTakenError) {
      return problem(409, "conflict", "Slug already in use", { detail: err.message });
    }
    throw err;
  }
});
