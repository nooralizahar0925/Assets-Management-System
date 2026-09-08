import { withTenant } from "../../db";
import type { Ctx } from "../../http/handler";
import type { ReportDefinition, ReportRow } from "../types";
import { assetFilters, sumBy } from "./shared";
import { bookValue } from "./book-value";

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
      const where = assetFilters(ctx, params, values);
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
      const where = assetFilters(ctx, params, values);
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
      const where = assetFilters(ctx, params, values);
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
  run: (ctx, params) =>
    withTenant(ctx.orgId, async (c) => {
      const values: unknown[] = [];
      // The assets table is aliased `s` here, so the shared filter is told so.
      const where = assetFilters(ctx, params, values, "s");
      return (await c.query<ReportRow>(
        `SELECT s.asset_tag, s.name AS asset_name,
                coalesce(u.name, a.assignee_label, l.name, '-') AS holder,
                a.checked_out_at,
                floor(extract(epoch FROM now() - a.checked_out_at) / 86400)::int AS days_out,
                a.due_at,
                CASE WHEN a.due_at IS NOT NULL AND a.due_at < now()
                     THEN 'Yes' ELSE 'No' END AS overdue
           FROM assignments a
           JOIN assets s ON s.id = a.asset_id
           LEFT JOIN users u ON u.id = a.assignee_id
           LEFT JOIN locations l ON l.id = a.location_id
          WHERE a.checked_in_at IS NULL AND ${where}
          ORDER BY a.checked_out_at`,
        values,
      )).rows;
    }),
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
  chart: {
    type: "none", categoryKey: "asset_name", valueKeys: ["days_late"],
    valueLabel: "Days late",
  },
  run: (ctx, params) =>
    withTenant(ctx.orgId, async (c) => {
      const values: unknown[] = [];
      const where = assetFilters(ctx, params, values, "s");
      return (await c.query<ReportRow>(
        `SELECT s.asset_tag, s.name AS asset_name,
                coalesce(u.name, a.assignee_label, l.name, '-') AS holder,
                a.due_at,
                floor(extract(epoch FROM now() - a.due_at) / 86400)::int AS days_late
           FROM assignments a
           JOIN assets s ON s.id = a.asset_id
           LEFT JOIN users u ON u.id = a.assignee_id
           LEFT JOIN locations l ON l.id = a.location_id
          WHERE a.checked_in_at IS NULL AND a.due_at IS NOT NULL AND a.due_at < now()
            AND ${where}
          ORDER BY a.due_at`,
        values,
      )).rows;
    }),
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
    withTenant(ctx.orgId, async (c) => {
      const values: unknown[] = [String(params.days ?? 90)];
      const where = assetFilters(ctx, params, values);
      return (await c.query<ReportRow>(
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
          WHERE ${where}
            AND a.status NOT IN ('retired', 'lost')
            AND a.custom ->> f.field ~ '^\\d{4}-\\d{2}-\\d{2}$'
            AND (a.custom ->> f.field)::date
                BETWEEN current_date AND current_date + ($1 || ' days')::interval
          ORDER BY expires_on`,
        values,
      )).rows;
    }),
};

const utilisation: ReportDefinition = {
  key: "utilisation",
  name: "Utilisation",
  description:
    "Days each asset spent checked out against days owned - which assets earn their keep.",
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
      const where = assetFilters(ctx, params, values);
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
  description: "Recorded events per day - how much the register is actually being used.",
  columns: [
    { key: "day", label: "Day", type: "date" },
    { key: "events", label: "Events", type: "number" },
  ],
  chart: { type: "line", categoryKey: "day", valueKeys: ["events"], valueLabel: "Events" },
  run: (ctx, params) =>
    withTenant(ctx.orgId, async (c) =>
      (await c.query<ReportRow>(
        `SELECT to_char(date_trunc('day', e.created_at), 'YYYY-MM-DD') AS day,
                count(*)::int AS events
           FROM audit_events e
          WHERE e.created_at >= coalesce($1::timestamptz, now() - interval '30 days')
            AND e.created_at <= coalesce($2::timestamptz, now())
            -- Branch scope reaches the audit trail through the asset each event
            -- is about. An event with no asset is organisation-level, so a
            -- scoped caller does not see it.
            AND ($3::uuid[] IS NULL OR EXISTS (
                  SELECT 1 FROM assets a
                   WHERE a.id = e.asset_id
                     AND a.location_id = ANY($3::uuid[])))
          GROUP BY 1 ORDER BY 1`,
        [params.from ?? null, params.to ?? null, ctx.actor.locationScope],
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
      const where = assetFilters(ctx, params, values);
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
    utilisation, auditActivity, acquisitionValue, bookValue,
  ].map((definition) => [definition.key, definition]),
);
