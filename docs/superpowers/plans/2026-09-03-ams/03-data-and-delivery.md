# Phase 3 — Data & delivery

> Part of the [Assets Management System plan](./00-overview.md). Read `00-overview.md` first — its Global Constraints apply to every task here.

**Tasks 10–18.** Bulk import and export, file attachments, the multi-provider email system, notification rules, scheduled jobs, dashboard aggregates, and the multi-format report engine.

**Spec sections:** §8 (reporting), §9 (email and notifications), §13.4 (attachments and overdue as rental prerequisites).

| Task | Deliverable |
|---|---|
| 10 | CSV/XLSX import with column mapping and a dry-run preview |
| 11 | File attachments on S3-compatible storage |
| 12 | Encrypted secrets and the six email provider adapters |
| 13 | Templates, the outbox worker and provider failover |
| 14 | Notification rules and recipient resolution |
| 15 | Scheduled jobs — overdue, warranty/licence expiry, maintenance due |
| 16 | Dashboard aggregates |
| 17 | Report engine — definitions, JSON/CSV, chart specs |
| 18 | Report renderers — XLSX, PDF, SVG/PNG — plus saved and scheduled reports |

---

### Task 10: CSV/XLSX import with dry-run

**Files:**
- Create: `api/src/lib/domain/imports.ts`
- Create: `api/src/app/api/v1/imports/route.ts`, `api/src/app/api/v1/imports/[id]/route.ts`
- Test: `api/src/lib/domain/imports.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `createAsset`, `updateAsset`, `getAssetByTag`, `buildCustomValidator`.
- Produces:
  - `parseUpload(buffer, filename): Promise<{ headers: string[]; rows: Record<string,string>[] }>` — CSV via papaparse, XLSX via exceljs
  - `type ColumnMap = Record<string, string>` — source header → target field (`name`, `serial_no`, `custom.os`, …)
  - `suggestMapping(headers, category): ColumnMap` — fuzzy header match, so the user confirms rather than types
  - `runImport(ctx, { rows, mapping, categoryId, dryRun, filename }): Promise<ImportResult>`
  - `interface ImportResult { jobId, total, created, updated, skipped, errors: { row: number; field: string; message: string }[] }`

- [ ] **Step 1: Write the failing test**

`api/src/lib/domain/imports.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { parseUpload, suggestMapping, runImport } from "./imports";
import { createCategory } from "./categories";
import { listAssets } from "./assets";

const orgId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: randomUUID(), label: "Importer", scopes: ["admin"] },
};
const page = { page: 1, perPage: 100, offset: 0 };
const sort = { column: "name", direction: "ASC" as const };
let categoryId: string;

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'I',$2)", [
    orgId, `imp-org-${orgId.slice(0, 8)}`,
  ]);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,'x','Importer','admin')`,
    [ctx.actor.id, orgId, `imp-${orgId.slice(0, 8)}@example.com`],
  );
  categoryId = (await createCategory(ctx, {
    name: "IT", kind: "it",
    field_schema: { fields: [
      { key: "os", label: "OS", type: "string", required: false },
      { key: "warranty_end", label: "Warranty End", type: "date", required: false },
    ] },
  })).id;
});

const CSV = `Asset Name,Serial Number,Status,Operating System,Warranty End
Dell Latitude,DL-001,available,Windows 11,2027-06-30
MacBook Air,MBA-002,in_use,macOS,2028-01-15
`;

describe("parseUpload", () => {
  it("reads headers and rows from a CSV", async () => {
    const out = await parseUpload(Buffer.from(CSV), "assets.csv");
    expect(out.headers).toEqual([
      "Asset Name", "Serial Number", "Status", "Operating System", "Warranty End",
    ]);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]["Serial Number"]).toBe("DL-001");
  });

  it("ignores a trailing blank line", async () => {
    const out = await parseUpload(Buffer.from(CSV + "\n\n"), "assets.csv");
    expect(out.rows).toHaveLength(2);
  });
});

describe("suggestMapping", () => {
  it("matches obvious headers to core fields", () => {
    const map = suggestMapping(
      ["Asset Name", "Serial Number", "Status"],
      { fields: [] },
    );
    expect(map).toMatchObject({
      "Asset Name": "name",
      "Serial Number": "serial_no",
      "Status": "status",
    });
  });

  it("matches a header to a custom field by its label", () => {
    const map = suggestMapping(["Operating System"], {
      fields: [{ key: "os", label: "Operating System", type: "string", required: false }],
    });
    expect(map["Operating System"]).toBe("custom.os");
  });

  it("leaves an unrecognised header unmapped", () => {
    const map = suggestMapping(["Cost Centre"], { fields: [] });
    expect(map["Cost Centre"]).toBeUndefined();
  });
});

describe("runImport", () => {
  const mapping = {
    "Asset Name": "name",
    "Serial Number": "serial_no",
    "Status": "status",
    "Operating System": "custom.os",
    "Warranty End": "custom.warranty_end",
  };

  it("creates nothing in dry-run mode but reports what would happen", async () => {
    const { rows } = await parseUpload(Buffer.from(CSV), "a.csv");
    const result = await runImport(ctx, {
      rows, mapping, categoryId, dryRun: true, filename: "a.csv",
    });
    expect(result).toMatchObject({ total: 2, created: 2, updated: 0, errors: [] });
    const after = await listAssets(ctx, {}, page, sort);
    expect(after.total).toBe(0);
  });

  it("creates the assets when committed", async () => {
    const { rows } = await parseUpload(Buffer.from(CSV), "a.csv");
    const result = await runImport(ctx, {
      rows, mapping, categoryId, dryRun: false, filename: "a.csv",
    });
    expect(result.created).toBe(2);
    const after = await listAssets(ctx, {}, page, sort);
    expect(after.rows.map((r) => r.serial_no).sort()).toEqual(["DL-001", "MBA-002"]);
  });

  it("maps custom fields through the category schema", async () => {
    const after = await listAssets(ctx, { q: "DL-001" }, page, sort);
    expect(after.rows[0].custom).toEqual({
      os: "Windows 11", warranty_end: "2027-06-30",
    });
  });

  it("updates an existing asset matched on serial number", async () => {
    const csv = `Asset Name,Serial Number,Status\nDell Latitude 5540,DL-001,maintenance\n`;
    const { rows } = await parseUpload(Buffer.from(csv), "b.csv");
    const result = await runImport(ctx, {
      rows,
      mapping: { "Asset Name": "name", "Serial Number": "serial_no", "Status": "status" },
      categoryId, dryRun: false, filename: "b.csv",
    });
    expect(result).toMatchObject({ created: 0, updated: 1 });
    const after = await listAssets(ctx, { q: "DL-001" }, page, sort);
    expect(after.rows[0].status).toBe("maintenance");
  });

  it("reports a per-row error without aborting the whole import", async () => {
    const csv = `Asset Name,Serial Number,Status
Good One,GD-001,available
Bad One,BD-002,teleported
`;
    const { rows } = await parseUpload(Buffer.from(csv), "c.csv");
    const result = await runImport(ctx, {
      rows,
      mapping: { "Asset Name": "name", "Serial Number": "serial_no", "Status": "status" },
      categoryId, dryRun: false, filename: "c.csv",
    });
    expect(result.created).toBe(1);
    expect(result.errors).toEqual([
      { row: 2, field: "status", message: expect.stringContaining("teleported") },
    ]);
  });

  it("rejects a row missing the required name", async () => {
    const csv = `Asset Name,Serial Number\n,NN-001\n`;
    const { rows } = await parseUpload(Buffer.from(csv), "d.csv");
    const result = await runImport(ctx, {
      rows, mapping: { "Asset Name": "name", "Serial Number": "serial_no" },
      categoryId, dryRun: true, filename: "d.csv",
    });
    expect(result.errors[0]).toMatchObject({ row: 1, field: "name" });
  });

  it("records the job so the result can be fetched later", async () => {
    const { rows } = await parseUpload(Buffer.from(CSV), "e.csv");
    const result = await runImport(ctx, {
      rows, mapping, categoryId, dryRun: true, filename: "e.csv",
    });
    const { rows: jobs } = await pool.query(
      "SELECT filename, dry_run, total FROM import_jobs WHERE id = $1", [result.jobId],
    );
    expect(jobs[0]).toMatchObject({ filename: "e.csv", dry_run: true, total: 2 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/imports.test.ts`
Expected: FAIL with `Cannot find module './imports'`.

- [ ] **Step 3: Add the dependencies**

```bash
cd api && npm install papaparse exceljs && npm install -D @types/papaparse
```

- [ ] **Step 4: Implement the import domain module**

`api/src/lib/domain/imports.ts`:

```ts
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

/** Best-effort header → field guess. The user always confirms it before committing. */
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
  jobId: string;
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
      if (Number.isNaN(n)) throw Object.assign(new Error(`"${raw}" is not a number`), { field: target });
      input[target] = n;
      continue;
    }
    if (target === "status" && !(STATUSES as readonly string[]).includes(raw)) {
      throw Object.assign(
        new Error(`"${raw}" is not a valid status (expected one of ${STATUSES.join(", ")})`),
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
 * Numbers coming from a spreadsheet arrive as strings. The category validator wants
 * real types, so coerce against the schema before validation rather than loosening it.
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
        existingId ? updated++ : created++;
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
      skipped++;
      const e = err as { field?: string; message: string };
      errors.push({
        row: index + 1,
        field: e.field ?? "_",
        message: e.message,
      });
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

  return { jobId, total: input.rows.length, created, updated, skipped, errors };
}

export const getImportJob = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query(
      `SELECT id, filename, status, dry_run, total, created, updated, errors, created_at
         FROM import_jobs WHERE id = $1`,
      [id],
    )).rows[0] ?? null,
  );
```

- [ ] **Step 5: Implement the route handlers**

`api/src/app/api/v1/imports/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { parseUpload, suggestMapping, runImport, type ColumnMap } from "@/lib/domain/imports";
import { getCategory } from "@/lib/domain/categories";

const MAX_BYTES = 10 * 1024 * 1024;

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return problem(422, "validation", "Validation failed", {
      detail: "Send the spreadsheet as multipart form field `file`.",
    });
  }
  if (file.size > MAX_BYTES) {
    return problem(413, "payload-too-large", "File too large", {
      detail: "Imports are limited to 10 MB. Split the file and import in batches.",
    });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { headers, rows } = await parseUpload(buffer, file.name);
  if (rows.length === 0) {
    return problem(422, "validation", "Validation failed", {
      detail: "The file contains no data rows.",
    });
  }

  const categoryId = (form?.get("category_id") as string) || null;
  const category = categoryId ? await getCategory(ctx, categoryId) : null;
  const schema = category?.field_schema ?? { fields: [] };

  // No mapping supplied means "tell me what you would do": return the suggestion
  // and the headers so the UI can render the mapping step.
  const rawMapping = form?.get("mapping");
  if (!rawMapping) {
    return Response.json({
      headers,
      row_count: rows.length,
      sample: rows.slice(0, 5),
      suggested_mapping: suggestMapping(headers, schema),
    });
  }

  let mapping: ColumnMap;
  try {
    mapping = JSON.parse(String(rawMapping));
  } catch {
    return problem(422, "validation", "Validation failed", {
      detail: "`mapping` must be a JSON object of source header to target field.",
    });
  }

  const dryRun = String(form?.get("dry_run") ?? "true") !== "false";
  const result = await runImport(ctx, {
    rows, mapping, categoryId, dryRun, filename: file.name,
  });
  return Response.json(result, { status: dryRun ? 200 : 201 });
});
```

`api/src/app/api/v1/imports/[id]/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getImportJob } from "@/lib/domain/imports";

export const GET = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  const job = await getImportJob(ctx, (await params).id);
  return job ? Response.json(job) : notFound("import job");
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/domain/imports.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/domain/imports.ts api/src/app/api/v1/imports api/package.json
git commit -m "feat: csv and xlsx import with column mapping and dry-run preview"
```

---

### Task 11: File attachments on S3-compatible storage

**Files:**
- Create: `api/src/lib/storage/s3.ts`, `api/src/lib/domain/attachments.ts`
- Create: `api/src/app/api/v1/assets/[id]/attachments/route.ts`, `api/src/app/api/v1/attachments/[id]/route.ts`
- Test: `api/src/lib/domain/attachments.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `recordEvent`, the `attachments` table from migration 005.
- Produces:
  - `putObject(key, body, contentType): Promise<void>`, `getObject(key): Promise<Buffer>`, `deleteObject(key): Promise<void>`, `presignGet(key, seconds): Promise<string>`
  - `addAttachment(ctx, { assetId, assignmentId?, kind, filename, contentType, size, body }): Promise<Attachment>`
  - `listAttachments(ctx, assetId)`, `getAttachment(ctx, id)`, `deleteAttachment(ctx, id)`
  - Allowed types: images (`image/png|jpeg|webp|gif`), `application/pdf`, plain text/CSV. Max 25 MB.

**Design note:** attachments are the evidence layer — condition photos at check-in,
warranty documents, equipment manuals. Spec §13.4 marks them a rental prerequisite:
before/after inspection photos are the entire basis of a damage claim.

- [ ] **Step 1: Write the failing test**

`api/src/lib/domain/attachments.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createAsset } from "./assets";
import {
  addAttachment, listAttachments, deleteAttachment, UnsupportedTypeError,
} from "./attachments";

const orgId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: randomUUID(), label: "Tech", scopes: ["admin"] },
};
let assetId: string;

// A one-pixel PNG, so the test exercises real bytes rather than a text stand-in.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'At',$2)", [
    orgId, `att-org-${orgId.slice(0, 8)}`,
  ]);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,'x','Tech','admin')`,
    [ctx.actor.id, orgId, `tech-${orgId.slice(0, 8)}@example.com`],
  );
  assetId = (await createAsset(ctx, { name: "Photographed drill" })).id;
});

describe("addAttachment", () => {
  it("stores the file and returns its metadata", async () => {
    const att = await addAttachment(ctx, {
      assetId, kind: "photo", filename: "front.png",
      contentType: "image/png", size: PNG.length, body: PNG,
    });
    expect(att).toMatchObject({
      filename: "front.png", content_type: "image/png", kind: "photo",
    });
    expect(att.object_key).toMatch(new RegExp(`^${orgId}/`));
  });

  it("namespaces the object key by organisation so tenants cannot collide", async () => {
    const att = await addAttachment(ctx, {
      assetId, kind: "file", filename: "manual.pdf",
      contentType: "application/pdf", size: 4, body: Buffer.from("%PDF"),
    });
    expect(att.object_key.startsWith(`${orgId}/`)).toBe(true);
  });

  it("rejects a content type that is not on the allowlist", async () => {
    await expect(addAttachment(ctx, {
      assetId, kind: "file", filename: "payload.exe",
      contentType: "application/x-msdownload", size: 4, body: Buffer.from("MZ\0\0"),
    })).rejects.toBeInstanceOf(UnsupportedTypeError);
  });

  it("rejects a file over the size limit", async () => {
    await expect(addAttachment(ctx, {
      assetId, kind: "file", filename: "huge.pdf",
      contentType: "application/pdf", size: 26 * 1024 * 1024, body: Buffer.alloc(1),
    })).rejects.toThrow(/25 MB/);
  });

  it("writes an asset.attachment_added audit event", async () => {
    await addAttachment(ctx, {
      assetId, kind: "photo", filename: "side.png",
      contentType: "image/png", size: PNG.length, body: PNG,
    });
    const { rows } = await pool.query(
      "SELECT event FROM audit_events WHERE asset_id=$1", [assetId],
    );
    expect(rows.map((r) => r.event)).toContain("asset.attachment_added");
  });
});

describe("listAttachments", () => {
  it("returns the asset's attachments newest first", async () => {
    const list = await listAttachments(ctx, assetId);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0].created_at >= list[1].created_at).toBe(true);
  });
});

describe("deleteAttachment", () => {
  it("removes the row and reports success", async () => {
    const att = await addAttachment(ctx, {
      assetId, kind: "file", filename: "temp.txt",
      contentType: "text/plain", size: 5, body: Buffer.from("hello"),
    });
    await expect(deleteAttachment(ctx, att.id)).resolves.toBe(true);
    const list = await listAttachments(ctx, assetId);
    expect(list.find((a) => a.id === att.id)).toBeUndefined();
  });

  it("returns false for an unknown id", async () => {
    await expect(deleteAttachment(ctx, randomUUID())).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/attachments.test.ts`
Expected: FAIL with `Cannot find module './attachments'`.

- [ ] **Step 3: Add the dependency and start MinIO**

```bash
cd api && npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
cd .. && docker compose up -d minio
```

Add to `api/src/test/setup.ts`:

```ts
process.env.S3_ENDPOINT ??= "http://localhost:9000";
process.env.S3_BUCKET ??= "ams-attachments";
process.env.S3_ACCESS_KEY ??= "ams";
process.env.S3_SECRET_KEY ??= "ams-secret";
```

- [ ] **Step 4: Implement the storage adapter**

`api/src/lib/storage/s3.ts`:

```ts
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  CreateBucketCommand, HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const bucket = process.env.S3_BUCKET ?? "ams-attachments";

// forcePathStyle keeps MinIO and real S3 on the same code path.
export const s3 = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "",
  },
});

let bucketReady: Promise<void> | null = null;

/** Creates the bucket on first use so a fresh environment needs no manual setup. */
function ensureBucket(): Promise<void> {
  bucketReady ??= (async () => {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  })();
  return bucketReady;
}

export async function putObject(
  key: string, body: Buffer, contentType: string,
): Promise<void> {
  await ensureBucket();
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: body, ContentType: contentType,
  }));
}

export async function getObject(key: string): Promise<Buffer> {
  await ensureBucket();
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await out.Body!.transformToByteArray());
}

export async function deleteObject(key: string): Promise<void> {
  await ensureBucket();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function presignGet(key: string, seconds = 300): Promise<string> {
  await ensureBucket();
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: seconds,
  });
}
```

- [ ] **Step 5: Implement the attachment domain module**

`api/src/lib/domain/attachments.ts`:

