# Phase 2 — Core registry

> Part of the [Assets Management System plan](./00-overview.md). Read `00-overview.md` first — its Global Constraints apply to every task here.

**Tasks 5–9.** Categories with per-category custom field schemas, asset CRUD with generated tags and audit events, search/filter/sort/pagination, check-out and check-in with guarded transitions, and the audit trail endpoint.

**Spec sections:** §4 (domain model), §5 (public API).

---

### Task 5: Categories with validated custom field schemas

**Files:**
- Create: `api/src/lib/validation/customFields.ts`, `api/src/lib/domain/categories.ts`
- Create: `api/src/app/api/v1/categories/route.ts`, `api/src/app/api/v1/categories/[id]/route.ts`
- Test: `api/src/lib/validation/customFields.test.ts`

**Interfaces:**
- Consumes: `withTenant` (Task 1), `Ctx` (Task 3), `requireAuth`/`isResponse` (Task 4), `validationProblem`/`conflict`/`notFound` (Task 3).
- Produces:
  - `type FieldDef = { key: string; label: string; type: "string"|"number"|"date"|"boolean"|"enum"; required: boolean; options?: string[] }`
  - `type FieldSchema = { fields: FieldDef[] }`
  - `FieldSchemaZ` — Zod validator for a schema definition
  - `buildCustomValidator(schema: FieldSchema): ZodType<Record<string, unknown>>` — validates an asset's `custom` payload against that schema
  - `listCategories(ctx)`, `getCategory(ctx, id)`, `createCategory(ctx, input)`, `updateCategory(ctx, id, patch)`
  - `CategoryInput` Zod schema

- [ ] **Step 1: Write the failing test**

`api/src/lib/validation/customFields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FieldSchemaZ, buildCustomValidator } from "./customFields";

const itSchema = {
  fields: [
    { key: "warranty_end", label: "Warranty End", type: "date", required: false },
    { key: "os", label: "OS", type: "enum", required: true,
      options: ["Windows 11", "macOS"] },
    { key: "ram_gb", label: "RAM (GB)", type: "number", required: false },
  ],
} as const;

describe("FieldSchemaZ", () => {
  it("accepts a well-formed schema", () => {
    expect(FieldSchemaZ.safeParse(itSchema).success).toBe(true);
  });

  it("requires options on an enum field", () => {
    const bad = { fields: [{ key: "os", label: "OS", type: "enum", required: false }] };
    expect(FieldSchemaZ.safeParse(bad).success).toBe(false);
  });

  it("rejects a key that is not a safe identifier", () => {
    const bad = { fields: [{ key: "bad key!", label: "X", type: "string", required: false }] };
    expect(FieldSchemaZ.safeParse(bad).success).toBe(false);
  });

  it("rejects duplicate keys", () => {
    const bad = { fields: [
      { key: "os", label: "A", type: "string", required: false },
      { key: "os", label: "B", type: "string", required: false },
    ] };
    expect(FieldSchemaZ.safeParse(bad).success).toBe(false);
  });
});

describe("buildCustomValidator", () => {
  const validator = buildCustomValidator(itSchema as never);

  it("accepts a valid custom payload", () => {
    expect(validator.safeParse({
      os: "macOS", ram_gb: 16, warranty_end: "2027-01-31",
    }).success).toBe(true);
  });

  it("rejects a missing required field", () => {
    expect(validator.safeParse({ ram_gb: 8 }).success).toBe(false);
  });

  it("rejects a value outside the enum options", () => {
    expect(validator.safeParse({ os: "TempleOS" }).success).toBe(false);
  });

  it("rejects a number field given a non-number", () => {
    expect(validator.safeParse({ os: "macOS", ram_gb: "lots" }).success).toBe(false);
  });

  it("strips fields the schema does not declare", () => {
    expect(validator.parse({ os: "macOS", sneaky: "value" })).not.toHaveProperty("sneaky");
  });

  it("accepts an empty payload when nothing is required", () => {
    const optional = buildCustomValidator({ fields: [
      { key: "note", label: "Note", type: "string", required: false },
    ] });
    expect(optional.safeParse({}).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/validation`
Expected: FAIL with `Cannot find module './customFields'`.

- [ ] **Step 3: Implement the field-schema layer**

`api/src/lib/validation/customFields.ts`:

```ts
import { z } from "zod";

export const FIELD_TYPES = ["string", "number", "date", "boolean", "enum"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}
export interface FieldSchema {
  fields: FieldDef[];
}

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

const FieldDefZ = z
  .object({
    key: z.string().regex(KEY_RE, "key must be snake_case, starting with a letter"),
    label: z.string().min(1).max(80),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine((f) => f.type !== "enum" || (f.options?.length ?? 0) > 0, {
    message: "enum fields must declare options",
    path: ["options"],
  });

export const FieldSchemaZ = z
  .object({ fields: z.array(FieldDefZ).max(50) })
  .refine((s) => new Set(s.fields.map((f) => f.key)).size === s.fields.length, {
    message: "field keys must be unique",
    path: ["fields"],
  });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function zodForField(field: FieldDef): z.ZodTypeAny {
  switch (field.type) {
    case "string":  return z.string().max(2000);
    case "number":  return z.number().finite();
    case "boolean": return z.boolean();
    case "date":    return z.string().regex(ISO_DATE, "expected an ISO date (YYYY-MM-DD)");
    case "enum":    return z.enum(field.options as [string, ...string[]]);
  }
}

/**
 * Builds a validator for an asset's `custom` object from its category schema.
 * Unknown keys are stripped rather than rejected, so a category can drop a field
 * without breaking integrators that still send it.
 */
export function buildCustomValidator(
  schema: FieldSchema,
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of schema.fields) {
    const base = zodForField(field);
    shape[field.key] = field.required ? base : base.optional().nullable();
  }
  return z.object(shape).strip() as z.ZodType<Record<string, unknown>>;
}
```

- [ ] **Step 4: Implement the category domain module**

`api/src/lib/domain/categories.ts`:

