import {
  requireAuth, isResponse, withinLocationScope, branchForbidden,
} from "@/lib/auth/guard";
import { notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getAsset } from "@/lib/domain/assets";
import { renderLabelPng, parseSymbology, InvalidTagError } from "@/lib/domain/labels";

export const GET = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "labels:print");
  if (isResponse(ctx)) return ctx;

  const asset = await getAsset(ctx, (await params).id);
  if (!asset) return notFound("asset");
  if (!withinLocationScope(ctx, asset.location_id)) return branchForbidden();

  const url = new URL(req.url);
  const symbology = parseSymbology(url.searchParams.get("symbology"));
  const scale = Number(url.searchParams.get("scale") ?? 3);

  try {
    const png = await renderLabelPng(asset.asset_tag, symbology, scale);
    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="${asset.asset_tag}-${symbology}.png"`,
        // Labels change only when the tag does, and the tag is in the URL.
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
