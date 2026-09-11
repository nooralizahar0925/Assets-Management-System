import { withPlatform } from "./db";

/**
 * What needs a decision.
 *
 * Not a dashboard of numbers: a list of customers with a reason beside each,
 * because the operator's question is "who do I need to do something about
 * today" and a chart never answers it. Everything here is something a person
 * acts on - ring them, change their plan, delete them, ask why.
 *
 * Deliberately no automation behind any of it. A trial that lapses is shown,
 * never enforced at three in the morning, and suspension stays a deliberate
 * act with a name against it.
 */

export type ReasonKind =
  | "trial-ending"
  | "renewal-due"
  | "over-limit"
  | "no-plan"
  | "long-suspended"
  | "dormant";

export interface Reason {
  kind: ReasonKind;
  /** Written for the operator, and specific enough to act on. */
  detail: string;
}

export interface AttentionItem {
  org_id: string;
  name: string;
  slug: string;
  reasons: Reason[];
}

const TRIAL_DAYS = 14;
const RENEWAL_DAYS = 30;
const SUSPENDED_DAYS = 90;
const DORMANT_DAYS = 60;

interface Row {
  org_id: string;
  name: string;
  slug: string;
  kind: ReasonKind;
  detail: string;
}

export async function needsAttention(): Promise<AttentionItem[]> {
  const rows = await withPlatform(async (c) =>
    (await c.query<Row>(
      `
      -- A trial about to lapse. Shown, never acted on: nothing here suspends
      -- a customer by itself.
      SELECT o.id AS org_id, o.name, o.slug, 'trial-ending' AS kind,
             'Trial ends ' || to_char(o.trial_ends_at, 'DD Mon YYYY') AS detail
        FROM organizations o
       WHERE o.suspended_at IS NULL
         AND o.trial_ends_at IS NOT NULL
         AND o.trial_ends_at <= current_date + $1::int
         AND o.trial_ends_at >= current_date - 30

      UNION ALL

      SELECT o.id, o.name, o.slug, 'renewal-due',
             'Renews ' || to_char(o.renews_on, 'DD Mon YYYY')
        FROM organizations o
       WHERE o.suspended_at IS NULL
         AND o.renews_on IS NOT NULL
         AND o.renews_on <= current_date + $2::int
         AND o.renews_on >= current_date - 30

      UNION ALL

      -- A customer who has not been put on anything. They can use the
      -- register and nothing that is sold, which is nobody's intention for
      -- long.
      SELECT o.id, o.name, o.slug, 'no-plan',
             'On no plan since ' || to_char(o.created_at, 'DD Mon YYYY')
        FROM organizations o
       WHERE o.suspended_at IS NULL
         AND o.plan_code IS NULL

      UNION ALL

      -- Over a limit their plan sets. Their writes are being refused right
      -- now, so this is the most urgent thing on the list.
      SELECT o.id, o.name, o.slug, 'over-limit',
             'Holds ' || u.assets || ' assets against a limit of ' || l.cap
        FROM organizations o
        JOIN plans p ON p.code = o.plan_code
        CROSS JOIN LATERAL (
          SELECT coalesce(
            (o.limit_overrides ->> 'max_assets')::int,
            (p.limits ->> 'max_assets')::int
          ) AS cap
        ) l
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS assets FROM assets a
           WHERE a.org_id = o.id AND a.deleted_at IS NULL
        ) u
       WHERE o.suspended_at IS NULL
         AND l.cap IS NOT NULL
         AND u.assets > l.cap

      UNION ALL

      -- Suspended long enough that somebody should decide: reinstate, or
      -- delete and stop holding their data.
      SELECT o.id, o.name, o.slug, 'long-suspended',
             'Suspended since ' || to_char(o.suspended_at, 'DD Mon YYYY')
        FROM organizations o
       WHERE o.suspended_at IS NOT NULL
         AND o.suspended_at < now() - ($3 || ' days')::interval

      UNION ALL

      -- Nobody has signed in for months. Either they have stopped using it -
      -- worth a conversation before the renewal - or something is wrong.
      SELECT o.id, o.name, o.slug, 'dormant',
             CASE WHEN s.last_seen IS NULL
                  THEN 'Nobody has ever signed in'
                  ELSE 'Last sign-in ' || to_char(s.last_seen, 'DD Mon YYYY')
             END
        FROM organizations o
        CROSS JOIN LATERAL (
          SELECT max(created_at) AS last_seen FROM sessions WHERE org_id = o.id
        ) s
       WHERE o.suspended_at IS NULL
         AND (s.last_seen IS NULL OR s.last_seen < now() - ($4 || ' days')::interval)
         -- Not a customer created this week: "nobody has signed in" is only
         -- news once they have had a chance to.
         AND o.created_at < now() - ($4 || ' days')::interval
      `,
      [TRIAL_DAYS, RENEWAL_DAYS, String(SUSPENDED_DAYS), String(DORMANT_DAYS)],
    )).rows,
  );

  // Grouped by customer, because the operator rings a customer rather than a
  // reason. Counting rows would say nine when there are four people to call.
  const byOrg = new Map<string, AttentionItem>();
  for (const row of rows) {
    const existing = byOrg.get(row.org_id);
    const reason: Reason = { kind: row.kind, detail: row.detail };
    if (existing) existing.reasons.push(reason);
    else {
      byOrg.set(row.org_id, {
        org_id: row.org_id, name: row.name, slug: row.slug, reasons: [reason],
      });
    }
  }

  // Most reasons first: a customer who is over their limit, dormant and up for
  // renewal is a more interesting conversation than one who is merely due.
  return [...byOrg.values()].sort(
    (a, b) => b.reasons.length - a.reasons.length || a.name.localeCompare(b.name),
  );
}