```ts
import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { FieldSchemaZ, type FieldSchema } from "../validation/customFields";

export const CategoryInput = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["it", "equipment", "media"]),
  field_schema: FieldSchemaZ.default({ fields: [] }),
});
export type CategoryInput = z.infer<typeof CategoryInput>;

export interface Category {
  id: string;
  name: string;
  kind: "it" | "equipment" | "media";
  field_schema: FieldSchema;
  asset_count?: number;
}

export const listCategories = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Category>(
      `SELECT c.id, c.name, c.kind, c.field_schema,
              count(a.id) FILTER (WHERE a.deleted_at IS NULL)::int AS asset_count
         FROM categories c
         LEFT JOIN assets a ON a.category_id = c.id
        GROUP BY c.id
        ORDER BY c.name`,
    )).rows,
  );

export const getCategory = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Category>(
      "SELECT id, name, kind, field_schema FROM categories WHERE id = $1", [id],
    )).rows[0] ?? null,
  );

export const createCategory = (ctx: Ctx, input: CategoryInput) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Category>(
      `INSERT INTO categories (org_id, name, kind, field_schema)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, kind, field_schema`,
      [ctx.orgId, input.name, input.kind, JSON.stringify(input.field_schema)],
    )).rows[0],
  );

export const updateCategory = (ctx: Ctx, id: string, patch: Partial<CategoryInput>) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Category>(
      `UPDATE categories SET
         name         = coalesce($2, name),
         kind         = coalesce($3, kind),
         field_schema = coalesce($4, field_schema)
       WHERE id = $1
       RETURNING id, name, kind, field_schema`,
      [
        id,
        patch.name ?? null,
        patch.kind ?? null,
        patch.field_schema ? JSON.stringify(patch.field_schema) : null,
      ],
    )).rows[0] ?? null,
  );
```

- [ ] **Step 5: Implement the route handlers**

`api/src/app/api/v1/categories/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, conflict } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listCategories, createCategory, CategoryInput } from "@/lib/domain/categories";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listCategories(ctx) });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = CategoryInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  try {
    return Response.json(await createCategory(ctx, parsed.data), { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return conflict("A category with that name already exists.");
    }
    throw err;
  }
});
```

`api/src/app/api/v1/categories/[id]/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getCategory, updateCategory, CategoryInput } from "@/lib/domain/categories";

type Params = { params: Promise<{ id: string }> };

export const GET = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  const category = await getCategory(ctx, (await params).id);
  return category ? Response.json(category) : notFound("category");
});

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = CategoryInput.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  const updated = await updateCategory(ctx, (await params).id, parsed.data);
  return updated ? Response.json(updated) : notFound("category");
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/validation`
Expected: PASS, 10 tests.

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/validation api/src/lib/domain/categories.ts api/src/app/api/v1/categories
git commit -m "feat: categories with validated per-category custom field schemas"
```

---

### Task 6: Asset creation and reads, with tag generation and audit events

**Files:**
- Create: `api/src/lib/domain/audit.ts`, `api/src/lib/domain/assets.ts`
- Create: `api/src/app/api/v1/assets/[id]/route.ts`
- Test: `api/src/lib/domain/assets.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `Ctx`, `buildCustomValidator`, `FieldSchema`.
- Produces:
  - `STATUSES`, `type AssetStatus`, `AssetInput` (Zod), `interface Asset`, `SELECT_ASSET` (shared SQL projection)
  - `nextAssetTag(client, orgId): Promise<string>` — `AMS-000001` sequence per org
  - `createAsset(ctx, input): Promise<Asset>`
  - `getAsset(ctx, id): Promise<Asset | null>`, `getAssetByTag(ctx, tag): Promise<Asset | null>`
  - `updateAsset(ctx, id, patch): Promise<Asset | null>`, `softDeleteAsset(ctx, id): Promise<boolean>`
  - From `audit.ts`: `recordEvent(client, ctx, { assetId, event, changes?, note? })`, `diff(before, after)`, `listAssetHistory(ctx, assetId, limit?)`, `interface AuditEvent`

- [ ] **Step 1: Write the failing test**

`api/src/lib/domain/assets.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createAsset, getAsset, updateAsset, softDeleteAsset } from "./assets";
import { createCategory } from "./categories";

const orgId = randomUUID();
const ctx: Ctx = {
  orgId,
  actor: { type: "user", id: randomUUID(), label: "Tester",
           scopes: ["assets:read", "assets:write", "admin"] },
};
let categoryId: string;

beforeAll(async () => {
  await pool.query(
    "INSERT INTO organizations (id, name, slug) VALUES ($1,'Asset Org',$2)",
    [orgId, `asset-org-${orgId.slice(0, 8)}`],
  );
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,'x','Tester','admin')`,
    [ctx.actor.id, orgId, `tester-${orgId.slice(0, 8)}@example.com`],
  );
  categoryId = (await createCategory(ctx, {
    name: "IT Equipment",
    kind: "it",
    field_schema: { fields: [
      { key: "os", label: "OS", type: "string", required: false },
      { key: "ram_gb", label: "RAM", type: "number", required: false },
    ] },
  })).id;
});

describe("createAsset", () => {
  it("generates a sequential asset tag when none is supplied", async () => {
    const a = await createAsset(ctx, { name: "Laptop A", category_id: categoryId });
    const b = await createAsset(ctx, { name: "Laptop B", category_id: categoryId });
    expect(a.asset_tag).toMatch(/^AMS-\d{6}$/);
    expect(Number(b.asset_tag.slice(4))).toBe(Number(a.asset_tag.slice(4)) + 1);
  });

  it("defaults status to available", async () => {
    const a = await createAsset(ctx, { name: "Laptop C", category_id: categoryId });
    expect(a.status).toBe("available");
  });

  it("stores validated custom fields", async () => {
    const a = await createAsset(ctx, {
      name: "Laptop D", category_id: categoryId,
      custom: { os: "Ubuntu 24.04", ram_gb: 32 },
    });
    expect(a.custom).toEqual({ os: "Ubuntu 24.04", ram_gb: 32 });
  });

  it("rejects a custom field of the wrong type", async () => {
    await expect(createAsset(ctx, {
      name: "Laptop E", category_id: categoryId, custom: { ram_gb: "loads" },
    })).rejects.toThrow(/ram_gb/);
  });

  it("rejects a duplicate serial number in the same org", async () => {
    await createAsset(ctx, { name: "Unique", category_id: categoryId, serial_no: "SN-1" });
    await expect(createAsset(ctx, {
      name: "Clone", category_id: categoryId, serial_no: "SN-1",
    })).rejects.toMatchObject({ code: "23505" });
  });

  it("writes an asset.created audit event", async () => {
    const a = await createAsset(ctx, { name: "Audited", category_id: categoryId });
    const { rows } = await pool.query(
      "SELECT event FROM audit_events WHERE asset_id = $1", [a.id],
    );
    expect(rows.map((r) => r.event)).toContain("asset.created");
  });
});

