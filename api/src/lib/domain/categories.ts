import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { FieldSchemaZ, type FieldSchema } from "../validation/customFields";

/**
 * The depreciation policy for a kind of asset.
 *
 * Bounds match the CHECK constraints in migration 014 deliberately. The
 * constraint is the guarantee; this is the readable error, so a form mistake
 * comes back as a validation problem rather than a database failure.
 */
const DepreciationFields = {
  depreciation_method: z
    .enum(["none", "straight_line", "reducing_balance"])
    .default("none"),
  useful_life_months: z.number().int().positive().nullish(),
  salvage_pct: z.number().min(0).max(100).default(0),
  declining_rate_pct: z.number().min(0).max(100).nullish(),
};

export const CategoryInput = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["it", "equipment", "media"]),
  field_schema: FieldSchemaZ.default({ fields: [] }),
  ...DepreciationFields,
});
export type CategoryInput = z.infer<typeof CategoryInput>;

export interface Category {
  id: string;
  name: string;
  kind: "it" | "equipment" | "media";
  field_schema: FieldSchema;
  depreciation_method: "none" | "straight_line" | "reducing_balance";
  useful_life_months: number | null;
  /** numeric(5,2) arrives as a string. */
  salvage_pct: string;
  declining_rate_pct: string | null;
  asset_count?: number;
}

const CATEGORY_COLUMNS = `id, name, kind, field_schema,
  depreciation_method, useful_life_months, salvage_pct, declining_rate_pct`;

export const listCategories = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Category>(
      `SELECT c.id, c.name, c.kind, c.field_schema,
              c.depreciation_method, c.useful_life_months,
              c.salvage_pct, c.declining_rate_pct,
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
      `SELECT ${CATEGORY_COLUMNS} FROM categories WHERE id = $1`, [id],
    )).rows[0] ?? null,
  );

/**
 * Parses rather than trusting its argument, as createAsset does. The route
 * already validates, but a caller reaching the domain directly - a job, a
 * script, a test - would otherwise skip every default and send NULL into a
 * NOT NULL column.
 */
export const createCategory = (ctx: Ctx, raw: z.input<typeof CategoryInput>) =>
  withTenant(ctx.orgId, async (c) => {
    const input = CategoryInput.parse(raw);
    return (await c.query<Category>(
      `INSERT INTO categories
         (org_id, name, kind, field_schema,
          depreciation_method, useful_life_months, salvage_pct, declining_rate_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${CATEGORY_COLUMNS}`,
      [
        ctx.orgId, input.name, input.kind, JSON.stringify(input.field_schema),
        input.depreciation_method,
        input.useful_life_months ?? null,
        input.salvage_pct,
        input.declining_rate_pct ?? null,
      ],
    )).rows[0];
  });

/**
 * The depreciation policy is patched as a unit, not field by field.
 *
 * The other columns use `coalesce(value, column)`, where null means "leave
 * alone" - which makes clearing impossible. Switching a category from
 * straight-line to reducing-balance has to clear its useful life, so supplying
 * a method replaces the whole policy and omitting one leaves it untouched.
 */
export const updateCategory = (ctx: Ctx, id: string, patch: Partial<CategoryInput>) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Category>(
      `UPDATE categories SET
         name         = coalesce($2, name),
         kind         = coalesce($3, kind),
         field_schema = coalesce($4, field_schema),
         depreciation_method =
           coalesce($5::depreciation_method, depreciation_method),
         useful_life_months =
           CASE WHEN $5 IS NULL THEN useful_life_months ELSE $6::integer END,
         salvage_pct =
           CASE WHEN $5 IS NULL THEN salvage_pct ELSE coalesce($7::numeric, 0) END,
         declining_rate_pct =
           CASE WHEN $5 IS NULL THEN declining_rate_pct ELSE $8::numeric END
       WHERE id = $1
       RETURNING ${CATEGORY_COLUMNS}`,
      [
        id,
        patch.name ?? null,
        patch.kind ?? null,
        patch.field_schema ? JSON.stringify(patch.field_schema) : null,
        patch.depreciation_method ?? null,
        patch.useful_life_months ?? null,
        patch.salvage_pct ?? null,
        patch.declining_rate_pct ?? null,
      ],
    )).rows[0] ?? null,
  );
