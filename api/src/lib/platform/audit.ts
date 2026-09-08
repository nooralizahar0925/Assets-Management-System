import { withPlatform } from "./db";
import type { PlatformActor } from "./auth";

/**
 * One row per action the operator takes.
 *
 * Written where the customer's own audit trail cannot reach it, and where the
 * platform role holds INSERT but neither UPDATE nor DELETE: the point of this
 * record is that it cannot be tidied up afterwards, including by the person it
 * is about.
 *
 * The operator's email is stored alongside the id rather than only joined,
 * because an account can be removed and the trail has to stay readable. An
 * audit entry that says "deleted an organisation" and cannot say who is not
 * worth keeping.
 */
export async function recordPlatformAction(
  actor: PlatformActor,
  action: string,
  detail: { orgId?: string | null; orgSlug?: string | null; [key: string]: unknown } = {},
): Promise<void> {
  const { orgId, orgSlug, ...rest } = detail;
  await withPlatform((c) =>
    c.query(
      `INSERT INTO platform_audit
         (admin_id, admin_email, action, org_id, org_slug, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        actor.id, actor.email, action,
        orgId ?? null, orgSlug ?? null, JSON.stringify(rest),
      ],
    ),
  );
}

export interface PlatformAuditEntry {
  id: string;
  admin_email: string;
  action: string;
  org_id: string | null;
  org_slug: string | null;
  detail: Record<string, unknown>;
  occurred_at: string;
}

/** The most recent actions, newest first. */
export const recentPlatformActions = (limit = 100) =>
  withPlatform(async (c) =>
    (await c.query<PlatformAuditEntry>(
      `SELECT id::text, admin_email, action, org_id, org_slug, detail, occurred_at
         FROM platform_audit
        ORDER BY occurred_at DESC
        LIMIT $1`,
      [limit],
    )).rows,
  );
