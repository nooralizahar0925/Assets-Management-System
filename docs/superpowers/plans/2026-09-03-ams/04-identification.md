# Phase 4 — Identification

> Part of the [Assets Management System plan](./00-overview.md). Read `00-overview.md` first — its Global Constraints apply to every task here.

**Tasks 19–20.** QR and Code 128 generation, tag lookup, and print-ready label sheets.

**Spec section:** §7.

The `asset_tag` is the payload for both symbologies, so one printed label works with a
phone camera and with a warehouse scanner. QR encodes a deep link (anyone scanning with
a plain camera lands on the asset page); Code 128 encodes the bare tag (a HID scanner
types it into the focused field exactly as a human would).

---

### Task 19: QR and Code 128 label generation

**Files:**
- Create: `api/src/lib/domain/labels.ts`
- Create: `api/src/app/api/v1/assets/[id]/label.png/route.ts`, `api/src/app/api/v1/assets/[id]/label.svg/route.ts`
- Test: `api/src/lib/domain/labels.test.ts`

**Interfaces:**
- Consumes: `getAsset` (Task 6).
- Produces:
  - `type Symbology = "qr" | "code128"`
  - `tagUrl(tag: string): string` — `${APP_BASE_URL}/a/${tag}`
  - `renderLabelPng(tag, symbology, scale): Promise<Buffer>`
  - `renderLabelSvg(tag, symbology): Promise<string>`
  - `InvalidTagError`

- [x] **Step 1: Write the failing test**

`api/src/lib/domain/labels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tagUrl, renderLabelPng, renderLabelSvg, InvalidTagError } from "./labels";

describe("tagUrl", () => {
  it("builds a deep link from the app base url", () => {
    process.env.APP_BASE_URL = "https://ams.example.com";
    expect(tagUrl("AMS-000123")).toBe("https://ams.example.com/a/AMS-000123");
  });

  it("url-encodes a tag containing a slash", () => {
    process.env.APP_BASE_URL = "https://ams.example.com";
    expect(tagUrl("SITE/A-1")).toBe("https://ams.example.com/a/SITE%2FA-1");
  });
});

describe("renderLabelPng", () => {
  it("produces a PNG for a QR code", async () => {
    const png = await renderLabelPng("AMS-000123", "qr", 3);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeGreaterThan(200);
  });

  it("produces a PNG for a Code 128 barcode", async () => {
    const png = await renderLabelPng("AMS-000123", "code128", 3);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("scales the image up with the scale argument", async () => {
    const small = await renderLabelPng("AMS-000123", "qr", 2);
    const large = await renderLabelPng("AMS-000123", "qr", 6);
    expect(large.length).toBeGreaterThan(small.length);
  });

  it("encodes the deep link in a QR but the bare tag in a Code 128", async () => {
    // Different payloads must produce different images.
    const qr = await renderLabelPng("AMS-000123", "qr", 3);
    const barcode = await renderLabelPng("AMS-000123", "code128", 3);
    expect(qr.equals(barcode)).toBe(false);
  });

  it("rejects an empty tag", async () => {
    await expect(renderLabelPng("", "qr", 3)).rejects.toBeInstanceOf(InvalidTagError);
  });

  it("rejects a tag Code 128 cannot encode", async () => {
    // Code 128 covers ASCII 0–127; an emoji is outside the character set.
    await expect(renderLabelPng("AMS-🚀", "code128", 3))
      .rejects.toBeInstanceOf(InvalidTagError);
  });

  it("clamps an absurd scale rather than exhausting memory", async () => {
    const png = await renderLabelPng("AMS-000123", "qr", 9999);
    expect(png.length).toBeLessThan(5_000_000);
  });
});

describe("renderLabelSvg", () => {
  it("produces an svg element for print", async () => {
    const svg = await renderLabelSvg("AMS-000123", "qr");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("produces an svg for a Code 128 barcode", async () => {
    const svg = await renderLabelSvg("AMS-000123", "code128");
    expect(svg).toContain("<svg");
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/labels.test.ts`
Expected: FAIL with `Cannot find module './labels'`.