```ts
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { putObject, deleteObject, getObject, presignGet } from "../storage/s3";
import { recordEvent } from "./audit";

export class UnsupportedTypeError extends Error {
  readonly status = 415;
}

export const ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "application/pdf", "text/plain", "text/csv",
]);
export const MAX_BYTES = 25 * 1024 * 1024;

export type AttachmentKind = "file" | "photo" | "condition_in" | "condition_out";

export interface Attachment {
  id: string;
  asset_id: string | null;
  assignment_id: string | null;
  kind: AttachmentKind;
  object_key: string;
  filename: string;
  content_type: string;
  size_bytes: string;
  created_at: string;
}

interface AddInput {
  assetId: string | null;
  assignmentId?: string | null;
  kind: AttachmentKind;
  filename: string;
  contentType: string;
  size: number;
  body: Buffer;
}

export async function addAttachment(ctx: Ctx, input: AddInput): Promise<Attachment> {
  if (!ALLOWED_TYPES.has(input.contentType)) {
    throw new UnsupportedTypeError(
      `${input.contentType} is not an accepted file type. ` +
      `Accepted: ${[...ALLOWED_TYPES].join(", ")}.`,
    );
  }
  if (input.size > MAX_BYTES) {
    throw new UnsupportedTypeError("Attachments are limited to 25 MB.");
  }

  // Key is org-prefixed so a bucket listing can never cross tenants, and
  // randomised so an uploaded filename cannot overwrite another.
  const key = `${ctx.orgId}/${input.assetId ?? "unfiled"}/${randomUUID()}${extname(input.filename)}`;
  await putObject(key, input.body, input.contentType);

  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<Attachment>(
      `INSERT INTO attachments
         (org_id, asset_id, assignment_id, kind, object_key, filename,
          content_type, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, asset_id, assignment_id, kind, object_key, filename,
                 content_type, size_bytes, created_at`,
      [
        ctx.orgId, input.assetId, input.assignmentId ?? null, input.kind, key,
        input.filename, input.contentType, input.size,
        ctx.actor.type === "user" ? ctx.actor.id : null,
      ],
    );
    if (input.assetId) {
      await recordEvent(c, ctx, {
        assetId: input.assetId,
        event: "asset.attachment_added",
        changes: { filename: { from: null, to: input.filename } },
      });
    }
    return rows[0];
  });
}

export const listAttachments = (ctx: Ctx, assetId: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Attachment>(
      `SELECT id, asset_id, assignment_id, kind, object_key, filename,
              content_type, size_bytes, created_at
         FROM attachments WHERE asset_id = $1
        ORDER BY created_at DESC`,
      [assetId],
    )).rows,
  );

export const getAttachment = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Attachment>(
      `SELECT id, asset_id, kind, object_key, filename, content_type,
              size_bytes, created_at
         FROM attachments WHERE id = $1`,
      [id],
    )).rows[0] ?? null,
  );

export async function deleteAttachment(ctx: Ctx, id: string): Promise<boolean> {
  const attachment = await getAttachment(ctx, id);
  if (!attachment) return false;

  await withTenant(ctx.orgId, async (c) => {
    await c.query("DELETE FROM attachments WHERE id = $1", [id]);
    if (attachment.asset_id) {
      await recordEvent(c, ctx, {
        assetId: attachment.asset_id,
        event: "asset.attachment_removed",
        changes: { filename: { from: attachment.filename, to: null } },
      });
    }
  });
  // Storage is cleaned after the row is gone: an orphaned object is recoverable,
  // a row pointing at a deleted object is not.
  await deleteObject(attachment.object_key).catch(() => undefined);
  return true;
}

export const readAttachmentBody = (key: string) => getObject(key);
export const attachmentUrl = (key: string) => presignGet(key, 300);
```

- [ ] **Step 6: Implement the route handlers**

`api/src/app/api/v1/assets/[id]/attachments/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { problem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getAsset } from "@/lib/domain/assets";
import {
  addAttachment, listAttachments, UnsupportedTypeError, type AttachmentKind,
} from "@/lib/domain/attachments";

type Params = { params: Promise<{ id: string }> };
const KINDS = new Set(["file", "photo", "condition_in", "condition_out"]);

export const GET = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listAttachments(ctx, (await params).id) });
});

export const POST = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;
  const { id } = await params;
  if (!(await getAsset(ctx, id))) return notFound("asset");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return problem(422, "validation", "Validation failed", {
      detail: "Send the file as multipart form field `file`.",
    });
  }

  const rawKind = String(form?.get("kind") ?? "file");
  const kind = (KINDS.has(rawKind) ? rawKind : "file") as AttachmentKind;

  try {
    const attachment = await addAttachment(ctx, {
      assetId: id,
      assignmentId: (form?.get("assignment_id") as string) || null,
      kind,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      size: file.size,
      body: Buffer.from(await file.arrayBuffer()),
    });
    return Response.json(attachment, { status: 201 });
  } catch (err) {
    if (err instanceof UnsupportedTypeError) {
      return problem(err.status, "unsupported-media-type", "Unsupported file", {
        detail: err.message,
      });
    }
    throw err;
  }
});
```

`api/src/app/api/v1/attachments/[id]/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import {
  getAttachment, deleteAttachment, readAttachmentBody,
} from "@/lib/domain/attachments";

type Params = { params: Promise<{ id: string }> };

export const GET = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  const attachment = await getAttachment(ctx, (await params).id);
  if (!attachment) return notFound("attachment");

  const body = await readAttachmentBody(attachment.object_key);
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": attachment.content_type,
      "content-disposition":
        `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
      "cache-control": "private, max-age=300",
    },
  });
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;
  const done = await deleteAttachment(ctx, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("attachment");
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/domain/attachments.test.ts`
Expected: PASS, 8 tests. (MinIO must be running — `docker compose up -d minio`.)

- [ ] **Step 8: Commit**

```bash
git add api/src/lib/storage api/src/lib/domain/attachments.ts api/src/app/api/v1 api/src/test/setup.ts api/package.json
git commit -m "feat: file attachments on s3-compatible storage with type and size limits"
```

---

### Task 12: Encrypted secrets and the email provider adapters

**Files:**
- Create: `api/migrations/006_email.sql`
- Create: `api/src/lib/crypto/secrets.ts`
- Create: `api/src/lib/email/types.ts`, `api/src/lib/email/providers/smtp.ts`, `sendgrid.ts`, `ses.ts`, `postmark.ts`, `mailgun.ts`, `resend.ts`, `api/src/lib/email/providers/index.ts`
- Create: `api/src/lib/domain/emailProviders.ts`
- Test: `api/src/lib/crypto/secrets.test.ts`, `api/src/lib/email/providers.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `Ctx`.
- Produces:
  - `encryptSecret(plain): string` / `decryptSecret(sealed): string` — AES-256-GCM, output `v1.<iv>.<tag>.<ciphertext>` base64url
  - `maskSecret(plain): string` — `sk_live_••••4f2a`
  - `sealConfig(config, secretKeys)` / `openConfig(config, secretKeys)` / `maskConfig(config, secretKeys)`
  - `interface EmailMessage { to: string[]; cc?: string[]; subject: string; html: string; text: string; from: {email,name}; replyTo?: string; attachments?: { filename; content: Buffer; contentType: string }[] }`
  - `interface EmailProvider { send(msg): Promise<{ providerMessageId: string }> }`
  - `PROVIDER_TYPES`, `SECRET_KEYS: Record<type, string[]>`, `CONFIG_SCHEMAS: Record<type, ZodType>`
  - `buildProvider(type, config, from): EmailProvider`
  - `listProviders(ctx)`, `createProvider(ctx, input)`, `updateProvider(ctx, id, patch)`, `deleteProvider(ctx, id)`, `getActiveProviders(ctx)` (ordered by priority)

**Design note (spec §9.1):** providers are plural and priority-ordered so a
misconfigured or rate-limited primary degrades to a backup rather than silently dropping
notifications. Secrets never leave the server in plaintext — reads come back masked.

- [ ] **Step 1: Write the failing tests**

`api/src/lib/crypto/secrets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  encryptSecret, decryptSecret, maskSecret, sealConfig, openConfig, maskConfig,
} from "./secrets";

describe("encryptSecret", () => {
  it("round-trips a value", () => {
    expect(decryptSecret(encryptSecret("SG.abc123"))).toBe("SG.abc123");
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("never contains the plaintext", () => {
    expect(encryptSecret("supersecret")).not.toContain("supersecret");
  });

  it("rejects tampered ciphertext rather than returning garbage", () => {
    const sealed = encryptSecret("value");
    const tampered = sealed.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered)).toThrow();
  });
});

describe("maskSecret", () => {
  it("keeps a recognisable prefix and the last four characters", () => {
    expect(maskSecret("sk_live_9f2b7c4a")).toBe("sk_live_••••7c4a");
  });

  it("fully masks a short secret", () => {
    expect(maskSecret("abc")).toBe("••••");
  });
});

describe("config sealing", () => {
  const config = { host: "smtp.example.com", port: 587, password: "hunter2" };

  it("encrypts only the declared secret keys", () => {
    const sealed = sealConfig(config, ["password"]);
    expect(sealed.host).toBe("smtp.example.com");
    expect(sealed.password).not.toBe("hunter2");
  });

  it("opens back to the original values", () => {
    expect(openConfig(sealConfig(config, ["password"]), ["password"])).toEqual(config);
  });

  it("masks secrets for API responses", () => {
    const masked = maskConfig(sealConfig(config, ["password"]), ["password"]);
    expect(masked.password).toMatch(/•/);
    expect(masked.host).toBe("smtp.example.com");
  });
});
```

`api/src/lib/email/providers.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildProvider, CONFIG_SCHEMAS, SECRET_KEYS } from "./providers";

const from = { email: "ams@example.com", name: "AMS" };
const message = {
  to: ["rina@example.com"],
  subject: "Asset assigned",
  html: "<p>Hello</p>",
  text: "Hello",
  from,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("config schemas", () => {
  it("requires an api key for sendgrid", () => {
    expect(CONFIG_SCHEMAS.sendgrid.safeParse({}).success).toBe(false);
    expect(CONFIG_SCHEMAS.sendgrid.safeParse({ api_key: "SG.x" }).success).toBe(true);
  });

  it("requires host and port for smtp", () => {
    expect(CONFIG_SCHEMAS.smtp.safeParse({ host: "smtp.x.com" }).success).toBe(false);
    expect(CONFIG_SCHEMAS.smtp.safeParse({
      host: "smtp.x.com", port: 587, secure: false,
      username: "u", password: "p",
    }).success).toBe(true);
  });

  it("declares which keys hold secrets for every provider type", () => {
    expect(SECRET_KEYS.sendgrid).toEqual(["api_key"]);
    expect(SECRET_KEYS.smtp).toEqual(["password"]);
    expect(SECRET_KEYS.ses).toEqual(["secret_access_key"]);
  });
});

describe("buildProvider", () => {
  it("posts to the SendGrid API and returns the message id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202, headers: { "x-message-id": "sg-1" } }),
    );
    const provider = buildProvider("sendgrid", { api_key: "SG.test" }, from);
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: "sg-1" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer SG.test");
  });

  it("throws a descriptive error when the provider rejects the send", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "bad key" }] }), { status: 401 }),
    );
    const provider = buildProvider("sendgrid", { api_key: "SG.bad" }, from);
    await expect(provider.send(message)).rejects.toThrow(/401/);
  });

  it("posts form-encoded to Mailgun with basic auth", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "<mg-1>" }), { status: 200 }),
    );
    const provider = buildProvider(
      "mailgun", { api_key: "key-x", domain: "mg.example.com", region: "us" }, from,
    );
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: "<mg-1>" });
    expect(fetchMock.mock.calls[0][0]).toContain("mg.example.com/messages");
  });

  it("posts to Postmark with the server token header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ MessageID: "pm-1" }), { status: 200 }),
    );
    const provider = buildProvider("postmark", { server_token: "tok" }, from);
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: "pm-1" });
    expect(
      (fetchMock.mock.calls[0][1]!.headers as Record<string, string>)["X-Postmark-Server-Token"],
    ).toBe("tok");
  });

  it("posts to Resend with a bearer token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "re-1" }), { status: 200 }),
    );
    const provider = buildProvider("resend", { api_key: "re_x" }, from);
    await expect(provider.send(message)).resolves.toEqual({ providerMessageId: "re-1" });
  });

  it("refuses an unknown provider type", () => {
    expect(() => buildProvider("carrier-pigeon" as never, {}, from)).toThrow(/unknown/i);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && npx vitest run src/lib/crypto src/lib/email`
Expected: FAIL — modules not found.

- [ ] **Step 3: Add dependencies and the encryption key**

```bash
cd api && npm install nodemailer @aws-sdk/client-sesv2 && npm install -D @types/nodemailer
```

Add to `.env.example` and the `api` service environment in `docker-compose.yml`:

```
APP_ENCRYPTION_KEY=64-hex-characters-32-bytes-generate-with-openssl-rand-hex-32
```

Add to `api/src/test/setup.ts`:

```ts
process.env.APP_ENCRYPTION_KEY ??=
  "0000000000000000000000000000000000000000000000000000000000000001";
```

- [ ] **Step 4: Implement the secrets module**

`api/src/lib/crypto/secrets.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function key(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "APP_ENCRYPTION_KEY must be 64 hex characters (32 bytes). " +
      "Generate one with: openssl rand -hex 32",
    );
  }
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM. The auth tag makes tampering a decryption failure, not silent corruption. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(sealed: string): string {
  const [version, ivB64, tagB64, dataB64] = sealed.split(".");
  if (version !== VERSION) throw new Error(`unsupported secret format: ${version}`);
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** `sk_live_9f2b7c4a` → `sk_live_••••7c4a`. Enough to recognise, useless to steal. */
export function maskSecret(plain: string): string {
  if (plain.length < 8) return "••••";
  const tail = plain.slice(-4);
  const prefixMatch = plain.match(/^([A-Za-z]+[_.])+/);
  const prefix = prefixMatch ? prefixMatch[0] : "";
  return `${prefix}••••${tail}`;
}

type Config = Record<string, unknown>;

export function sealConfig(config: Config, secretKeys: string[]): Config {
  const out: Config = { ...config };
  for (const k of secretKeys) {
    if (typeof out[k] === "string" && out[k]) out[k] = encryptSecret(out[k] as string);
  }
  return out;
}

export function openConfig(config: Config, secretKeys: string[]): Config {
  const out: Config = { ...config };
  for (const k of secretKeys) {
    if (typeof out[k] === "string" && out[k]) out[k] = decryptSecret(out[k] as string);
  }
  return out;
}

export function maskConfig(config: Config, secretKeys: string[]): Config {
  const out: Config = { ...config };
  for (const k of secretKeys) {
    if (typeof out[k] === "string" && out[k]) {
      out[k] = maskSecret(decryptSecret(out[k] as string));
    }
  }
  return out;
}
```

- [ ] **Step 5: Implement the provider adapters**

`api/src/lib/email/types.ts`:

```ts
export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface EmailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  from: EmailAddress;
  replyTo?: string;
  attachments?: EmailAttachment[];
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}

export class EmailSendError extends Error {
  constructor(
    readonly providerType: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}
```

`api/src/lib/email/providers/index.ts`:

```ts
import { z } from "zod";
import type { EmailAddress, EmailProvider } from "../types";
import { smtpProvider } from "./smtp";
import { sendgridProvider } from "./sendgrid";
import { sesProvider } from "./ses";
import { postmarkProvider } from "./postmark";
import { mailgunProvider } from "./mailgun";
import { resendProvider } from "./resend";

export const PROVIDER_TYPES = [
  "smtp", "sendgrid", "ses", "postmark", "mailgun", "resend",
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const CONFIG_SCHEMAS: Record<ProviderType, z.ZodTypeAny> = {
  smtp: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean().default(false),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  sendgrid: z.object({ api_key: z.string().min(1) }),
  ses: z.object({
    region: z.string().min(1),
    access_key_id: z.string().min(1),
    secret_access_key: z.string().min(1),
  }),
  postmark: z.object({ server_token: z.string().min(1) }),
  mailgun: z.object({
    api_key: z.string().min(1),
    domain: z.string().min(1),
    region: z.enum(["us", "eu"]).default("us"),
  }),
  resend: z.object({ api_key: z.string().min(1) }),
};

/** Which config keys are secrets, and so must be encrypted at rest and masked on read. */
export const SECRET_KEYS: Record<ProviderType, string[]> = {
  smtp: ["password"],
  sendgrid: ["api_key"],
  ses: ["secret_access_key"],
  postmark: ["server_token"],
  mailgun: ["api_key"],
  resend: ["api_key"],
};

const BUILDERS: Record<
  ProviderType,
  (config: Record<string, unknown>, from: EmailAddress) => EmailProvider
> = {
  smtp: smtpProvider,
  sendgrid: sendgridProvider,
  ses: sesProvider,
  postmark: postmarkProvider,
  mailgun: mailgunProvider,
  resend: resendProvider,
};

export function buildProvider(
  type: ProviderType,
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const builder = BUILDERS[type];
  if (!builder) throw new Error(`unknown email provider type: ${type}`);
  return builder(config, from);
}
```

`api/src/lib/email/providers/sendgrid.ts`:

```ts
import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

export function sendgridProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const apiKey = String(config.api_key);
  return {
    async send(message: EmailMessage) {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{
            to: message.to.map((email) => ({ email })),
            ...(message.cc?.length ? { cc: message.cc.map((email) => ({ email })) } : {}),
          }],
          from: { email: message.from.email, name: message.from.name },
          ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
          subject: message.subject,
          content: [
            { type: "text/plain", value: message.text },
            { type: "text/html", value: message.html },
          ],
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((a) => ({
                  filename: a.filename,
                  type: a.contentType,
                  content: a.content.toString("base64"),
                })),
              }
            : {}),
        }),
      });

      if (!res.ok) {
        throw new EmailSendError("sendgrid", res.status,
          `SendGrid rejected the message (${res.status}): ${await res.text()}`);
      }
      return { providerMessageId: res.headers.get("x-message-id") ?? "" };
    },
  };
}
```

`api/src/lib/email/providers/postmark.ts`:

```ts
import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

export function postmarkProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const token = String(config.server_token);
  return {
    async send(message: EmailMessage) {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "X-Postmark-Server-Token": token,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          From: message.from.name
            ? `${message.from.name} <${message.from.email}>`
            : message.from.email,
          To: message.to.join(","),
          ...(message.cc?.length ? { Cc: message.cc.join(",") } : {}),
          ...(message.replyTo ? { ReplyTo: message.replyTo } : {}),
          Subject: message.subject,
          HtmlBody: message.html,
          TextBody: message.text,
          MessageStream: "outbound",
          ...(message.attachments?.length
            ? {
                Attachments: message.attachments.map((a) => ({
                  Name: a.filename,
                  Content: a.content.toString("base64"),
                  ContentType: a.contentType,
                })),
              }
            : {}),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as { MessageID?: string; Message?: string };
      if (!res.ok) {
        throw new EmailSendError("postmark", res.status,
          `Postmark rejected the message (${res.status}): ${body.Message ?? ""}`);
      }
      return { providerMessageId: body.MessageID ?? "" };
    },
  };
}
```

`api/src/lib/email/providers/mailgun.ts`:

```ts
import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

export function mailgunProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const apiKey = String(config.api_key);
  const domain = String(config.domain);
  const host = config.region === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";

  return {
    async send(message: EmailMessage) {
      const form = new FormData();
      form.set("from", message.from.name
        ? `${message.from.name} <${message.from.email}>`
        : message.from.email);
      for (const to of message.to) form.append("to", to);
      for (const cc of message.cc ?? []) form.append("cc", cc);
      if (message.replyTo) form.set("h:Reply-To", message.replyTo);
      form.set("subject", message.subject);
      form.set("text", message.text);
      form.set("html", message.html);
      for (const a of message.attachments ?? []) {
        form.append("attachment", new Blob([a.content], { type: a.contentType }), a.filename);
      }

      const res = await fetch(`https://${host}/v3/${domain}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
        },
        body: form,
      });

      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        throw new EmailSendError("mailgun", res.status,
          `Mailgun rejected the message (${res.status}): ${body.message ?? ""}`);
      }
      return { providerMessageId: body.id ?? "" };
    },
  };
}
```

`api/src/lib/email/providers/resend.ts`:

```ts
import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

export function resendProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const apiKey = String(config.api_key);
  return {
    async send(message: EmailMessage) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: message.from.name
            ? `${message.from.name} <${message.from.email}>`
            : message.from.email,
          to: message.to,
          ...(message.cc?.length ? { cc: message.cc } : {}),
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map((a) => ({
                  filename: a.filename,
                  content: a.content.toString("base64"),
                })),
              }
            : {}),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) {
        throw new EmailSendError("resend", res.status,
          `Resend rejected the message (${res.status}): ${body.message ?? ""}`);
      }
      return { providerMessageId: body.id ?? "" };
    },
  };
}
```

`api/src/lib/email/providers/smtp.ts`:

```ts
import nodemailer from "nodemailer";
import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

export function smtpProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const transport = nodemailer.createTransport({
    host: String(config.host),
    port: Number(config.port),
    secure: Boolean(config.secure),
    auth: { user: String(config.username), pass: String(config.password) },
  });

  return {
    async send(message: EmailMessage) {
      try {
        const info = await transport.sendMail({
          from: { address: message.from.email, name: message.from.name ?? "" },
          to: message.to,
          cc: message.cc,
          replyTo: message.replyTo,
          subject: message.subject,
          text: message.text,
          html: message.html,
          attachments: message.attachments?.map((a) => ({
            filename: a.filename, content: a.content, contentType: a.contentType,
          })),
        });
        return { providerMessageId: info.messageId };
      } catch (err) {
        throw new EmailSendError("smtp", null, `SMTP send failed: ${(err as Error).message}`);
      }
    },
  };
}
```

`api/src/lib/email/providers/ses.ts`:

```ts
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { EmailSendError, type EmailAddress, type EmailMessage, type EmailProvider } from "../types";

export function sesProvider(
  config: Record<string, unknown>,
  from: EmailAddress,
): EmailProvider {
  const client = new SESv2Client({
    region: String(config.region),
    credentials: {
      accessKeyId: String(config.access_key_id),
      secretAccessKey: String(config.secret_access_key),
    },
  });

  return {
    async send(message: EmailMessage) {
      try {
        const out = await client.send(new SendEmailCommand({
          FromEmailAddress: message.from.name
            ? `${message.from.name} <${message.from.email}>`
            : message.from.email,
          Destination: { ToAddresses: message.to, CcAddresses: message.cc },
          ReplyToAddresses: message.replyTo ? [message.replyTo] : undefined,
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: message.text, Charset: "UTF-8" },
                Html: { Data: message.html, Charset: "UTF-8" },
              },
            },
          },
        }));
        return { providerMessageId: out.MessageId ?? "" };
      } catch (err) {
        throw new EmailSendError("ses", null, `SES send failed: ${(err as Error).message}`);
      }
    },
  };
}
```

> **Note on SES attachments:** the `Simple` content shape cannot carry attachments.
> Scheduled reports (Task 18) therefore build a raw MIME message for SES. Implement that
> in Task 18 where an attachment first exists; a `Simple` send is correct for every
> notification in Tasks 13–15.

- [ ] **Step 6: Write the migration**

`api/migrations/006_email.sql`:

```sql
CREATE TABLE email_providers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL,
  from_email  text NOT NULL,
  from_name   text,
  reply_to    text,
  priority    integer NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- secret values encrypted
  verified_at timestamptz,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_providers_type_chk CHECK (
    type IN ('smtp', 'sendgrid', 'ses', 'postmark', 'mailgun', 'resend')),
  UNIQUE (org_id, name)
);
CREATE INDEX email_providers_order_idx
  ON email_providers (org_id, active, priority);

CREATE TABLE email_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key        text NOT NULL,
  subject    text NOT NULL,
  html_body  text NOT NULL,
  text_body  text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

CREATE TABLE email_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id   uuid REFERENCES email_providers(id) ON DELETE SET NULL,
  to_addresses  text[] NOT NULL,
  cc_addresses  text[] NOT NULL DEFAULT '{}',
  subject       text NOT NULL,
  html_body     text NOT NULL,
  text_body     text NOT NULL,
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{filename, object_key, content_type}]
  template_key  text,
  event         text,
  status        text NOT NULL DEFAULT 'queued',
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  provider_message_id text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_messages_status_chk CHECK (
    status IN ('queued', 'sending', 'sent', 'failed', 'cancelled'))
);
-- The worker's claim query: due, not terminal, oldest first.
CREATE INDEX email_messages_due_idx
  ON email_messages (status, scheduled_for)
  WHERE status IN ('queued', 'sending');
CREATE INDEX email_messages_org_idx ON email_messages (org_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_providers', 'email_templates', 'email_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON email_providers, email_templates, email_messages TO ams_app;
```

- [ ] **Step 7: Implement the provider domain module**

`api/src/lib/domain/emailProviders.ts`:

```ts
import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { sealConfig, openConfig, maskConfig } from "../crypto/secrets";
import {
  PROVIDER_TYPES, CONFIG_SCHEMAS, SECRET_KEYS, type ProviderType,
} from "../email/providers";

export const ProviderInput = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(PROVIDER_TYPES),
  from_email: z.string().email(),
  from_name: z.string().max(80).nullish(),
  reply_to: z.string().email().nullish(),
  priority: z.number().int().min(1).max(1000).default(100),
  active: z.boolean().default(true),
  config: z.record(z.unknown()),
}).superRefine((value, ctx) => {
  const schema = CONFIG_SCHEMAS[value.type as ProviderType];
  const parsed = schema.safeParse(value.config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["config", ...issue.path],
        message: issue.message,
      });
    }
  }
});
export type ProviderInput = z.infer<typeof ProviderInput>;

