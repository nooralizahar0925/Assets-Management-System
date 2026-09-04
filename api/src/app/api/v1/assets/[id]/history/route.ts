import {
  requireAuth, isResponse, withinLocationScope, branchForbidden,
} from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listAssetHistory } from "@/lib/domain/audit";
import { listAssignments } from "@/lib/domain/assignments";
import { getAsset } from "@/lib/domain/assets";

export const GET = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  // One asset's history is part of reading that asset. The organisation-wide
  // audit trail is a separate concern behind audit:read.
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const { id } = await params;
  const asset = await getAsset(ctx, id);
  if (!asset) return notFound("asset");
  if (!withinLocationScope(ctx, asset.location_id)) return branchForbidden();

  const [events, assignments] = await Promise.all([
    listAssetHistory(ctx, id),
    listAssignments(ctx, id),
  ]);
  return Response.json({ data: { events, assignments } });
});
