import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { parseUpload, suggestMapping, runImport } from "./imports";
import { createCategory } from "./categories";
import { listAssets } from "./assets";

let orgId: string;
let ctx: Ctx;
let categoryId: string;

const page = { page: 1, perPage: 100, offset: 0 };
const sort = { column: "name", direction: "ASC" as const };

beforeAll(async () => {
  orgId = await createOrg("Import Org");
  const importer = await createUserWithRole(orgId, "Manager", { name: "Importer" });
  ctx = {
    orgId,
    actor: {
      type: "user", id: importer.id, label: "Importer", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
  categoryId = (await createCategory(ctx, {
    name: "IT", kind: "it",
    field_schema: { fields: [
      { key: "os", label: "OS", type: "string", required: false },
      { key: "warranty_end", label: "Warranty End", type: "date", required: false },
      { key: "ram_gb", label: "RAM", type: "number", required: false },
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

  it("trims whitespace from headers", async () => {
    const out = await parseUpload(Buffer.from("  Name  ,Serial\nA,1\n"), "x.csv");
    expect(out.headers).toEqual(["Name", "Serial"]);
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

  it("is insensitive to case, spacing and punctuation", () => {
    const map = suggestMapping(["SERIAL_NUMBER", "asset  name"], { fields: [] });
    expect(map["SERIAL_NUMBER"]).toBe("serial_no");
    expect(map["asset  name"]).toBe("name");
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

  it("coerces a spreadsheet string into a number field", async () => {
    // Everything from a CSV is text; the category validator wants real types.
    const csv = `Asset Name,Serial Number,RAM\nTyped,TY-001,16\n`;
    const { rows } = await parseUpload(Buffer.from(csv), "t.csv");
    await runImport(ctx, {
      rows,
      mapping: { "Asset Name": "name", "Serial Number": "serial_no", "RAM": "custom.ram_gb" },
      categoryId, dryRun: false, filename: "t.csv",
    });
    const after = await listAssets(ctx, { q: "TY-001" }, page, sort);
    expect(after.rows[0].custom).toEqual({ ram_gb: 16 });
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

  it("counts a rejected row as skipped, not created", async () => {
    const csv = `Asset Name,Serial Number,Status\n,SK-001,available\n`;
    const { rows } = await parseUpload(Buffer.from(csv), "s.csv");
    const result = await runImport(ctx, {
      rows,
      mapping: { "Asset Name": "name", "Serial Number": "serial_no", "Status": "status" },
      categoryId, dryRun: true, filename: "s.csv",
    });
    expect(result).toMatchObject({ total: 1, created: 0, skipped: 1 });
  });

  it("records the job so the result can be fetched later", async () => {
    const { rows } = await parseUpload(Buffer.from(CSV), "e.csv");
    const result = await runImport(ctx, {
      rows, mapping, categoryId, dryRun: true, filename: "e.csv",
    });
    const job = await withTenant(orgId, async (c) =>
      (await c.query<{ filename: string; dry_run: boolean; total: number }>(
        "SELECT filename, dry_run, total FROM import_jobs WHERE id = $1", [result.job_id],
      )).rows[0],
    );
    expect(job).toMatchObject({ filename: "e.csv", dry_run: true, total: 2 });
  });

  it("writes an audit event per created asset, so an import is traceable", async () => {
    const csv = `Asset Name,Serial Number\nTraceable,TR-001\n`;
    const { rows } = await parseUpload(Buffer.from(csv), "audit.csv");
    await runImport(ctx, {
      rows, mapping: { "Asset Name": "name", "Serial Number": "serial_no" },
      categoryId, dryRun: false, filename: "audit.csv",
    });
    const events = await withTenant(orgId, async (c) =>
      (await c.query<{ event: string }>(
        `SELECT e.event FROM audit_events e
           JOIN assets a ON a.id = e.asset_id
          WHERE a.serial_no = 'TR-001'`,
      )).rows,
    );
    expect(events.map((e) => e.event)).toContain("asset.created");
  });
});
