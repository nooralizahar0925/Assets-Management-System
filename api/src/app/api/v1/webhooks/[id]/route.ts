import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { deleteWebhook } from "@/lib/domain/webhooks";
import { requireFeature } from "@/lib/entitlements";

type Params = { params: Promise<{ id: string }> };

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "webhooks:write");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "webhooks");
  if (gate) return gate;

  const removed = await deleteWebhook(ctx, (await params).id);
  return removed ? new Response(null, { status: 204 }) : notFound("webhook");
});
