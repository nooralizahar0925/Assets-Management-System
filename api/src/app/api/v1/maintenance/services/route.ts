import { requireAuth, isResponse, withinLocationScope } from "@/lib/auth/guard";
import { problem, notFound, forbidden } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listServices } from "@/lib/domain/maintenance";
import { getAsset } from "@/lib/domain/assets";
import { requireFeature } from "@/lib/entitlements";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "maintenance:read");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "maintenance");
  if (gate) return gate;

  const assetId = new URL(req.url).searchParams.get("asset_id");
  if (!assetId) {
    return problem(422, "validation", "Validation failed", {
      detail: "asset_id is required.",
    });
  }

  const asset = await getAsset(ctx, assetId);
  if (!asset) return notFound("asset");
  if (!withinLocationScope(ctx, asset.location_id)) {
    return forbidden(
      "Your access is limited to specific branches, and this asset is not in " +
        "one of them.",
    );
  }

  return Response.json({ data: await listServices(ctx, assetId) });
});
