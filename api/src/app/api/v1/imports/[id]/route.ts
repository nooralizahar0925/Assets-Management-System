import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getImportJob } from "@/lib/domain/imports";

export const GET = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  const job = await getImportJob(ctx, (await params).id);
  return job ? Response.json(job) : notFound("import job");
});
