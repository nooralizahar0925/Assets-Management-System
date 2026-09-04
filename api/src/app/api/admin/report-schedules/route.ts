import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listSchedules, createSchedule, ScheduleInput } from "@/lib/reports/schedules";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "reports:schedule");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listSchedules(ctx) });
});

export const POST = safe(async (req: Request) => {
  // Scheduling is its own permission: running a report for yourself is not the
  // same as arranging for it to be emailed to a list every week.
  const ctx = await requireAuth(req, "reports:schedule");
  if (isResponse(ctx)) return ctx;

  const parsed = ScheduleInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  return Response.json(await createSchedule(ctx, parsed.data), { status: 201 });
});
