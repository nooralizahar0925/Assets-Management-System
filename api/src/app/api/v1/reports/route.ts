import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { REPORTS } from "@/lib/reports/engine";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({
    data: Object.values(REPORTS).map((definition) => ({
      key: definition.key,
      name: definition.name,
      description: definition.description,
      columns: definition.columns,
      chart: definition.chart,
      formats: ["json", "csv", "xlsx", "pdf", "svg", "png"],
    })),
  });
});
