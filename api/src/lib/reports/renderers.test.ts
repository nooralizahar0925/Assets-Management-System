import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { renderXlsx } from "./renderers/xlsx";
import { renderPdf } from "./renderers/pdf";
import { renderSvg, renderPng } from "./renderers/svg";
import type { ReportResult } from "./types";

const result: ReportResult = {
  key: "assets-by-category", name: "Assets by category",
  description: "The register split by category.",
  generated_at: "2026-09-03T10:00:00Z", params: { days: 90 },
  filter_summary: "Next 90 days",
  columns: [
    { key: "category", label: "Category", type: "string" },
    { key: "count", label: "Assets", type: "number" },
    { key: "value", label: "Value", type: "money" },
  ],
  chart: { type: "bar", categoryKey: "category", valueKeys: ["count"], valueLabel: "Assets" },
  rows: [
    { category: "IT", count: 42, value: "520000000" },
    { category: "Plant", count: 11, value: "980000000" },
  ],
  totals: { category: "Total", count: 53, value: "1500000000" },
};

describe("renderXlsx", () => {
  it("returns a spreadsheet content type and filename", async () => {
    const res = await renderXlsx(result);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("assets-by-category");
  });

  it("writes a Summary sheet and a Data sheet", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await renderXlsx(result)).arrayBuffer());
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["Summary", "Data"]);
  });

  it("puts the column labels in the header row", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await renderXlsx(result)).arrayBuffer());
    const header = workbook.getWorksheet("Data")!.getRow(1);
    expect([header.getCell(1).value, header.getCell(2).value, header.getCell(3).value])
      .toEqual(["Category", "Assets", "Value"]);
  });

  it("writes numbers as numbers, not text", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await renderXlsx(result)).arrayBuffer());
    expect(workbook.getWorksheet("Data")!.getRow(2).getCell(2).value).toBe(42);
  });

  it("freezes the header row and enables the auto-filter", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await renderXlsx(result)).arrayBuffer());
    const sheet = workbook.getWorksheet("Data")!;
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
  });

  it("appends the totals row", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await renderXlsx(result)).arrayBuffer());
    const sheet = workbook.getWorksheet("Data")!;
    expect(sheet.getRow(sheet.rowCount).getCell(1).value).toBe("Total");
  });
});

describe("renderPdf", () => {
  it("returns a real PDF", async () => {
    const res = await renderPdf(result);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("names the file after the report and date", async () => {
    const res = await renderPdf(result);
    expect(res.headers.get("content-disposition"))
      .toContain("assets-by-category-2026-09-03.pdf");
  });

  it("renders a report with no rows without throwing", async () => {
    const res = await renderPdf({ ...result, rows: [], totals: null });
    expect(res.status).toBe(200);
  });
});

describe("renderSvg and renderPng", () => {
  it("serves the chart as svg", () => {
    const res = renderSvg(result);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("rasterises the chart to a png", async () => {
    const res = await renderPng(result);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  });
});