export interface StoredProvider {
  id: string;
  name: string;
  type: ProviderType;
  from_email: string;
  from_name: string | null;
  reply_to: string | null;
  priority: number;
  active: boolean;
  config: Record<string, unknown>;
  verified_at: string | null;
  last_error: string | null;
}

const SELECT = `
  SELECT id, name, type, from_email, from_name, reply_to, priority, active,
         config, verified_at, last_error
    FROM email_providers`;

/** Reads always mask secrets — the plaintext never leaves the server. */
const mask = (row: StoredProvider): StoredProvider => ({
  ...row,
  config: maskConfig(row.config, SECRET_KEYS[row.type]),
});

export const listProviders = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<StoredProvider>(`${SELECT} ORDER BY priority, name`)).rows.map(mask),
  );

export const createProvider = (ctx: Ctx, input: ProviderInput) =>
  withTenant(ctx.orgId, async (c) =>
    mask((await c.query<StoredProvider>(
      `INSERT INTO email_providers
         (org_id, name, type, from_email, from_name, reply_to, priority, active, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, name, type, from_email, from_name, reply_to, priority,
                 active, config, verified_at, last_error`,
      [
        ctx.orgId, input.name, input.type, input.from_email, input.from_name ?? null,
        input.reply_to ?? null, input.priority, input.active,
        JSON.stringify(sealConfig(input.config, SECRET_KEYS[input.type])),
      ],
    )).rows[0]),
  );

export function updateProvider(ctx: Ctx, id: string, patch: Partial<ProviderInput>) {
  return withTenant(ctx.orgId, async (c) => {
    const existing = (await c.query<StoredProvider>(`${SELECT} WHERE id = $1`, [id])).rows[0];
    if (!existing) return null;

    const type = (patch.type ?? existing.type) as ProviderType;
    // A config patch merges into the stored config, so the UI can save without
    // re-sending a secret it only ever received masked.
    const config = patch.config
      ? sealConfig(
          { ...openConfig(existing.config, SECRET_KEYS[existing.type]), ...patch.config },
          SECRET_KEYS[type],
        )
      : existing.config;

    const { rows } = await c.query<StoredProvider>(
      `UPDATE email_providers SET
         name       = coalesce($2, name),
         type       = coalesce($3, type),
         from_email = coalesce($4, from_email),
         from_name  = coalesce($5, from_name),
         reply_to   = coalesce($6, reply_to),
         priority   = coalesce($7, priority),
         active     = coalesce($8, active),
         config     = $9
       WHERE id = $1
       RETURNING id, name, type, from_email, from_name, reply_to, priority,
                 active, config, verified_at, last_error`,
      [
        id, patch.name ?? null, patch.type ?? null, patch.from_email ?? null,
        patch.from_name ?? null, patch.reply_to ?? null, patch.priority ?? null,
        patch.active ?? null, JSON.stringify(config),
      ],
    );
    return mask(rows[0]);
  });
}

export const deleteProvider = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query("DELETE FROM email_providers WHERE id = $1 RETURNING id", [id]))
      .rowCount === 1,
  );

/** Decrypted, priority-ordered. Used only by the sender — never by a route handler. */
export const getActiveProviders = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<StoredProvider>(
      `${SELECT} WHERE active = true ORDER BY priority, created_at`,
    )).rows.map((row) => ({
      ...row,
      config: openConfig(row.config, SECRET_KEYS[row.type]),
    })),
  );
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/crypto src/lib/email`
Expected: PASS, 16 tests.

- [ ] **Step 9: Commit**

```bash
git add api/migrations/006_email.sql api/src/lib/crypto api/src/lib/email api/src/lib/domain/emailProviders.ts api/package.json
git commit -m "feat: encrypted secrets and six pluggable email provider adapters"
```

---

### Task 13: Templates, the outbox worker and provider failover

**Files:**
- Create: `api/src/lib/email/templates.ts`, `api/src/lib/email/outbox.ts`, `api/src/lib/email/sender.ts`
- Create: `api/src/app/api/admin/email/providers/route.ts`, `api/src/app/api/admin/email/providers/[id]/route.ts`, `api/src/app/api/admin/email/providers/[id]/test/route.ts`, `api/src/app/api/admin/email/templates/route.ts`, `api/src/app/api/admin/email/messages/route.ts`
- Test: `api/src/lib/email/templates.test.ts`, `api/src/lib/email/outbox.test.ts`

**Interfaces:**
- Consumes: `getActiveProviders`, `buildProvider`, `withTenant`.
- Produces:
  - `render(template, vars): { subject, html, text }` — `{{a.b}}` substitution with `| date`, `| datetime`, `| money` filters, HTML-escaped by default
  - `SEED_TEMPLATES: Record<string, { subject, html_body, text_body }>` — the ten defaults from spec §9.3
  - `getTemplate(ctx, key)` — org override, falling back to the seeded default
  - `enqueue(ctx, { to, cc?, subject, html, text, templateKey?, event?, attachments?, scheduledFor? }): Promise<string>`
  - `enqueueTemplated(ctx, templateKey, to, vars, opts?): Promise<string>`
  - `processOutbox(ctx, limit): Promise<{ sent: number; failed: number }>` — claims due messages, walks providers by priority, retries with backoff
  - `sendTestEmail(ctx, providerId, to): Promise<{ ok: boolean; error?: string }>`

**Design note (spec §9.2):** nothing calls a provider SDK from a request handler. Every
message is a row first, so a provider outage is a retry, not a lost notification.

- [ ] **Step 1: Write the failing tests**

`api/src/lib/email/templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { render, SEED_TEMPLATES } from "./templates";

describe("render", () => {
  const template = {
    subject: "{{asset.name}} is due back {{assignment.due_at | date}}",
    html_body: "<p>Hi {{user.name}}, please return {{asset.name}}.</p>",
    text_body: "Hi {{user.name}}, please return {{asset.name}}.",
  };
  const vars = {
    asset: { name: "Dell Latitude" },
    user: { name: "Rina" },
    assignment: { due_at: "2026-10-14T09:00:00Z" },
  };

  it("substitutes nested variables", () => {
    const out = render(template, vars);
    expect(out.text).toBe("Hi Rina, please return Dell Latitude.");
  });

  it("applies the date filter", () => {
    expect(render(template, vars).subject).toBe("Dell Latitude is due back 14 Oct 2026");
  });

  it("renders a missing variable as an empty string, never as the raw token", () => {
    const out = render({ ...template, text_body: "Hello {{nobody.here}}!" }, vars);
    expect(out.text).toBe("Hello !");
  });

  it("escapes HTML in a variable so asset names cannot inject markup", () => {
    const out = render(
      { subject: "s", html_body: "<p>{{asset.name}}</p>", text_body: "{{asset.name}}" },
      { asset: { name: '<img src=x onerror="alert(1)">' } },
    );
    expect(out.html).toContain("&lt;img");
    expect(out.html).not.toContain("<img");
  });

  it("formats money with its currency", () => {
    const out = render(
      { subject: "s", html_body: "h", text_body: "{{asset.purchase_cost | money}}" },
      { asset: { purchase_cost: 1250000, currency: "IDR" } },
    );
    expect(out.text).toMatch(/1.250.000|1,250,000/);
  });
});

describe("SEED_TEMPLATES", () => {
  it("ships every template the notification rules reference", () => {
    expect(Object.keys(SEED_TEMPLATES).sort()).toEqual([
      "asset.checked_in", "asset.checked_out", "asset.overdue",
      "import.completed", "licence.expiring", "maintenance.due",
      "password.reset", "product.release", "report.scheduled",
      "user.invite", "warranty.expiring",
    ].sort());
  });

  it("gives every template a subject, an HTML body and a text body", () => {
    for (const [key, t] of Object.entries(SEED_TEMPLATES)) {
      expect(t.subject, key).toBeTruthy();
      expect(t.html_body, key).toBeTruthy();
      expect(t.text_body, key).toBeTruthy();
    }
  });
});
```

`api/src/lib/email/outbox.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createProvider } from "../domain/emailProviders";
import { enqueue, processOutbox } from "./outbox";

const orgId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: randomUUID(), label: "Admin", scopes: ["admin"] },
};

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'E',$2)", [
    orgId, `email-org-${orgId.slice(0, 8)}`,
  ]);
  await createProvider(ctx, {
    name: "Primary", type: "sendgrid", from_email: "ams@example.com",
    from_name: "AMS", priority: 10, active: true, config: { api_key: "SG.primary" },
  });
  await createProvider(ctx, {
    name: "Backup", type: "resend", from_email: "ams@example.com",
    from_name: "AMS", priority: 20, active: true, config: { api_key: "re_backup" },
  });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await pool.query("DELETE FROM email_messages WHERE org_id = $1", [orgId]);
});

const message = {
  to: ["rina@example.com"],
  subject: "Asset assigned",
  html: "<p>Hello</p>",
  text: "Hello",
};

describe("enqueue", () => {
  it("stores the message as queued and sends nothing yet", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const id = await enqueue(ctx, message);
    const { rows } = await pool.query(
      "SELECT status, attempts, to_addresses FROM email_messages WHERE id=$1", [id],
    );
    expect(rows[0]).toMatchObject({ status: "queued", attempts: 0 });
    expect(rows[0].to_addresses).toEqual(["rina@example.com"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("processOutbox", () => {
  it("sends a queued message through the highest-priority provider", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202, headers: { "x-message-id": "sg-9" } }),
    );
    const id = await enqueue(ctx, message);
    await expect(processOutbox(ctx, 10)).resolves.toEqual({ sent: 1, failed: 0 });

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.sendgrid.com/v3/mail/send");
    const { rows } = await pool.query(
      "SELECT status, provider_message_id, sent_at FROM email_messages WHERE id=$1", [id],
    );
    expect(rows[0]).toMatchObject({ status: "sent", provider_message_id: "sg-9" });
    expect(rows[0].sent_at).not.toBeNull();
  });

  it("falls through to the backup provider when the primary rejects", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("upstream down", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "re-9" }), { status: 200 }));

    const id = await enqueue(ctx, message);
    await expect(processOutbox(ctx, 10)).resolves.toEqual({ sent: 1, failed: 0 });

    expect(fetchMock.mock.calls[1][0]).toBe("https://api.resend.com/emails");
    const { rows } = await pool.query(
      "SELECT status, provider_message_id FROM email_messages WHERE id=$1", [id],
    );
    expect(rows[0]).toMatchObject({ status: "sent", provider_message_id: "re-9" });
  });

  it("re-queues with a backoff when every provider fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const id = await enqueue(ctx, message);
    await expect(processOutbox(ctx, 10)).resolves.toEqual({ sent: 0, failed: 1 });

    const { rows } = await pool.query(
      `SELECT status, attempts, last_error, scheduled_for > now() AS deferred
         FROM email_messages WHERE id=$1`, [id],
    );
    expect(rows[0]).toMatchObject({ status: "queued", attempts: 1, deferred: true });
    expect(rows[0].last_error).toContain("500");
  });

  it("gives up after five attempts and marks the message failed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const id = await enqueue(ctx, message);
    await pool.query(
      "UPDATE email_messages SET attempts = 4 WHERE id = $1", [id],
    );
    await processOutbox(ctx, 10);
    const { rows } = await pool.query(
      "SELECT status FROM email_messages WHERE id=$1", [id],
    );
    expect(rows[0].status).toBe("failed");
  });

  it("ignores a message scheduled for the future", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await enqueue(ctx, {
      ...message,
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await expect(processOutbox(ctx, 10)).resolves.toEqual({ sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when the org has no active provider", async () => {
    const emptyOrg = randomUUID();
    await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'N',$2)", [
      emptyOrg, `noprov-${emptyOrg.slice(0, 8)}`,
    ]);
    const emptyCtx: Ctx = { ...ctx, orgId: emptyOrg };
    const id = await enqueue(emptyCtx, message);
    await processOutbox(emptyCtx, 10);
    const { rows } = await pool.query(
      "SELECT status, last_error FROM email_messages WHERE id=$1", [id],
    );
    expect(rows[0].last_error).toMatch(/no active email provider/i);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && npx vitest run src/lib/email/templates.test.ts src/lib/email/outbox.test.ts`
Expected: FAIL — `Cannot find module './templates'`.

- [ ] **Step 3: Implement template rendering**

`api/src/lib/email/templates.ts`:

```ts
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";

export interface Template {
  subject: string;
  html_body: string;
  text_body: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]!);

function resolve(vars: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (acc, key) =>
      acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
    vars,
  );
}

function applyFilter(value: unknown, filter: string, vars: Record<string, unknown>): string {
  if (value === null || value === undefined) return "";
  switch (filter) {
    case "date":
      return new Date(String(value)).toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
      });
    case "datetime":
      return new Date(String(value)).toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "UTC",
      });
    case "money": {
      const currency =
        String((resolve(vars, "asset.currency") ?? resolve(vars, "currency")) || "IDR");
      return new Intl.NumberFormat("id-ID", {
        style: "currency", currency, maximumFractionDigits: 0,
      }).format(Number(value));
    }
    default:
      return String(value);
  }
}

const TOKEN = /\{\{\s*([a-z0-9_.]+)\s*(?:\|\s*([a-z]+)\s*)?\}\}/gi;

function fill(
  template: string,
  vars: Record<string, unknown>,
  escape: boolean,
): string {
  return template.replace(TOKEN, (_match, path: string, filter?: string) => {
    const raw = resolve(vars, path);
    const value = filter ? applyFilter(raw, filter, vars) : String(raw ?? "");
    return escape ? escapeHtml(value) : value;
  });
}

/**
 * Substitution only — no expressions, no loops, no code execution. A template is
 * editable by an org admin, so it must not be a scripting surface.
 */
export function render(
  template: Template,
  vars: Record<string, unknown>,
): { subject: string; html: string; text: string } {
  return {
    subject: fill(template.subject, vars, false),
    html: fill(template.html_body, vars, true),
    text: fill(template.text_body, vars, false),
  };
}

const layout = (body: string) => `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;
            max-width:560px;margin:0 auto;padding:24px;color:#1f2937">
  ${body}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:12px;color:#6b7280">
    Sent by {{org.name}} Asset Management.
  </p>
</div>`.trim();

export const SEED_TEMPLATES: Record<string, Template> = {
  "asset.checked_out": {
    subject: "{{asset.name}} has been assigned to you",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Asset assigned</h2>
      <p>Hi {{recipient.name}}, <strong>{{asset.name}}</strong>
         ({{asset.asset_tag}}) is now assigned to you.</p>
      <p>Due back: <strong>{{assignment.due_at | date}}</strong></p>
      <p><a href="{{links.asset}}">View the asset</a></p>`),
    text_body:
      "Hi {{recipient.name}}, {{asset.name}} ({{asset.asset_tag}}) is now assigned to you.\n" +
      "Due back: {{assignment.due_at | date}}\n{{links.asset}}",
  },
  "asset.checked_in": {
    subject: "{{asset.name}} has been returned",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Asset returned</h2>
      <p><strong>{{asset.name}}</strong> ({{asset.asset_tag}}) was checked in by
         {{actor.name}} on {{assignment.checked_in_at | datetime}}.</p>
      <p>Condition: {{assignment.condition}}</p>`),
    text_body:
      "{{asset.name}} ({{asset.asset_tag}}) was checked in by {{actor.name}} " +
      "on {{assignment.checked_in_at | datetime}}. Condition: {{assignment.condition}}",
  },
  "asset.overdue": {
    subject: "Overdue: {{asset.name}} was due {{assignment.due_at | date}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px;color:#b91c1c">Asset overdue</h2>
      <p><strong>{{asset.name}}</strong> ({{asset.asset_tag}}) was due back on
         {{assignment.due_at | date}} and has not been returned.</p>
      <p><a href="{{links.asset}}">Check it in</a></p>`),
    text_body:
      "{{asset.name}} ({{asset.asset_tag}}) was due back on " +
      "{{assignment.due_at | date}} and has not been returned. {{links.asset}}",
  },
  "warranty.expiring": {
    subject: "Warranty expiring: {{asset.name}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Warranty expiring</h2>
      <p>The warranty on <strong>{{asset.name}}</strong> ({{asset.asset_tag}})
         expires on {{asset.custom.warranty_end | date}}.</p>`),
    text_body:
      "The warranty on {{asset.name}} ({{asset.asset_tag}}) expires on " +
      "{{asset.custom.warranty_end | date}}.",
  },
  "licence.expiring": {
    subject: "Licence expiring: {{asset.name}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Licence expiring</h2>
      <p>The licence for <strong>{{asset.name}}</strong> expires on
         {{asset.custom.license_expiry | date}}.</p>
      <p>Rights holder: {{asset.custom.rights_holder}}</p>`),
    text_body:
      "The licence for {{asset.name}} expires on {{asset.custom.license_expiry | date}}. " +
      "Rights holder: {{asset.custom.rights_holder}}",
  },
  "maintenance.due": {
    subject: "Service due: {{asset.name}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Maintenance due</h2>
      <p><strong>{{asset.name}}</strong> ({{asset.asset_tag}}) is due for service on
         {{asset.custom.next_service_at | date}}.</p>
      <p>Hours run: {{asset.custom.hours_run}}</p>`),
    text_body:
      "{{asset.name}} ({{asset.asset_tag}}) is due for service on " +
      "{{asset.custom.next_service_at | date}}. Hours run: {{asset.custom.hours_run}}",
  },
  "import.completed": {
    subject: "Import finished: {{import.filename}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Import finished</h2>
      <p>{{import.filename}} processed {{import.total}} rows:
         {{import.created}} created, {{import.updated}} updated,
         {{import.skipped}} skipped.</p>
      <p><a href="{{links.import}}">View the result</a></p>`),
    text_body:
      "{{import.filename}} processed {{import.total}} rows: {{import.created}} created, " +
      "{{import.updated}} updated, {{import.skipped}} skipped. {{links.import}}",
  },
  "report.scheduled": {
    subject: "{{report.name}} — {{report.generated_at | date}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">{{report.name}}</h2>
      <p>Your scheduled report is attached as {{report.format}}.</p>
      <p>Covering: {{report.period}}</p>
      <p><a href="{{links.report}}">Open it in the dashboard</a></p>`),
    text_body:
      "{{report.name}} is attached as {{report.format}}. Covering: {{report.period}}. " +
      "{{links.report}}",
  },
  "user.invite": {
    subject: "You have been invited to {{org.name}} Asset Management",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Welcome</h2>
      <p>{{actor.name}} has invited you to {{org.name}} Asset Management
         as a {{recipient.role}}.</p>
      <p><a href="{{links.invite}}">Set your password</a></p>
      <p style="font-size:12px;color:#6b7280">This link expires in 72 hours.</p>`),
    text_body:
      "{{actor.name}} has invited you to {{org.name}} Asset Management as a " +
      "{{recipient.role}}. Set your password: {{links.invite}} (expires in 72 hours)",
  },
  "password.reset": {
    subject: "Reset your password",
    html_body: layout(`
      <h2 style="margin:0 0 16px">Password reset</h2>
      <p>Use the link below to choose a new password.</p>
      <p><a href="{{links.reset}}">Reset password</a></p>
      <p style="font-size:12px;color:#6b7280">
        This link expires in 1 hour. If you did not request it, ignore this email.</p>`),
    text_body:
      "Use this link to choose a new password: {{links.reset}} " +
      "(expires in 1 hour). If you did not request it, ignore this email.",
  },
  "product.release": {
    subject: "What's new in {{release.version}}",
    html_body: layout(`
      <h2 style="margin:0 0 16px">{{release.title}}</h2>
      <p>Version {{release.version}} is live.</p>
      <p>{{release.summary}}</p>
      <p><a href="{{links.whats_new}}">See everything that changed</a></p>`),
    text_body:
      "{{release.title}} — version {{release.version}} is live. {{release.summary}} " +
      "{{links.whats_new}}",
  },
};

/** An org's override if it has one, otherwise the shipped default. */
export async function getTemplate(ctx: Ctx, key: string): Promise<Template> {
  const override = await withTenant(ctx.orgId, async (c) =>
    (await c.query<Template>(
      "SELECT subject, html_body, text_body FROM email_templates WHERE key = $1", [key],
    )).rows[0],
  );
  const seed = SEED_TEMPLATES[key];
  if (!override && !seed) throw new Error(`unknown email template: ${key}`);
  return override ?? seed;
}

export const listTemplates = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) => {
    const overrides = new Map(
      (await c.query<{ key: string } & Template>(
        "SELECT key, subject, html_body, text_body FROM email_templates",
      )).rows.map((r) => [r.key, r]),
    );
    return Object.entries(SEED_TEMPLATES).map(([key, seed]) => ({
      key,
      customised: overrides.has(key),
      ...(overrides.get(key) ?? seed),
    }));
  });

export const upsertTemplate = (ctx: Ctx, key: string, template: Template) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Template>(
      `INSERT INTO email_templates (org_id, key, subject, html_body, text_body)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (org_id, key) DO UPDATE SET
         subject = excluded.subject,
         html_body = excluded.html_body,
         text_body = excluded.text_body,
         updated_at = now()
       RETURNING subject, html_body, text_body`,
      [ctx.orgId, key, template.subject, template.html_body, template.text_body],
    )).rows[0],
  );
```

- [ ] **Step 4: Implement the outbox and sender**

`api/src/lib/email/outbox.ts`:

```ts
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { getActiveProviders } from "../domain/emailProviders";
import { buildProvider } from "./providers";
import { getTemplate, render } from "./templates";
import { readAttachmentBody } from "../domain/attachments";
import type { EmailAttachment } from "./types";

const MAX_ATTEMPTS = 5;
/** 1 min, 5 min, 15 min, 1 h, 6 h — long enough to outlast a provider incident. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 360];

export interface EnqueueInput {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  templateKey?: string;
  event?: string;
  attachments?: { filename: string; object_key: string; content_type: string }[];
  scheduledFor?: string;
}

export async function enqueue(ctx: Ctx, input: EnqueueInput): Promise<string> {
  return withTenant(ctx.orgId, async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO email_messages
         (org_id, to_addresses, cc_addresses, subject, html_body, text_body,
          template_key, event, attachments, scheduled_for)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, coalesce($10::timestamptz, now()))
       RETURNING id`,
      [
        ctx.orgId, input.to, input.cc ?? [], input.subject, input.html, input.text,
        input.templateKey ?? null, input.event ?? null,
        JSON.stringify(input.attachments ?? []), input.scheduledFor ?? null,
      ],
    )).rows[0].id,
  );
}

