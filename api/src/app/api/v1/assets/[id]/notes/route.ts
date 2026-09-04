import { z } from "zod";
import {
  requireAuth, isResponse, withinLocationScope, branchForbidden,
} from "@/lib/auth/guard";
import { validationProblem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getAsset } from "@/lib/domain/assets";
import { addNote } from "@/lib/domain/assignments";

const Body = z.object({ note: z.string().min(1).max(2000) });

export const POST = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  // Adding a note changes the asset's record, so it needs write access rather
  // than only the ability to move custody.
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const id = (await params).id;
  const asset = await getAsset(ctx, id);
  if (!asset) return notFound("asset");
  if (!withinLocationScope(ctx, asset.location_id)) return branchForbidden();

  const done = await addNote(ctx, id, parsed.data.note);
  return done ? new Response(null, { status: 204 }) : notFound("asset");
});
