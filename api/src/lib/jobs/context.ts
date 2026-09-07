import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";

/**
 * The context background work runs under.
 *
 * There is no signed-in person behind a scheduled job, but the domain functions
 * it calls all check permissions, so it holds every one of them. It is
 * organisation-wide by design: a sweep that inherited someone's branch scope
 * would silently skip the branches that person cannot see, and an overdue
 * notice nobody receives is worse than none.
 *
 * `label` is what appears in the audit trail. The scheduler passes its own
 * name; the report deliverer passes the organisation's, because a scheduled
 * report is sent on that organisation's behalf.
 */
export const systemCtx = (orgId: string, label = "Scheduler"): Ctx => ({
  orgId,
  actor: {
    type: "system",
    id: orgId,
    label,
    scopes: ["admin"],
    permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
    locationScope: null,
  },
});
