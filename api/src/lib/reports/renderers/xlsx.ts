import ExcelJS from "exceljs";
import type { ReportColumn, ReportResult } from "../types";

const NUMBER_FORMATS: Record<ReportColumn["type"], string | undefined> = {
  string: undefined,
  number: "#,##0",
  date: "dd mmm yyyy",
  money: "#,##0.00",
  percent: "0.0%",
};

/**
 * Writes a real typed cell rather than text, so the recipient can sort, sum and
 * pivot. A spreadsheet full of numbers stored as strings is a spreadsheet
 * nobody can use.
 */
function cellValue(column: ReportColumn, raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (column.type) {
    case "number":
    case "money":
      return Number(raw);
    case "percent":
      // Excel's percent format multiplies by 100 on display.
      return Number(raw) / 100;
    case "date": {
      const date = new Date(String(raw));
      return Number.isNaN(date.getTime()) ? String(raw) : date;
    }
    default:
      return String(raw);
  }
}

export async function renderXlsx(result: ReportResult): Promise<Response> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Asset Management System";
  workbook.created = new Date(result.generated_at);

  // Summary first: whoever opens the file sees what it is, and which filters
  // produced it, before the raw grid.
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 24 }, { width: 60 }];
  const meta: [string, string][] = [
    ["Report", result.name],
    ["Description", result.description],
    ["Filters", result.filter_summary],
    ["Generated", new Date(result.generated_at).toUTCString()],
    ["Rows", String(result.rows.length)],
  ];
  for (const [label, value] of meta) {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  if (result.totals) {
    summary.addRow([]);
    summary.addRow(["Totals", ""]).getCell(1).font = { bold: true };
    for (const column of result.columns) {
      const value = result.totals[column.key];
      if (value !== undefined && value !== null) {
        summary.addRow([column.label, String(value)]);
      }
    }
  }

  const data = workbook.addWorksheet("Data");
  data.columns = result.columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.max(12, Math.min(40, column.label.length + 6)),
    style: { numFmt: NUMBER_FORMATS[column.type] },
  }));

  const header = data.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B82F6" } };
  header.alignment = { vertical: "middle" };
  header.height = 20;

  for (const row of result.rows) {
    data.addRow(Object.fromEntries(
      result.columns.map((column) => [column.key, cellValue(column, row[column.key])]),
    ));
  }

  if (result.totals) {
    const totals = data.addRow(Object.fromEntries(
      result.columns.map((column) => [
        column.key, cellValue(column, result.totals![column.key]),
      ]),
    ));
    totals.font = { bold: true };
    totals.border = { top: { style: "thin" } };
  }

  // Frozen header and auto-filter, so a long report is navigable on open.
  data.views = [{ state: "frozen", ySplit: 1 }];
  data.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: result.columns.length },
  };

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const date = result.generated_at.slice(0, 10);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${result.key}-${date}.xlsx"`,
    },
  });
}
