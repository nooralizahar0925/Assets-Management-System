import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset } from "./assets";
import { buildLabelSheet, LABEL_TEMPLATES, lookupByTag } from "./labels";

let orgId: string;
let ctx: Ctx;
let ids: string[];
let tag: string;

beforeAll(async () => {
  orgId = await createOrg("Label Org");
  const printer = await createUserWithRole(orgId, "Manager", { name: "Printer" });
  ctx = {
    orgId,
    actor: {
      type: "user", id: printer.id, label: "Printer", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
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
