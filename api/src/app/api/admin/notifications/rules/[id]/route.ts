import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { updateRule, deleteRule, RuleInput } from "@/lib/notify/rules";

type Params = { params: Promise<{ id: string }> };

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;

  const parsed = RuleInput.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const updated = await updateRule(ctx, (await params).id, parsed.data);
  return updated ? Response.json(updated) : notFound("notification rule");
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;
  const done = await deleteRule(ctx, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("notification rule");
});
