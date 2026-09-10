import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { runReport, parseReportParams, REPORTS } from "@/lib/reports/engine";
import { renderJson } from "@/lib/reports/renderers/json";
import { renderCsv } from "@/lib/reports/renderers/csv";
import { renderXlsx } from "@/lib/reports/renderers/xlsx";
import { renderPdf } from "@/lib/reports/renderers/pdf";
import { renderSvg, renderPng } from "@/lib/reports/renderers/svg";
import { requireFeature } from "@/lib/entitlements";

const FORMATS = new Set(["json", "csv", "xlsx", "pdf", "svg", "png"]);

export const GET = safe(async (
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  const gate = await requireFeature(ctx, "reports");
  if (gate) return gate;

  const { key } = await params;
  const definition = REPORTS[key];
  if (!definition) return notFound("report");

  // Some reports belong to a feature of their own. Book value is only
  // meaningful to a customer who has depreciation.
  if (definition.feature) {
    const featureGate = await requireFeature(
      ctx, definition.feature as Parameters<typeof requireFeature>[1],
    );
    if (featureGate) return featureGate;
  }

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
  // One definition, six renderings. No renderer runs its own query - each takes
  // the ReportResult and formats it, so the CSV and the PDF cannot disagree.
  switch (format) {
    case "csv":  return renderCsv(result);
    case "xlsx": return renderXlsx(result);
    case "pdf":  return renderPdf(result);
    case "svg":  return renderSvg(result);
    case "png":  return renderPng(result);
    default:     return renderJson(result);
  }
});
