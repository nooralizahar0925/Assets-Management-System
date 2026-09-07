import { z } from "zod";
import { requireAuth, isResponse, withinLocationScope } from "@/lib/auth/guard";
import { validationProblem, notFound, forbidden, conflict } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import {
  closeSession, getSession, SessionClosedError,
} from "@/lib/domain/stocktake";

type Params = { params: Promise<{ id: string }> };

// Adjusting defaults to false: writing a dozen assets off is not something a
// caller who forgot the flag should trigger.
const Body = z.object({ adjust: z.boolean().default(false) });

export const POST = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "stocktake:write");
  if (isResponse(ctx)) return ctx;

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
    return Response.json(await closeSession(ctx, id, parsed.data));
  } catch (err) {
    // Closing twice is a conflict, not a failure: it means somebody else
    // already finished this count, and adjusting again would write off
    // whatever has gone missing since.
    if (err instanceof SessionClosedError) return conflict(err.message);
    throw err;
  }
});