describe("updateAsset", () => {
  it("merges custom fields rather than replacing the object", async () => {
    const a = await createAsset(ctx, {
      name: "Merge me", category_id: categoryId,
      custom: { os: "Windows 11", ram_gb: 8 },
    });
    const updated = await updateAsset(ctx, a.id, { custom: { ram_gb: 16 } });
    expect(updated!.custom).toEqual({ os: "Windows 11", ram_gb: 16 });
  });

  it("records the before/after diff in the audit trail", async () => {
    const a = await createAsset(ctx, { name: "Before", category_id: categoryId });
    await updateAsset(ctx, a.id, { name: "After" });
    const { rows } = await pool.query(
      "SELECT changes FROM audit_events WHERE asset_id=$1 AND event='asset.updated'",
      [a.id],
    );
    expect(rows[0].changes).toMatchObject({ name: { from: "Before", to: "After" } });
  });

  it("returns null for an unknown id", async () => {
    await expect(updateAsset(ctx, randomUUID(), { name: "Ghost" })).resolves.toBeNull();
  });
});

describe("softDeleteAsset", () => {
  it("hides the asset from reads but keeps the row", async () => {
    const a = await createAsset(ctx, { name: "Doomed", category_id: categoryId });
    await expect(softDeleteAsset(ctx, a.id)).resolves.toBe(true);
    await expect(getAsset(ctx, a.id)).resolves.toBeNull();
    const { rows } = await pool.query("SELECT deleted_at FROM assets WHERE id=$1", [a.id]);
    expect(rows[0].deleted_at).not.toBeNull();
  });

  it("frees the asset tag for reuse", async () => {
    const a = await createAsset(ctx, {
      name: "Tagged", category_id: categoryId, asset_tag: "REUSE-1",
    });
    await softDeleteAsset(ctx, a.id);
    const b = await createAsset(ctx, {
      name: "Reused", category_id: categoryId, asset_tag: "REUSE-1",
    });
    expect(b.asset_tag).toBe("REUSE-1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/assets.test.ts`
Expected: FAIL with `Cannot find module './assets'`.

- [ ] **Step 3: Implement the audit recorder**

`api/src/lib/domain/audit.ts`:

```ts
import type { PoolClient } from "pg";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";

export interface AuditEvent {
  id: string;
  asset_id: string | null;
  actor_type: string;
  actor_label: string | null;
  event: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  note: string | null;
  created_at: string;
}

export async function recordEvent(
  client: PoolClient,
  ctx: Ctx,
  input: {
    assetId: string | null;
    event: string;
    changes?: Record<string, unknown>;
    note?: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events
       (org_id, asset_id, actor_type, actor_id, actor_label, event, changes, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ctx.orgId,
      input.assetId,
      ctx.actor.type,
      ctx.actor.type === "system" ? null : ctx.actor.id,
      ctx.actor.label,
      input.event,
      JSON.stringify(input.changes ?? {}),
      input.note ?? null,
    ],
  );
}

/** Builds a {field: {from, to}} diff, ignoring unchanged and undefined values. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after)) {
    if (after[key] === undefined) continue;
    const a = JSON.stringify(before[key] ?? null);
    const b = JSON.stringify(after[key] ?? null);
    if (a !== b) out[key] = { from: before[key] ?? null, to: after[key] };
  }
  return out;
}

export const listAssetHistory = (ctx: Ctx, assetId: string, limit = 200) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<AuditEvent>(
      `SELECT id, asset_id, actor_type, actor_label, event, changes, note, created_at
         FROM audit_events
        WHERE asset_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      [assetId, limit],
    )).rows,
  );
```

- [ ] **Step 4: Implement the asset domain module**

`api/src/lib/domain/assets.ts`:

```ts
import { z } from "zod";
import type { PoolClient } from "pg";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { buildCustomValidator, type FieldSchema } from "../validation/customFields";
import { recordEvent, diff } from "./audit";

export const STATUSES = [
  "available", "in_use", "maintenance", "retired", "lost",
] as const;
export type AssetStatus = (typeof STATUSES)[number];

export const AssetInput = z.object({
  asset_tag: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).nullish(),
  category_id: z.string().uuid().nullish(),
  serial_no: z.string().max(120).nullish(),
  status: z.enum(STATUSES).default("available"),
  location_id: z.string().uuid().nullish(),
  assignee_id: z.string().uuid().nullish(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  purchase_cost: z.number().nonnegative().nullish(),
  currency: z.string().length(3).default("IDR"),
  custom: z.record(z.unknown()).default({}),
});
export type AssetInput = z.input<typeof AssetInput>;

export interface Asset {
  id: string;
  asset_tag: string;
  name: string;
  description: string | null;
  category_id: string | null;
  category_name?: string | null;
  serial_no: string | null;
  status: AssetStatus;
  location_id: string | null;
  location_name?: string | null;
  assignee_id: string | null;
  assignee_name?: string | null;
  purchase_date: string | null;
  purchase_cost: string | null;
  currency: string;
  custom: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const SELECT_ASSET = `
  SELECT a.id, a.asset_tag, a.name, a.description, a.category_id,
         c.name AS category_name, a.serial_no, a.status, a.location_id,
         l.name AS location_name, a.assignee_id, u.name AS assignee_name,
         a.purchase_date, a.purchase_cost, a.currency, a.custom,
         a.created_at, a.updated_at
    FROM assets a
    LEFT JOIN categories c ON c.id = a.category_id
    LEFT JOIN locations  l ON l.id = a.location_id
    LEFT JOIN users      u ON u.id = a.assignee_id`;

/**
 * Next `AMS-000123` tag for the org. Takes a transaction-scoped advisory lock so
 * two concurrent creates cannot compute the same number.
 */
export async function nextAssetTag(client: PoolClient, orgId: string): Promise<string> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`tag:${orgId}`]);
  const { rows } = await client.query<{ max: number | null }>(
    `SELECT max(substring(asset_tag from '^AMS-(\\d+)$')::int) AS max
       FROM assets WHERE asset_tag ~ '^AMS-\\d+$'`,
  );
  return `AMS-${String((rows[0].max ?? 0) + 1).padStart(6, "0")}`;
}

async function validateCustom(
  client: PoolClient,
  categoryId: string | null | undefined,
  custom: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!categoryId) return {};
  const { rows } = await client.query<{ field_schema: FieldSchema }>(
    "SELECT field_schema FROM categories WHERE id = $1", [categoryId],
  );
  if (!rows[0]) return {};
  const parsed = buildCustomValidator(rows[0].field_schema).safeParse(custom);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`custom field "${issue.path.join(".")}" is invalid: ${issue.message}`);
  }
  return parsed.data;
}

