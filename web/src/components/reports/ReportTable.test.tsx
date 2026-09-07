import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportTable from "./ReportTable";
import type { ReportResult } from "../../api/types";

const result: ReportResult = {
  key: "assets-by-category", name: "Assets by category", description: "d",
  generated_at: "2026-09-03T10:00:00Z", filter_summary: "All assets",
  columns: [
    { key: "category", label: "Category", type: "string" },
    { key: "count", label: "Assets", type: "number" },
    { key: "value", label: "Value", type: "money" },
    { key: "share", label: "Share", type: "percent" },
    { key: "as_of", label: "As of", type: "date" },
  ],
  chart: { type: "bar", categoryKey: "category", valueKeys: ["count"], valueLabel: "Assets" },
  rows: [
    { category: "IT", count: 42, value: "520000000", share: 79.2, as_of: "2026-09-01" },
    { category: "Plant", count: 11, value: null, share: 20.8, as_of: null },
  ],
  totals: { category: "Total", count: 53, value: "520000000", share: 100, as_of: null },
};

describe("ReportTable", () => {
  it("renders a header per column", () => {
    render(<ReportTable result={result} />);
    for (const column of result.columns) {
      expect(screen.getByText(column.label)).toBeInTheDocument();
    }
  });

  it("renders a row per data row", () => {
    render(<ReportTable result={result} />);
    expect(screen.getByText("IT")).toBeInTheDocument();
    expect(screen.getByText("Plant")).toBeInTheDocument();
  });

  it("formats a money column", () => {
    render(<ReportTable result={result} />);
    expect(screen.getAllByText(/520[.,]000[.,]000/).length).toBeGreaterThan(0);
  });

  it("formats a percent column", () => {
    render(<ReportTable result={result} />);
    expect(screen.getByText("79.2%")).toBeInTheDocument();
  });

  it("formats a date column readably", () => {
    // en-GB abbreviates September as "Sept", not "Sep". Both are accepted so
    // the test asserts a readable date rather than one ICU version's spelling.
    render(<ReportTable result={result} />);
    expect(screen.getByText(/1 Sept? 2026/)).toBeInTheDocument();
  });

  it("shows a dash for an empty cell", () => {
    render(<ReportTable result={result} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the totals row when the report has one", () => {
    render(<ReportTable result={result} />);
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("says so plainly when a report returns no rows", () => {
    render(<ReportTable result={{ ...result, rows: [], totals: null }} />);
    expect(screen.getByText(/No rows/i)).toBeInTheDocument();
  });
});
