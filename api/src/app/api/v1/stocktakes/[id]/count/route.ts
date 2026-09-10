import { z } from "zod";
import { requireAuth, isResponse, withinLocationScope } from "@/lib/auth/guard";
import { validationProblem, notFound, forbidden, conflict } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import {
  countAsset, getSession, SessionClosedError,
} from "@/lib/domain/stocktake";
import { requireFeature } from "@/lib/entitlements";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({ tag: z.string().min(1).max(64) });

export const POST = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "stocktake:write");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "stocktake");
  if (gate) return gate;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const id = (await params).id;
  const session = await getSession(ctx, id);
  if (!session) return notFound("stock-take");
  if (!withinLocationScope(ctx, session.location_id)) {
    return forbidden(
      "Your access is limited to specific branches, and this count is not at " +
        "one of them.",
    );
  }

  try {
    // Every outcome is a 200. A rescan, a tag from elsewhere and an unreadable
    // label are all things that happen mid-count, and the scanning screen has
    // to tell the counter which - not show them an error page.
    return Response.json(await countAsset(ctx, id, parsed.data.tag));
  } catch (err) {
    if (err instanceof SessionClosedError) return conflict(err.message);
    throw err;
  }
});
