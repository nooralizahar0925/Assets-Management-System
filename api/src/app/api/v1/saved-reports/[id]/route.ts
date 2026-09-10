import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getSavedReport, deleteSavedReport } from "@/lib/reports/saved";
import { requireFeature } from "@/lib/entitlements";

type Params = { params: Promise<{ id: string }> };

export const GET = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "reports");
  if (gate) return gate;
  const saved = await getSavedReport(ctx, (await params).id);
  return saved ? Response.json(saved) : notFound("saved report");
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "reports");
  if (gate) return gate;
  const done = await deleteSavedReport(ctx, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("saved report");
});
