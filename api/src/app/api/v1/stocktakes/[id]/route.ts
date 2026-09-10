import { requireAuth, isResponse, withinLocationScope } from "@/lib/auth/guard";
import { notFound, forbidden } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getSession, reconcile } from "@/lib/domain/stocktake";
import { requireFeature } from "@/lib/entitlements";

type Params = { params: Promise<{ id: string }> };

export const GET = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "stocktake:read");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "stocktake");
  if (gate) return gate;

  const id = (await params).id;
  const session = await getSession(ctx, id);
  if (!session) return notFound("stock-take");
  if (!withinLocationScope(ctx, session.location_id)) {
    return forbidden(
      "Your access is limited to specific branches, and this count is not at " +
        "one of them.",
    );
  }

  // The reconciliation travels with the session: a counting screen needs both
  // on every refresh, and two round trips would show them disagreeing.
  return Response.json({
    session,
    reconciliation: await reconcile(ctx, id),
  });
});
