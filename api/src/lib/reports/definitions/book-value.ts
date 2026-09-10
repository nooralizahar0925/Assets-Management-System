import { withTenant } from "../../db";
import type { ReportDefinition, ReportRow } from "../types";
import { assetFilters, sumBy } from "./shared";

/**
 * What each asset is worth after depreciation.
 *
 * Reads the month-end snapshots rather than recalculating: a finance report has
 * to reprint identically, and a figure that shifts because today's date moved
 * is one nobody can reconcile against last quarter's copy. The interface shows
 * a live value instead, through bookValueNow.
 */
export const bookValue: ReportDefinition = {
  key: "asset-book-value",
  feature: "depreciation",
  name: "Asset book value",
  description:
    "What each asset is worth after depreciation, from the month-end figures.",
  columns: [
    { key: "name", label: "Asset", type: "string" },
    { key: "category", label: "Category", type: "string" },
    { key: "cost", label: "Cost", type: "money" },
    { key: "accumulated", label: "Depreciation", type: "money" },
    { key: "book_value", label: "Book value", type: "money" },
    { key: "as_of", label: "As of", type: "date" },
  ],
  chart: {
    type: "bar",
    categoryKey: "category",
    valueKeys: ["book_value"],
    valueLabel: "Book value",
  },
  run: (ctx, params) =>
    withTenant(ctx.orgId, async (c) => {
      const values: unknown[] = [];
      const where = assetFilters(ctx, params, values);
      return (await c.query<ReportRow>(
        `SELECT a.name,
                coalesce(cat.name, 'Uncategorised') AS category,
                a.purchase_cost::text AS cost,
                coalesce(b.accumulated, 0)::text AS accumulated,
                (a.purchase_cost - coalesce(b.accumulated, 0))::text AS book_value,
                b.period_end::text AS as_of
           FROM assets a
           LEFT JOIN categories cat ON cat.id = a.category_id
           -- LATERAL, not a plain join: an asset has one row per closed month,
           -- and joining would repeat the asset once per period it has been
           -- valued, making every total wrong.
           LEFT JOIN LATERAL (
             SELECT accumulated, period_end
               FROM asset_book_values
              WHERE asset_id = a.id
              ORDER BY period_end DESC
              LIMIT 1
           ) b ON true
          WHERE ${where}
            AND a.purchase_cost IS NOT NULL
          ORDER BY (a.purchase_cost - coalesce(b.accumulated, 0)) DESC, a.name`,
        values,
      )).rows;
    }),
  totals: (rows) => ({
    name: "Total",
    category: "",
    cost: String(sumBy(rows, "cost")),
    accumulated: String(sumBy(rows, "accumulated")),
    book_value: String(sumBy(rows, "book_value")),
    as_of: null,
  }),
};
