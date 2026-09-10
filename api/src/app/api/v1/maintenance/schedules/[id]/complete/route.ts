import { requireAuth, isResponse, withinLocationScope } from "@/lib/auth/guard";
import { validationProblem, notFound, forbidden } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { ServiceInput, completeService, listSchedules } from "@/lib/domain/maintenance";
import { getAsset } from "@/lib/domain/assets";
import { requireFeature } from "@/lib/entitlements";

type Params = { params: Promise<{ id: string }> };

export const POST = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "maintenance:write");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "maintenance");
  if (gate) return gate;

  const parsed = ServiceInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const id = (await params).id;
  const schedule = (await listSchedules(ctx)).find((s) => s.id === id);
  if (!schedule) return notFound("maintenance schedule");

  const asset = await getAsset(ctx, schedule.asset_id);
  if (asset && !withinLocationScope(ctx, asset.location_id)) {
    return forbidden(
      "Your access is limited to specific branches, and this asset is not in " +
        "one of them.",
    );
  }

  return Response.json(await completeService(ctx, id, parsed.data));
});