export async function enqueueTemplated(
  ctx: Ctx,
  templateKey: string,
  to: string[],
  vars: Record<string, unknown>,
  opts: { cc?: string[]; event?: string; attachments?: EnqueueInput["attachments"];
          scheduledFor?: string } = {},
): Promise<string> {
  const rendered = render(await getTemplate(ctx, templateKey), vars);
  return enqueue(ctx, {
    to, cc: opts.cc, ...rendered, templateKey,
    event: opts.event ?? templateKey,
    attachments: opts.attachments, scheduledFor: opts.scheduledFor,
  });
}

interface QueuedMessage {
  id: string;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string;
  html_body: string;
  text_body: string;
  attachments: { filename: string; object_key: string; content_type: string }[];
  attempts: number;
}

/**
 * Claims due messages and sends them, walking providers by priority so a failing
 * primary degrades to a backup instead of dropping the notification.
 */
export async function processOutbox(
  ctx: Ctx,
  limit = 25,
): Promise<{ sent: number; failed: number }> {
  // SKIP LOCKED lets several workers run without sending the same message twice.
  const claimed = await withTenant(ctx.orgId, async (c) =>
    (await c.query<QueuedMessage>(
      `UPDATE email_messages SET status = 'sending'
        WHERE id IN (
          SELECT id FROM email_messages
           WHERE status = 'queued' AND scheduled_for <= now()
           ORDER BY scheduled_for
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, to_addresses, cc_addresses, subject, html_body,
                  text_body, attachments, attempts`,
      [limit],
    )).rows,
  );
  if (claimed.length === 0) return { sent: 0, failed: 0 };

  const providers = await getActiveProviders(ctx);
  let sent = 0;
  let failed = 0;

  for (const message of claimed) {
    if (providers.length === 0) {
      await defer(ctx, message, "No active email provider is configured.");
      failed++;
      continue;
    }

    const attachments: EmailAttachment[] = await Promise.all(
      message.attachments.map(async (a) => ({
        filename: a.filename,
        contentType: a.content_type,
        content: await readAttachmentBody(a.object_key),
      })),
    );

    let lastError = "";
    let delivered = false;

    for (const stored of providers) {
      try {
        const provider = buildProvider(stored.type, stored.config, {
          email: stored.from_email,
          name: stored.from_name ?? undefined,
        });
        const { providerMessageId } = await provider.send({
          to: message.to_addresses,
          cc: message.cc_addresses.length ? message.cc_addresses : undefined,
          subject: message.subject,
          html: message.html_body,
          text: message.text_body,
          from: { email: stored.from_email, name: stored.from_name ?? undefined },
          replyTo: stored.reply_to ?? undefined,
          attachments: attachments.length ? attachments : undefined,
        });

        await withTenant(ctx.orgId, (c) =>
          c.query(
            `UPDATE email_messages SET
               status = 'sent', sent_at = now(), provider_id = $2,
               provider_message_id = $3, attempts = attempts + 1, last_error = NULL
             WHERE id = $1`,
            [message.id, stored.id, providerMessageId],
          ),
        );
        await withTenant(ctx.orgId, (c) =>
          c.query("UPDATE email_providers SET last_error = NULL WHERE id = $1", [stored.id]),
        );
        delivered = true;
        sent++;
        break;
      } catch (err) {
        lastError = (err as Error).message;
        await withTenant(ctx.orgId, (c) =>
          c.query("UPDATE email_providers SET last_error = $2 WHERE id = $1",
            [stored.id, lastError]),
        );
      }
    }

    if (!delivered) {
      await defer(ctx, message, lastError);
      failed++;
    }
  }

  return { sent, failed };
}

/** Re-queue with backoff, or give up once the attempt budget is spent. */
async function defer(ctx: Ctx, message: QueuedMessage, error: string): Promise<void> {
  const attempts = message.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];

  await withTenant(ctx.orgId, (c) =>
    c.query(
      `UPDATE email_messages SET
         status = $2,
         attempts = $3,
         last_error = $4,
         scheduled_for = now() + ($5 || ' minutes')::interval
       WHERE id = $1`,
      [message.id, exhausted ? "failed" : "queued", attempts, error, String(wait)],
    ),
  );
}

export const listMessages = (ctx: Ctx, limit = 100) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query(
      `SELECT m.id, m.to_addresses, m.subject, m.status, m.attempts, m.last_error,
              m.template_key, m.event, m.sent_at, m.created_at, p.name AS provider_name
         FROM email_messages m
         LEFT JOIN email_providers p ON p.id = m.provider_id
        ORDER BY m.created_at DESC
        LIMIT $1`,
      [limit],
    )).rows,
  );
```

`api/src/lib/email/sender.ts`:

```ts
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { getActiveProviders } from "../domain/emailProviders";
import { buildProvider } from "./providers";

/**
 * Sends immediately through one named provider and records the outcome. This is the
 * only path that bypasses the outbox, because its whole purpose is to tell an admin
 * whether the credentials they just typed actually work.
 */
export async function sendTestEmail(
  ctx: Ctx,
  providerId: string,
  to: string,
): Promise<{ ok: boolean; error?: string }> {
  const stored = (await getActiveProviders(ctx)).find((p) => p.id === providerId);
  if (!stored) return { ok: false, error: "Provider not found or inactive." };

  try {
    const provider = buildProvider(stored.type, stored.config, {
      email: stored.from_email,
      name: stored.from_name ?? undefined,
    });
    await provider.send({
      to: [to],
      subject: `Test email from ${stored.name}`,
      html:
        "<p>This is a test message from your Asset Management System.</p>" +
        `<p>Provider: <strong>${stored.name}</strong> (${stored.type})</p>`,
      text:
        "This is a test message from your Asset Management System. " +
        `Provider: ${stored.name} (${stored.type})`,
      from: { email: stored.from_email, name: stored.from_name ?? undefined },
      replyTo: stored.reply_to ?? undefined,
    });

    await withTenant(ctx.orgId, (c) =>
      c.query(
        "UPDATE email_providers SET verified_at = now(), last_error = NULL WHERE id = $1",
        [providerId],
      ),
    );
    return { ok: true };
  } catch (err) {
    const error = (err as Error).message;
    await withTenant(ctx.orgId, (c) =>
      c.query("UPDATE email_providers SET last_error = $2 WHERE id = $1",
        [providerId, error]),
    );
    return { ok: false, error };
  }
}
```

- [ ] **Step 5: Implement the admin route handlers**

`api/src/app/api/admin/email/providers/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, conflict } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listProviders, createProvider, ProviderInput } from "@/lib/domain/emailProviders";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listProviders(ctx) });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = ProviderInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  try {
    return Response.json(await createProvider(ctx, parsed.data), { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return conflict("A provider with that name already exists.");
    }
    throw err;
  }
});
```

`api/src/app/api/admin/email/providers/[id]/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { updateProvider, deleteProvider, ProviderInput } from "@/lib/domain/emailProviders";

type Params = { params: Promise<{ id: string }> };

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  // `.partial()` on the refined schema: validate the config only when one is sent.
  const parsed = ProviderInput._def.schema.partial().safeParse(
    await req.json().catch(() => ({})),
  );
  if (!parsed.success) return validationProblem(parsed.error);
  const updated = await updateProvider(ctx, (await params).id, parsed.data);
  return updated ? Response.json(updated) : notFound("email provider");
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const done = await deleteProvider(ctx, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("email provider");
});
```

`api/src/app/api/admin/email/providers/[id]/test/route.ts`:

```ts
import { z } from "zod";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { sendTestEmail } from "@/lib/email/sender";

const Body = z.object({ to: z.string().email() });

export const POST = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const result = await sendTestEmail(ctx, (await params).id, parsed.data.to);
  // A failed test is a successful diagnostic, not a server error — return the reason.
  return Response.json(result, { status: result.ok ? 200 : 422 });
});
```

`api/src/app/api/admin/email/templates/route.ts`:

```ts
import { z } from "zod";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listTemplates, upsertTemplate, SEED_TEMPLATES } from "@/lib/email/templates";

const Body = z.object({
  key: z.string().refine((k) => k in SEED_TEMPLATES, "unknown template key"),
  subject: z.string().min(1).max(300),
  html_body: z.string().min(1),
  text_body: z.string().min(1),
});

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listTemplates(ctx) });
});

export const PUT = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  const { key, ...template } = parsed.data;
  return Response.json(await upsertTemplate(ctx, key, template));
});
```

`api/src/app/api/admin/email/messages/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { listMessages } from "@/lib/email/outbox";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 100), 500);
  return Response.json({ data: await listMessages(ctx, limit) });
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/email`
Expected: PASS — 7 template tests, 7 outbox tests, plus the 7 provider tests from Task 12.

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/email api/src/app/api/admin/email
git commit -m "feat: email templates, outbox worker and provider failover"
```

---

### Task 14: Notification rules and recipient resolution

**Files:**
- Create: `api/migrations/007_notifications.sql`
- Create: `api/src/lib/notify/recipients.ts`, `api/src/lib/notify/rules.ts`, `api/src/lib/notify/dispatch.ts`
- Modify: `api/src/lib/domain/assignments.ts` (fire `asset.checked_out` / `asset.checked_in`)
- Create: `api/src/app/api/admin/notifications/rules/route.ts`, `api/src/app/api/admin/notifications/rules/[id]/route.ts`, `api/src/app/api/admin/notifications/preferences/route.ts`
- Test: `api/src/lib/notify/dispatch.test.ts`

**Interfaces:**
- Consumes: `enqueueTemplated`, `withTenant`, `Ctx`.
- Produces:
  - `NOTIFICATION_EVENTS` — the eight events from spec §9.4
  - `type RecipientSpec = { roles?: UserRole[]; user_ids?: string[]; emails?: string[]; assignee?: boolean; actor?: boolean }`
  - `resolveRecipients(ctx, spec, context): Promise<{ email: string; name: string; user_id: string | null }[]>` — deduplicated, honouring per-user preferences
  - `listRules(ctx)`, `createRule(ctx, input)`, `updateRule(ctx, id, patch)`, `deleteRule(ctx, id)`, `seedDefaultRules(ctx)`
  - `dispatch(ctx, event, context): Promise<{ queued: number }>` — the single entry point every feature calls

**Design note (spec §9.5):** `dispatch` writes to a channel. Email is implemented here;
webhooks (Task 33) become a second channel row in the same table rather than a parallel
system.

- [ ] **Step 1: Write the failing test**

`api/src/lib/notify/dispatch.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createAsset } from "../domain/assets";
import { checkOut } from "../domain/assignments";
import { createRule, seedDefaultRules } from "./rules";
import { resolveRecipients } from "./recipients";
import { dispatch } from "./dispatch";

const orgId = randomUUID();
const adminId = randomUUID();
const techId = randomUUID();
const viewerId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: adminId, label: "Admin", scopes: ["admin"] },
};
let assetId: string;

const email = (who: string) => `${who}-${orgId.slice(0, 8)}@example.com`;

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'N',$2)", [
    orgId, `notify-org-${orgId.slice(0, 8)}`,
  ]);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role) VALUES
       ($1,$4,$5,'x','Admin User','admin'),
       ($2,$4,$6,'x','Tech User','technician'),
       ($3,$4,$7,'x','Viewer User','viewer')`,
    [adminId, techId, viewerId, orgId, email("admin"), email("tech"), email("viewer")],
  );
  assetId = (await createAsset(ctx, { name: "Notified drill" })).id;
});

beforeEach(async () => {
  await pool.query("DELETE FROM email_messages WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM notification_rules WHERE org_id = $1", [orgId]);
});

describe("resolveRecipients", () => {
  it("resolves a role to every user holding it", async () => {
    const out = await resolveRecipients(ctx, { roles: ["admin"] }, {});
    expect(out.map((r) => r.email)).toEqual([email("admin")]);
  });

  it("resolves several roles at once", async () => {
    const out = await resolveRecipients(ctx, { roles: ["admin", "technician"] }, {});
    expect(out.map((r) => r.email).sort()).toEqual([email("admin"), email("tech")].sort());
  });

  it("resolves the assignee from the event context", async () => {
    const out = await resolveRecipients(ctx, { assignee: true }, { assigneeId: techId });
    expect(out.map((r) => r.email)).toEqual([email("tech")]);
  });

  it("includes literal email addresses", async () => {
    const out = await resolveRecipients(ctx, { emails: ["ops@vendor.com"] }, {});
    expect(out.map((r) => r.email)).toEqual(["ops@vendor.com"]);
  });

  it("deduplicates a user reached by two paths", async () => {
    const out = await resolveRecipients(
      ctx, { roles: ["admin"], user_ids: [adminId] }, {},
    );
    expect(out).toHaveLength(1);
  });

  it("omits a user who has turned the event off", async () => {
    await pool.query(
      `INSERT INTO notification_prefs (user_id, org_id, event, email_enabled)
       VALUES ($1,$2,'asset.overdue',false)`,
      [techId, orgId],
    );
    const out = await resolveRecipients(
      ctx, { roles: ["technician"] }, {}, "asset.overdue",
    );
    expect(out).toHaveLength(0);
  });
});

describe("dispatch", () => {
  it("queues an email for each recipient of a matching rule", async () => {
    await createRule(ctx, {
      event: "asset.overdue", channel: "email",
      template_key: "asset.overdue",
      recipient_spec: { roles: ["admin"] }, active: true,
    });
    const result = await dispatch(ctx, "asset.overdue", {
      asset: { name: "Notified drill", asset_tag: "AMS-000001" },
      assignment: { due_at: "2026-08-01T00:00:00Z" },
    });
    expect(result.queued).toBe(1);

    const { rows } = await pool.query(
      "SELECT to_addresses, subject, event FROM email_messages WHERE org_id=$1", [orgId],
    );
    expect(rows[0].to_addresses).toEqual([email("admin")]);
    expect(rows[0].subject).toContain("Notified drill");
    expect(rows[0].event).toBe("asset.overdue");
  });

  it("queues nothing when no rule matches the event", async () => {
    const result = await dispatch(ctx, "asset.overdue", { asset: { name: "x" } });
    expect(result.queued).toBe(0);
  });

  it("skips an inactive rule", async () => {
    await createRule(ctx, {
      event: "asset.overdue", channel: "email", template_key: "asset.overdue",
      recipient_spec: { roles: ["admin"] }, active: false,
    });
    await expect(dispatch(ctx, "asset.overdue", { asset: { name: "x" } }))
      .resolves.toEqual({ queued: 0 });
  });

  it("never throws when a template variable is missing", async () => {
    await createRule(ctx, {
      event: "asset.overdue", channel: "email", template_key: "asset.overdue",
      recipient_spec: { roles: ["admin"] }, active: true,
    });
    await expect(dispatch(ctx, "asset.overdue", {})).resolves.toEqual({ queued: 1 });
  });
});

describe("check-out fires a notification", () => {
  it("queues the assignee email when a rule exists", async () => {
    await createRule(ctx, {
      event: "asset.checked_out", channel: "email",
      template_key: "asset.checked_out",
      recipient_spec: { assignee: true }, active: true,
    });
    await checkOut(ctx, assetId, { assignee_type: "user", assignee_id: techId });

    const { rows } = await pool.query(
      "SELECT to_addresses FROM email_messages WHERE org_id=$1 AND event='asset.checked_out'",
      [orgId],
    );
    expect(rows[0].to_addresses).toEqual([email("tech")]);
  });
});

describe("seedDefaultRules", () => {
  it("creates one rule per default event and is safe to run twice", async () => {
    await seedDefaultRules(ctx);
    await seedDefaultRules(ctx);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM notification_rules WHERE org_id=$1", [orgId],
    );
    expect(rows[0].n).toBe(8);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/notify`
Expected: FAIL — `Cannot find module './rules'`.

- [ ] **Step 3: Write the migration**

`api/migrations/007_notifications.sql`:

```sql
CREATE TABLE notification_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event          text NOT NULL,
  channel        text NOT NULL DEFAULT 'email',
  template_key   text NOT NULL,
  recipient_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_rules_channel_chk CHECK (channel IN ('email', 'webhook')),
  UNIQUE (org_id, event, channel, template_key)
);
CREATE INDEX notification_rules_lookup_idx
  ON notification_rules (org_id, event, active);

CREATE TABLE notification_prefs (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event         text NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, event)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_rules', 'notification_prefs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON notification_rules, notification_prefs TO ams_app;
```

- [ ] **Step 4: Implement recipient resolution**

`api/src/lib/notify/recipients.ts`:

```ts
import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";

export const USER_ROLES = ["admin", "manager", "technician", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const RecipientSpec = z.object({
  roles: z.array(z.enum(USER_ROLES)).optional(),
  user_ids: z.array(z.string().uuid()).optional(),
  emails: z.array(z.string().email()).optional(),
  assignee: z.boolean().optional(),
  actor: z.boolean().optional(),
});
export type RecipientSpec = z.infer<typeof RecipientSpec>;

export interface Recipient {
  email: string;
  name: string;
  user_id: string | null;
}

export interface EventContext {
  assigneeId?: string | null;
  actorId?: string | null;
  [key: string]: unknown;
}

/**
 * Turns a rule's recipient spec into concrete addresses. Deduplicated by email, and
 * filtered by each user's per-event preference — a literal address is never filtered,
 * because nobody has a preference row for an external contact.
 */
export async function resolveRecipients(
  ctx: Ctx,
  spec: RecipientSpec,
  context: EventContext,
  event?: string,
): Promise<Recipient[]> {
  const userIds = new Set<string>(spec.user_ids ?? []);
  if (spec.assignee && context.assigneeId) userIds.add(context.assigneeId);
  if (spec.actor && context.actorId) userIds.add(context.actorId);

  const users = await withTenant(ctx.orgId, async (c) => {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (spec.roles?.length) {
      params.push(spec.roles);
      clauses.push(`role = ANY($${params.length}::user_role[])`);
    }
    if (userIds.size) {
      params.push([...userIds]);
      clauses.push(`id = ANY($${params.length}::uuid[])`);
    }
    if (clauses.length === 0) return [];

    // A user opts out per event; absence of a row means opted in.
    const prefFilter = event
      ? `AND NOT EXISTS (
           SELECT 1 FROM notification_prefs p
            WHERE p.user_id = u.id AND p.event = $${params.push(event)}
              AND p.email_enabled = false)`
      : "";

    return (await c.query<Recipient>(
      `SELECT u.email, u.name, u.id AS user_id
         FROM users u
        WHERE (${clauses.join(" OR ")}) ${prefFilter}`,
      params,
    )).rows;
  });

  const byEmail = new Map<string, Recipient>();
  for (const user of users) byEmail.set(user.email.toLowerCase(), user);
  for (const address of spec.emails ?? []) {
    const key = address.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, { email: address, name: address, user_id: null });
  }
  return [...byEmail.values()];
}
```

- [ ] **Step 5: Implement rules and dispatch**

`api/src/lib/notify/rules.ts`:

```ts
import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { RecipientSpec } from "./recipients";

export const NOTIFICATION_EVENTS = [
  "asset.checked_out", "asset.checked_in", "asset.overdue",
  "warranty.expiring", "licence.expiring", "maintenance.due",
  "import.completed", "report.scheduled",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const RuleInput = z.object({
  event: z.enum(NOTIFICATION_EVENTS),
  channel: z.enum(["email", "webhook"]).default("email"),
  template_key: z.string().min(1),
  recipient_spec: RecipientSpec,
  active: z.boolean().default(true),
});
export type RuleInput = z.infer<typeof RuleInput>;

export interface Rule {
  id: string;
  event: NotificationEvent;
  channel: "email" | "webhook";
  template_key: string;
  recipient_spec: RecipientSpec;
  active: boolean;
}

const SELECT = `
  SELECT id, event, channel, template_key, recipient_spec, active
    FROM notification_rules`;

export const listRules = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Rule>(`${SELECT} ORDER BY event, channel`)).rows,
  );

export const rulesFor = (ctx: Ctx, event: string, channel = "email") =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Rule>(
      `${SELECT} WHERE event = $1 AND channel = $2 AND active = true`,
      [event, channel],
    )).rows,
  );

export const createRule = (ctx: Ctx, input: RuleInput) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Rule>(
      `INSERT INTO notification_rules
         (org_id, event, channel, template_key, recipient_spec, active)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_id, event, channel, template_key) DO UPDATE SET
         recipient_spec = excluded.recipient_spec,
         active = excluded.active
       RETURNING id, event, channel, template_key, recipient_spec, active`,
      [
        ctx.orgId, input.event, input.channel, input.template_key,
        JSON.stringify(input.recipient_spec), input.active,
      ],
    )).rows[0],
  );

export const updateRule = (ctx: Ctx, id: string, patch: Partial<RuleInput>) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Rule>(
      `UPDATE notification_rules SET
         template_key   = coalesce($2, template_key),
         recipient_spec = coalesce($3, recipient_spec),
         active         = coalesce($4, active)
       WHERE id = $1
       RETURNING id, event, channel, template_key, recipient_spec, active`,
      [
        id, patch.template_key ?? null,
        patch.recipient_spec ? JSON.stringify(patch.recipient_spec) : null,
        patch.active ?? null,
      ],
    )).rows[0] ?? null,
  );

