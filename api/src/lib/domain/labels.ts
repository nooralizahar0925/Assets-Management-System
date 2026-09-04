// The Node entry point explicitly: bwip-js 4 uses conditional exports, and the
// bare specifier resolves to the browser build under bundler resolution - which
// has no toBuffer, so it would fail at runtime rather than at the type check.
import bwipjs from "bwip-js/node";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import type { Asset } from "./assets";
import { SELECT_ASSET } from "./assets";


export type Symbology = "qr" | "code128";

export class InvalidTagError extends Error {
  readonly status = 422;
}

const MAX_SCALE = 10;

/**
 * The QR payload. A deep link means anyone scanning with a plain phone camera
 * lands on the asset page — no app to install, no scanner mode to find.
 */
export function tagUrl(tag: string): string {
  const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return `${base}/a/${encodeURIComponent(tag)}`;
}

function payloadFor(tag: string, symbology: Symbology): string {
  if (!tag.trim()) throw new InvalidTagError("An asset tag is required.");
  if (symbology === "code128") {
    // Code 128 covers ASCII 0–127 only. Fail loudly rather than print a label
    // that no scanner in the warehouse can read.
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7F]/.test(tag)) {
      throw new InvalidTagError(
        `"${tag}" contains characters Code 128 cannot encode. ` +
        "Use ASCII only for asset tags, or print a QR label instead.",
      );
    }
    return tag;
  }
  return tagUrl(tag);
}

export async function renderLabelPng(
  tag: string,
  symbology: Symbology,
  scale = 3,
): Promise<Buffer> {
  const text = payloadFor(tag, symbology);
  const safeScale = Math.max(1, Math.min(Math.trunc(scale) || 3, MAX_SCALE));

  return bwipjs.toBuffer({
    bcid: symbology === "qr" ? "qrcode" : "code128",
    text,
    scale: safeScale,
    // The human-readable tag is printed beneath a barcode; a QR carries a URL,
    // so the tag is printed by the label template instead.
    includetext: symbology === "code128",
    textxalign: "center",
    ...(symbology === "code128" ? { height: 12 } : {}),
    ...(symbology === "qr" ? { eclevel: "M" } : {}),
    paddingwidth: 2,
    paddingheight: 2,
    backgroundcolor: "FFFFFF",
  });
}

export async function renderLabelSvg(
  tag: string,
  symbology: Symbology,
): Promise<string> {
  const text = payloadFor(tag, symbology);
  return bwipjs.toSVG({
    bcid: symbology === "qr" ? "qrcode" : "code128",
    text,
    includetext: symbology === "code128",
    textxalign: "center",
    ...(symbology === "code128" ? { height: 12 } : {}),
    ...(symbology === "qr" ? { eclevel: "M" } : {}),
    paddingwidth: 2,
    paddingheight: 2,
  });
}

export const parseSymbology = (raw: string | null): Symbology =>
  raw === "code128" ? "code128" : "qr";


export interface LabelTemplate {
  name: string;
  pageWidthMm: number;
  pageHeightMm: number;
  cols: number;
  rows: number;
  labelWidthMm: number;
  labelHeightMm: number;
  marginTopMm: number;
  marginLeftMm: number;
  gapXMm: number;
  gapYMm: number;
}

export type TemplateKey = "avery5160" | "avery5163" | "thermal50x25";

/** Physical dimensions, so a printed sheet lines up with real label stock. */
export const LABEL_TEMPLATES: Record<TemplateKey, LabelTemplate> = {
  avery5160: {
    name: "Avery 5160 — 30 per sheet (66.7 × 25.4 mm)",
    pageWidthMm: 215.9, pageHeightMm: 279.4,
    cols: 3, rows: 10,
    labelWidthMm: 66.7, labelHeightMm: 25.4,
    marginTopMm: 12.7, marginLeftMm: 4.8,
    gapXMm: 2.6, gapYMm: 0,
  },
  avery5163: {
    name: "Avery 5163 — 10 per sheet (101.6 × 50.8 mm)",
    pageWidthMm: 215.9, pageHeightMm: 279.4,
    cols: 2, rows: 5,
    labelWidthMm: 101.6, labelHeightMm: 50.8,
    marginTopMm: 12.7, marginLeftMm: 4.8,
    gapXMm: 3.2, gapYMm: 0,
  },
  thermal50x25: {
    name: "Thermal 50 × 25 mm — one per page (Zebra/Brother)",
    pageWidthMm: 50, pageHeightMm: 25,
    cols: 1, rows: 1,
    labelWidthMm: 46, labelHeightMm: 21,
    marginTopMm: 2, marginLeftMm: 2,
    gapXMm: 0, gapYMm: 0,
  },
};

const MAX_LABELS = 500;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]!);

const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export interface SheetInput {
  assetIds: string[];
  symbology: Symbology;
  template: TemplateKey;
}

/**
 * A self-contained printable HTML document — symbols inlined as SVG so the sheet
 * prints correctly with no network access, and `@page` sized in millimetres so it
 * lands on real label stock rather than "whatever the browser thought".
 */