export function createAsset(ctx: Ctx, raw: AssetInput): Promise<Asset> {
  const input = AssetInput.parse(raw);
  return withTenant(ctx.orgId, async (c) => {
    const tag = input.asset_tag ?? (await nextAssetTag(c, ctx.orgId));
    const custom = await validateCustom(c, input.category_id, input.custom);

    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO assets (org_id, asset_tag, name, description, category_id,
                           serial_no, status, location_id, assignee_id,
                           purchase_date, purchase_cost, currency, custom)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id`,
      [
        ctx.orgId, tag, input.name, input.description ?? null,
        input.category_id ?? null, input.serial_no ?? null, input.status,
        input.location_id ?? null, input.assignee_id ?? null,
        input.purchase_date ?? null, input.purchase_cost ?? null,
        input.currency, JSON.stringify(custom),
      ],
    );
    const id = rows[0].id;
    await recordEvent(c, ctx, {
      assetId: id,
      event: "asset.created",
      changes: { name: { from: null, to: input.name } },
    });
    return (await c.query<Asset>(`${SELECT_ASSET} WHERE a.id = $1`, [id])).rows[0];
  });
}

export const getAsset = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Asset>(
      `${SELECT_ASSET} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id],
    )).rows[0] ?? null,
  );

export const getAssetByTag = (ctx: Ctx, tag: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Asset>(
      `${SELECT_ASSET} WHERE a.asset_tag = $1 AND a.deleted_at IS NULL`, [tag],
    )).rows[0] ?? null,
  );