export const deleteRule = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query("DELETE FROM notification_rules WHERE id = $1 RETURNING id", [id]))
      .rowCount === 1,
  );

/** The defaults from spec §9.4. Idempotent — safe on every org creation and on upgrade. */
const DEFAULTS: RuleInput[] = [
  { event: "asset.checked_out", channel: "email", template_key: "asset.checked_out",
    recipient_spec: { assignee: true }, active: true },
  { event: "asset.checked_in", channel: "email", template_key: "asset.checked_in",
    recipient_spec: { actor: true }, active: true },
  { event: "asset.overdue", channel: "email", template_key: "asset.overdue",
    recipient_spec: { assignee: true, roles: ["admin", "manager"] }, active: true },
  { event: "warranty.expiring", channel: "email", template_key: "warranty.expiring",
    recipient_spec: { roles: ["admin", "manager"] }, active: true },
  { event: "licence.expiring", channel: "email", template_key: "licence.expiring",
    recipient_spec: { roles: ["admin", "manager"] }, active: true },
  { event: "maintenance.due", channel: "email", template_key: "maintenance.due",
    recipient_spec: { roles: ["technician", "manager"] }, active: true },
  { event: "import.completed", channel: "email", template_key: "import.completed",
    recipient_spec: { actor: true }, active: true },
  { event: "report.scheduled", channel: "email", template_key: "report.scheduled",
    recipient_spec: {}, active: true },
];

export async function seedDefaultRules(ctx: Ctx): Promise<void> {
  for (const rule of DEFAULTS) await createRule(ctx, rule);
}
```

`api/src/lib/notify/dispatch.ts`:

```ts
import type { Ctx } from "../http/handler";
import { enqueueTemplated } from "../email/outbox";
import { rulesFor } from "./rules";
import { resolveRecipients, type EventContext } from "./recipients";

const baseUrl = () => process.env.APP_BASE_URL ?? "http://localhost:3000";

/**
 * The single entry point for every notification in the system. Never throws — a
 * failed notification must not roll back the business action that caused it.
 */
export async function dispatch(
  ctx: Ctx,
  event: string,
  context: EventContext,
): Promise<{ queued: number }> {
  let queued = 0;
  try {
    const rules = await rulesFor(ctx, event, "email");
    if (rules.length === 0) return { queued: 0 };

    for (const rule of rules) {
      const recipients = await resolveRecipients(
        ctx, rule.recipient_spec, context, event,
      );
      for (const recipient of recipients) {
        await enqueueTemplated(
          ctx,
          rule.template_key,
          [recipient.email],
          {
            ...context,
            recipient,
            org: { name: ctx.actor.label },
            links: {
              asset: context.assetId ? `${baseUrl()}/assets/${context.assetId}` : baseUrl(),
              import: context.importId
                ? `${baseUrl()}/import/${context.importId}` : baseUrl(),
              report: `${baseUrl()}/reports`,
              whats_new: `${baseUrl()}/whats-new`,
            },
          },
          { event },
        );
        queued++;
      }
    }
  } catch (err) {
    console.error(`notification dispatch failed for ${event}:`, err);
  }
  return { queued };
}
```

- [ ] **Step 6: Fire the events from check-out and check-in**

In `api/src/lib/domain/assignments.ts`, add the import and one call at the end of each
function, **after** the transaction commits — a queued email must never be able to roll
back a completed check-out:

```ts
import { dispatch } from "../notify/dispatch";
```

At the end of `checkOut`, replace `return rows[0];` in the outer scope with:

```ts
  });

  await dispatch(ctx, "asset.checked_out", {
    assetId,
    assigneeId: input.assignee_type === "user" ? input.assignee_id ?? null : null,
    actorId: ctx.actor.type === "user" ? ctx.actor.id : null,
    asset: await getAssetSummary(ctx, assetId),
    assignment: assignment,
  });
  return assignment;
}
```

…where the transaction result is captured as `const assignment = await withTenant(...)`
and `getAssetSummary` is a small local helper:

```ts
const getAssetSummary = (ctx: Ctx, assetId: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query(
      "SELECT name, asset_tag, serial_no, custom FROM assets WHERE id = $1", [assetId],
    )).rows[0] ?? {},
  );
```

Apply the same shape to `checkIn`, dispatching `asset.checked_in` with
`actorId: ctx.actor.type === "user" ? ctx.actor.id : null`.

- [ ] **Step 7: Implement the admin route handlers**

`api/src/app/api/admin/notifications/rules/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listRules, createRule, RuleInput, NOTIFICATION_EVENTS } from "@/lib/notify/rules";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listRules(ctx), events: NOTIFICATION_EVENTS });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = RuleInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  return Response.json(await createRule(ctx, parsed.data), { status: 201 });
});
```

`api/src/app/api/admin/notifications/rules/[id]/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { updateRule, deleteRule, RuleInput } from "@/lib/notify/rules";

type Params = { params: Promise<{ id: string }> };

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = RuleInput.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  const updated = await updateRule(ctx, (await params).id, parsed.data);
  return updated ? Response.json(updated) : notFound("notification rule");
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const done = await deleteRule(ctx, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("notification rule");
});
```

`api/src/app/api/admin/notifications/preferences/route.ts`:

```ts
import { z } from "zod";
import { withTenant } from "@/lib/db";
import { readSession } from "@/lib/auth/session";
import { unauthorized, validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { NOTIFICATION_EVENTS } from "@/lib/notify/rules";

const Body = z.object({
  preferences: z.array(z.object({
    event: z.enum(NOTIFICATION_EVENTS),
    email_enabled: z.boolean(),
  })),
});

export const GET = safe(async (req: Request) => {
  const ctx = await readSession(req);
  if (!ctx) return unauthorized();
  const rows = await withTenant(ctx.orgId, async (c) =>
    (await c.query(
      "SELECT event, email_enabled FROM notification_prefs WHERE user_id = $1",
      [ctx.actor.id],
    )).rows,
  );
  const stored = new Map(rows.map((r) => [r.event, r.email_enabled]));
  return Response.json({
    data: NOTIFICATION_EVENTS.map((event) => ({
      event, email_enabled: stored.get(event) ?? true,
    })),
  });
});

export const PUT = safe(async (req: Request) => {
  const ctx = await readSession(req);
  if (!ctx) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  await withTenant(ctx.orgId, async (c) => {
    for (const pref of parsed.data.preferences) {
      await c.query(
        `INSERT INTO notification_prefs (user_id, org_id, event, email_enabled)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, event) DO UPDATE SET email_enabled = excluded.email_enabled`,
        [ctx.actor.id, ctx.orgId, pref.event, pref.email_enabled],
      );
    }
  });
  return new Response(null, { status: 204 });
});
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/notify`
Expected: PASS, 12 tests.

- [ ] **Step 9: Commit**

```bash
git add api/migrations/007_notifications.sql api/src/lib/notify api/src/lib/domain/assignments.ts api/src/app/api/admin/notifications
git commit -m "feat: notification rules, recipient resolution and event dispatch"
```

---

### Task 15: Scheduled jobs — overdue, expiry, maintenance due

**Files:**
- Create: `api/src/lib/jobs/overdue.ts`, `api/src/lib/jobs/expiring.ts`, `api/src/lib/jobs/runner.ts`
- Create: `api/scripts/jobs.ts`
- Modify: `docker-compose.yml` (add the `jobs` service)
- Test: `api/src/lib/jobs/jobs.test.ts`

**Interfaces:**
- Consumes: `dispatch`, `processOutbox`, `withTenant`.
- Produces:
  - `findOverdue(ctx): Promise<OverdueRow[]>` — open assignments past `due_at`
  - `runOverdueJob(ctx): Promise<{ notified: number }>` — dispatches once per assignment per day
  - `findExpiring(ctx, field, days)` — reads a date out of `custom`
  - `runExpiryJobs(ctx): Promise<{ warranty: number; licence: number; maintenance: number }>`
  - `runAllJobs(): Promise<void>` — iterates every organisation, then drains the outbox

**Design note:** the notification is de-duplicated by looking for an `audit_events` row
of the same kind on the same day. An overdue asset must generate one email a day, not
one per job tick.

- [ ] **Step 1: Write the failing test**

`api/src/lib/jobs/jobs.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createAsset } from "../domain/assets";
import { checkOut } from "../domain/assignments";
import { createCategory } from "../domain/categories";
import { createRule } from "../notify/rules";
import { findOverdue, runOverdueJob } from "./overdue";
import { findExpiring, runExpiryJobs } from "./expiring";

const orgId = randomUUID();
const userId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: userId, label: "Ops", scopes: ["admin"] },
};
let categoryId: string;

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'J',$2)", [
    orgId, `jobs-org-${orgId.slice(0, 8)}`,
  ]);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,'x','Ops','admin')`,
    [userId, orgId, `jobs-${orgId.slice(0, 8)}@example.com`],
  );
  categoryId = (await createCategory(ctx, {
    name: "IT", kind: "it",
    field_schema: { fields: [
      { key: "warranty_end", label: "Warranty End", type: "date", required: false },
      { key: "license_expiry", label: "Licence Expiry", type: "date", required: false },
      { key: "next_service_at", label: "Next Service", type: "date", required: false },
    ] },
  })).id;

  for (const event of ["asset.overdue", "warranty.expiring",
                       "licence.expiring", "maintenance.due"] as const) {
    await createRule(ctx, {
      event, channel: "email", template_key: event,
      recipient_spec: { roles: ["admin"] }, active: true,
    });
  }
});

beforeEach(async () => {
  await pool.query("DELETE FROM email_messages WHERE org_id=$1", [orgId]);
});

describe("findOverdue", () => {
  it("finds an open assignment past its due date", async () => {
    const asset = await createAsset(ctx, { name: "Late laptop" });
    await checkOut(ctx, asset.id, {
      assignee_type: "user", assignee_id: userId,
      due_at: "2026-08-01T00:00:00Z",
    });
    const overdue = await findOverdue(ctx);
    expect(overdue.map((o) => o.asset_name)).toContain("Late laptop");
    expect(overdue[0].days_late).toBeGreaterThan(0);
  });

  it("ignores an assignment with no due date", async () => {
    const asset = await createAsset(ctx, { name: "Open-ended" });
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    const overdue = await findOverdue(ctx);
    expect(overdue.map((o) => o.asset_name)).not.toContain("Open-ended");
  });

  it("ignores an assignment already checked back in", async () => {
    const asset = await createAsset(ctx, { name: "Returned late" });
    await checkOut(ctx, asset.id, {
      assignee_type: "user", assignee_id: userId, due_at: "2026-08-01T00:00:00Z",
    });
    await pool.query(
      "UPDATE assignments SET checked_in_at = now() WHERE asset_id = $1", [asset.id],
    );
    const overdue = await findOverdue(ctx);
    expect(overdue.map((o) => o.asset_name)).not.toContain("Returned late");
  });
});

describe("runOverdueJob", () => {
  it("queues one notification per overdue assignment", async () => {
    const result = await runOverdueJob(ctx);
    expect(result.notified).toBeGreaterThan(0);
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM email_messages WHERE org_id=$1 AND event='asset.overdue'",
      [orgId],
    );
    expect(rows[0].n).toBe(result.notified);
  });

  it("does not notify twice on the same day", async () => {
    await pool.query("DELETE FROM email_messages WHERE org_id=$1", [orgId]);
    const second = await runOverdueJob(ctx);
    expect(second.notified).toBe(0);
  });
});

describe("findExpiring", () => {
  it("finds assets whose custom date falls inside the window", async () => {
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await createAsset(ctx, {
      name: "Expiring warranty", category_id: categoryId,
      custom: { warranty_end: soon },
    });
    const rows = await findExpiring(ctx, "warranty_end", 90);
    expect(rows.map((r) => r.name)).toContain("Expiring warranty");
  });

  it("ignores a date beyond the window", async () => {
    const far = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    await createAsset(ctx, {
      name: "Distant warranty", category_id: categoryId,
      custom: { warranty_end: far },
    });
    const rows = await findExpiring(ctx, "warranty_end", 90);
    expect(rows.map((r) => r.name)).not.toContain("Distant warranty");
  });

  it("ignores an already-expired date", async () => {
    const past = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    await createAsset(ctx, {
      name: "Expired warranty", category_id: categoryId,
      custom: { warranty_end: past },
    });
    const rows = await findExpiring(ctx, "warranty_end", 90);
    expect(rows.map((r) => r.name)).not.toContain("Expired warranty");
  });

  it("ignores a retired asset", async () => {
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const asset = await createAsset(ctx, {
      name: "Retired warranty", category_id: categoryId,
      custom: { warranty_end: soon },
    });
    await pool.query("UPDATE assets SET status='retired' WHERE id=$1", [asset.id]);
    const rows = await findExpiring(ctx, "warranty_end", 90);
    expect(rows.map((r) => r.name)).not.toContain("Retired warranty");
  });
});

describe("runExpiryJobs", () => {
  it("reports a count for each of the three date fields", async () => {
    await pool.query(
      "DELETE FROM audit_events WHERE org_id=$1 AND event LIKE '%.notified'", [orgId],
    );
    const result = await runExpiryJobs(ctx);
    expect(result).toHaveProperty("warranty");
    expect(result).toHaveProperty("licence");
    expect(result).toHaveProperty("maintenance");
    expect(result.warranty).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/jobs`
Expected: FAIL — `Cannot find module './overdue'`.

- [ ] **Step 3: Implement the overdue job**

`api/src/lib/jobs/overdue.ts`:

```ts
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { dispatch } from "../notify/dispatch";
import { recordEvent } from "../domain/audit";

export interface OverdueRow {
  assignment_id: string;
  asset_id: string;
  asset_name: string;
  asset_tag: string;
  assignee_id: string | null;
  assignee_label: string | null;
  due_at: string;
  days_late: number;
}

export const findOverdue = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<OverdueRow>(
      `SELECT a.id AS assignment_id, s.id AS asset_id, s.name AS asset_name,
              s.asset_tag, a.assignee_id, a.assignee_label, a.due_at,
              floor(extract(epoch FROM now() - a.due_at) / 86400)::int AS days_late
         FROM assignments a
         JOIN assets s ON s.id = a.asset_id
        WHERE a.checked_in_at IS NULL
          AND a.due_at IS NOT NULL
          AND a.due_at < now()
          AND s.deleted_at IS NULL
        ORDER BY a.due_at`,
    )).rows,
  );

/**
 * One notification per overdue assignment per day. The de-duplication key is an
 * audit event, so a job that runs hourly does not send hourly email.
 */
export async function runOverdueJob(ctx: Ctx): Promise<{ notified: number }> {
  const overdue = await findOverdue(ctx);
  let notified = 0;

  for (const row of overdue) {
    const alreadySent = await withTenant(ctx.orgId, async (c) =>
      (await c.query(
        `SELECT 1 FROM audit_events
          WHERE asset_id = $1 AND event = 'asset.overdue_notified'
            AND created_at > date_trunc('day', now())
          LIMIT 1`,
        [row.asset_id],
      )).rowCount === 1,
    );
    if (alreadySent) continue;

    await dispatch(ctx, "asset.overdue", {
      assetId: row.asset_id,
      assigneeId: row.assignee_id,
      asset: { name: row.asset_name, asset_tag: row.asset_tag },
      assignment: { due_at: row.due_at, days_late: row.days_late },
    });

    await withTenant(ctx.orgId, (c) =>
      recordEvent(c, ctx, {
        assetId: row.asset_id,
        event: "asset.overdue_notified",
        note: `${row.days_late} day(s) overdue`,
      }),
    );
    notified++;
  }
  return { notified };
}
```

- [ ] **Step 4: Implement the expiry jobs**

`api/src/lib/jobs/expiring.ts`:

```ts
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { dispatch } from "../notify/dispatch";
import { recordEvent } from "../domain/audit";

export interface ExpiringRow {
  id: string;
  name: string;
  asset_tag: string;
  custom: Record<string, unknown>;
  expires_on: string;
  days_left: number;
}

/**
 * Reads an ISO date out of the JSONB `custom` column. The cast is guarded by a regex
 * so a hand-typed value like "soon" cannot abort the query for every other row.
 */
export const findExpiring = (ctx: Ctx, field: string, days: number) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<ExpiringRow>(
      `SELECT id, name, asset_tag, custom,
              (custom ->> $1)::date AS expires_on,
              ((custom ->> $1)::date - current_date) AS days_left
         FROM assets
        WHERE deleted_at IS NULL
          AND status NOT IN ('retired', 'lost')
          AND custom ->> $1 ~ '^\\d{4}-\\d{2}-\\d{2}$'
          AND (custom ->> $1)::date BETWEEN current_date
                                        AND current_date + ($2 || ' days')::interval
        ORDER BY (custom ->> $1)::date`,
      [field, String(days)],
    )).rows,
  );

const WINDOW_DAYS = Number(process.env.EXPIRY_WINDOW_DAYS ?? 90);

const JOBS = [
  { field: "warranty_end", event: "warranty.expiring", key: "warranty" },
  { field: "license_expiry", event: "licence.expiring", key: "licence" },
  { field: "next_service_at", event: "maintenance.due", key: "maintenance" },
] as const;

export async function runExpiryJobs(
  ctx: Ctx,
): Promise<{ warranty: number; licence: number; maintenance: number }> {
  const counts = { warranty: 0, licence: 0, maintenance: 0 };

  for (const job of JOBS) {
    const rows = await findExpiring(ctx, job.field, WINDOW_DAYS);
    for (const row of rows) {
      const marker = `${job.event}.notified`;
      // Once per asset per window, not once per day — an expiry notice repeated
      // daily for 90 days trains people to ignore it.
      const alreadySent = await withTenant(ctx.orgId, async (c) =>
        (await c.query(
          `SELECT 1 FROM audit_events
            WHERE asset_id = $1 AND event = $2
              AND created_at > now() - ($3 || ' days')::interval
            LIMIT 1`,
          [row.id, marker, String(WINDOW_DAYS)],
        )).rowCount === 1,
      );
      if (alreadySent) continue;

      await dispatch(ctx, job.event, {
        assetId: row.id,
        asset: { name: row.name, asset_tag: row.asset_tag, custom: row.custom },
        expires_on: row.expires_on,
        days_left: row.days_left,
      });
      await withTenant(ctx.orgId, (c) =>
        recordEvent(c, ctx, {
          assetId: row.id, event: marker,
          note: `${job.field} on ${row.expires_on} (${row.days_left} days)`,
        }),
      );
      counts[job.key]++;
    }
  }
  return counts;
}
```

- [ ] **Step 5: Implement the runner and its entrypoint**

`api/src/lib/jobs/runner.ts`:

```ts
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { processOutbox } from "../email/outbox";
import { runOverdueJob } from "./overdue";
import { runExpiryJobs } from "./expiring";

const systemCtx = (orgId: string): Ctx => ({
  orgId,
  actor: { type: "system", id: orgId, label: "Scheduler", scopes: ["admin"] },
});

/** Every organisation, one at a time. One tenant's failure must not stop the rest. */
export async function runAllJobs(): Promise<void> {
  const { rows } = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM organizations",
  );

  for (const org of rows) {
    const ctx = systemCtx(org.id);
    try {
      const overdue = await runOverdueJob(ctx);
      const expiry = await runExpiryJobs(ctx);
      const mail = await processOutbox(ctx, 100);
      console.log(JSON.stringify({
        org: org.name, overdue: overdue.notified, ...expiry, ...mail,
      }));
    } catch (err) {
      console.error(`jobs failed for org ${org.name}:`, err);
    }
  }
}

/** Drains the outbox far more often than the daily jobs run. */
export async function runOutboxOnly(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM organizations");
  for (const org of rows) {
    try {
      await processOutbox(systemCtx(org.id), 100);
    } catch (err) {
      console.error(`outbox failed for org ${org.id}:`, err);
    }
  }
}
```

`api/scripts/jobs.ts`:

```ts
import { runAllJobs, runOutboxOnly } from "../src/lib/jobs/runner";
import { runDueSchedules } from "../src/lib/reports/schedules";

const OUTBOX_INTERVAL_MS = 30_000;
const DAILY_INTERVAL_MS = 60 * 60 * 1000;

/**
 * A single long-lived process rather than cron, so the whole system stays inside
 * `docker compose up` with no host configuration. Daily work is idempotent and
 * de-duplicated in the database, so running it hourly is safe.
 */
async function main() {
  const mode = process.argv[2] ?? "loop";

  if (mode === "once") {
    await runAllJobs();
    await runDueSchedules();
    process.exit(0);
  }

  console.log("job runner started");
  setInterval(() => {
    runOutboxOnly().catch((err) => console.error("outbox tick failed:", err));
  }, OUTBOX_INTERVAL_MS);

  setInterval(() => {
    runAllJobs().catch((err) => console.error("daily tick failed:", err));
    runDueSchedules().catch((err) => console.error("schedule tick failed:", err));
  }, DAILY_INTERVAL_MS);

  // Run once at boot so a restart does not skip a day.
  await runAllJobs();
  await runDueSchedules();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

> `runDueSchedules` arrives in Task 18. Until then, stub it in
> `api/src/lib/reports/schedules.ts` as
> `export const runDueSchedules = async (): Promise<void> => {};`
> and replace the body in Task 18.

Add the service to `docker-compose.yml`:

```yaml
  jobs:
    build: ./api
    command: ["node", "--experimental-strip-types", "scripts/jobs.ts"]
    environment:
      DATABASE_URL: postgres://ams_app:${APP_DB_PASSWORD:-ams_app}@db:5432/ams
      APP_ENCRYPTION_KEY: ${APP_ENCRYPTION_KEY}
      APP_BASE_URL: ${APP_BASE_URL:-http://localhost:3000}
      S3_ENDPOINT: http://minio:9000
      S3_BUCKET: ams-attachments
      S3_ACCESS_KEY: ${MINIO_ROOT_USER:-ams}
      S3_SECRET_KEY: ${MINIO_ROOT_PASSWORD:-ams-secret}
    depends_on:
      db: { condition: service_healthy }
    restart: unless-stopped
```

Add the script to `api/package.json`:

```json
    "jobs": "tsx scripts/jobs.ts",
    "jobs:once": "tsx scripts/jobs.ts once"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/jobs`
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/jobs api/scripts/jobs.ts api/package.json docker-compose.yml
git commit -m "feat: scheduled jobs for overdue, warranty, licence and maintenance alerts"
```

---

### Task 16: Dashboard aggregates

**Files:**
- Create: `api/src/lib/domain/dashboard.ts`
- Create: `api/src/app/api/v1/dashboard/summary/route.ts`
- Test: `api/src/lib/domain/dashboard.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `Ctx`.
- Produces:
  - `getDashboardSummary(ctx): Promise<DashboardSummary>` where
    `DashboardSummary = { totals: { assets, active_assignments, overdue, maintenance, total_value, currency }, by_status: {status,count}[], by_category: {category,count,value}[], by_location: {location,count}[], recent_activity: AuditEvent[], expiring_soon: {id,name,field,expires_on,days_left}[], utilisation: { in_use_pct } }`

**Design note:** one round trip, not eight. The dashboard is the first screen every user
sees, so the whole payload is assembled in a single query using CTEs — a page that fires
eight requests feels slow no matter how fast each one is.

- [ ] **Step 1: Write the failing test**

`api/src/lib/domain/dashboard.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createAsset } from "./assets";
import { createCategory } from "./categories";
import { createLocation } from "./locations";
import { checkOut } from "./assignments";
import { getDashboardSummary } from "./dashboard";

