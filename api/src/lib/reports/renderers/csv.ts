import type { ReportResult } from "../types";

const escape = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function renderCsv(result: ReportResult): Response {
  const lines = [result.columns.map((c) => escape(c.label)).join(",")];
  for (const row of result.rows) {
    lines.push(result.columns.map((c) => escape(row[c.key])).join(","));
  }
  if (result.totals) {
    lines.push(result.columns.map((c) => escape(result.totals![c.key])).join(","));
  }

  const date = result.generated_at.slice(0, 10);
  return new Response(`${lines.join("\n")}\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${result.key}-${date}.csv"`,
    },
  });
}
