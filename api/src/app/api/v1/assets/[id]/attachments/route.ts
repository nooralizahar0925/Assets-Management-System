import {
  requireAuth, isResponse, withinLocationScope, branchForbidden,
} from "@/lib/auth/guard";
import { problem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getAsset } from "@/lib/domain/assets";
import {
  addAttachment, listAttachments, UnsupportedTypeError, type AttachmentKind,
} from "@/lib/domain/attachments";

type Params = { params: Promise<{ id: string }> };
const KINDS = new Set(["file", "photo", "condition_in", "condition_out"]);

export const GET = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const { id } = await params;
  const asset = await getAsset(ctx, id);
  if (!asset) return notFound("asset");
  if (!withinLocationScope(ctx, asset.location_id)) return branchForbidden();

  return Response.json({ data: await listAttachments(ctx, id) });
});

export const POST = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;

  const { id } = await params;
  const asset = await getAsset(ctx, id);
  if (!asset) return notFound("asset");
  if (!withinLocationScope(ctx, asset.location_id)) return branchForbidden();

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return problem(422, "validation", "Validation failed", {
      detail: "Send the file as multipart form field `file`.",
    });
  }

  const rawKind = String(form?.get("kind") ?? "file");
  const kind = (KINDS.has(rawKind) ? rawKind : "file") as AttachmentKind;

  try {
    const attachment = await addAttachment(ctx, {
      assetId: id,
      assignmentId: (form?.get("assignment_id") as string) || null,
      kind,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      body: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json(attachment, { status: 201 });
  } catch (err) {
    if (err instanceof UnsupportedTypeError) {
      return problem(err.status, "unsupported-media-type", "Unsupported file", {
        detail: err.message,
      });
    }
    throw err;
  }
});
