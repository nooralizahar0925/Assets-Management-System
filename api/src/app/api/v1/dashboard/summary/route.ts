import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { getDashboardSummary } from "@/lib/domain/dashboard";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  // getDashboardSummary applies the caller's branch scope itself, so every
  // figure reflects what this person can actually see.
  return Response.json({ data: await getDashboardSummary(ctx) });
});
