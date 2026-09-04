import { describe, it, expect } from "vitest";
import { buildChartSvg } from "./charts";
import { PALETTE } from "./palette";
import type { ReportResult } from "./types";

const base: Omit<ReportResult, "chart" | "rows"> = {
  key: "assets-by-status", name: "Assets by status", description: "d",
  generated_at: "2026-09-03T00:00:00Z", params: {}, filter_summary: "All assets",
  columns: [
    { key: "status", label: "Status", type: "string" },
    { key: "count", label: "Assets", type: "number" },
  ],
  totals: null,
};

const donut: ReportResult = {
  ...base,
  chart: { type: "donut", categoryKey: "status", valueKeys: ["count"], valueLabel: "Assets" },
  rows: [
    { status: "available", count: 12 },
    { status: "in_use", count: 7 },
    { status: "maintenance", count: 3 },
  ],
};

describe("buildChartSvg", () => {
  it("emits a self-contained svg element with the requested size", () => {
    const svg = buildChartSvg(donut, { width: 600, height: 360 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="600"');
    expect(svg).toContain('height="360"');
    expect(svg).toContain("xmlns=");
  });

  it("draws one arc per row for a donut", () => {
    const svg = buildChartSvg(donut, { width: 600, height: 360 });
    expect(svg.match(/<path class="slice"/g)).toHaveLength(3);
  });

  it("draws one rect per row for a bar chart", () => {
    const svg = buildChartSvg(
      { ...donut, chart: { ...donut.chart, type: "bar" } },
      { width: 600, height: 360 },
    );
    expect(svg.match(/<rect class="bar"/g)).toHaveLength(3);
  });

  it("draws a single path for a line chart", () => {
    const svg = buildChartSvg(
      {
        ...donut,
        chart: { type: "line", categoryKey: "status", valueKeys: ["count"], valueLabel: "n" },
      },
      { width: 600, height: 360 },
    );
    expect(svg.match(/<path class="line"/g)).toHaveLength(1);
  });

  it("uses the shared palette so a PDF matches the screen", () => {
    const svg = buildChartSvg(donut, { width: 600, height: 360 });
    expect(svg).toContain(PALETTE[0]);
    expect(svg).toContain(PALETTE[1]);
  });

  it("escapes a category label containing markup", () => {
    const svg = buildChartSvg(
      { ...donut, rows: [{ status: "<script>x</script>", count: 1 }] },
      { width: 600, height: 360 },
    );
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("returns an empty-state svg rather than throwing on no rows", () => {
    const svg = buildChartSvg({ ...donut, rows: [] }, { width: 600, height: 360 });
    expect(svg).toContain("No data");
  });

  it("returns an empty string when the report declares no chart", () => {
    const svg = buildChartSvg(
      { ...donut, chart: { ...donut.chart, type: "none" } },
      { width: 600, height: 360 },
    );
    expect(svg).toBe("");
  });
});