const orgId = randomUUID();
const userId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: userId, label: "Dash", scopes: ["admin"] },
};

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'D',$2)", [
    orgId, `dash-org-${orgId.slice(0, 8)}`,
  ]);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,'x','Dash','admin')`,
    [userId, orgId, `dash-${orgId.slice(0, 8)}@example.com`],
  );

  const it = await createCategory(ctx, {
    name: "IT", kind: "it",
    field_schema: { fields: [
      { key: "warranty_end", label: "Warranty", type: "date", required: false },
    ] },
  });
  const plant = await createCategory(ctx, {
    name: "Plant", kind: "equipment", field_schema: { fields: [] },
  });
  const site = await createLocation(ctx, { name: "Head Office" });

  const soon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
  await createAsset(ctx, {
    name: "Laptop 1", category_id: it.id, location_id: site.id,
    purchase_cost: 15_000_000, currency: "IDR", custom: { warranty_end: soon },
  });
  await createAsset(ctx, {
    name: "Laptop 2", category_id: it.id, location_id: site.id,
    purchase_cost: 12_000_000, currency: "IDR",
  });
  const generator = await createAsset(ctx, {
    name: "Generator", category_id: plant.id, purchase_cost: 80_000_000, currency: "IDR",
  });
  await pool.query("UPDATE assets SET status='maintenance' WHERE id=$1", [generator.id]);

  const issued = await createAsset(ctx, { name: "Issued tablet", category_id: it.id });
  await checkOut(ctx, issued.id, {
    assignee_type: "user", assignee_id: userId, due_at: "2026-08-01T00:00:00Z",
  });
});

describe("getDashboardSummary", () => {
  it("counts every live asset", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.totals.assets).toBe(4);
  });

  it("counts open assignments and overdue ones separately", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.totals.active_assignments).toBe(1);
    expect(summary.totals.overdue).toBe(1);
  });

  it("counts assets in maintenance", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.totals.maintenance).toBe(1);
  });

  it("sums purchase value", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(Number(summary.totals.total_value)).toBe(107_000_000);
  });

  it("breaks the register down by status", async () => {
    const summary = await getDashboardSummary(ctx);
    const byStatus = Object.fromEntries(summary.by_status.map((s) => [s.status, s.count]));
    expect(byStatus).toMatchObject({ available: 2, in_use: 1, maintenance: 1 });
  });

  it("breaks the register down by category with value", async () => {
    const summary = await getDashboardSummary(ctx);
    const it = summary.by_category.find((c) => c.category === "IT");
    expect(it).toMatchObject({ count: 3 });
    expect(Number(it!.value)).toBe(27_000_000);
  });

  it("breaks the register down by location", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.by_location.find((l) => l.location === "Head Office")?.count).toBe(2);
  });

  it("lists recent activity newest first", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.recent_activity.length).toBeGreaterThan(0);
    expect(summary.recent_activity[0].created_at >= summary.recent_activity[1].created_at)
      .toBe(true);
  });

  it("surfaces assets expiring soon", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.expiring_soon.map((e) => e.name)).toContain("Laptop 1");
  });

  it("reports utilisation as a percentage in use", async () => {
    const summary = await getDashboardSummary(ctx);
    expect(summary.utilisation.in_use_pct).toBe(25);
  });

  it("returns zeroes rather than nulls for an empty organisation", async () => {
    const emptyOrg = randomUUID();
    await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'Z',$2)", [
      emptyOrg, `empty-${emptyOrg.slice(0, 8)}`,
    ]);
    const summary = await getDashboardSummary({ ...ctx, orgId: emptyOrg });
    expect(summary.totals).toMatchObject({
      assets: 0, active_assignments: 0, overdue: 0, maintenance: 0,
    });
    expect(Number(summary.totals.total_value)).toBe(0);
    expect(summary.utilisation.in_use_pct).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/dashboard.test.ts`
Expected: FAIL — `Cannot find module './dashboard'`.

- [ ] **Step 3: Implement the dashboard module**

`api/src/lib/domain/dashboard.ts`:

```ts
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import type { AuditEvent } from "./audit";

export interface DashboardSummary {
  totals: {
    assets: number;
    active_assignments: number;
    overdue: number;
    maintenance: number;
    total_value: string;
    currency: string;
  };
  by_status: { status: string; count: number }[];
  by_category: { category: string; count: number; value: string }[];
  by_location: { location: string; count: number }[];
  recent_activity: AuditEvent[];
  expiring_soon: {
    id: string; name: string; field: string; expires_on: string; days_left: number;
  }[];
  utilisation: { in_use_pct: number };
}

const EXPIRY_FIELDS = ["warranty_end", "license_expiry", "next_service_at"] as const;

export function getDashboardSummary(ctx: Ctx): Promise<DashboardSummary> {
  return withTenant(ctx.orgId, async (c) => {
    // One round trip. The dashboard is the first screen a user sees; eight
    // sequential queries would be felt even when each is fast.
    const { rows } = await c.query<{ payload: DashboardSummary }>(
      `WITH live AS (
         SELECT * FROM assets WHERE deleted_at IS NULL
       ),
       totals AS (
         SELECT
           count(*)::int AS assets,
           count(*) FILTER (WHERE status = 'maintenance')::int AS maintenance,
           count(*) FILTER (WHERE status = 'in_use')::int AS in_use,
           coalesce(sum(purchase_cost), 0)::text AS total_value,
           coalesce(max(currency), 'IDR') AS currency
         FROM live
       ),
       assignments_now AS (
         SELECT
           count(*)::int AS active_assignments,
           count(*) FILTER (WHERE due_at IS NOT NULL AND due_at < now())::int AS overdue
         FROM assignments a
         JOIN live s ON s.id = a.asset_id
        WHERE a.checked_in_at IS NULL
       ),
       by_status AS (
         SELECT jsonb_agg(jsonb_build_object('status', status, 'count', n)
                          ORDER BY status) AS rows
           FROM (SELECT status, count(*)::int AS n FROM live GROUP BY status) s
       ),
       by_category AS (
         SELECT jsonb_agg(jsonb_build_object(
                  'category', name, 'count', n, 'value', value) ORDER BY n DESC) AS rows
           FROM (
             SELECT coalesce(c.name, 'Uncategorised') AS name,
                    count(*)::int AS n,
                    coalesce(sum(l.purchase_cost), 0)::text AS value
               FROM live l LEFT JOIN categories c ON c.id = l.category_id
              GROUP BY c.name
           ) t
       ),
       by_location AS (
         SELECT jsonb_agg(jsonb_build_object('location', name, 'count', n)
                          ORDER BY n DESC) AS rows
           FROM (
             SELECT coalesce(lo.name, 'Unassigned') AS name, count(*)::int AS n
               FROM live l LEFT JOIN locations lo ON lo.id = l.location_id
              GROUP BY lo.name
           ) t
       ),
       recent AS (
         SELECT jsonb_agg(e ORDER BY e.created_at DESC) AS rows
           FROM (
             SELECT ae.id, ae.asset_id, ae.actor_type, ae.actor_label, ae.event,
                    ae.changes, ae.note, ae.created_at, a.name AS asset_name
               FROM audit_events ae
               LEFT JOIN assets a ON a.id = ae.asset_id
              ORDER BY ae.created_at DESC
              LIMIT 15
           ) e
       ),
       expiring AS (
         SELECT jsonb_agg(jsonb_build_object(
                  'id', id, 'name', name, 'field', field,
                  'expires_on', expires_on, 'days_left', days_left)
                ORDER BY expires_on) AS rows
           FROM (
             SELECT l.id, l.name, f.field,
                    (l.custom ->> f.field)::date AS expires_on,
                    ((l.custom ->> f.field)::date - current_date)::int AS days_left
               FROM live l
               CROSS JOIN unnest($1::text[]) AS f(field)
              WHERE l.status NOT IN ('retired', 'lost')
                AND l.custom ->> f.field ~ '^\\d{4}-\\d{2}-\\d{2}$'
                AND (l.custom ->> f.field)::date
                    BETWEEN current_date AND current_date + interval '90 days'
              ORDER BY (l.custom ->> f.field)::date
              LIMIT 10
           ) t
       )
       SELECT jsonb_build_object(
         'totals', jsonb_build_object(
           'assets', t.assets,
           'active_assignments', an.active_assignments,
           'overdue', an.overdue,
           'maintenance', t.maintenance,
           'total_value', t.total_value,
           'currency', t.currency),
         'by_status', coalesce(bs.rows, '[]'::jsonb),
         'by_category', coalesce(bc.rows, '[]'::jsonb),
         'by_location', coalesce(bl.rows, '[]'::jsonb),
         'recent_activity', coalesce(r.rows, '[]'::jsonb),
         'expiring_soon', coalesce(ex.rows, '[]'::jsonb),
         'utilisation', jsonb_build_object(
           'in_use_pct',
           CASE WHEN t.assets = 0 THEN 0
                ELSE round(t.in_use::numeric * 100 / t.assets) END)
       ) AS payload
       FROM totals t, assignments_now an, by_status bs, by_category bc,
            by_location bl, recent r, expiring ex`,
      [EXPIRY_FIELDS],
    );

    const payload = rows[0].payload;
    return {
      ...payload,
      utilisation: { in_use_pct: Number(payload.utilisation.in_use_pct) },
    };
  });
}
```

- [ ] **Step 4: Implement the route handler**

`api/src/app/api/v1/dashboard/summary/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { getDashboardSummary } from "@/lib/domain/dashboard";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await getDashboardSummary(ctx) });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/domain/dashboard.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/domain/dashboard.ts api/src/app/api/v1/dashboard
git commit -m "feat: dashboard summary aggregates in a single query"
```

---

### Task 17: Report engine — definitions, JSON and CSV, chart specs

**Files:**
- Create: `api/src/lib/reports/types.ts`, `api/src/lib/reports/definitions/index.ts` (+ one file per report), `api/src/lib/reports/engine.ts`, `api/src/lib/reports/renderers/json.ts`, `api/src/lib/reports/renderers/csv.ts`
- Create: `api/src/app/api/v1/reports/route.ts`, `api/src/app/api/v1/reports/[key]/route.ts`
- Test: `api/src/lib/reports/engine.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `Ctx`.
- Produces:
  - `interface ReportParams { from?, to?, category_id?, location_id?, status?, days?, limit? }`
  - `interface ReportColumn { key: string; label: string; type: "string"|"number"|"date"|"money"|"percent" }`
  - `interface ChartSpec { type: "donut"|"bar"|"column"|"line"|"none"; categoryKey: string; valueKeys: string[]; valueLabel: string }`
  - `interface ReportDefinition { key, name, description, columns, chart, run(ctx, params): Promise<Row[]>, totals?(rows): Row | null }`
  - `interface ReportResult { key, name, description, generated_at, params, filter_summary: string, columns, chart, rows, totals }`
  - `REPORTS: Record<string, ReportDefinition>` — the nine reports from spec §8.1
  - `runReport(ctx, key, params): Promise<ReportResult>`
  - `renderJson(result): Response`, `renderCsv(result): Response`

- [ ] **Step 1: Write the failing test**

`api/src/lib/reports/engine.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createAsset } from "../domain/assets";
import { createCategory } from "../domain/categories";
import { checkOut } from "../domain/assignments";
import { REPORTS, runReport, describeFilters } from "./engine";
import { renderCsv } from "./renderers/csv";

const orgId = randomUUID();
const userId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: userId, label: "Rep", scopes: ["admin"] },
};
let itId: string;

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'R',$2)", [
    orgId, `rep-org-${orgId.slice(0, 8)}`,
  ]);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,'x','Rep','admin')`,
    [userId, orgId, `rep-${orgId.slice(0, 8)}@example.com`],
  );
  itId = (await createCategory(ctx, {
    name: "IT", kind: "it",
    field_schema: { fields: [
      { key: "warranty_end", label: "Warranty", type: "date", required: false },
    ] },
  })).id;

  const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  await createAsset(ctx, {
    name: "Laptop A", category_id: itId, purchase_cost: 10_000_000,
    purchase_date: "2026-01-15", custom: { warranty_end: soon },
  });
  await createAsset(ctx, {
    name: "Laptop B", category_id: itId, purchase_cost: 20_000_000,
    purchase_date: "2026-02-20",
  });
  const issued = await createAsset(ctx, { name: "Tablet", category_id: itId });
  await checkOut(ctx, issued.id, {
    assignee_type: "user", assignee_id: userId, due_at: "2026-08-01T00:00:00Z",
  });
});

describe("REPORTS", () => {
  it("registers every report in the catalogue", () => {
    expect(Object.keys(REPORTS).sort()).toEqual([
      "acquisition-value", "assets-by-category", "assets-by-location",
      "assets-by-status", "assignments-active", "assignments-overdue",
      "audit-activity", "expiring", "utilisation",
    ]);
  });

  it("gives every report a chart spec and typed columns", () => {
    for (const [key, def] of Object.entries(REPORTS)) {
      expect(def.columns.length, key).toBeGreaterThan(0);
      expect(def.chart, key).toHaveProperty("type");
      for (const column of def.columns) {
        expect(["string", "number", "date", "money", "percent"], key)
          .toContain(column.type);
      }
    }
  });

  it("points every chart at columns the report actually returns", () => {
    for (const [key, def] of Object.entries(REPORTS)) {
      if (def.chart.type === "none") continue;
      const keys = def.columns.map((c) => c.key);
      expect(keys, key).toContain(def.chart.categoryKey);
      for (const valueKey of def.chart.valueKeys) expect(keys, key).toContain(valueKey);
    }
  });
});

describe("runReport", () => {
  it("groups assets by status with counts", async () => {
    const result = await runReport(ctx, "assets-by-status", {});
    const available = result.rows.find((r) => r.status === "available");
    expect(available).toMatchObject({ count: 2 });
  });

  it("groups by category with a value total", async () => {
    const result = await runReport(ctx, "assets-by-category", {});
    const row = result.rows.find((r) => r.category === "IT");
    expect(row!.count).toBe(3);
    expect(Number(row!.value)).toBe(30_000_000);
  });

  it("returns a totals row where the report defines one", async () => {
    const result = await runReport(ctx, "assets-by-category", {});
    expect(result.totals).toMatchObject({ count: 3 });
  });

  it("lists only overdue assignments in the overdue report", async () => {
    const result = await runReport(ctx, "assignments-overdue", {});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].asset_name).toBe("Tablet");
    expect(Number(result.rows[0].days_late)).toBeGreaterThan(0);
  });

  it("honours the days parameter on the expiring report", async () => {
    const wide = await runReport(ctx, "expiring", { days: 90 });
    const narrow = await runReport(ctx, "expiring", { days: 7 });
    expect(wide.rows.length).toBeGreaterThan(narrow.rows.length);
  });

  it("filters by category", async () => {
    const other = await createCategory(ctx, {
      name: "Media", kind: "media", field_schema: { fields: [] },
    });
    const result = await runReport(ctx, "assets-by-status", { category_id: other.id });
    expect(result.rows).toHaveLength(0);
  });

  it("buckets acquisition value by month", async () => {
    const result = await runReport(ctx, "acquisition-value", {});
    expect(result.rows.map((r) => r.month)).toEqual(["2026-01", "2026-02"]);
    expect(Number(result.rows[1].value)).toBe(20_000_000);
  });

  it("carries the metadata a renderer needs", async () => {
    const result = await runReport(ctx, "assets-by-status", {});
    expect(result).toMatchObject({ key: "assets-by-status", name: expect.any(String) });
    expect(result.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.columns.length).toBeGreaterThan(0);
  });

  it("rejects an unknown report key", async () => {
    await expect(runReport(ctx, "not-a-report", {})).rejects.toThrow(/unknown report/i);
  });
});

describe("describeFilters", () => {
  it("states the filter set in words for a report header", () => {
    expect(describeFilters({ days: 90 })).toBe("Next 90 days");
    expect(describeFilters({})).toBe("All assets");
    expect(describeFilters({ from: "2026-01-01", to: "2026-06-30" }))
      .toContain("1 Jan 2026");
  });
});

describe("renderCsv", () => {
  it("emits a header row of column labels", async () => {
    const result = await runReport(ctx, "assets-by-status", {});
    const body = await renderCsv(result).text();
    expect(body.split("\n")[0]).toBe("Status,Assets,Value");
  });

  it("quotes a value containing a comma", async () => {
    const result = await runReport(ctx, "assets-by-status", {});
    result.rows.push({ status: "Odd, name", count: 1, value: "0" });
    const body = await renderCsv(result).text();
    expect(body).toContain('"Odd, name"');
  });

  it("sets a downloadable content type and filename", async () => {
    const res = renderCsv(await runReport(ctx, "assets-by-status", {}));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("assets-by-status");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/reports`
Expected: FAIL — `Cannot find module './engine'`.

- [ ] **Step 3: Implement the report types**

`api/src/lib/reports/types.ts`:

```ts
import type { Ctx } from "../http/handler";

export interface ReportParams {
  from?: string;
  to?: string;
  category_id?: string;
  location_id?: string;
  status?: string[];
  days?: number;
  limit?: number;
}

export type ColumnType = "string" | "number" | "date" | "money" | "percent";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

/**
 * The chart is described once, here, and drawn by both ApexCharts in the browser
 * and the server-side SVG renderer. A chart added to a report appears in the
 * dashboard, the PDF and the PNG at the same time.
 */
export interface ChartSpec {
  type: "donut" | "bar" | "column" | "line" | "none";
  categoryKey: string;
  valueKeys: string[];
  valueLabel: string;
}

export type ReportRow = Record<string, string | number | null>;

export interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  columns: ReportColumn[];
  chart: ChartSpec;
  run(ctx: Ctx, params: ReportParams): Promise<ReportRow[]>;
  totals?(rows: ReportRow[]): ReportRow | null;
}

export interface ReportResult {
  key: string;
  name: string;
  description: string;
  generated_at: string;
  params: ReportParams;
  filter_summary: string;
  columns: ReportColumn[];
  chart: ChartSpec;
  rows: ReportRow[];
  totals: ReportRow | null;
}
```

- [ ] **Step 4: Implement the report definitions**

`api/src/lib/reports/definitions/index.ts`:

