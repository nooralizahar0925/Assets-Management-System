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

export interface Location {
  id: string;
  name: string;
  parent_id: string | null;
  address: string | null;
}

export const createLocation = (ctx: Ctx, input: LocationInput) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Location>(
      `INSERT INTO locations (org_id, name, parent_id, address)
       VALUES ($1,$2,$3,$4) RETURNING id, name, parent_id, address`,
      [ctx.orgId, input.name, input.parent_id ?? null, input.address ?? null],
    )).rows[0],
  );
