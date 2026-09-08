import { requirePlatform } from "@/lib/platform/auth";
import { recordPlatformAction } from "@/lib/platform/audit";
import {
  listPlans, upsertPlan, PlanInput, UnknownFeatureError,
} from "@/lib/platform/plans";
import { FEATURES } from "@/lib/platform/features";
import { validationProblem, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

export const GET = safe(async (req: Request) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  // The catalogue travels with the plans: the console needs both to render a
  // plan editor, and fetching them separately means rendering a switch for a
  // feature whose label has not arrived yet.
  return Response.json({ data: await listPlans(), features: FEATURES });
});

export const POST = safe(async (req: Request) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  const parsed = PlanInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    const plan = await upsertPlan(parsed.data);
    await recordPlatformAction(actor, "plan.saved", {
      code: plan.code, features: plan.features, price_minor: plan.price_minor,
    });
    return Response.json(plan, { status: 201 });
  } catch (err) {
    if (err instanceof UnknownFeatureError) {
      return problem(422, "validation", "Validation failed", { detail: err.message });
    }
    throw err;
  }
});
