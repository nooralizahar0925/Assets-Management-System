import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { updateSchedule, deleteSchedule, ScheduleInput } from "@/lib/reports/schedules";
import { requireFeature } from "@/lib/entitlements";

type Params = { params: Promise<{ id: string }> };

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "reports:schedule");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "reports_scheduled");
  if (gate) return gate;

  const parsed = ScheduleInput.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const updated = await updateSchedule(ctx, (await params).id, parsed.data);
  return updated ? Response.json(updated) : notFound("report schedule");
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "reports:schedule");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "reports_scheduled");
  if (gate) return gate;
  const done = await deleteSchedule(ctx, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("report schedule");
});