export function updateAsset(
  ctx: Ctx,
  id: string,
  patch: Partial<AssetInput>,
): Promise<Asset | null> {
  return withTenant(ctx.orgId, async (c) => {
    const before = (await c.query<Asset>(
      `${SELECT_ASSET} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id],
    )).rows[0];
    if (!before) return null;

    const categoryId = patch.category_id ?? before.category_id;
    // A PATCH sends only the custom keys it wants to change, so merge rather than replace.
    const mergedCustom = patch.custom
      ? await validateCustom(c, categoryId, { ...before.custom, ...patch.custom })
      : before.custom;

    const { rows } = await c.query<{ id: string }>(
      `UPDATE assets SET
         asset_tag     = coalesce($2, asset_tag),
         name          = coalesce($3, name),
         description   = coalesce($4, description),
         category_id   = coalesce($5, category_id),
         serial_no     = coalesce($6, serial_no),
         status        = coalesce($7, status),
         location_id   = coalesce($8, location_id),
         assignee_id   = coalesce($9, assignee_id),
         purchase_date = coalesce($10, purchase_date),
         purchase_cost = coalesce($11, purchase_cost),
         currency      = coalesce($12, currency),
         custom        = $13
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [
        id, patch.asset_tag ?? null, patch.name ?? null, patch.description ?? null,
        patch.category_id ?? null, patch.serial_no ?? null, patch.status ?? null,
        patch.location_id ?? null, patch.assignee_id ?? null,
        patch.purchase_date ?? null, patch.purchase_cost ?? null,
        patch.currency ?? null, JSON.stringify(mergedCustom),
      ],
    );
    if (rows.length === 0) return null;

    const after = (await c.query<Asset>(`${SELECT_ASSET} WHERE a.id = $1`, [id])).rows[0];
    const changes = diff(
      before as unknown as Record<string, unknown>,
      { ...patch, custom: mergedCustom } as Record<string, unknown>,
    );
    if (Object.keys(changes).length > 0) {
      await recordEvent(c, ctx, { assetId: id, event: "asset.updated", changes });
    }
    return after;
  });
}

export const softDeleteAsset = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query(
      `UPDATE assets SET deleted_at = now()
        WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id],
    );
    if (rows.length === 0) return false;
    await recordEvent(c, ctx, { assetId: id, event: "asset.deleted" });
    return true;
  });
```

- [ ] **Step 5: Implement the single-asset route handler**

`api/src/app/api/v1/assets/[id]/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { AssetInput, getAsset, updateAsset, softDeleteAsset } from "@/lib/domain/assets";

type Params = { params: Promise<{ id: string }> };

export const GET = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  const asset = await getAsset(ctx, (await params).id);
  return asset ? Response.json(asset) : notFound("asset");
});

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;
  const parsed = AssetInput.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  try {
    const asset = await updateAsset(ctx, (await params).id, parsed.data);
    return asset ? Response.json(asset) : notFound("asset");
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === "23505") {
      return problem(409, "conflict", "Duplicate value", { detail: e.message });
    }
    if (e.message.startsWith("custom field")) {
      return problem(422, "validation", "Validation failed", { detail: e.message });
    }
    throw err;
  }
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;
  const done = await softDeleteAsset(ctx, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("asset");
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/domain/assets.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/domain/audit.ts api/src/lib/domain/assets.ts api/src/app/api/v1/assets
git commit -m "feat: asset registry with tag generation, custom fields and audit events"
```

---

### Task 7: Search, filter, sort and pagination

**Files:**
- Modify: `api/src/lib/domain/assets.ts` (append `AssetFilters`, `SORTABLE`, `listAssets`)
- Create: `api/src/app/api/v1/assets/route.ts`
- Test: `api/src/lib/domain/assets.list.test.ts`

**Interfaces:**
- Consumes: `SELECT_ASSET`, `AssetStatus` (Task 6); `Pagination`, `Sort`, `parsePagination`, `parseSort`, `paginated` (Task 3).
- Produces:
  - `interface AssetFilters { q?, status?: AssetStatus[], categoryId?, locationId?, assigneeId?, custom?: Record<string,string> }`
  - `SORTABLE` — the sort allowlist
  - `listAssets(ctx, filters, page, sort): Promise<{ rows: Asset[]; total: number }>`
  - `GET /api/v1/assets`, `POST /api/v1/assets`

- [ ] **Step 1: Write the failing test**

`api/src/lib/domain/assets.list.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createAsset, listAssets } from "./assets";
import { createCategory } from "./categories";

const orgId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: randomUUID(), label: "T", scopes: ["admin"] },
};
const page = { page: 1, perPage: 50, offset: 0 };
const sort = { column: "name", direction: "ASC" as const };
let itId: string;
let plantId: string;

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'L',$2)", [
    orgId, `list-org-${orgId.slice(0, 8)}`,
  ]);
  itId = (await createCategory(ctx, {
    name: "IT", kind: "it",
    field_schema: { fields: [{ key: "os", label: "OS", type: "string", required: false }] },
  })).id;
  plantId = (await createCategory(ctx, {
    name: "Plant", kind: "equipment", field_schema: { fields: [] },
  })).id;

  await createAsset(ctx, { name: "Dell Latitude 5540", category_id: itId,
    serial_no: "DL5540-001", status: "in_use", custom: { os: "Windows 11" } });
  await createAsset(ctx, { name: "MacBook Pro 16", category_id: itId,
    serial_no: "MBP16-002", status: "available", custom: { os: "macOS" } });
  await createAsset(ctx, { name: "Cummins Generator", category_id: plantId,
    serial_no: "GEN-003", status: "maintenance" });
});

describe("listAssets", () => {
  it("returns everything with no filters", async () => {
    const { rows, total } = await listAssets(ctx, {}, page, sort);
    expect(total).toBe(3);
    expect(rows).toHaveLength(3);
  });

  it("matches a partial name, case-insensitively", async () => {
    const { rows } = await listAssets(ctx, { q: "macbook" }, page, sort);
    expect(rows.map((r) => r.name)).toEqual(["MacBook Pro 16"]);
  });

  it("matches on serial number", async () => {
    const { rows } = await listAssets(ctx, { q: "GEN-003" }, page, sort);
    expect(rows[0].name).toBe("Cummins Generator");
  });

  it("filters by a single status", async () => {
    const { rows } = await listAssets(ctx, { status: ["available"] }, page, sort);
    expect(rows.map((r) => r.status)).toEqual(["available"]);
  });

  it("filters by several statuses at once", async () => {
    const { total } = await listAssets(ctx, { status: ["available", "in_use"] }, page, sort);
    expect(total).toBe(2);
  });

  it("filters by category", async () => {
    const { total } = await listAssets(ctx, { categoryId: itId }, page, sort);
    expect(total).toBe(2);
  });

  it("filters on a custom JSONB field", async () => {
    const { rows } = await listAssets(ctx, { custom: { os: "macOS" } }, page, sort);
    expect(rows.map((r) => r.name)).toEqual(["MacBook Pro 16"]);
  });

  it("combines a search term with a status filter", async () => {
    const { total } = await listAssets(ctx, { q: "o", status: ["maintenance"] }, page, sort);
    expect(total).toBe(1);
  });

  it("sorts descending when asked", async () => {
    const { rows } = await listAssets(ctx, {}, page, { column: "name", direction: "DESC" });
    expect(rows[0].name).toBe("MacBook Pro 16");
  });

  it("paginates and reports the unpaginated total", async () => {
    const { rows, total } = await listAssets(ctx, {}, { page: 2, perPage: 2, offset: 2 }, sort);
    expect(total).toBe(3);
    expect(rows).toHaveLength(1);
  });

  it("excludes soft-deleted assets", async () => {
    await pool.query(
      "UPDATE assets SET deleted_at = now() WHERE org_id = $1 AND name = 'Cummins Generator'",
      [orgId],
    );
    const { total } = await listAssets(ctx, {}, page, sort);
    expect(total).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/assets.list.test.ts`
Expected: FAIL with `listAssets is not a function`.

- [ ] **Step 3: Append `listAssets` to the asset domain module**

Append to `api/src/lib/domain/assets.ts` (and add the import at the top of the file):

```ts
import type { Pagination, Sort } from "../http/pagination";

export interface AssetFilters {
  q?: string;
  status?: AssetStatus[];
  categoryId?: string;
  locationId?: string;
  assigneeId?: string;
  custom?: Record<string, string>;
}

export const SORTABLE = [
  "name", "asset_tag", "status", "created_at", "updated_at", "purchase_date",
] as const;

export function listAssets(
  ctx: Ctx,
  filters: AssetFilters,
  page: Pagination,
  sort: Sort,
): Promise<{ rows: Asset[]; total: number }> {
  return withTenant(ctx.orgId, async (c) => {
    const where: string[] = ["a.deleted_at IS NULL"];
    const params: unknown[] = [];
    const add = (value: unknown) => `$${params.push(value)}`;

    if (filters.q) {
      const p = add(`%${filters.q}%`);
      where.push(`(a.name ILIKE ${p} OR a.serial_no ILIKE ${p} OR a.asset_tag ILIKE ${p})`);
    }
    if (filters.status?.length) {
      where.push(`a.status = ANY(${add(filters.status)}::asset_status[])`);
    }
    if (filters.categoryId) where.push(`a.category_id = ${add(filters.categoryId)}`);
    if (filters.locationId) where.push(`a.location_id = ${add(filters.locationId)}`);
    if (filters.assigneeId) where.push(`a.assignee_id = ${add(filters.assigneeId)}`);
    for (const [key, value] of Object.entries(filters.custom ?? {})) {
      where.push(`a.custom ->> ${add(key)} = ${add(value)}`);
    }

    const clause = `WHERE ${where.join(" AND ")}`;
    const { rows: countRows } = await c.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM assets a ${clause}`, params,
    );

    // sort.column and sort.direction come from parseSort's allowlist, never raw input.
    const { rows } = await c.query<Asset>(
      `${SELECT_ASSET} ${clause}
        ORDER BY a.${sort.column} ${sort.direction}, a.id
        LIMIT ${add(page.perPage)} OFFSET ${add(page.offset)}`,
      params,
    );
    return { rows, total: Number(countRows[0].total) };
  });
}
```

- [ ] **Step 4: Implement the collection route handler**

`api/src/app/api/v1/assets/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { parsePagination, parseSort, paginated } from "@/lib/http/pagination";
import {
  AssetInput, STATUSES, SORTABLE, listAssets, createAsset,
  type AssetStatus, type AssetFilters,
} from "@/lib/domain/assets";

