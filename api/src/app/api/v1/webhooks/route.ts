import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { WebhookInput, createWebhook, listWebhooks, WEBHOOK_EVENTS } from "@/lib/domain/webhooks";
import { requireFeature } from "@/lib/entitlements";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "webhooks:write");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "webhooks");
  if (gate) return gate;

  return Response.json({
    data: await listWebhooks(ctx),
    // Published alongside the list so an integrator can see what is available
    // without reading the documentation for a name they might mistype.
    events: WEBHOOK_EVENTS,
  });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "webhooks:write");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "webhooks");
  if (gate) return gate;

  const parsed = WebhookInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  // The response carries the signing secret. It is the only time it is ever
  // returned, which the documentation has to say plainly.
  return Response.json(await createWebhook(ctx, parsed.data), { status: 201 });
});