export async function buildLabelSheet(ctx: Ctx, input: SheetInput): Promise<string> {
  if (input.assetIds.length > MAX_LABELS) {
    throw new Error(`A label sheet is limited to ${MAX_LABELS} labels per request.`);
  }
  const template = LABEL_TEMPLATES[input.template] ?? LABEL_TEMPLATES.avery5160;

  const assets = await withTenant(ctx.orgId, async (c) =>
    (await c.query<Asset>(
      `${SELECT_ASSET} WHERE a.id = ANY($1::uuid[]) AND a.deleted_at IS NULL
        ORDER BY a.asset_tag`,
      [input.assetIds],
    )).rows,
  );

  const org = await withTenant(ctx.orgId, async (c) =>
    (await c.query<{ name: string }>("SELECT name FROM organizations LIMIT 1")).rows[0],
  );

  const labels = await Promise.all(assets.map(async (asset) => {
    let symbol = "";
    try {
      symbol = await renderLabelSvg(asset.asset_tag, input.symbology);
    } catch {
      // A tag Code 128 cannot encode should not sink the whole sheet.
      symbol = `<span class="unencodable">Cannot encode</span>`;
    }
    return `
      <div class="label">
        <div class="symbol">${symbol}</div>
        <div class="meta">
          <div class="tag">${escapeHtml(asset.asset_tag)}</div>
          <div class="name">${escapeHtml(truncate(asset.name, 34))}</div>
          <div class="org">${escapeHtml(truncate(org?.name ?? "", 26))}</div>
        </div>
      </div>`;
  }));

  const isQr = input.symbology === "qr";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Labels — ${escapeHtml(template.name)}</title>
<style>
  @page {
    size: ${template.pageWidthMm}mm ${template.pageHeightMm}mm;
    margin: ${template.marginTopMm}mm ${template.marginLeftMm}mm;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #000;
    background: #fff;
  }
  .sheet {
    display: grid;
    grid-template-columns: repeat(${template.cols}, ${template.labelWidthMm}mm);
    column-gap: ${template.gapXMm}mm;
    row-gap: ${template.gapYMm}mm;
  }
  .label {
    width: ${template.labelWidthMm}mm;
    height: ${template.labelHeightMm}mm;
    display: flex;
    align-items: center;
    gap: 2mm;
    padding: 1.5mm;
    overflow: hidden;
    page-break-inside: avoid;
    break-inside: avoid;
  }
  .symbol {
    flex: 0 0 auto;
    height: 100%;
    display: flex;
    align-items: center;
  }
  .symbol svg {
    height: ${isQr ? "100%" : "80%"};
    width: ${isQr ? "auto" : "100%"};
    max-width: ${isQr ? `${template.labelHeightMm - 3}mm` : "none"};
  }
  .meta { flex: 1 1 auto; min-width: 0; line-height: 1.25; }
  .tag { font-size: 8pt; font-weight: 700; letter-spacing: 0.02em; }
  .name { font-size: 7pt; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .org { font-size: 5.5pt; color: #555; margin-top: 0.5mm; }
  .unencodable { font-size: 6pt; color: #b91c1c; }
  ${input.template === "thermal50x25"
    ? ".label { page-break-after: always; break-after: page; }"
    : ""}
  @media screen {
    body { background: #f3f4f6; padding: 16px; }
    .sheet { background: #fff; padding: ${template.marginTopMm}mm ${template.marginLeftMm}mm;
             box-shadow: 0 1px 4px rgba(0,0,0,.15); width: ${template.pageWidthMm}mm;
             margin: 0 auto; }
    .label { outline: 0.2mm dashed #d1d5db; }
    .toolbar { max-width: ${template.pageWidthMm}mm; margin: 0 auto 12px; font-size: 13px; }
    button { font: inherit; padding: 6px 14px; border-radius: 6px;
             border: 1px solid #3b82f6; background: #3b82f6; color: #fff; cursor: pointer; }
  }
  @media print { .toolbar { display: none; } .label { outline: none; } }
</style>
</head>
<body>
<div class="toolbar">
  <button onclick="window.print()">Print ${assets.length} label${assets.length === 1 ? "" : "s"}</button>
  <span style="margin-left:8px;color:#6b7280">${escapeHtml(template.name)}</span>
</div>
<div class="sheet">${labels.join("")}</div>
</body>
</html>`;
}

/**
 * Resolves whatever a scanner produced into an asset. Accepts a bare tag, a tag with
 * trailing whitespace or a carriage return (HID scanners append one), any case, and a
 * full deep link from a phone camera.
 */
export async function lookupByTag(ctx: Ctx, raw: string): Promise<Asset | null> {
  let tag = raw.trim();

  const match = tag.match(/\/a\/([^/?#]+)$/);
  if (match) tag = decodeURIComponent(match[1]);
  if (!tag) return null;

  return withTenant(ctx.orgId, async (c) =>
    (await c.query<Asset>(
      `${SELECT_ASSET} WHERE lower(a.asset_tag) = lower($1) AND a.deleted_at IS NULL`,
      [tag],
    )).rows[0] ?? null,
  );
}