- [x] **Step 3: Add the dependency**

```bash
cd api && npm install bwip-js
```

- [x] **Step 4: Implement the label module**

`api/src/lib/domain/labels.ts`:

```ts
import bwipjs from "bwip-js";

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
```

- [x] **Step 5: Implement the route handlers**

`api/src/app/api/v1/assets/[id]/label.png/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getAsset } from "@/lib/domain/assets";
import { renderLabelPng, parseSymbology, InvalidTagError } from "@/lib/domain/labels";

export const GET = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const asset = await getAsset(ctx, (await params).id);
  if (!asset) return notFound("asset");

  const url = new URL(req.url);
  const symbology = parseSymbology(url.searchParams.get("symbology"));
  const scale = Number(url.searchParams.get("scale") ?? 3);

  try {
    const png = await renderLabelPng(asset.asset_tag, symbology, scale);
    return new Response(new Uint8Array(png), {
      headers: {
        "content-type": "image/png",
        "content-disposition": `inline; filename="${asset.asset_tag}-${symbology}.png"`,
        // Labels change only when the tag does, and the tag is in the URL.
        "cache-control": "private, max-age=86400",
      },
    });
  } catch (err) {
    if (err instanceof InvalidTagError) {
      return problem(422, "validation", "Cannot encode this tag", { detail: err.message });
    }
    throw err;
  }
});
```

`api/src/app/api/v1/assets/[id]/label.svg/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getAsset } from "@/lib/domain/assets";
import { renderLabelSvg, parseSymbology, InvalidTagError } from "@/lib/domain/labels";

export const GET = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const asset = await getAsset(ctx, (await params).id);
  if (!asset) return notFound("asset");

  const symbology = parseSymbology(new URL(req.url).searchParams.get("symbology"));
  try {
    return new Response(await renderLabelSvg(asset.asset_tag, symbology), {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "private, max-age=86400",
      },
    });
  } catch (err) {
    if (err instanceof InvalidTagError) {
      return problem(422, "validation", "Cannot encode this tag", { detail: err.message });
    }
    throw err;
  }
});
```

- [x] **Step 6: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/domain/labels.test.ts`
Expected: PASS, 11 tests.

- [x] **Step 7: Commit**

```bash
git add api/src/lib/domain/labels.ts api/src/app/api/v1/assets api/package.json
git commit -m "feat: qr and code 128 label generation as png and svg"
```

---

### Task 20: Tag lookup and print-ready label sheets

**Files:**
- Modify: `api/src/lib/domain/labels.ts` (append the sheet builder)
- Create: `api/src/app/api/v1/assets/lookup/route.ts`, `api/src/app/api/v1/labels/sheet/route.ts`
- Test: `api/src/lib/domain/labels.sheet.test.ts`

**Interfaces:**
- Consumes: `getAssetByTag` (Task 6), `renderLabelSvg` (Task 19), `withTenant`.
- Produces:
  - `LABEL_TEMPLATES: Record<TemplateKey, LabelTemplate>` where
    `TemplateKey = "avery5160" | "avery5163" | "thermal50x25"` and
    `LabelTemplate = { name, pageWidthMm, pageHeightMm, cols, rows, labelWidthMm, labelHeightMm, marginTopMm, marginLeftMm, gapXMm, gapYMm }`
  - `buildLabelSheet(ctx, { assetIds, symbology, template }): Promise<string>` — self-contained printable HTML
  - `lookupByTag(ctx, tag)` — resolve a scanned tag to an asset

**Design note:** `/assets/lookup` is the endpoint every scanner flow calls — camera
scan, HID scanner, and the `/a/<tag>` deep link all funnel through it. Keeping it a
single, cheap, exact-match endpoint is what makes scanning feel instant.

- [x] **Step 1: Write the failing test**

`api/src/lib/domain/labels.sheet.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createAsset } from "./assets";
import { buildLabelSheet, LABEL_TEMPLATES, lookupByTag } from "./labels";

