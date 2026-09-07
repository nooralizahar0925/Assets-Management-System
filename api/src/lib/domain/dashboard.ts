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
    /** Cost less accumulated depreciation, from the month-end snapshots. */
    book_value: string;
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
    // Branch scope is folded into the `live` CTE, so every figure below is
    // scoped by construction. A dashboard showing organisation-wide totals to
    // someone whose register shows one branch summarises nothing they can act
    // on - and would leak how much the rest of the company holds.
    const scope = ctx.actor.locationScope;

    // One round trip. The dashboard is the first screen a user sees; eight
    // sequential queries would be felt even when each is fast.
    const { rows } = await c.query<{ payload: DashboardSummary }>(
      `WITH live AS (
         SELECT * FROM assets
          WHERE deleted_at IS NULL
            AND ($2::uuid[] IS NULL OR location_id = ANY($2::uuid[]))
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
       -- Written-down value: cost less whatever the latest closed month
       -- recorded. LATERAL rather than a join, so an asset valued for twelve
       -- months is counted once and not twelve times.
       book AS (
         SELECT coalesce(sum(
                  l.purchase_cost - coalesce(b.accumulated, 0)
                ), 0)::text AS book_value
         FROM live l
         LEFT JOIN LATERAL (
           SELECT accumulated FROM asset_book_values
            WHERE asset_id = l.id
            ORDER BY period_end DESC LIMIT 1
         ) b ON true
         WHERE l.purchase_cost IS NOT NULL
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
               JOIN live a ON a.id = ae.asset_id
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
           'book_value', bv.book_value,
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
       FROM totals t, book bv, assignments_now an, by_status bs, by_category bc,
            by_location bl, recent r, expiring ex`,
      [EXPIRY_FIELDS, scope],
    );

    const payload = rows[0].payload;
    return {
      ...payload,
      utilisation: { in_use_pct: Number(payload.utilisation.in_use_pct) },
    };
  });
}
