import { z } from "zod";
import type { PoolClient } from "pg";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { buildCustomValidator, type FieldSchema } from "../validation/customFields";
import { recordEvent, diff } from "./audit";
import { locationScopeClause } from "../auth/guard";
import type { Pagination, Sort } from "../http/pagination";

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

/** Thrown when a custom field fails its category's schema. */
export class CustomFieldError extends Error {}

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
 *
 * The query needs no org filter: it runs inside withTenant, so row-level
 * security has already restricted it to this tenant's assets.
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
    throw new CustomFieldError(
      `custom field "${issue.path.join(".")}" is invalid: ${issue.message}`,
    );
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
    // A PATCH sends only the custom keys it wants to change, so merge rather
    // than replace - otherwise setting one field would erase the others.
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
    // The audit trail outlives the asset: the record is evidence, and a
    // deletion is one of the events worth keeping.
    await recordEvent(c, ctx, { assetId: id, event: "asset.deleted" });
    return true;
  });

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

    // Branch scope goes through the shared clause rather than being rebuilt
    // here, so there is one implementation to audit. It is ANDed with any
    // explicit location filter: asking for a branch you cannot see returns
    // nothing rather than that branch's assets.
    const scope = locationScopeClause(ctx, "a.location_id", params.length + 1);
    for (const p of scope.params) params.push(p);
    where.push(scope.sql);

    const clause = `WHERE ${where.join(" AND ")}`;

    // The count runs over the same clause, so a scoped caller's total reflects
    // what they can see rather than what exists.
    const { rows: countRows } = await c.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM assets a ${clause}`, params,
    );

    // sort.column and sort.direction come from parseSort's allowlist, never raw
    // input - they are the only values interpolated into a query in this
    // codebase.
    const { rows } = await c.query<Asset>(
      `${SELECT_ASSET} ${clause}
        ORDER BY a.${sort.column} ${sort.direction}, a.id
        LIMIT ${add(page.perPage)} OFFSET ${add(page.offset)}`,
      params,
    );
    return { rows, total: Number(countRows[0].total) };
  });
}