const orgId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: randomUUID(), label: "Printer", scopes: ["admin"] },
};
let ids: string[];
let tag: string;

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'Lab',$2)", [
    orgId, `label-org-${orgId.slice(0, 8)}`,
  ]);
  const a = await createAsset(ctx, { name: "Label me A" });
  const b = await createAsset(ctx, { name: "Label me B" });
  ids = [a.id, b.id];
  tag = a.asset_tag;
});

describe("LABEL_TEMPLATES", () => {
  it("offers the three sheet formats from the spec", () => {
    expect(Object.keys(LABEL_TEMPLATES).sort())
      .toEqual(["avery5160", "avery5163", "thermal50x25"]);
  });

  it("describes each template in real physical units", () => {
    for (const [key, t] of Object.entries(LABEL_TEMPLATES)) {
      expect(t.labelWidthMm, key).toBeGreaterThan(0);
      expect(t.labelHeightMm, key).toBeGreaterThan(0);
      expect(t.cols * t.rows, key).toBeGreaterThan(0);
    }
  });

  it("fits its labels inside its page", () => {
    for (const [key, t] of Object.entries(LABEL_TEMPLATES)) {
      const usedW = t.marginLeftMm * 2 + t.cols * t.labelWidthMm + (t.cols - 1) * t.gapXMm;
      const usedH = t.marginTopMm * 2 + t.rows * t.labelHeightMm + (t.rows - 1) * t.gapYMm;
      expect(usedW, `${key} width`).toBeLessThanOrEqual(t.pageWidthMm + 0.5);
      expect(usedH, `${key} height`).toBeLessThanOrEqual(t.pageHeightMm + 0.5);
    }
  });
});