function readFilters(url: URL): AssetFilters {
  const statuses = url.searchParams
    .getAll("status")
    .flatMap((s) => s.split(","))
    .filter((s): s is AssetStatus => (STATUSES as readonly string[]).includes(s));

  // `custom[os]=macOS` filters on the JSONB column.
  const custom: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    const match = key.match(/^custom\[([a-z][a-z0-9_]*)\]$/);
    if (match) custom[match[1]] = value;
  }

  return {
    q: url.searchParams.get("q") ?? undefined,
    status: statuses.length ? statuses : undefined,
    categoryId: url.searchParams.get("category_id") ?? undefined,
    locationId: url.searchParams.get("location_id") ?? undefined,
    assigneeId: url.searchParams.get("assignee_id") ?? undefined,
    custom: Object.keys(custom).length ? custom : undefined,
  };
}

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  const url = new URL(req.url);
  const page = parsePagination(url);
  const sort = parseSort(url, SORTABLE, "created_at");
  const { rows, total } = await listAssets(ctx, readFilters(url), page, sort);
  return paginated(rows, page, total);
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;
  const parsed = AssetInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  try {
    return Response.json(await createAsset(ctx, parsed.data), { status: 201 });
  } catch (err) {
    const e = err as { code?: string; message: string };
    if (e.code === "23505") {
      return problem(409, "conflict", "Duplicate value", {
        detail: "An asset with that tag or serial number already exists.",
      });
    }
    if (e.message.startsWith("custom field")) {
      return problem(422, "validation", "Validation failed", { detail: e.message });
    }
    throw err;
  }
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/domain/assets.list.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/domain/assets.ts api/src/app/api/v1/assets/route.ts
git commit -m "feat: asset search, filtering, sorting and pagination"
```

---

### Task 8: Check-out and check-in with guarded status transitions

**Files:**
- Create: `api/src/lib/domain/assignments.ts`
- Create: `api/src/app/api/v1/assets/[id]/checkout/route.ts`, `api/src/app/api/v1/assets/[id]/checkin/route.ts`, `api/src/app/api/v1/assets/[id]/notes/route.ts`
- Test: `api/src/lib/domain/assignments.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `recordEvent`, `Ctx`.
- Produces:
  - `class TransitionError extends Error { readonly status = 409 }`
  - `CheckOutInput`, `CheckInInput` (Zod), `interface Assignment`
  - `checkOut(ctx, assetId, input): Promise<Assignment>`
  - `checkIn(ctx, assetId, input): Promise<Assignment>`
  - `addNote(ctx, assetId, note): Promise<boolean>`
  - `listAssignments(ctx, assetId): Promise<Assignment[]>`

**Design note:** `assignments` already carries the columns a rental booking needs
(`kind`, `party_id`, `rate_snapshot`, `charge_total`, `currency` from migration 005).
The MVP writes `kind = 'internal'` by default and never touches the rest — see spec §11.

- [ ] **Step 1: Write the failing test**

`api/src/lib/domain/assignments.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createAsset, getAsset, updateAsset } from "./assets";
import { checkOut, checkIn, TransitionError } from "./assignments";

const orgId = randomUUID();
const userId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: userId, label: "Ops", scopes: ["admin"] },
};

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'A',$2)", [
    orgId, `assign-org-${orgId.slice(0, 8)}`,
  ]);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,'x','Ops','admin')`,
    [userId, orgId, `ops-${orgId.slice(0, 8)}@example.com`],
  );
});

const newAsset = (name: string) => createAsset(ctx, { name });

describe("checkOut", () => {
  it("moves the asset to in_use and records the assignee", async () => {
    const asset = await newAsset("Drill");
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    const after = await getAsset(ctx, asset.id);
    expect(after!.status).toBe("in_use");
    expect(after!.assignee_id).toBe(userId);
  });

  it("writes an asset.checked_out audit event", async () => {
    const asset = await newAsset("Ladder");
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    const { rows } = await pool.query(
      "SELECT event FROM audit_events WHERE asset_id=$1", [asset.id],
    );
    expect(rows.map((r) => r.event)).toContain("asset.checked_out");
  });

  it("refuses to check out an asset that is already out", async () => {
    const asset = await newAsset("Van");
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    await expect(
      checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId }),
    ).rejects.toBeInstanceOf(TransitionError);
  });

  it("refuses to check out a retired asset", async () => {
    const asset = await newAsset("Old server");
    await updateAsset(ctx, asset.id, { status: "retired" });
    await expect(
      checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId }),
    ).rejects.toThrow(/retired/);
  });

  it("supports checking out to a location instead of a person", async () => {
    const { rows } = await pool.query(
      "INSERT INTO locations (org_id, name) VALUES ($1,'Site B') RETURNING id", [orgId],
    );
    const asset = await newAsset("Compressor");
    const assignment = await checkOut(ctx, asset.id, {
      assignee_type: "location", location_id: rows[0].id,
    });
    expect(assignment.assignee_type).toBe("location");
    expect((await getAsset(ctx, asset.id))!.location_id).toBe(rows[0].id);
  });

  it("supports an external assignee with a due date", async () => {
    const asset = await newAsset("Licensed video");
    const assignment = await checkOut(ctx, asset.id, {
      assignee_type: "external", assignee_label: "Acme Agency",
      due_at: "2026-12-31T00:00:00Z",
    });
    expect(assignment.assignee_label).toBe("Acme Agency");
    expect(assignment.due_at).not.toBeNull();
  });
});

