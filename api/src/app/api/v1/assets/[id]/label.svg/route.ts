import {
  requireAuth, isResponse, withinLocationScope, branchForbidden,
} from "@/lib/auth/guard";
import { notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getAsset } from "@/lib/domain/assets";
import { renderLabelSvg, parseSymbology, InvalidTagError } from "@/lib/domain/labels";

export const GET = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "labels:print");
  if (isResponse(ctx)) return ctx;

  const asset = await getAsset(ctx, (await params).id);
  if (!asset) return notFound("asset");
  if (!withinLocationScope(ctx, asset.location_id)) return branchForbidden();

  const symbology = parseSymbology(new URL(req.url).searchParams.get("symbology"));
  try {
    return new Response(await renderLabelSvg(asset.asset_tag, symbology), {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch (err) {
    if (err instanceof InvalidTagError) {
      return problem(422, "validation", "Cannot encode this tag", { detail: err.message });
    }
    throw err;
  }
});
