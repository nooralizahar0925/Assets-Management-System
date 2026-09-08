import { requirePlatform } from "@/lib/platform/auth";
import { recordPlatformAction } from "@/lib/platform/audit";
import {
  getPlan, upsertPlan, deletePlan, PlanInput, UnknownFeatureError, PlanInUseError,
} from "@/lib/platform/plans";
import { validationProblem, problem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

type Params = { params: Promise<{ code: string }> };

export const GET = safe(async (req: Request, { params }: Params) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  const plan = await getPlan((await params).code);
  return plan ? Response.json(plan) : notFound("plan");
});

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  const code = (await params).code;
  const existing = await getPlan(code);
  if (!existing) return notFound("plan");

  // Merged onto what is there, so a console that sends only the changed field
  // does not blank the rest. The code itself is never taken from the body: it
  // is the identity, and renaming it would silently create a second plan.
  const parsed = PlanInput.safeParse({
    ...existing, ...(await req.json().catch(() => ({}))), code,
  });
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    const plan = await upsertPlan(parsed.data);
    await recordPlatformAction(actor, "plan.saved", {
      code: plan.code, features: plan.features, price_minor: plan.price_minor,
    });
    return Response.json(plan);
  } catch (err) {
    if (err instanceof UnknownFeatureError) {
      return problem(422, "validation", "Validation failed", { detail: err.message });
    }
    throw err;
  }
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  const code = (await params).code;
  try {
    const removed = await deletePlan(code);
    if (!removed) return notFound("plan");
    await recordPlatformAction(actor, "plan.deleted", { code });
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof PlanInUseError) {
      return problem(409, "conflict", "Plan is in use", { detail: err.message });
    }
    throw err;
  }
});
