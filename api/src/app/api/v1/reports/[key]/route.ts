import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { runReport, parseReportParams, REPORTS } from "@/lib/reports/engine";
import { renderJson } from "@/lib/reports/renderers/json";
import { renderCsv } from "@/lib/reports/renderers/csv";

const FORMATS = new Set(["json", "csv", "xlsx", "pdf", "svg", "png"]);

export const GET = safe(async (
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;

  const { key } = await params;
  if (!REPORTS[key]) return notFound("report");

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "json";
  if (!FORMATS.has(format)) {
    return problem(422, "validation", "Unsupported format", {
      detail: `format must be one of: ${[...FORMATS].join(", ")}`,
    });
  }

  // Every report applies the caller's branch scope in its own query, so a
  // scoped user's export contains only their branches.
  const result = await runReport(ctx, key, parseReportParams(url));
  switch (format) {
    case "csv": return renderCsv(result);
    // xlsx, pdf, svg and png are wired up in Task 18.
    default: return renderJson(result);
  }
});
