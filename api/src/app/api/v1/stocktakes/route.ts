import { requireAuth, isResponse, withinLocationScope } from "@/lib/auth/guard";
import { validationProblem, forbidden } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { SessionInput, openSession, listSessions } from "@/lib/domain/stocktake";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "stocktake:read");
  if (isResponse(ctx)) return ctx;

  // A branch-limited reader sees only counts at their own sites. Filtering
  // here rather than in SQL keeps the domain query simple and the rule in one
  // readable place; the list is small by nature.
  const sessions = (await listSessions(ctx))
    .filter((s) => withinLocationScope(ctx, s.location_id));

  return Response.json({ data: sessions });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "stocktake:write");
  if (isResponse(ctx)) return ctx;

  const parsed = SessionInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  // Otherwise a branch-limited manager could count - and adjust - a site they
  // are not responsible for.
  if (!withinLocationScope(ctx, parsed.data.location_id)) {
    return forbidden(
      "Your access is limited to specific branches, and this location is not " +
        "one of them.",
    );
  }

  return Response.json(await openSession(ctx, parsed.data), { status: 201 });
});
