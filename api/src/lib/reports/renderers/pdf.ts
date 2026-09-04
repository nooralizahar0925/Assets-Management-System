// pdfmake 0.3 replaced the 0.2 `new PdfPrinter(fonts).createPdfKitDocument()`
// API that the plan was written against. The package root is now a configured
// singleton: fonts are registered once with addFonts, and createPdf returns a
// promise of a document exposing getBuffer.
import pdfmakeModule from "pdfmake";
import type { TDocumentDefinitions, TableCell } from "pdfmake/interfaces";
import { buildChartSvg } from "../charts";
import { INK, MUTED } from "../palette";
import type { ReportColumn, ReportResult } from "../types";

interface PdfMake {
  addFonts(fonts: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(callback: (url: string) => boolean): void;
  setLocalAccessPolicy(callback: (path: string) => boolean): void;
  createPdf(definition: TDocumentDefinitions): Promise<{ getBuffer(): Promise<Buffer> }>;
}

const pdfmake = pdfmakeModule as unknown as PdfMake;

// The standard 14 PDF fonts need no font files in the image.
pdfmake.addFonts({
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
});

/**
 * The standard 14 fonts every PDF reader ships. pdfmake resolves these through
 * its local-access policy even though no file is read, so they are allowlisted
 * by name.
 */
const STANDARD_FONTS = new Set([
  "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
  "Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
  "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
  "Symbol", "ZapfDingbats",
]);

// A report is built from our own rows and never legitimately references a
// remote resource or a file on disk. Denying both closes the door on a document
// definition that could otherwise be steered into reading the filesystem or
// making an outbound request - and silences pdfmake's warning about having no
// policy at all.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((path) => STANDARD_FONTS.has(path));

function format(column: ReportColumn, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "-";
  switch (column.type) {
    case "money":
      return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 })
        .format(Number(raw));
    case "number":
      return Number(raw).toLocaleString("en-GB");
    case "percent":
      return `${Number(raw).toFixed(1)}%`;
    case "date": {
      const date = new Date(String(raw));
      return Number.isNaN(date.getTime())
        ? String(raw)
        : date.toLocaleDateString("en-GB", {
            day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
          });
    }
    default:
      return String(raw);
  }
}

export async function renderPdf(result: ReportResult): Promise<Response> {
  const numericTypes = new Set(["number", "money", "percent"]);
  const body: TableCell[][] = [
    result.columns.map((column) => ({
      text: column.label, bold: true, color: "#ffffff",
      fillColor: "#3b82f6", margin: [0, 4, 0, 4],
      alignment: numericTypes.has(column.type) ? "right" : "left",
    })),
  ];

  for (const row of result.rows) {
    body.push(result.columns.map((column) => ({
      text: format(column, row[column.key]),
      alignment: numericTypes.has(column.type) ? "right" : "left",
      margin: [0, 3, 0, 3],
    })));
  }

  if (result.totals) {
    body.push(result.columns.map((column) => ({
      text: format(column, result.totals![column.key]),
      bold: true,
      alignment: numericTypes.has(column.type) ? "right" : "left",
      margin: [0, 4, 0, 4],
    })));
  }

  if (result.rows.length === 0) {
    // An empty report still prints, saying so - a blank page invites the reader
    // to assume the export broke.
    body.push([{
      text: "No rows matched this report's filters.",
      colSpan: result.columns.length, color: MUTED, italics: true,
      margin: [0, 8, 0, 8],
    }, ...Array(result.columns.length - 1).fill({})]);
  }

  // pdfmake embeds the SVG as vectors, so the chart stays sharp at any zoom.
  const chartSvg = buildChartSvg(result, { width: 720, height: 300 });

  const definition: TDocumentDefinitions = {
    pageSize: "A4",
    pageOrientation: result.columns.length > 5 ? "landscape" : "portrait",
    pageMargins: [32, 44, 32, 48],
    defaultStyle: { font: "Helvetica", fontSize: 9, color: INK },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `Generated ${new Date(result.generated_at).toUTCString()}`,
          fontSize: 7, color: MUTED, margin: [32, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`,
          fontSize: 7, color: MUTED, alignment: "right", margin: [0, 0, 32, 0] },
      ],
    }),
    content: [
      { text: result.name, fontSize: 18, bold: true, margin: [0, 0, 0, 2] },
      { text: result.description, fontSize: 9, color: MUTED, margin: [0, 0, 0, 6] },
      { text: result.filter_summary, fontSize: 9, color: INK, margin: [0, 0, 0, 14] },
      ...(chartSvg
        ? [{
            svg: chartSvg,
            width: 500,
            margin: [0, 0, 0, 16] as [number, number, number, number],
          }]
        : []),
      {
        table: {
          headerRows: 1,
          widths: result.columns.map(() => "*"),
          body,
        },
        layout: {
          hLineWidth: (i: number) => (i <= 1 ? 0 : 0.5),
          vLineWidth: () => 0,
          hLineColor: () => "#e5e7eb",
          paddingLeft: () => 6,
          paddingRight: () => 6,
        },
      },
    ],
  };

  const document = await pdfmake.createPdf(definition);
  const buffer = await document.getBuffer();

  const date = result.generated_at.slice(0, 10);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${result.key}-${date}.pdf"`,
    },
  });
}