describe("checkIn", () => {
  it("returns the asset to available and clears the assignee", async () => {
    const asset = await newAsset("Projector");
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    await checkIn(ctx, asset.id, { note: "returned intact", condition: "good" });
    const after = await getAsset(ctx, asset.id);
    expect(after!.status).toBe("available");
    expect(after!.assignee_id).toBeNull();
  });

  it("closes the open assignment with a timestamp", async () => {
    const asset = await newAsset("Camera");
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    const assignment = await checkIn(ctx, asset.id, {});
    expect(assignment.checked_in_at).not.toBeNull();
  });

  it("refuses to check in an asset that is not checked out", async () => {
    const asset = await newAsset("Idle scanner");
    await expect(checkIn(ctx, asset.id, {})).rejects.toBeInstanceOf(TransitionError);
  });

  it("allows the same asset to cycle out and back repeatedly", async () => {
    const asset = await newAsset("Trolley");
    for (let i = 0; i < 3; i++) {
      await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
      await checkIn(ctx, asset.id, {});
    }
    const { rows } = await pool.query(
      "SELECT count(*)::int AS n FROM assignments WHERE asset_id=$1", [asset.id],
    );
    expect(rows[0].n).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/assignments.test.ts`
Expected: FAIL with `Cannot find module './assignments'`.

- [ ] **Step 3: Implement the assignment domain module**

`api/src/lib/domain/assignments.ts`:

```ts
import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { recordEvent } from "./audit";

export class TransitionError extends Error {
  readonly status = 409;
}

export const CheckOutInput = z.object({
  assignee_type: z.enum(["user", "location", "external"]),
  assignee_id: z.string().uuid().nullish(),
  assignee_label: z.string().max(200).nullish(),
  location_id: z.string().uuid().nullish(),
  due_at: z.string().datetime().nullish(),
  note: z.string().max(2000).nullish(),
});
export type CheckOutInput = z.infer<typeof CheckOutInput>;

export const CheckInInput = z.object({
  note: z.string().max(2000).nullish(),
  condition: z.string().max(120).nullish(),
  location_id: z.string().uuid().nullish(),
});
export type CheckInInput = z.infer<typeof CheckInInput>;

export interface Assignment {
  id: string;
  asset_id: string;
  assignee_type: "user" | "location" | "external";
  assignee_id: string | null;
  assignee_label: string | null;
  location_id: string | null;
  checked_out_at: string;
  due_at: string | null;
  checked_in_at: string | null;
  checkout_note: string | null;
  checkin_note: string | null;
  condition: string | null;
}

// An asset in maintenance can be issued straight back out; a retired or lost one cannot.
const CHECKOUTABLE = new Set(["available", "maintenance"]);

export function checkOut(ctx: Ctx, assetId: string, raw: CheckOutInput): Promise<Assignment> {
  const input = CheckOutInput.parse(raw);
  return withTenant(ctx.orgId, async (c) => {
    const { rows: assetRows } = await c.query<{ status: string }>(
      "SELECT status FROM assets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [assetId],
    );
    const asset = assetRows[0];
    if (!asset) throw new TransitionError("Asset not found");
    if (!CHECKOUTABLE.has(asset.status)) {
      throw new TransitionError(`Cannot check out an asset that is ${asset.status}.`);
    }

    const { rows } = await c.query<Assignment>(
      `INSERT INTO assignments
         (org_id, asset_id, assignee_type, assignee_id, assignee_label,
          location_id, checked_out_by, due_at, checkout_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        ctx.orgId, assetId, input.assignee_type, input.assignee_id ?? null,
        input.assignee_label ?? null, input.location_id ?? null,
        ctx.actor.type === "user" ? ctx.actor.id : null,
        input.due_at ?? null, input.note ?? null,
      ],
    );

    await c.query(
      `UPDATE assets SET
         status = 'in_use',
         assignee_id = $2,
         location_id = coalesce($3, location_id)
       WHERE id = $1`,
      [
        assetId,
        input.assignee_type === "user" ? input.assignee_id ?? null : null,
        input.location_id ?? null,
      ],
    );

    await recordEvent(c, ctx, {
      assetId,
      event: "asset.checked_out",
      changes: {
        status: { from: asset.status, to: "in_use" },
        assignee: {
          from: null,
          to: input.assignee_label ?? input.assignee_id ?? input.location_id,
        },
      },
      note: input.note ?? null,
    });
    return rows[0];
  });
}

export function checkIn(ctx: Ctx, assetId: string, raw: CheckInInput): Promise<Assignment> {
  const input = CheckInInput.parse(raw);
  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<Assignment>(
      `UPDATE assignments SET
         checked_in_at = now(),
         checked_in_by = $2,
         checkin_note  = $3,
         condition     = $4
       WHERE asset_id = $1 AND checked_in_at IS NULL
       RETURNING *`,
      [
        assetId,
        ctx.actor.type === "user" ? ctx.actor.id : null,
        input.note ?? null,
        input.condition ?? null,
      ],
    );
    if (rows.length === 0) {
      throw new TransitionError("This asset is not currently checked out.");
    }

    await c.query(
      `UPDATE assets SET
         status = 'available',
         assignee_id = NULL,
         location_id = coalesce($2, location_id)
       WHERE id = $1`,
      [assetId, input.location_id ?? null],
    );

    await recordEvent(c, ctx, {
      assetId,
      event: "asset.checked_in",
      changes: { status: { from: "in_use", to: "available" } },
      note: input.note ?? null,
    });
    return rows[0];
  });
}

export const addNote = (ctx: Ctx, assetId: string, note: string) =>
  withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query(
      "SELECT 1 FROM assets WHERE id = $1 AND deleted_at IS NULL", [assetId],
    );
    if (rows.length === 0) return false;
    await recordEvent(c, ctx, { assetId, event: "asset.note", note });
    return true;
  });

export const listAssignments = (ctx: Ctx, assetId: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Assignment>(
      `SELECT a.*, u.name AS assignee_user_name, l.name AS location_name
         FROM assignments a
         LEFT JOIN users u ON u.id = a.assignee_id
         LEFT JOIN locations l ON l.id = a.location_id
        WHERE a.asset_id = $1
        ORDER BY a.checked_out_at DESC`,
      [assetId],
    )).rows,
  );
```

- [ ] **Step 4: Implement the route handlers**

`api/src/app/api/v1/assets/[id]/checkout/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { checkOut, CheckOutInput, TransitionError } from "@/lib/domain/assignments";

export const POST = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;
  const parsed = CheckOutInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  try {
    return Response.json(await checkOut(ctx, (await params).id, parsed.data), { status: 201 });
  } catch (err) {
    if (err instanceof TransitionError) {
      return problem(409, "invalid-transition", "Invalid status transition", {
        detail: err.message,
      });
    }
    throw err;
  }
});
```

`api/src/app/api/v1/assets/[id]/checkin/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { checkIn, CheckInInput, TransitionError } from "@/lib/domain/assignments";

export const POST = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;
  const parsed = CheckInInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  try {
    return Response.json(await checkIn(ctx, (await params).id, parsed.data));
  } catch (err) {
    if (err instanceof TransitionError) {
      return problem(409, "invalid-transition", "Invalid status transition", {
        detail: err.message,
      });
    }
    throw err;
  }
});
```

`api/src/app/api/v1/assets/[id]/notes/route.ts`:

```ts
import { z } from "zod";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { addNote } from "@/lib/domain/assignments";

const Body = z.object({ note: z.string().min(1).max(2000) });

export const POST = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  const ok = await addNote(ctx, (await params).id, parsed.data.note);
  return ok ? new Response(null, { status: 204 }) : notFound("asset");
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/domain/assignments.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/domain/assignments.ts api/src/app/api/v1/assets
git commit -m "feat: asset check-out and check-in with guarded status transitions"
```

---

### Task 9: Audit trail endpoint, locations and assignable users

**Files:**
- Create: `api/src/lib/domain/locations.ts`
- Create: `api/src/app/api/v1/assets/[id]/history/route.ts`, `api/src/app/api/v1/locations/route.ts`, `api/src/app/api/v1/users/route.ts`
- Test: `api/src/lib/domain/audit.test.ts`

**Interfaces:**
- Consumes: `listAssetHistory` (Task 6), `listAssignments` (Task 8), `getAsset` (Task 6).
- Produces:
  - `LocationInput` (Zod), `interface LocationNode { id, name, parent_id, address, depth, path, asset_count }`
  - `listLocations(ctx)` — tree flattened depth-first with a display `path`
  - `createLocation(ctx, input)`, `listAssignableUsers(ctx)`
  - `GET /api/v1/assets/{id}/history` → `{ data: { events, assignments } }`

- [ ] **Step 1: Write the failing test**

`api/src/lib/domain/audit.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import { createAsset, updateAsset } from "./assets";
import { checkOut, checkIn, addNote } from "./assignments";
import { listAssetHistory } from "./audit";

const orgId = randomUUID();
const userId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: userId, label: "Rina", scopes: ["admin"] },
};

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'H',$2)", [
    orgId, `hist-org-${orgId.slice(0, 8)}`,
  ]);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,'x','Rina','admin')`,
    [userId, orgId, `rina-${orgId.slice(0, 8)}@example.com`],
  );
});

describe("listAssetHistory", () => {
  it("returns every event newest first with the actor attached", async () => {
    const asset = await createAsset(ctx, { name: "Tracked laptop" });
    await updateAsset(ctx, asset.id, { name: "Tracked laptop (renamed)" });
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    await addNote(ctx, asset.id, "Screen has a scratch");
    await checkIn(ctx, asset.id, { condition: "fair" });

    const history = await listAssetHistory(ctx, asset.id);
    expect(history.map((e) => e.event)).toEqual([
      "asset.checked_in",
      "asset.note",
      "asset.checked_out",
      "asset.updated",
      "asset.created",
    ]);
    expect(history.every((e) => e.actor_label === "Rina")).toBe(true);
  });

  it("carries the note text on a note event", async () => {
    const asset = await createAsset(ctx, { name: "Noted" });
    await addNote(ctx, asset.id, "Serviced 2026-09-01");
    const [event] = await listAssetHistory(ctx, asset.id);
    expect(event.note).toBe("Serviced 2026-09-01");
  });

  it("carries a from/to diff on an update event", async () => {
    const asset = await createAsset(ctx, { name: "Diffed", status: "available" });
    await updateAsset(ctx, asset.id, { status: "maintenance" });
    const [event] = await listAssetHistory(ctx, asset.id);
    expect(event.changes).toMatchObject({
      status: { from: "available", to: "maintenance" },
    });
  });

  it("returns an empty list for an asset with no events", async () => {
    await expect(listAssetHistory(ctx, randomUUID())).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/audit.test.ts`
Expected: FAIL — the ordering assertion fails, or the module resolution fails, depending on what is already present.

- [ ] **Step 3: Implement the location domain module**

`api/src/lib/domain/locations.ts`:

```ts
import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";

export const LocationInput = z.object({
  name: z.string().min(1).max(120),
  parent_id: z.string().uuid().nullish(),
  address: z.string().max(500).nullish(),
});
export type LocationInput = z.infer<typeof LocationInput>;

export interface LocationNode {
  id: string;
  name: string;
  parent_id: string | null;
  address: string | null;
  depth: number;
  path: string;
  asset_count: number;
}

/** The location tree flattened depth-first, each row carrying a display path. */
export const listLocations = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<LocationNode>(
      `WITH RECURSIVE tree AS (
         SELECT id, name, parent_id, address, 0 AS depth,
                name::text AS path, ARRAY[lower(name)] AS sort_path
           FROM locations WHERE parent_id IS NULL
         UNION ALL
         SELECT l.id, l.name, l.parent_id, l.address, t.depth + 1,
                t.path || ' / ' || l.name, t.sort_path || lower(l.name)
           FROM locations l JOIN tree t ON l.parent_id = t.id
       )
       SELECT t.id, t.name, t.parent_id, t.address, t.depth, t.path,
              count(a.id) FILTER (WHERE a.deleted_at IS NULL)::int AS asset_count
         FROM tree t
         LEFT JOIN assets a ON a.location_id = t.id
        GROUP BY t.id, t.name, t.parent_id, t.address, t.depth, t.path, t.sort_path
        ORDER BY t.sort_path`,
    )).rows,
  );

export const createLocation = (ctx: Ctx, input: LocationInput) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query(
      `INSERT INTO locations (org_id, name, parent_id, address)
       VALUES ($1,$2,$3,$4) RETURNING id, name, parent_id, address`,
      [ctx.orgId, input.name, input.parent_id ?? null, input.address ?? null],
    )).rows[0],
  );

export const listAssignableUsers = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query(
      `SELECT u.id, u.name, u.email, u.role,
              count(a.id) FILTER (WHERE a.deleted_at IS NULL)::int AS assigned_count
         FROM users u
         LEFT JOIN assets a ON a.assignee_id = u.id
        GROUP BY u.id
        ORDER BY u.name`,
    )).rows,
  );
```

- [ ] **Step 4: Implement the route handlers**

`api/src/app/api/v1/assets/[id]/history/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listAssetHistory } from "@/lib/domain/audit";
import { listAssignments } from "@/lib/domain/assignments";
import { getAsset } from "@/lib/domain/assets";

export const GET = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  const { id } = await params;
  if (!(await getAsset(ctx, id))) return notFound("asset");
  const [events, assignments] = await Promise.all([
    listAssetHistory(ctx, id),
    listAssignments(ctx, id),
  ]);
  return Response.json({ data: { events, assignments } });
});
```

`api/src/app/api/v1/locations/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listLocations, createLocation, LocationInput } from "@/lib/domain/locations";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listLocations(ctx) });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = LocationInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  return Response.json(await createLocation(ctx, parsed.data), { status: 201 });
});
```

`api/src/app/api/v1/users/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { listAssignableUsers } from "@/lib/domain/locations";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listAssignableUsers(ctx) });
});
```

- [ ] **Step 5: Run the entire API suite**

Run: `cd api && npm test`
Expected: PASS — every suite from Tasks 1–9 green.

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/domain/locations.ts api/src/app/api/v1
git commit -m "feat: audit trail endpoint, location tree and assignable users"
```

---

**Phase 2 complete.** The registry is functional through the API: categories with custom
schemas, assets with generated tags, search and filter, custody tracking, and a complete
audit trail. Continue to [Phase 3 — Data movement](./03-data-movement.md).
