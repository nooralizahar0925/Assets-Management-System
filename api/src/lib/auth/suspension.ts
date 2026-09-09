import { withTenant } from "../db";
import { problem } from "../http/problem";

/**
 * Whether an organisation has been suspended by the operator.
 *
 * Checked in the guard rather than only at sign-in, so suspending a customer
 * stops their existing sessions and their API keys as well. A suspension that
 * only refused new sign-ins would leave whoever was already signed in working
 * normally, and every integration running - which is not a suspension.
 *
 * Read inside the organisation's own tenant context. The `own_org` policy is
 * written without a missing-ok flag, so `current_setting('app.org_id')` raises
 * rather than returning null when there is none - reading this on the plain
 * pool turned every authenticated request into a 500.
 */
const CACHE_MS = 10_000;
const cache = new Map<string, { suspended: boolean; at: number }>();

export async function isSuspended(orgId: string): Promise<boolean> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.suspended;

  const rows = await withTenant(orgId, async (c) =>
    (await c.query<{ suspended: boolean }>(
      "SELECT suspended_at IS NOT NULL AS suspended FROM organizations WHERE id = $1",
      [orgId],
    )).rows,
  );
  // An organisation that has vanished is not "not suspended": the session
  // pointing at it is worthless either way, and treating it as live would let
  // a request through on a tenant that no longer exists.
  const suspended = rows[0]?.suspended ?? true;

  // Ten seconds, because this is on every authenticated request and a
  // suspension does not need to take effect within the same second - but it
  // does need to take effect without a deploy or a restart.
  cache.set(orgId, { suspended, at: Date.now() });
  return suspended;
}

/** Used by the tests, and by anything that changes a suspension. */
export const forgetSuspension = (orgId?: string) =>
  orgId ? cache.delete(orgId) : cache.clear();

export const suspendedResponse = () =>
  problem(403, "organization-suspended", "Organisation suspended", {
    detail:
      "This organisation's access has been suspended. Its data is intact. "
      + "Contact whoever manages your subscription to restore access.",
  });
