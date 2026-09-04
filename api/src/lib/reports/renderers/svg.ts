import { Resvg } from "@resvg/resvg-js";
import { buildChartSvg } from "../charts";
import type { ReportResult } from "../types";

const SIZE = { width: 900, height: 420 };

export function renderSvg(result: ReportResult): Response {
  const svg = buildChartSvg(result, SIZE) ||
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE.width}" ` +
    `height="${SIZE.height}"><text x="20" y="30" font-size="14">` +
    `This report has no chart.</text></svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "private, max-age=60",
    },
  });
}

export async function renderPng(result: ReportResult): Promise<Response> {
  const svg = buildChartSvg(result, SIZE);
  const resvg = new Resvg(svg || `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `width="${SIZE.width}" height="${SIZE.height}"/>`, {
    background: "#ffffff",
    fitTo: { mode: "width", value: SIZE.width * 2 }, // 2x for retina and print
  });
  const png = resvg.render().asPng();

  const date = result.generated_at.slice(0, 10);
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "content-disposition": `inline; filename="${result.key}-${date}.png"`,
    },
  });
}
