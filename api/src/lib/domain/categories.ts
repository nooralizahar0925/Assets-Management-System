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