```ts
import { withTenant } from "../../db";
import type { Ctx } from "../../http/handler";
import type { ReportDefinition, ReportParams, ReportRow } from "../types";

/** Shared WHERE fragment so every report filters identically. */
function assetFilters(params: ReportParams, values: unknown[]): string {
  const clauses = ["a.deleted_at IS NULL"];
  if (params.category_id) clauses.push(`a.category_id = $${values.push(params.category_id)}`);
  if (params.location_id) clauses.push(`a.location_id = $${values.push(params.location_id)}`);
  if (params.status?.length) {
    clauses.push(`a.status = ANY($${values.push(params.status)}::asset_status[])`);
  }
  if (params.from) clauses.push(`a.created_at >= $${values.push(params.from)}::timestamptz`);
  if (params.to) clauses.push(`a.created_at <= $${values.push(params.to)}::timestamptz`);
  return clauses.join(" AND ");
}

const sumBy = (rows: ReportRow[], key: string) =>
  rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

const assetsByStatus: ReportDefinition = {
  key: "assets-by-status",
  name: "Assets by status",
  description: "How many assets sit in each operational state, and what they are worth.",
  columns: [
    { key: "status", label: "Status", type: "string" },
    { key: "count", label: "Assets", type: "number" },
    { key: "value", label: "Value", type: "money" },
  ],
  chart: { type: "donut", categoryKey: "status", valueKeys: ["count"], valueLabel: "Assets" },
  run: (ctx, params) =>
    withTenant(ctx.orgId, async (c) => {
      const values: unknown[] = [];
      const where = assetFilters(params, values);
      return (await c.query<ReportRow>(
        `SELECT a.status::text AS status, count(*)::int AS count,
                coalesce(sum(a.purchase_cost), 0)::text AS value
           FROM assets a WHERE ${where}
          GROUP BY a.status ORDER BY count DESC`,
        values,
      )).rows;
    }),
  totals: (rows) => ({
    status: "Total", count: sumBy(rows, "count"), value: String(sumBy(rows, "value")),
  }),
};

const assetsByCategory: ReportDefinition = {
  key: "assets-by-category",
  name: "Assets by category",
  description: "The register split across IT, plant and media, with capital value.",
  columns: [
    { key: "category", label: "Category", type: "string" },
    { key: "count", label: "Assets", type: "number" },
    { key: "value", label: "Value", type: "money" },
  ],
  chart: { type: "bar", categoryKey: "category", valueKeys: ["count"], valueLabel: "Assets" },
  run: (ctx, params) =>
    withTenant(ctx.orgId, async (c) => {
      const values: unknown[] = [];
      const where = assetFilters(params, values);
      return (await c.query<ReportRow>(
        `SELECT coalesce(cat.name, 'Uncategorised') AS category,
                count(*)::int AS count,
                coalesce(sum(a.purchase_cost), 0)::text AS value
           FROM assets a LEFT JOIN categories cat ON cat.id = a.category_id
          WHERE ${where}
          GROUP BY cat.name ORDER BY count DESC`,
        values,
      )).rows;
    }),
  totals: (rows) => ({
    category: "Total", count: sumBy(rows, "count"), value: String(sumBy(rows, "value")),
  }),
};

const assetsByLocation: ReportDefinition = {
  key: "assets-by-location",
  name: "Assets by location",
  description: "Where the register physically sits, site by site.",
  columns: [
    { key: "location", label: "Location", type: "string" },
    { key: "count", label: "Assets", type: "number" },
    { key: "value", label: "Value", type: "money" },
  ],
  chart: { type: "bar", categoryKey: "location", valueKeys: ["count"], valueLabel: "Assets" },
  run: (ctx, params) =>
    withTenant(ctx.orgId, async (c) => {
      const values: unknown[] = [];
      const where = assetFilters(params, values);
      return (await c.query<ReportRow>(
        `SELECT coalesce(l.name, 'Unassigned') AS location,
                count(*)::int AS count,
                coalesce(sum(a.purchase_cost), 0)::text AS value
           FROM assets a LEFT JOIN locations l ON l.id = a.location_id
          WHERE ${where}
          GROUP BY l.name ORDER BY count DESC`,
        values,
      )).rows;
    }),
  totals: (rows) => ({
    location: "Total", count: sumBy(rows, "count"), value: String(sumBy(rows, "value")),
  }),
};

const assignmentsActive: ReportDefinition = {
  key: "assignments-active",
  name: "Active assignments",
  description: "Everything currently checked out, who holds it and for how long.",
  columns: [
    { key: "asset_tag", label: "Tag", type: "string" },
    { key: "asset_name", label: "Asset", type: "string" },
    { key: "holder", label: "Held by", type: "string" },
    { key: "checked_out_at", label: "Out since", type: "date" },
    { key: "days_out", label: "Days out", type: "number" },
    { key: "due_at", label: "Due back", type: "date" },
    { key: "overdue", label: "Overdue", type: "string" },
  ],
  chart: { type: "none", categoryKey: "asset_name", valueKeys: ["days_out"], valueLabel: "Days" },
  run: (ctx) =>
    withTenant(ctx.orgId, async (c) =>
      (await c.query<ReportRow>(
        `SELECT s.asset_tag, s.name AS asset_name,
                coalesce(u.name, a.assignee_label, l.name, '—') AS holder,
                a.checked_out_at,
                floor(extract(epoch FROM now() - a.checked_out_at) / 86400)::int AS days_out,
                a.due_at,
                CASE WHEN a.due_at IS NOT NULL AND a.due_at < now()
                     THEN 'Yes' ELSE 'No' END AS overdue
           FROM assignments a
           JOIN assets s ON s.id = a.asset_id AND s.deleted_at IS NULL
           LEFT JOIN users u ON u.id = a.assignee_id
           LEFT JOIN locations l ON l.id = a.location_id
          WHERE a.checked_in_at IS NULL
          ORDER BY a.checked_out_at`,
      )).rows,
    ),
};

const assignmentsOverdue: ReportDefinition = {
  key: "assignments-overdue",
  name: "Overdue assignments",
  description: "Past the agreed return date and still out, worst first.",
  columns: [
    { key: "asset_tag", label: "Tag", type: "string" },
    { key: "asset_name", label: "Asset", type: "string" },
    { key: "holder", label: "Held by", type: "string" },
    { key: "due_at", label: "Was due", type: "date" },
    { key: "days_late", label: "Days late", type: "number" },
  ],
  chart: { type: "none", categoryKey: "asset_name", valueKeys: ["days_late"], valueLabel: "Days late" },
  run: (ctx) =>
    withTenant(ctx.orgId, async (c) =>
      (await c.query<ReportRow>(
        `SELECT s.asset_tag, s.name AS asset_name,
                coalesce(u.name, a.assignee_label, l.name, '—') AS holder,
                a.due_at,
                floor(extract(epoch FROM now() - a.due_at) / 86400)::int AS days_late
           FROM assignments a
           JOIN assets s ON s.id = a.asset_id AND s.deleted_at IS NULL
           LEFT JOIN users u ON u.id = a.assignee_id
           LEFT JOIN locations l ON l.id = a.location_id
          WHERE a.checked_in_at IS NULL AND a.due_at IS NOT NULL AND a.due_at < now()
          ORDER BY a.due_at`,
      )).rows,
    ),
};

const expiring: ReportDefinition = {
  key: "expiring",
  name: "Expiring soon",
  description: "Warranties, licences and services falling due inside the window.",
  columns: [
    { key: "asset_tag", label: "Tag", type: "string" },
    { key: "name", label: "Asset", type: "string" },
    { key: "category", label: "Category", type: "string" },
    { key: "kind", label: "Expiry type", type: "string" },
    { key: "expires_on", label: "Expires", type: "date" },
    { key: "days_left", label: "Days left", type: "number" },
  ],
  chart: { type: "bar", categoryKey: "kind", valueKeys: ["days_left"], valueLabel: "Days left" },
  run: (ctx, params) =>
    withTenant(ctx.orgId, async (c) =>
      (await c.query<ReportRow>(
        `SELECT a.asset_tag, a.name, coalesce(cat.name, 'Uncategorised') AS category,
                CASE f.field
                  WHEN 'warranty_end' THEN 'Warranty'
                  WHEN 'license_expiry' THEN 'Licence'
                  ELSE 'Service' END AS kind,
                (a.custom ->> f.field)::date AS expires_on,
                ((a.custom ->> f.field)::date - current_date)::int AS days_left
           FROM assets a
           LEFT JOIN categories cat ON cat.id = a.category_id
           CROSS JOIN unnest(ARRAY['warranty_end','license_expiry','next_service_at'])
                      AS f(field)
          WHERE a.deleted_at IS NULL
            AND a.status NOT IN ('retired', 'lost')
            AND a.custom ->> f.field ~ '^\\d{4}-\\d{2}-\\d{2}$'
            AND (a.custom ->> f.field)::date
                BETWEEN current_date AND current_date + ($1 || ' days')::interval
          ORDER BY expires_on`,
        [String(params.days ?? 90)],
      )).rows,
    ),
};

const utilisation: ReportDefinition = {
  key: "utilisation",
  name: "Utilisation",
  description:
    "Days each asset spent checked out against days owned — which assets earn their keep.",
  columns: [
    { key: "asset_tag", label: "Tag", type: "string" },
    { key: "name", label: "Asset", type: "string" },
    { key: "category", label: "Category", type: "string" },
    { key: "days_owned", label: "Days owned", type: "number" },
    { key: "days_out", label: "Days out", type: "number" },
    { key: "utilisation_pct", label: "Utilisation", type: "percent" },
  ],
  chart: {
    type: "bar", categoryKey: "name", valueKeys: ["utilisation_pct"],
    valueLabel: "Utilisation %",
  },
  run: (ctx, params) =>
    withTenant(ctx.orgId, async (c) => {
      const values: unknown[] = [];
      const where = assetFilters(params, values);
      values.push(params.limit ?? 100);
      return (await c.query<ReportRow>(
        `WITH usage AS (
           SELECT asset_id,
                  sum(extract(epoch FROM
                    coalesce(checked_in_at, now()) - checked_out_at) / 86400) AS days_out
             FROM assignments GROUP BY asset_id
         )
         SELECT a.asset_tag, a.name, coalesce(cat.name, 'Uncategorised') AS category,
                greatest(1, extract(epoch FROM now() - a.created_at) / 86400)::int
                  AS days_owned,
                coalesce(u.days_out, 0)::int AS days_out,
                round(coalesce(u.days_out, 0)::numeric * 100 /
                      greatest(1, extract(epoch FROM now() - a.created_at) / 86400)::numeric,
                      1)::float AS utilisation_pct
           FROM assets a
           LEFT JOIN usage u ON u.asset_id = a.id
           LEFT JOIN categories cat ON cat.id = a.category_id
          WHERE ${where}
          ORDER BY utilisation_pct DESC
          LIMIT $${values.length}`,
        values,
      )).rows;
    }),
};

const auditActivity: ReportDefinition = {
  key: "audit-activity",
  name: "Activity over time",
  description: "Recorded events per day — how much the register is actually being used.",
  columns: [
    { key: "day", label: "Day", type: "date" },
    { key: "events", label: "Events", type: "number" },
  ],
  chart: { type: "line", categoryKey: "day", valueKeys: ["events"], valueLabel: "Events" },
  run: (ctx, params) =>
    withTenant(ctx.orgId, async (c) =>
      (await c.query<ReportRow>(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                count(*)::int AS events
           FROM audit_events
          WHERE created_at >= coalesce($1::timestamptz, now() - interval '30 days')
            AND created_at <= coalesce($2::timestamptz, now())
          GROUP BY 1 ORDER BY 1`,
        [params.from ?? null, params.to ?? null],
      )).rows,
    ),
  totals: (rows) => ({ day: "Total", events: sumBy(rows, "events") }),
};

const acquisitionValue: ReportDefinition = {
  key: "acquisition-value",
  name: "Acquisition value by month",
  description: "Capital committed to assets each month, for budgeting and depreciation.",
  columns: [
    { key: "month", label: "Month", type: "string" },
    { key: "count", label: "Assets", type: "number" },
    { key: "value", label: "Value", type: "money" },
  ],
  chart: { type: "column", categoryKey: "month", valueKeys: ["value"], valueLabel: "Value" },
  run: (ctx, params) =>
    withTenant(ctx.orgId, async (c) => {
      const values: unknown[] = [];
      const where = assetFilters(params, values);
      return (await c.query<ReportRow>(
        `SELECT to_char(date_trunc('month', a.purchase_date), 'YYYY-MM') AS month,
                count(*)::int AS count,
                coalesce(sum(a.purchase_cost), 0)::text AS value
           FROM assets a
          WHERE ${where} AND a.purchase_date IS NOT NULL
          GROUP BY 1 ORDER BY 1`,
        values,
      )).rows;
    }),
  totals: (rows) => ({
    month: "Total", count: sumBy(rows, "count"), value: String(sumBy(rows, "value")),
  }),
};

export const REPORTS: Record<string, ReportDefinition> = Object.fromEntries(
  [
    assetsByStatus, assetsByCategory, assetsByLocation,
    assignmentsActive, assignmentsOverdue, expiring,
    utilisation, auditActivity, acquisitionValue,
  ].map((definition) => [definition.key, definition]),
);
```

- [ ] **Step 5: Implement the engine and the JSON/CSV renderers**

`api/src/lib/reports/engine.ts`:

```ts
import type { Ctx } from "../http/handler";
import { REPORTS } from "./definitions";
import type { ReportParams, ReportResult } from "./types";

export { REPORTS };
export * from "./types";

const asDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });

/** A human sentence describing the filter set, printed in the PDF and XLSX headers. */
export function describeFilters(params: ReportParams): string {
  const parts: string[] = [];
  if (params.days) parts.push(`Next ${params.days} days`);
  if (params.from && params.to) parts.push(`${asDate(params.from)} – ${asDate(params.to)}`);
  else if (params.from) parts.push(`From ${asDate(params.from)}`);
  else if (params.to) parts.push(`Up to ${asDate(params.to)}`);
  if (params.status?.length) parts.push(`Status: ${params.status.join(", ")}`);
  if (params.category_id) parts.push("Filtered by category");
  if (params.location_id) parts.push("Filtered by location");
  return parts.length ? parts.join(" · ") : "All assets";
}

export async function runReport(
  ctx: Ctx,
  key: string,
  params: ReportParams,
): Promise<ReportResult> {
  const definition = REPORTS[key];
  if (!definition) throw new Error(`unknown report: ${key}`);

  const rows = await definition.run(ctx, params);
  return {
    key: definition.key,
    name: definition.name,
    description: definition.description,
    generated_at: new Date().toISOString(),
    params,
    filter_summary: describeFilters(params),
    columns: definition.columns,
    chart: definition.chart,
    rows,
    totals: definition.totals?.(rows) ?? null,
  };
}

export function parseReportParams(url: URL): ReportParams {
  const status = url.searchParams.getAll("status").flatMap((s) => s.split(","))
    .filter(Boolean);
  const days = Number(url.searchParams.get("days"));
  const limit = Number(url.searchParams.get("limit"));
  return {
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    category_id: url.searchParams.get("category_id") ?? undefined,
    location_id: url.searchParams.get("location_id") ?? undefined,
    status: status.length ? status : undefined,
    days: Number.isFinite(days) && days > 0 ? Math.min(days, 3650) : undefined,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : undefined,
  };
}
```

`api/src/lib/reports/renderers/json.ts`:

```ts
import type { ReportResult } from "../types";

export const renderJson = (result: ReportResult): Response =>
  Response.json({ data: result });
```

`api/src/lib/reports/renderers/csv.ts`:

```ts
import type { ReportResult } from "../types";

const escape = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function renderCsv(result: ReportResult): Response {
  const lines = [result.columns.map((c) => escape(c.label)).join(",")];
  for (const row of result.rows) {
    lines.push(result.columns.map((c) => escape(row[c.key])).join(","));
  }
  if (result.totals) {
    lines.push(result.columns.map((c) => escape(result.totals![c.key])).join(","));
  }

  const date = result.generated_at.slice(0, 10);
  return new Response(`${lines.join("\n")}\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${result.key}-${date}.csv"`,
    },
  });
}
```

- [ ] **Step 6: Implement the route handlers**

`api/src/app/api/v1/reports/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { REPORTS } from "@/lib/reports/engine";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({
    data: Object.values(REPORTS).map((definition) => ({
      key: definition.key,
      name: definition.name,
      description: definition.description,
      columns: definition.columns,
      chart: definition.chart,
      formats: ["json", "csv", "xlsx", "pdf", "svg", "png"],
    })),
  });
});
```

`api/src/app/api/v1/reports/[key]/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { runReport, parseReportParams, REPORTS } from "@/lib/reports/engine";
import { renderJson } from "@/lib/reports/renderers/json";
import { renderCsv } from "@/lib/reports/renderers/csv";

const FORMATS = new Set(["json", "csv", "xlsx", "pdf", "svg", "png"]);

export const GET = safe(async (
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;

  const { key } = await params;
  if (!REPORTS[key]) return notFound("report");

  const url = new URL(req.url);
  const format = url.searchParams.get("format") ?? "json";
  if (!FORMATS.has(format)) {
    return problem(422, "validation", "Unsupported format", {
      detail: `format must be one of: ${[...FORMATS].join(", ")}`,
    });
  }

  const result = await runReport(ctx, key, parseReportParams(url));
  switch (format) {
    case "csv": return renderCsv(result);
    // xlsx, pdf, svg and png are wired up in Task 18.
    default: return renderJson(result);
  }
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/reports`
Expected: PASS, 16 tests.

- [ ] **Step 8: Commit**

```bash
git add api/src/lib/reports api/src/app/api/v1/reports
git commit -m "feat: report engine with nine definitions, chart specs, json and csv output"
```

---

### Task 18: Report renderers — XLSX, PDF, SVG/PNG — plus saved and scheduled reports

**Files:**
- Create: `api/migrations/008_reports.sql`
- Create: `api/src/lib/reports/palette.ts`, `api/src/lib/reports/charts.ts`
- Create: `api/src/lib/reports/renderers/xlsx.ts`, `api/src/lib/reports/renderers/pdf.ts`, `api/src/lib/reports/renderers/svg.ts`
- Create: `api/src/lib/reports/saved.ts`, `api/src/lib/reports/schedules.ts` (replacing the Task 15 stub)
- Modify: `api/src/app/api/v1/reports/[key]/route.ts` (wire the remaining formats)
- Create: `api/src/app/api/v1/saved-reports/route.ts`, `api/src/app/api/v1/saved-reports/[id]/route.ts`, `api/src/app/api/admin/report-schedules/route.ts`, `api/src/app/api/admin/report-schedules/[id]/route.ts`
- Test: `api/src/lib/reports/charts.test.ts`, `api/src/lib/reports/renderers.test.ts`, `api/src/lib/reports/schedules.test.ts`

**Interfaces:**
- Consumes: `ReportResult`, `runReport`, `enqueueTemplated`, `putObject`.
- Produces:
  - `PALETTE: string[]` — one accessible categorical set shared with the SPA
  - `buildChartSvg(result, { width, height }): string` — pure d3 geometry, no DOM
  - `renderXlsx(result): Promise<Response>`, `renderPdf(result): Promise<Response>`, `renderSvg(result): Response`, `renderPng(result): Promise<Response>`
  - `listSavedReports(ctx)`, `createSavedReport(ctx, input)`, `deleteSavedReport(ctx, id)`
  - `listSchedules(ctx)`, `createSchedule(ctx, input)`, `updateSchedule(ctx, id, patch)`, `deleteSchedule(ctx, id)`
  - `runDueSchedules(): Promise<{ delivered: number }>` — replaces the Task 15 stub

**Design note (spec §8.2):** one report definition, five renderings. No renderer runs its
own query — each takes a `ReportResult` and formats it. Charts are computed with d3's
scale and shape primitives, which produce path geometry without touching a DOM, so the
same code path serves the PDF, the PNG and a standalone SVG with no headless browser.

- [ ] **Step 1: Write the failing tests**

`api/src/lib/reports/charts.test.ts`:

```ts
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
```

`api/src/lib/reports/renderers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { renderXlsx } from "./renderers/xlsx";
import { renderPdf } from "./renderers/pdf";
import { renderSvg, renderPng } from "./renderers/svg";
import type { ReportResult } from "./types";

const result: ReportResult = {
  key: "assets-by-category", name: "Assets by category",
  description: "The register split by category.",
  generated_at: "2026-09-03T10:00:00Z", params: { days: 90 },
  filter_summary: "Next 90 days",
  columns: [
    { key: "category", label: "Category", type: "string" },
    { key: "count", label: "Assets", type: "number" },
    { key: "value", label: "Value", type: "money" },
  ],
  chart: { type: "bar", categoryKey: "category", valueKeys: ["count"], valueLabel: "Assets" },
  rows: [
    { category: "IT", count: 42, value: "520000000" },
    { category: "Plant", count: 11, value: "980000000" },
  ],
  totals: { category: "Total", count: 53, value: "1500000000" },
};

describe("renderXlsx", () => {
  it("returns a spreadsheet content type and filename", async () => {
    const res = await renderXlsx(result);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("assets-by-category");
  });

  it("writes a Summary sheet and a Data sheet", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await renderXlsx(result)).arrayBuffer());
    expect(workbook.worksheets.map((w) => w.name)).toEqual(["Summary", "Data"]);
  });

  it("puts the column labels in the header row", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await renderXlsx(result)).arrayBuffer());
    const header = workbook.getWorksheet("Data")!.getRow(1);
    expect([header.getCell(1).value, header.getCell(2).value, header.getCell(3).value])
      .toEqual(["Category", "Assets", "Value"]);
  });

  it("writes numbers as numbers, not text", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await renderXlsx(result)).arrayBuffer());
    expect(workbook.getWorksheet("Data")!.getRow(2).getCell(2).value).toBe(42);
  });

  it("freezes the header row and enables the auto-filter", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await renderXlsx(result)).arrayBuffer());
    const sheet = workbook.getWorksheet("Data")!;
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
  });

  it("appends the totals row", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await renderXlsx(result)).arrayBuffer());
    const sheet = workbook.getWorksheet("Data")!;
    expect(sheet.getRow(sheet.rowCount).getCell(1).value).toBe("Total");
  });
});

