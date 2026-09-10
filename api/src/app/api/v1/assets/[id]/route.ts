import {
  requireAuth, isResponse, withinLocationScope, branchForbidden,
} from "@/lib/auth/guard";
import { dispatch } from "@/lib/notify/dispatch";
import { validationProblem, notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import {
  AssetInput, getAsset, updateAsset, softDeleteAsset, CustomFieldError,
} from "@/lib/domain/assets";
import { requireFeature } from "@/lib/entitlements";

type Params = { params: Promise<{ id: string }> };

export const GET = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const asset = await getAsset(ctx, (await params).id);
  if (!asset) return notFound("asset");
  // The branch check happens after the fetch, because the asset's location is
  // not known until it is loaded. requireAuth handles the case where a handler
  // knows the location up front; both paths return the same refusal.
  if (!withinLocationScope(ctx, asset.location_id)) return branchForbidden();

  return Response.json(asset);
});

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;

  const parsed = AssetInput.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  // Configuring depreciation is the feature, not merely reading its output. A
  // customer without it can still hold assets that have a purchase cost; they
  // simply cannot set a policy for writing that cost down.
  if (parsed.data.depreciation !== undefined) {
    const depreciationGate = await requireFeature(ctx, "depreciation");
    if (depreciationGate) return depreciationGate;
  }

  const id = (await params).id;
  const existing = await getAsset(ctx, id);
  if (!existing) return notFound("asset");
  if (!withinLocationScope(ctx, existing.location_id)) return branchForbidden();
  // Moving an asset out of the caller's branches would otherwise be a way to
  // push it somewhere they can no longer see, or to claim one they cannot.
  if (parsed.data.location_id !== undefined
      && !withinLocationScope(ctx, parsed.data.location_id ?? null)) {
    return branchForbidden();
  }

  try {
    const asset = await updateAsset(ctx, id, parsed.data);
    if (!asset) return notFound("asset");
    await dispatch(ctx, "asset.updated", {
      assetId: asset.id,
      actorId: ctx.actor.type === "user" ? ctx.actor.id : null,
      asset: { name: asset.name, asset_tag: asset.asset_tag, status: asset.status },
    });
    return Response.json(asset);
  } catch (err) {
    if (err instanceof CustomFieldError) {
      return problem(422, "validation", "Validation failed", { detail: err.message });
    }
    const e = err as { code?: string; message: string };
    if (e.code === "23505") {
      return problem(409, "conflict", "Duplicate value", { detail: e.message });
    }
    throw err;
  }
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:delete");
  if (isResponse(ctx)) return ctx;

  const id = (await params).id;
  const existing = await getAsset(ctx, id);
  if (!existing) return notFound("asset");
  if (!withinLocationScope(ctx, existing.location_id)) return branchForbidden();

  const done = await softDeleteAsset(ctx, id);
  if (!done) return notFound("asset");
  // The asset is read before the delete, so the payload can still say which
  // one it was - a subscriber receiving only an id could no longer look it up.
  await dispatch(ctx, "asset.deleted", {
    assetId: id,
    actorId: ctx.actor.type === "user" ? ctx.actor.id : null,
    asset: {
      name: existing.name, asset_tag: existing.asset_tag, status: existing.status,
    },
  });
  return new Response(null, { status: 204 });
});
