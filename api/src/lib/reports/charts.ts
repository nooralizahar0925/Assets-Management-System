import { scaleLinear, scaleBand, scalePoint } from "d3-scale";
import { arc as d3Arc, pie as d3Pie, line as d3Line } from "d3-shape";
import { max as d3Max } from "d3-array";
import { colorFor, INK, MUTED, GRID } from "./palette";
import type { ReportResult, ReportRow } from "./types";

export interface ChartSize {
  width: number;
  height: number;
}

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]!);

const num = (row: ReportRow, key: string) => Number(row[key] ?? 0);

const svgWrap = (size: ChartSize, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" ` +
  `height="${size.height}" viewBox="0 0 ${size.width} ${size.height}" ` +
  `font-family="system-ui,-apple-system,'Segoe UI',sans-serif">` +
  `<rect width="${size.width}" height="${size.height}" fill="#ffffff"/>${body}</svg>`;

const emptyState = (size: ChartSize) =>
  svgWrap(size,
    `<text x="${size.width / 2}" y="${size.height / 2}" text-anchor="middle" ` +
    `fill="${MUTED}" font-size="14">No data for this report</text>`);

/**
 * d3-scale and d3-shape compute geometry only - no DOM, no canvas - so the same
 * function serves a standalone SVG, an embedded PDF vector and a rasterised PNG
 * without a headless browser anywhere in the image.
 */
export function buildChartSvg(result: ReportResult, size: ChartSize): string {
  const { chart, rows } = result;
  if (chart.type === "none") return "";
  if (rows.length === 0) return emptyState(size);

  switch (chart.type) {
    case "donut":  return donutChart(result, size);
    case "bar":    return barChart(result, size, "horizontal");
    case "column": return barChart(result, size, "vertical");
    case "line":   return lineChart(result, size);
  }
}

function donutChart(result: ReportResult, size: ChartSize): string {
  const { chart, rows } = result;
  const valueKey = chart.valueKeys[0];
  const radius = Math.min(size.width * 0.5, size.height) / 2 - 20;
  const cx = size.height / 2 + 10;
  const cy = size.height / 2;

  const slices = d3Pie<ReportRow>().sort(null).value((row) => num(row, valueKey))(rows);
  const arcPath = d3Arc<(typeof slices)[number]>()
    .innerRadius(radius * 0.58)
    .outerRadius(radius);

  const paths = slices.map((slice, i) =>
    `<path class="slice" d="${arcPath(slice)}" ` +
    `fill="${colorFor(String(rows[i][chart.categoryKey]), i)}" ` +
    `stroke="#ffffff" stroke-width="2"/>`,
  ).join("");

  const total = rows.reduce((sum, row) => sum + num(row, valueKey), 0);
  const centre =
    `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="24" ` +
    `font-weight="600" fill="${INK}">${total.toLocaleString()}</text>` +
    `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="12" ` +
    `fill="${MUTED}">${esc(chart.valueLabel)}</text>`;

  const legendX = size.height + 30;
  const legend = rows.map((row, i) => {
    const y = 30 + i * 22;
    return (
      `<rect x="${legendX}" y="${y - 9}" width="11" height="11" rx="2" ` +
      `fill="${colorFor(String(row[chart.categoryKey]), i)}"/>` +
      `<text x="${legendX + 18}" y="${y}" font-size="12" fill="${INK}">` +
      `${esc(row[chart.categoryKey])}</text>` +
      `<text x="${size.width - 14}" y="${y}" font-size="12" text-anchor="end" ` +
      `fill="${MUTED}">${num(row, valueKey).toLocaleString()}</text>`
    );
  }).join("");

  return svgWrap(size,
    `<g transform="translate(${cx},${cy})">${paths}</g>${centre}${legend}`);
}

function barChart(
  result: ReportResult,
  size: ChartSize,
  orientation: "horizontal" | "vertical",
): string {
  const { chart, rows } = result;
  const valueKey = chart.valueKeys[0];
  const maxValue = d3Max(rows, (row) => num(row, valueKey)) ?? 1;
  const horizontal = orientation === "horizontal";

  const margin = horizontal
    ? { top: 16, right: 56, bottom: 24, left: 140 }
    : { top: 16, right: 16, bottom: 56, left: 64 };
  const innerW = size.width - margin.left - margin.right;
  const innerH = size.height - margin.top - margin.bottom;

  const band = scaleBand<string>()
    .domain(rows.map((row) => String(row[chart.categoryKey])))
    .range([0, horizontal ? innerH : innerW])
    .padding(0.28);
  const value = scaleLinear()
    .domain([0, maxValue])
    .nice()
    .range([0, horizontal ? innerW : innerH]);

  const bars = rows.map((row, i) => {
    const label = String(row[chart.categoryKey]);
    const v = num(row, valueKey);
    const fill = colorFor(label, i);
    const pos = band(label) ?? 0;

    if (horizontal) {
      const w = value(v);
      return (
        `<rect class="bar" x="0" y="${pos}" width="${w}" height="${band.bandwidth()}" ` +
        `rx="3" fill="${fill}"/>` +
        `<text x="-10" y="${pos + band.bandwidth() / 2 + 4}" text-anchor="end" ` +
        `font-size="12" fill="${INK}">${esc(label)}</text>` +
        `<text x="${w + 8}" y="${pos + band.bandwidth() / 2 + 4}" font-size="12" ` +
        `fill="${MUTED}">${v.toLocaleString()}</text>`
      );
    }
    const h = value(v);
    return (
      `<rect class="bar" x="${pos}" y="${innerH - h}" width="${band.bandwidth()}" ` +
      `height="${h}" rx="3" fill="${fill}"/>` +
      `<text x="${pos + band.bandwidth() / 2}" y="${innerH + 18}" ` +
      `text-anchor="middle" font-size="11" fill="${INK}">${esc(label)}</text>` +
      `<text x="${pos + band.bandwidth() / 2}" y="${innerH - h - 6}" ` +
      `text-anchor="middle" font-size="11" fill="${MUTED}">${v.toLocaleString()}</text>`
    );
  }).join("");

  const axis =
    `<line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="${GRID}"/>`;

  return svgWrap(size,
    `<g transform="translate(${margin.left},${margin.top})">${axis}${bars}</g>`);
}

function lineChart(result: ReportResult, size: ChartSize): string {
  const { chart, rows } = result;
  const valueKey = chart.valueKeys[0];
  const margin = { top: 16, right: 20, bottom: 44, left: 56 };
  const innerW = size.width - margin.left - margin.right;
  const innerH = size.height - margin.top - margin.bottom;

  const x = scalePoint<string>()
    .domain(rows.map((row) => String(row[chart.categoryKey])))
    .range([0, innerW]);
  const y = scaleLinear()
    .domain([0, d3Max(rows, (row) => num(row, valueKey)) ?? 1])
    .nice()
    .range([innerH, 0]);

  const path = d3Line<ReportRow>()
    .x((row) => x(String(row[chart.categoryKey])) ?? 0)
    .y((row) => y(num(row, valueKey)))(rows);

  const gridlines = y.ticks(4).map((tick) =>
    `<line x1="0" y1="${y(tick)}" x2="${innerW}" y2="${y(tick)}" stroke="${GRID}"/>` +
    `<text x="-10" y="${y(tick) + 4}" text-anchor="end" font-size="11" ` +
    `fill="${MUTED}">${tick.toLocaleString()}</text>`,
  ).join("");

  const dots = rows.map((row) =>
    `<circle cx="${x(String(row[chart.categoryKey])) ?? 0}" ` +
    `cy="${y(num(row, valueKey))}" r="3" fill="${colorFor("", 0)}"/>`,
  ).join("");

  // Thin the axis labels so a 90-day series stays readable.
  const step = Math.max(1, Math.ceil(rows.length / 8));
  const labels = rows.map((row, i) =>
    i % step === 0
      ? `<text x="${x(String(row[chart.categoryKey])) ?? 0}" y="${innerH + 20}" ` +
        `text-anchor="middle" font-size="10" fill="${MUTED}">` +
        `${esc(row[chart.categoryKey])}</text>`
      : "",
  ).join("");

  return svgWrap(size,
    `<g transform="translate(${margin.left},${margin.top})">${gridlines}` +
    `<path class="line" d="${path}" fill="none" stroke="${colorFor("", 0)}" ` +
    `stroke-width="2" stroke-linejoin="round"/>${dots}${labels}</g>`);
}
