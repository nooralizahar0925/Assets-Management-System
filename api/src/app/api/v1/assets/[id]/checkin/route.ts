import {
  requireAuth, isResponse, withinLocationScope, branchForbidden,
} from "@/lib/auth/guard";
import { validationProblem, problem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getAsset } from "@/lib/domain/assets";
import {
  checkIn, CheckInInput, TransitionError, AssetNotFoundError,
} from "@/lib/domain/assignments";

export const POST = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "custody:write");
  if (isResponse(ctx)) return ctx;

  const parsed = CheckInInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const id = (await params).id;
  const asset = await getAsset(ctx, id);
  if (!asset) return notFound("asset");
  if (!withinLocationScope(ctx, asset.location_id)) return branchForbidden();
  if (parsed.data.location_id !== undefined
      && !withinLocationScope(ctx, parsed.data.location_id ?? null)) {
    return branchForbidden();
  }

  try {
    return Response.json(await checkIn(ctx, id, parsed.data));
  } catch (err) {
    if (err instanceof AssetNotFoundError) return notFound("asset");
    if (err instanceof TransitionError) {
      return problem(409, "invalid-transition", "Invalid status transition", {
        detail: err.message,
      });
    }
    throw err;
  }
});