describe("renderPdf", () => {
  it("returns a real PDF", async () => {
    const res = await renderPdf(result);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("names the file after the report and date", async () => {
    const res = await renderPdf(result);
    expect(res.headers.get("content-disposition"))
      .toContain("assets-by-category-2026-09-03.pdf");
  });

  it("renders a report with no rows without throwing", async () => {
    const res = await renderPdf({ ...result, rows: [], totals: null });
    expect(res.status).toBe(200);
  });
});

describe("renderSvg and renderPng", () => {
  it("serves the chart as svg", () => {
    const res = renderSvg(result);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("rasterises the chart to a png", async () => {
    const res = await renderPng(result);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  });
});
```

`api/src/lib/reports/schedules.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createSavedReport, listSavedReports } from "./saved";
import { createSchedule, isDue, runDueSchedules } from "./schedules";
import { createRule } from "../notify/rules";

const orgId = randomUUID();
const userId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: userId, label: "Sched", scopes: ["admin"] },
};
let savedId: string;

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'S',$2)", [
    orgId, `sched-org-${orgId.slice(0, 8)}`,
  ]);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,'x','Sched','admin')`,
    [userId, orgId, `sched-${orgId.slice(0, 8)}@example.com`],
  );
  await createRule(ctx, {
    event: "report.scheduled", channel: "email", template_key: "report.scheduled",
    recipient_spec: {}, active: true,
  });
  savedId = (await createSavedReport(ctx, {
    name: "Weekly overdue", report_key: "assignments-overdue", params: {},
  })).id;
});

beforeEach(async () => {
  await pool.query("DELETE FROM email_messages WHERE org_id=$1", [orgId]);
  await pool.query("DELETE FROM report_schedules WHERE org_id=$1", [orgId]);
});

describe("saved reports", () => {
  it("stores a report key with its filter set", async () => {
    const list = await listSavedReports(ctx);
    expect(list[0]).toMatchObject({
      name: "Weekly overdue", report_key: "assignments-overdue",
    });
  });

  it("rejects an unknown report key", async () => {
    await expect(createSavedReport(ctx, {
      name: "Nope", report_key: "not-a-report", params: {},
    })).rejects.toThrow(/unknown report/i);
  });
});

describe("isDue", () => {
  const at = (iso: string) => new Date(iso);

  it("fires a daily schedule at its hour", () => {
    const schedule = { cadence: "daily", hour_utc: 8, day_of_week: null,
                       day_of_month: null, last_run_at: null } as never;
    expect(isDue(schedule, at("2026-09-03T08:05:00Z"))).toBe(true);
    expect(isDue(schedule, at("2026-09-03T07:05:00Z"))).toBe(false);
  });

  it("does not fire twice in the same hour", () => {
    const schedule = { cadence: "daily", hour_utc: 8, day_of_week: null,
                       day_of_month: null,
                       last_run_at: "2026-09-03T08:01:00Z" } as never;
    expect(isDue(schedule, at("2026-09-03T08:45:00Z"))).toBe(false);
  });

  it("fires a weekly schedule only on its weekday", () => {
    // 2026-09-03 is a Thursday (day 4).
    const schedule = { cadence: "weekly", hour_utc: 8, day_of_week: 4,
                       day_of_month: null, last_run_at: null } as never;
    expect(isDue(schedule, at("2026-09-03T08:05:00Z"))).toBe(true);
    expect(isDue(schedule, at("2026-09-04T08:05:00Z"))).toBe(false);
  });

  it("fires a monthly schedule only on its day of month", () => {
    const schedule = { cadence: "monthly", hour_utc: 6, day_of_week: null,
                       day_of_month: 1, last_run_at: null } as never;
    expect(isDue(schedule, at("2026-10-01T06:05:00Z"))).toBe(true);
    expect(isDue(schedule, at("2026-10-02T06:05:00Z"))).toBe(false);
  });
});

describe("runDueSchedules", () => {
  it("queues an email with the rendered report attached", async () => {
    await createSchedule(ctx, {
      saved_report_id: savedId, format: "xlsx", cadence: "daily",
      hour_utc: new Date().getUTCHours(),
      recipients: ["ops@example.com"], active: true,
    });
    const result = await runDueSchedules();
    expect(result.delivered).toBeGreaterThan(0);

    const { rows } = await pool.query(
      `SELECT to_addresses, attachments, event
         FROM email_messages WHERE org_id=$1 AND event='report.scheduled'`,
      [orgId],
    );
    expect(rows[0].to_addresses).toEqual(["ops@example.com"]);
    expect(rows[0].attachments).toHaveLength(1);
    expect(rows[0].attachments[0].filename).toMatch(/\.xlsx$/);
  });

  it("stamps last_run_at so the same hour does not deliver twice", async () => {
    await createSchedule(ctx, {
      saved_report_id: savedId, format: "pdf", cadence: "daily",
      hour_utc: new Date().getUTCHours(),
      recipients: ["ops@example.com"], active: true,
    });
    await runDueSchedules();
    const second = await runDueSchedules();
    expect(second.delivered).toBe(0);
  });

  it("skips an inactive schedule", async () => {
    await createSchedule(ctx, {
      saved_report_id: savedId, format: "csv", cadence: "daily",
      hour_utc: new Date().getUTCHours(),
      recipients: ["ops@example.com"], active: false,
    });
    await expect(runDueSchedules()).resolves.toEqual({ delivered: 0 });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && npx vitest run src/lib/reports`
Expected: FAIL — `Cannot find module './charts'`.

- [ ] **Step 3: Add the dependencies**

```bash
cd api && npm install pdfmake d3-scale d3-shape d3-array @resvg/resvg-js && \
  npm install -D @types/pdfmake @types/d3-scale @types/d3-shape @types/d3-array
```

- [ ] **Step 4: Implement the palette and the chart builder**

`api/src/lib/reports/palette.ts`:

```ts
/**
 * One categorical palette, used by the server-side SVG renderer and exported to the
 * SPA's ApexCharts config, so a printed PDF matches the screen it came from.
 * Checked for contrast against both the light and dark surfaces the app uses.
 */
export const PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ef4444", // red
  "#14b8a6", // teal
  "#ec4899", // pink
  "#6366f1", // indigo
  "#84cc16", // lime
  "#f97316", // orange
] as const;

export const STATUS_COLORS: Record<string, string> = {
  available: "#10b981",
  in_use: "#3b82f6",
  maintenance: "#f59e0b",
  retired: "#6b7280",
  lost: "#ef4444",
};

export const colorFor = (label: string, index: number): string =>
  STATUS_COLORS[label] ?? PALETTE[index % PALETTE.length];

export const INK = "#1f2937";
export const MUTED = "#6b7280";
export const GRID = "#e5e7eb";
```

`api/src/lib/reports/charts.ts`:

```ts
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
 * d3-scale and d3-shape compute geometry only — no DOM, no canvas — so the same
 * function serves a standalone SVG, an embedded PDF vector and a rasterised PNG.
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

  const axis = horizontal
    ? `<line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="${GRID}"/>`
    : `<line x1="0" y1="${innerH}" x2="${innerW}" y2="${innerH}" stroke="${GRID}"/>`;

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
```

- [ ] **Step 5: Implement the XLSX renderer**

`api/src/lib/reports/renderers/xlsx.ts`:

```ts
import ExcelJS from "exceljs";
import type { ReportColumn, ReportResult } from "../types";

const NUMBER_FORMATS: Record<ReportColumn["type"], string | undefined> = {
  string: undefined,
  number: "#,##0",
  date: "dd mmm yyyy",
  money: "#,##0.00",
  percent: "0.0%",
};

function cellValue(column: ReportColumn, raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (column.type) {
    case "number":
    case "money":
      return Number(raw);
    case "percent":
      return Number(raw) / 100;
    case "date": {
      const date = new Date(String(raw));
      return Number.isNaN(date.getTime()) ? String(raw) : date;
    }
    default:
      return String(raw);
  }
}

export async function renderXlsx(result: ReportResult): Promise<Response> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Asset Management System";
  workbook.created = new Date(result.generated_at);

  // Summary first: whoever opens the file sees what it is before the raw grid.
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 24 }, { width: 60 }];
  const meta: [string, string][] = [
    ["Report", result.name],
    ["Description", result.description],
    ["Filters", result.filter_summary],
    ["Generated", new Date(result.generated_at).toUTCString()],
    ["Rows", String(result.rows.length)],
  ];
  for (const [label, value] of meta) {
    const row = summary.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }
  if (result.totals) {
    summary.addRow([]);
    summary.addRow(["Totals", ""]).getCell(1).font = { bold: true };
    for (const column of result.columns) {
      const value = result.totals[column.key];
      if (value !== undefined && value !== null) {
        summary.addRow([column.label, String(value)]);
      }
    }
  }

  const data = workbook.addWorksheet("Data");
  data.columns = result.columns.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.max(12, Math.min(40, column.label.length + 6)),
    style: { numFmt: NUMBER_FORMATS[column.type] },
  }));

  const header = data.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B82F6" } };
  header.alignment = { vertical: "middle" };
  header.height = 20;

  for (const row of result.rows) {
    data.addRow(Object.fromEntries(
      result.columns.map((column) => [column.key, cellValue(column, row[column.key])]),
    ));
  }

  if (result.totals) {
    const totals = data.addRow(Object.fromEntries(
      result.columns.map((column) => [
        column.key, cellValue(column, result.totals![column.key]),
      ]),
    ));
    totals.font = { bold: true };
    totals.border = { top: { style: "thin" } };
  }

  data.views = [{ state: "frozen", ySplit: 1 }];
  data.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: result.columns.length },
  };

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const date = result.generated_at.slice(0, 10);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${result.key}-${date}.xlsx"`,
    },
  });
}
```

- [ ] **Step 6: Implement the PDF and SVG/PNG renderers**

`api/src/lib/reports/renderers/pdf.ts`:

```ts
import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { buildChartSvg } from "../charts";
import { INK, MUTED } from "../palette";
import type { ReportColumn, ReportResult } from "../types";

// The standard 14 PDF fonts need no font files in the image.
const printer = new PdfPrinter({
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
});

function format(column: ReportColumn, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
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
  const body: unknown[][] = [
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
      ...(chartSvg ? [{ svg: chartSvg, width: 500, margin: [0, 0, 0, 16] as [number, number, number, number] }] : []),
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

  const chunks: Buffer[] = [];
  const doc = printer.createPdfKitDocument(definition);
  const buffer = await new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });

  const date = result.generated_at.slice(0, 10);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${result.key}-${date}.pdf"`,
    },
  });
}
```

`api/src/lib/reports/renderers/svg.ts`:

```ts
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
    fitTo: { mode: "width", value: SIZE.width * 2 }, // 2× for retina and print
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
```

- [ ] **Step 7: Write the migration and the saved/scheduled report modules**

`api/migrations/008_reports.sql`:

```sql
CREATE TABLE saved_reports (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  report_key text NOT NULL,
  params     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE report_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  saved_report_id uuid NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
  format          text NOT NULL DEFAULT 'pdf',
  cadence         text NOT NULL DEFAULT 'weekly',
  day_of_week     integer,          -- 0=Sunday .. 6=Saturday, weekly only
  day_of_month    integer,          -- 1..28, monthly only
  hour_utc        integer NOT NULL DEFAULT 8,
  recipients      jsonb NOT NULL DEFAULT '[]'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  last_run_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_schedules_format_chk CHECK (format IN ('csv','xlsx','pdf','png')),
  CONSTRAINT report_schedules_cadence_chk CHECK (cadence IN ('daily','weekly','monthly')),
  CONSTRAINT report_schedules_hour_chk CHECK (hour_utc BETWEEN 0 AND 23),
  CONSTRAINT report_schedules_dow_chk CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  -- Capped at 28 so a monthly schedule fires in February too.
  CONSTRAINT report_schedules_dom_chk CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28)
);
CREATE INDEX report_schedules_active_idx ON report_schedules (active, hour_utc);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['saved_reports', 'report_schedules'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON saved_reports, report_schedules TO ams_app;
```

`api/src/lib/reports/saved.ts`:

```ts
import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { REPORTS } from "./definitions";

export const SavedReportInput = z.object({
  name: z.string().min(1).max(120),
  report_key: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});
export type SavedReportInput = z.infer<typeof SavedReportInput>;

export interface SavedReport {
  id: string;
  name: string;
  report_key: string;
  params: Record<string, unknown>;
  created_at: string;
}

export const listSavedReports = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<SavedReport>(
      `SELECT id, name, report_key, params, created_at
         FROM saved_reports ORDER BY name`,
    )).rows,
  );

export const getSavedReport = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<SavedReport>(
      "SELECT id, name, report_key, params, created_at FROM saved_reports WHERE id = $1",
      [id],
    )).rows[0] ?? null,
  );

export function createSavedReport(ctx: Ctx, input: SavedReportInput) {
  if (!REPORTS[input.report_key]) {
    throw new Error(`unknown report: ${input.report_key}`);
  }
  return withTenant(ctx.orgId, async (c) =>
    (await c.query<SavedReport>(
      `INSERT INTO saved_reports (org_id, name, report_key, params, created_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, report_key, params, created_at`,
      [
        ctx.orgId, input.name, input.report_key, JSON.stringify(input.params),
        ctx.actor.type === "user" ? ctx.actor.id : null,
      ],
    )).rows[0],
  );
}

export const deleteSavedReport = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query("DELETE FROM saved_reports WHERE id = $1 RETURNING id", [id]))
      .rowCount === 1,
  );
```

`api/src/lib/reports/schedules.ts` (replacing the Task 15 stub):

```ts
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool, withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { putObject } from "../storage/s3";
import { enqueueTemplated } from "../email/outbox";
import { runReport } from "./engine";
import { renderCsv } from "./renderers/csv";
import { renderXlsx } from "./renderers/xlsx";
import { renderPdf } from "./renderers/pdf";
import { renderPng } from "./renderers/svg";
import type { ReportParams, ReportResult } from "./types";

export const ScheduleInput = z.object({
  saved_report_id: z.string().uuid(),
  format: z.enum(["csv", "xlsx", "pdf", "png"]).default("pdf"),
  cadence: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
  day_of_week: z.number().int().min(0).max(6).nullish(),
  day_of_month: z.number().int().min(1).max(28).nullish(),
  hour_utc: z.number().int().min(0).max(23).default(8),
  recipients: z.array(z.string().email()).min(1),
  active: z.boolean().default(true),
});
export type ScheduleInput = z.infer<typeof ScheduleInput>;

export interface Schedule {
  id: string;
  org_id: string;
  saved_report_id: string;
  format: "csv" | "xlsx" | "pdf" | "png";
  cadence: "daily" | "weekly" | "monthly";
  day_of_week: number | null;
  day_of_month: number | null;
  hour_utc: number;
  recipients: string[];
  active: boolean;
  last_run_at: string | null;
  report_key?: string;
  report_name?: string;
  params?: ReportParams;
}

const SELECT = `
  SELECT s.id, s.org_id, s.saved_report_id, s.format, s.cadence, s.day_of_week,
         s.day_of_month, s.hour_utc, s.recipients, s.active, s.last_run_at,
         r.report_key, r.name AS report_name, r.params
    FROM report_schedules s
    JOIN saved_reports r ON r.id = s.saved_report_id`;

export const listSchedules = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Schedule>(`${SELECT} ORDER BY r.name`)).rows,
  );

export const createSchedule = (ctx: Ctx, input: ScheduleInput) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Schedule>(
      `INSERT INTO report_schedules
         (org_id, saved_report_id, format, cadence, day_of_week, day_of_month,
          hour_utc, recipients, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, org_id, saved_report_id, format, cadence, day_of_week,
                 day_of_month, hour_utc, recipients, active, last_run_at`,
      [
        ctx.orgId, input.saved_report_id, input.format, input.cadence,
        input.day_of_week ?? null, input.day_of_month ?? null, input.hour_utc,
        JSON.stringify(input.recipients), input.active,
      ],
    )).rows[0],
  );

export const updateSchedule = (ctx: Ctx, id: string, patch: Partial<ScheduleInput>) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Schedule>(
      `UPDATE report_schedules SET
         format       = coalesce($2, format),
         cadence      = coalesce($3, cadence),
         day_of_week  = coalesce($4, day_of_week),
         day_of_month = coalesce($5, day_of_month),
         hour_utc     = coalesce($6, hour_utc),
         recipients   = coalesce($7, recipients),
         active       = coalesce($8, active)
       WHERE id = $1
       RETURNING id, org_id, saved_report_id, format, cadence, day_of_week,
                 day_of_month, hour_utc, recipients, active, last_run_at`,
      [
        id, patch.format ?? null, patch.cadence ?? null, patch.day_of_week ?? null,
        patch.day_of_month ?? null, patch.hour_utc ?? null,
        patch.recipients ? JSON.stringify(patch.recipients) : null,
        patch.active ?? null,
      ],
    )).rows[0] ?? null,
  );

export const deleteSchedule = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query("DELETE FROM report_schedules WHERE id = $1 RETURNING id", [id]))
      .rowCount === 1,
  );

/**
 * Fires at most once per scheduled hour. The job runner ticks hourly, so the
 * last_run_at guard is what keeps a report from being emailed twice.
 */
export function isDue(schedule: Schedule, now = new Date()): boolean {
  if (now.getUTCHours() !== schedule.hour_utc) return false;
  if (schedule.cadence === "weekly" && now.getUTCDay() !== schedule.day_of_week) return false;
  if (schedule.cadence === "monthly" && now.getUTCDate() !== schedule.day_of_month) return false;

  if (schedule.last_run_at) {
    const last = new Date(schedule.last_run_at);
    const sameHour =
      last.getUTCFullYear() === now.getUTCFullYear() &&
      last.getUTCMonth() === now.getUTCMonth() &&
      last.getUTCDate() === now.getUTCDate() &&
      last.getUTCHours() === now.getUTCHours();
    if (sameHour) return false;
  }
  return true;
}

async function renderTo(
  result: ReportResult,
  format: Schedule["format"],
): Promise<{ body: Buffer; contentType: string; extension: string }> {
  const response =
    format === "csv" ? renderCsv(result)
    : format === "xlsx" ? await renderXlsx(result)
    : format === "png" ? await renderPng(result)
    : await renderPdf(result);

  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    extension: format,
  };
}

/** Runs every organisation's due schedules and queues them for delivery. */
export async function runDueSchedules(now = new Date()): Promise<{ delivered: number }> {
  const { rows: orgs } = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM organizations",
  );
  let delivered = 0;

  for (const org of orgs) {
    const ctx: Ctx = {
      orgId: org.id,
      actor: { type: "system", id: org.id, label: org.name, scopes: ["admin"] },
    };

    let schedules: Schedule[];
    try {
      schedules = (await withTenant(org.id, async (c) =>
        (await c.query<Schedule>(`${SELECT} WHERE s.active = true`)).rows,
      ));
    } catch (err) {
      console.error(`could not read schedules for ${org.name}:`, err);
      continue;
    }

    for (const schedule of schedules) {
      if (!isDue(schedule, now)) continue;
      try {
        const result = await runReport(
          ctx, schedule.report_key!, (schedule.params ?? {}) as ReportParams,
        );
        const file = await renderTo(result, schedule.format);

        // Attachments travel through object storage, so a large workbook never
        // sits in a database row or in memory between queue and send.
        const date = result.generated_at.slice(0, 10);
        const filename = `${result.key}-${date}.${file.extension}`;
        const objectKey = `${org.id}/reports/${randomUUID()}-${filename}`;
        await putObject(objectKey, file.body, file.contentType);

        await enqueueTemplated(
          ctx, "report.scheduled", schedule.recipients,
          {
            report: {
              name: schedule.report_name,
              format: schedule.format.toUpperCase(),
              period: result.filter_summary,
              generated_at: result.generated_at,
            },
            org: { name: org.name },
          },
          {
            event: "report.scheduled",
            attachments: [
              { filename, object_key: objectKey, content_type: file.contentType },
            ],
          },
        );

        await withTenant(org.id, (c) =>
          c.query("UPDATE report_schedules SET last_run_at = now() WHERE id = $1",
            [schedule.id]),
        );
        delivered++;
      } catch (err) {
        console.error(`schedule ${schedule.id} failed:`, err);
      }
    }
  }
  return { delivered };
}
```

- [ ] **Step 8: Wire the remaining formats into the report route**

Replace the `switch` in `api/src/app/api/v1/reports/[key]/route.ts`:

```ts
import { renderXlsx } from "@/lib/reports/renderers/xlsx";
import { renderPdf } from "@/lib/reports/renderers/pdf";
import { renderSvg, renderPng } from "@/lib/reports/renderers/svg";

// …inside GET, replacing the previous switch:
  switch (format) {
    case "csv":  return renderCsv(result);
    case "xlsx": return renderXlsx(result);
    case "pdf":  return renderPdf(result);
    case "svg":  return renderSvg(result);
    case "png":  return renderPng(result);
    default:     return renderJson(result);
  }
```

- [ ] **Step 9: Implement the saved-report and schedule route handlers**

`api/src/app/api/v1/saved-reports/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, problem, conflict } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listSavedReports, createSavedReport, SavedReportInput } from "@/lib/reports/saved";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listSavedReports(ctx) });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  const parsed = SavedReportInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  try {
    return Response.json(await createSavedReport(ctx, parsed.data), { status: 201 });
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === "23505") return conflict("A saved report with that name already exists.");
    if (/unknown report/i.test(e.message)) {
      return problem(422, "validation", "Validation failed", { detail: e.message });
    }
    throw err;
  }
});
```

`api/src/app/api/v1/saved-reports/[id]/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getSavedReport, deleteSavedReport } from "@/lib/reports/saved";

type Params = { params: Promise<{ id: string }> };

export const GET = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  const saved = await getSavedReport(ctx, (await params).id);
  return saved ? Response.json(saved) : notFound("saved report");
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "reports:read");
  if (isResponse(ctx)) return ctx;
  const done = await deleteSavedReport(ctx, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("saved report");
});
```

`api/src/app/api/admin/report-schedules/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listSchedules, createSchedule, ScheduleInput } from "@/lib/reports/schedules";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listSchedules(ctx) });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = ScheduleInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  return Response.json(await createSchedule(ctx, parsed.data), { status: 201 });
});
```

`api/src/app/api/admin/report-schedules/[id]/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { updateSchedule, deleteSchedule, ScheduleInput } from "@/lib/reports/schedules";

type Params = { params: Promise<{ id: string }> };

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = ScheduleInput.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  const updated = await updateSchedule(ctx, (await params).id, parsed.data);
  return updated ? Response.json(updated) : notFound("report schedule");
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const done = await deleteSchedule(ctx, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("report schedule");
});
```

- [ ] **Step 10: Run the tests to verify they pass**

```bash
cd api
MIGRATION_DATABASE_URL=postgres://ams:ams@localhost:5433/ams_test npm run migrate
npx vitest run src/lib/reports
```

Expected: PASS — 8 chart tests, 11 renderer tests, 9 schedule tests, plus the 16 engine
tests from Task 17.

- [ ] **Step 11: Run the whole API suite**

Run: `cd api && npm test`
Expected: PASS — every suite from Tasks 1–18 green.

- [ ] **Step 12: Commit**

```bash
git add api/migrations/008_reports.sql api/src/lib/reports api/src/app/api/v1 api/src/app/api/admin api/package.json
git commit -m "feat: xlsx, pdf and svg/png report renderers with saved and scheduled reports"
```

---

**Phase 3 complete.** The API can now move data in and out, hold evidence files, send
mail through any of six providers with failover, notify people on rules they control,
run its own scheduled work, and produce every report in five formats — delivered on a
schedule by email. Continue to [Phase 4 — Identification](./04-identification.md).
