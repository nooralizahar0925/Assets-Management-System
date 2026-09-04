import {
  requireAuth, isResponse, withinLocationScope, branchForbidden,
} from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getAsset } from "@/lib/domain/assets";
import {
  getAttachment, deleteAttachment, readAttachmentBody,
} from "@/lib/domain/attachments";
import type { Ctx } from "@/lib/http/handler";

type Params = { params: Promise<{ id: string }> };

/** An attachment inherits its asset's branch, so the check follows the asset. */
async function branchAllows(ctx: Ctx, assetId: string | null): Promise<boolean> {
  if (ctx.actor.locationScope === null) return true;
  if (!assetId) return false;
  const asset = await getAsset(ctx, assetId);
  return asset !== null && withinLocationScope(ctx, asset.location_id);
}

export const GET = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const attachment = await getAttachment(ctx, (await params).id);
  if (!attachment) return notFound("attachment");
  if (!(await branchAllows(ctx, attachment.asset_id))) return branchForbidden();

  const body = await readAttachmentBody(attachment.object_key);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": attachment.content_type,
      // The filename is quoted, so any quote inside it is stripped rather than
      // allowed to break out of the header value.
      "content-disposition":
        `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
      "cache-control": "private, max-age=300",
    },
  });
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;

  const attachment = await getAttachment(ctx, (await params).id);
  if (!attachment) return notFound("attachment");
  if (!(await branchAllows(ctx, attachment.asset_id))) return branchForbidden();

  const done = await deleteAttachment(ctx, attachment.id);
  return done ? new Response(null, { status: 204 }) : notFound("attachment");
});
