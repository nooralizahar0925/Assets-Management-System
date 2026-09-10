import { requireAuth, isResponse, withinLocationScope } from "@/lib/auth/guard";
import { validationProblem, notFound, forbidden } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { ScheduleInput, createSchedule, listSchedules } from "@/lib/domain/maintenance";
import { getAsset } from "@/lib/domain/assets";
import { requireFeature } from "@/lib/entitlements";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "maintenance:read");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "maintenance");
  if (gate) return gate;

  const assetId = new URL(req.url).searchParams.get("asset_id") ?? undefined;
  const schedules = await listSchedules(ctx, assetId);

  return Response.json({ data: schedules });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "maintenance:write");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "maintenance");
  if (gate) return gate;

  const parsed = ScheduleInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  // The schedule belongs to an asset, so the asset's branch decides who may
  // create it - scheduling work on a machine at a site you cannot see is not
  // something a branch-limited account should be able to do.
  const asset = await getAsset(ctx, parsed.data.asset_id);
  if (!asset) return notFound("asset");
  if (!withinLocationScope(ctx, asset.location_id)) {
    return forbidden(
      "Your access is limited to specific branches, and this asset is not in " +
        "one of them.",
    );
  }

  return Response.json(await createSchedule(ctx, parsed.data), { status: 201 });
});
