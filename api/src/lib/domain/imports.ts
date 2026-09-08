import Papa from "papaparse";
import ExcelJS from "exceljs";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import type { FieldSchema } from "../validation/customFields";
import { STATUSES, createAsset, updateAsset, type AssetInput } from "./assets";

export interface ParsedUpload {
  headers: string[];
  rows: Record<string, string>[];
}

export async function parseUpload(
  buffer: Buffer,
  filename: string,
): Promise<ParsedUpload> {
  if (/\.xlsx?$/i.test(filename)) return parseWorkbook(buffer);

  const parsed = Papa.parse<Record<string, string>>(buffer.toString("utf8"), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  return {
    headers: parsed.meta.fields ?? [],
    rows: parsed.data.filter((r) => Object.values(r).some((v) => String(v ?? "").trim())),
  };
}

async function parseWorkbook(buffer: Buffer): Promise<ParsedUpload> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { headers: [], rows: [] };

  const headers: string[] = [];
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col - 1] = String(cell.value ?? "").trim();
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const record: Record<string, string> = {};
    headers.forEach((header, i) => {
      const value = row.getCell(i + 1).value;
      // A date cell arrives as a Date; the rest of the pipeline is text.
      record[header] =
        value instanceof Date
          ? value.toISOString().slice(0, 10)
          : String(value ?? "").trim();
    });
    if (Object.values(record).some((v) => v)) rows.push(record);
  });
  return { headers, rows };
}

export type ColumnMap = Record<string, string>;

const CORE_ALIASES: Record<string, string[]> = {
  asset_tag: ["asset tag", "tag", "asset id", "asset code"],
  name: ["name", "asset name", "description", "item", "title"],
  serial_no: ["serial", "serial no", "serial number", "sn", "serialnumber"],
  status: ["status", "state", "condition"],
  purchase_date: ["purchase date", "acquired", "date purchased", "acquisition date"],
  purchase_cost: ["purchase cost", "cost", "price", "value", "purchase price"],
  currency: ["currency", "ccy"],
  description: ["notes", "remarks", "detail", "details"],
};

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Best-effort header to field guess. The user always confirms it before committing. */
export function suggestMapping(headers: string[], schema: FieldSchema): ColumnMap {
  const map: ColumnMap = {};
  for (const header of headers) {
    const key = normalise(header);

    const core = Object.entries(CORE_ALIASES).find(([, aliases]) =>
      aliases.some((a) => normalise(a) === key),
    );
    if (core) {
      map[header] = core[0];
      continue;
    }

    const custom = schema.fields.find(
      (f) => normalise(f.label) === key || normalise(f.key) === key,
    );
    if (custom) map[header] = `custom.${custom.key}`;
  }
  return map;
}

export interface ImportError {
  row: number;
  field: string;
  message: string;
}
export interface ImportResult {
  /** snake_case on the wire, like every other field the v1 API returns. */
  job_id: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
}

interface RunInput {
  rows: Record<string, string>[];
  mapping: ColumnMap;
  categoryId: string | null;
  dryRun: boolean;
  filename: string;
}

/** Turns one source row into asset input, or throws with the offending field. */
function toAssetInput(
  row: Record<string, string>,
  mapping: ColumnMap,
  categoryId: string | null,
): Partial<AssetInput> & { name?: string } {
  const input: Record<string, unknown> = { custom: {} as Record<string, unknown> };

  for (const [header, target] of Object.entries(mapping)) {
    const raw = String(row[header] ?? "").trim();
    if (!raw) continue;

    if (target.startsWith("custom.")) {
      (input.custom as Record<string, unknown>)[target.slice(7)] = raw;
      continue;
    }
    if (target === "purchase_cost") {
      const n = Number(raw.replace(/[^0-9.\-]/g, ""));
      if (Number.isNaN(n)) {
        throw Object.assign(new Error(`"${raw}" is not a number`), { field: target });
      }
      input[target] = n;
      continue;
    }
    if (target === "status" && !(STATUSES as readonly string[]).includes(raw)) {
      throw Object.assign(
        new Error(
          `"${raw}" is not a valid status (expected one of ${STATUSES.join(", ")})`,
        ),
        { field: target },
      );
    }
    input[target] = raw;
  }

  if (categoryId) input.category_id = categoryId;
  if (!input.name) throw Object.assign(new Error("name is required"), { field: "name" });
  return input as Partial<AssetInput> & { name: string };
}

/**
 * Numbers coming from a spreadsheet arrive as strings. The category validator
 * wants real types, so coerce against the schema before validation rather than
 * loosening the validator.
 */
function coerceCustom(
  custom: Record<string, unknown>,
  schema: FieldSchema,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(custom)) {
    const field = schema.fields.find((f) => f.key === key);
    if (!field) continue;
    if (field.type === "number") out[key] = Number(value);
    else if (field.type === "boolean") out[key] = /^(true|yes|y|1)$/i.test(String(value));
    else out[key] = value;
  }
  return out;
}

export async function runImport(ctx: Ctx, input: RunInput): Promise<ImportResult> {
  const schema = input.categoryId
    ? await withTenant(ctx.orgId, async (c) =>
        (await c.query<{ field_schema: FieldSchema }>(
          "SELECT field_schema FROM categories WHERE id = $1", [input.categoryId],
        )).rows[0]?.field_schema ?? { fields: [] },
      )
    : { fields: [] };

  const jobId = await withTenant(ctx.orgId, async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO import_jobs (org_id, filename, dry_run, status, total)
       VALUES ($1, $2, $3, 'running', $4) RETURNING id`,
      [ctx.orgId, input.filename, input.dryRun, input.rows.length],
    )).rows[0].id,
  );

  const errors: ImportError[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const [index, row] of input.rows.entries()) {
    try {
      const parsed = toAssetInput(row, input.mapping, input.categoryId);
      parsed.custom = coerceCustom(
        (parsed.custom ?? {}) as Record<string, unknown>, schema,
      );

      // Serial number is the natural key: re-importing a vendor file updates
      // rather than duplicating.
      const existingId = parsed.serial_no
        ? await withTenant(ctx.orgId, async (c) =>
            (await c.query<{ id: string }>(
              "SELECT id FROM assets WHERE serial_no = $1 AND deleted_at IS NULL",
              [parsed.serial_no],
            )).rows[0]?.id ?? null,
          )
        : null;

      if (input.dryRun) {
        if (existingId) updated++;
        else created++;
        continue;
      }
      if (existingId) {
        await updateAsset(ctx, existingId, parsed);
        updated++;
      } else {
        await createAsset(ctx, parsed as AssetInput);
        created++;
      }
    } catch (err) {
      // One bad row must not lose the other nine hundred: record it and carry on.
      skipped++;
      const e = err as { field?: string; message: string };
      errors.push({ row: index + 1, field: e.field ?? "_", message: e.message });
    }
  }

  await withTenant(ctx.orgId, (c) =>
    c.query(
      `UPDATE import_jobs
          SET status = 'completed', created = $2, updated = $3, errors = $4
        WHERE id = $1`,
      [jobId, created, updated, JSON.stringify(errors)],
    ),
  );

  return { job_id: jobId, total: input.rows.length, created, updated, skipped, errors };
}

export const getImportJob = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query(
      `SELECT id, filename, status, dry_run, total, created, updated, errors, created_at
         FROM import_jobs WHERE id = $1`,
      [id],
    )).rows[0] ?? null,
  );
