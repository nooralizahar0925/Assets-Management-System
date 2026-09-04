import {
  requireAuth, isResponse, withinLocationScope, branchForbidden,
} from "@/lib/auth/guard";
import { notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { lookupByTag } from "@/lib/domain/labels";

/**
 * The endpoint every scanner flow funnels through - camera scan, USB scanner,
 * and the /a/<tag> deep link. Keeping it one cheap exact-match query is what
 * makes scanning feel instant; anything slower and people go back to a
 * clipboard.
 */
export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const tag = new URL(req.url).searchParams.get("tag");
  if (!tag?.trim()) {
    return problem(422, "validation", "Validation failed", {
      detail: "Pass the scanned value as ?tag=",
    });
  }

  const asset = await lookupByTag(ctx, tag);
  if (!asset) return notFound("asset");
  if (!withinLocationScope(ctx, asset.location_id)) return branchForbidden();

  return Response.json(asset);
});
