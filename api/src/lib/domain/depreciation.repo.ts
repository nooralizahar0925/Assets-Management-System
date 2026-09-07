import { withTenant } from "../db";
import type { Ctx } from "../http/handler";

export type Method = "none" | "straight_line" | "reducing_balance";

export interface DepreciationPolicy {
  method: Method;
  useful_life_months: number | null;
  salvage_pct: number;
  declining_rate_pct: number | null;
}

export interface DepreciableAsset {
  id: string;
  name: string;
  /** numeric(14,2) arrives as a string; the caller converts once. */
  cost: string;
  start: string;
  policy: DepreciationPolicy;
}

/**
 * Field by field, not all-or-nothing. An asset that overrides only its useful
 * life keeps its category's method, and an override object that silently reset
 * the other three would be a trap.
 */
const POLICY_COLUMNS = `
  coalesce(a.depreciation_method, c.depreciation_method, 'none') AS method,
  coalesce(a.useful_life_months, c.useful_life_months)           AS useful_life_months,
  coalesce(a.salvage_pct, c.salvage_pct, 0)                      AS salvage_pct,
  coalesce(a.declining_rate_pct, c.declining_rate_pct)           AS declining_rate_pct`;

interface PolicyRow {
  method: Method;
  useful_life_months: number | null;
  salvage_pct: string;
  declining_rate_pct: string | null;
}

const NO_POLICY: DepreciationPolicy = {
  method: "none",
  useful_life_months: null,
  salvage_pct: 0,
  declining_rate_pct: null,
};

const toPolicy = (row: PolicyRow): DepreciationPolicy => ({
  method: row.method,
  useful_life_months: row.useful_life_months,
  salvage_pct: Number(row.salvage_pct),
  declining_rate_pct:
    row.declining_rate_pct === null ? null : Number(row.declining_rate_pct),
});

/** The asset's own settings, falling back to its category for anything unset. */
export async function resolvePolicy(
  ctx: Ctx,
  assetId: string,
): Promise<DepreciationPolicy> {
  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<PolicyRow>(
      `SELECT ${POLICY_COLUMNS}
         FROM assets a LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.id = $1`,
      [assetId],
    );
    return rows[0] ? toPolicy(rows[0]) : NO_POLICY;
  });
}

/**
 * Every asset the snapshot job should charge.
 *
 * Excludes assets with no cost (nothing to write down), no start date, and no
 * method. Also excludes those that have left the register: a retired or lost
 * asset has been disposed of, and continuing to depreciate it overstates the
 * charge.
 */
export async function listDepreciableAssets(ctx: Ctx): Promise<DepreciableAsset[]> {
  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<PolicyRow & {
      id: string; name: string; cost: string; start: string;
    }>(
      `SELECT a.id, a.name,
              a.purchase_cost AS cost,
              coalesce(a.depreciation_start, a.purchase_date)::text AS start,
              ${POLICY_COLUMNS}
         FROM assets a LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.deleted_at IS NULL
          AND a.status NOT IN ('retired', 'lost')
          AND a.purchase_cost IS NOT NULL
          AND a.purchase_cost > 0
          AND coalesce(a.depreciation_start, a.purchase_date) IS NOT NULL
          AND coalesce(a.depreciation_method, c.depreciation_method, 'none') <> 'none'
        ORDER BY a.name`,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      cost: row.cost,
      start: row.start,
      policy: toPolicy(row),
    }));
  });
}