describe("buildLabelSheet", () => {
  it("returns a standalone printable document", async () => {
    const html = await buildLabelSheet(ctx, {
      assetIds: ids, symbology: "qr", template: "avery5160",
    });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("@page");
    expect(html).toContain("</html>");
  });

  it("renders one label per asset", async () => {
    const html = await buildLabelSheet(ctx, {
      assetIds: ids, symbology: "qr", template: "avery5160",
    });
    expect(html.match(/class="label"/g)).toHaveLength(2);
  });

  it("prints the tag and the name on each label", async () => {
    const html = await buildLabelSheet(ctx, {
      assetIds: ids, symbology: "qr", template: "avery5160",
    });
    expect(html).toContain(tag);
    expect(html).toContain("Label me A");
  });

  it("embeds the symbol inline so the sheet prints offline", async () => {
    const html = await buildLabelSheet(ctx, {
      assetIds: ids, symbology: "code128", template: "thermal50x25",
    });
    expect(html).toContain("<svg");
    expect(html).not.toContain("<img src=\"http");
  });

  it("sets the page size from the chosen template", async () => {
    const thermal = await buildLabelSheet(ctx, {
      assetIds: ids, symbology: "qr", template: "thermal50x25",
    });
    expect(thermal).toContain("50mm 25mm");
  });

  it("escapes an asset name containing markup", async () => {
    const nasty = await createAsset(ctx, { name: '<script>alert(1)</script>' });
    const html = await buildLabelSheet(ctx, {
      assetIds: [nasty.id], symbology: "qr", template: "avery5160",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("ignores an id that is not in this organisation", async () => {
    const html = await buildLabelSheet(ctx, {
      assetIds: [...ids, randomUUID()], symbology: "qr", template: "avery5160",
    });
    expect(html.match(/class="label"/g)).toHaveLength(2);
  });

  it("rejects a request for more than 500 labels", async () => {
    await expect(buildLabelSheet(ctx, {
      assetIds: Array.from({ length: 501 }, () => randomUUID()),
      symbology: "qr", template: "avery5160",
    })).rejects.toThrow(/500/);
  });
});

describe("lookupByTag", () => {
  it("resolves a scanned tag to its asset", async () => {
    const asset = await lookupByTag(ctx, tag);
    expect(asset!.name).toBe("Label me A");
  });

  it("is case-insensitive, because scanners and people are not consistent", async () => {
    const asset = await lookupByTag(ctx, tag.toLowerCase());
    expect(asset!.name).toBe("Label me A");
  });

  it("trims surrounding whitespace a scanner may append", async () => {
    const asset = await lookupByTag(ctx, `  ${tag}\r\n`);
    expect(asset!.name).toBe("Label me A");
  });

  it("accepts a full deep link as well as a bare tag", async () => {
    process.env.APP_BASE_URL = "https://ams.example.com";
    const asset = await lookupByTag(ctx, `https://ams.example.com/a/${tag}`);
    expect(asset!.name).toBe("Label me A");
  });

  it("returns null for an unknown tag", async () => {
    await expect(lookupByTag(ctx, "NOPE-1")).resolves.toBeNull();
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/labels.sheet.test.ts`
Expected: FAIL — `buildLabelSheet is not a function`.

- [x] **Step 3: Append the sheet builder and lookup to the label module**

Append to `api/src/lib/domain/labels.ts`:

```ts
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import type { Asset } from "./assets";
import { SELECT_ASSET } from "./assets";

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
```

- [x] **Step 4: Implement the route handlers**

`api/src/app/api/v1/assets/lookup/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { lookupByTag } from "@/lib/domain/labels";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const tag = new URL(req.url).searchParams.get("tag");
  if (!tag) {
    return problem(422, "validation", "Validation failed", {
      detail: "Provide the scanned value as ?tag=",
    });
  }

  const asset = await lookupByTag(ctx, tag);
  return asset ? Response.json(asset) : notFound("asset");
});
```

> **Route ordering note:** in the App Router, the static segment
> `app/api/v1/assets/lookup/route.ts` takes precedence over the dynamic
> `app/api/v1/assets/[id]/route.ts`, so `/assets/lookup` never resolves as an asset id.
> No extra configuration is needed, but do not rename `lookup` to something a tag could
> collide with.

`api/src/app/api/v1/labels/sheet/route.ts`:

```ts
import { z } from "zod";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { buildLabelSheet, LABEL_TEMPLATES } from "@/lib/domain/labels";

const Body = z.object({
  asset_ids: z.array(z.string().uuid()).min(1).max(500),
  symbology: z.enum(["qr", "code128"]).default("qr"),
  template: z.enum(
    Object.keys(LABEL_TEMPLATES) as [string, ...string[]],
  ).default("avery5160"),
});

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({
    data: Object.entries(LABEL_TEMPLATES).map(([key, t]) => ({
      key, name: t.name, per_sheet: t.cols * t.rows,
      label_mm: [t.labelWidthMm, t.labelHeightMm],
    })),
  });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    const html = await buildLabelSheet(ctx, {
      assetIds: parsed.data.asset_ids,
      symbology: parsed.data.symbology,
      template: parsed.data.template as keyof typeof LABEL_TEMPLATES,
    });
    return new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return problem(422, "validation", "Cannot build the label sheet", {
      detail: (err as Error).message,
    });
  }
});
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/domain/labels.sheet.test.ts`
Expected: PASS, 16 tests.

- [x] **Step 6: Run the whole API suite**

Run: `cd api && npm test`
Expected: PASS — every suite from Tasks 1–20 green.

- [x] **Step 7: Commit**

```bash
git add api/src/lib/domain/labels.ts api/src/app/api/v1/assets/lookup api/src/app/api/v1/labels
git commit -m "feat: tag lookup and print-ready label sheets for avery and thermal stock"
```

---

**Phase 4 complete.** The API is now feature-complete: every capability the dashboard
needs exists behind `/api/v1`. Continue to [Phase 5 — Frontend](./05-frontend.md), which
builds the TailAdmin dashboard against it.
