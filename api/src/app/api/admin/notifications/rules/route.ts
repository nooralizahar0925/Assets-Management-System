import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listRules, createRule, RuleInput, NOTIFICATION_EVENTS } from "@/lib/notify/rules";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;
  return Response.json({
    data: await listRules(ctx),
    events: NOTIFICATION_EVENTS,
  });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;

  const parsed = RuleInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  // Upserts on (event, channel, template_key), so saving the same rule twice
  // edits it rather than creating a duplicate that fires two emails.
  return Response.json(await createRule(ctx, parsed.data), { status: 201 });
});
