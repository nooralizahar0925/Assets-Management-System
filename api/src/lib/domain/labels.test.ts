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
