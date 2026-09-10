import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, conflict, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import {
  listSavedReports, createSavedReport, SavedReportInput,
  UnknownReportError, DuplicateSavedReportError,
} from "@/lib/reports/saved";
import { requireFeature } from "@/lib/entitlements";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "reports");
  if (gate) return gate;
  return Response.json({ data: await listSavedReports(ctx) });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "reports");
  if (gate) return gate;

  const parsed = SavedReportInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    return Response.json(await createSavedReport(ctx, parsed.data), { status: 201 });
  } catch (err) {
    if (err instanceof UnknownReportError) {
      return problem(422, "validation", "Validation failed", { detail: err.message });
    }
    if (err instanceof DuplicateSavedReportError) return conflict(err.message);
    throw err;
  }
});
