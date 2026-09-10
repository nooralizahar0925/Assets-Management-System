import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { REPORTS } from "@/lib/reports/engine";
import { requireFeature, hasFeature } from "@/lib/entitlements";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "reports");
  if (gate) return gate;
  // A report belonging to a feature this customer does not have is left out of
  // the gallery rather than listed and then refused. Offering something and
  // saying no when it is chosen is a worse experience than not offering it.
  const visible = [];
  for (const definition of Object.values(REPORTS)) {
    if (definition.feature) {
      const allowed = await hasFeature(
        ctx, definition.feature as Parameters<typeof hasFeature>[1],
      );
      if (!allowed) continue;
    }
    visible.push(definition);
  }

  return Response.json({
    data: visible.map((definition) => ({
      key: definition.key,
      name: definition.name,
      description: definition.description,
      columns: definition.columns,
      chart: definition.chart,
      formats: ["json", "csv", "xlsx", "pdf", "svg", "png"],
    })),
  });
});
