import { query } from "../db";
import type { Ctx } from "../http/handler";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import { processOutbox, } from "../email/outbox";
import { purgeRateLimitEvents } from "../auth/apikey";
import { purgeOldLoginAttempts } from "../auth/loginThrottle";
import { runOverdueJob } from "./overdue";
import { runExpiryJobs } from "./expiring";
import { runDueSchedules } from "../reports/schedules";
import { logError } from "../http/logger";

/**
 * The scheduler acts as the organisation itself, not as a person.
 *
 * It holds every permission because it is not subject to authorization - there
 * is no user to authorize - and no branch scope, because a nightly overdue
 * sweep must see the whole register regardless of who happens to be limited to
 * which site.
 */
const systemCtx = (orgId: string): Ctx => ({
  orgId,
  actor: {
    type: "system",
    id: orgId,
    label: "Scheduler",
    scopes: ["admin"],
    permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
    locationScope: null,
  },
});

export interface JobRunSummary {
  scheduled_reports?: number;
  org_id: string;
  overdue: number;
  warranty: number;
  licence: number;
  maintenance: number;
  sent: number;
  failed: number;
}

/** Every organisation, one at a time. One tenant's failure must not stop the rest. */
export async function runAllJobs(): Promise<JobRunSummary[]> {
  // Pre-tenant lookup: there is no app.org_id to set until an organisation has
  // been chosen. See migration 013 for why this is a SECURITY DEFINER function
  // rather than a cross-tenant grant.
  const rows = await query<{ id: string; name: string }>(
    "SELECT * FROM scheduler_list_organizations()",
  );

  const summaries: JobRunSummary[] = [];

  for (const org of rows) {
    const ctx = systemCtx(org.id);
    try {
      const overdue = await runOverdueJob(ctx);
      const expiry = await runExpiryJobs(ctx);
      const mail = await processOutbox(ctx, 100);

      // Tenant-scoped housekeeping belongs inside the per-org loop, under the
      // guard - the table it sweeps carries org_id and row-level security.
      await purgeRateLimitEvents(ctx);

      summaries.push({
        org_id: org.id,
        overdue: overdue.notified,
        ...expiry,
        sent: mail.sent,
        failed: mail.failed,
      });
    } catch (err) {
      // A tenant whose data trips a job must not stop the other tenants'
      // notifications going out.
      logError(`scheduled jobs for org ${org.id}`, err);
    }
  }

  // Scheduled reports iterate organisations themselves, so they run once after
  // the per-org loop rather than inside it.
  try {
    const reports = await runDueSchedules();
    if (summaries.length > 0) summaries[0].scheduled_reports = reports.delivered;
  } catch (err) {
    logError("scheduled report delivery", err);
  }

  // login_attempts is the one table with no tenant - login happens before an
  // organisation is known - so its sweep runs once, outside the loop.
  try {
    await purgeOldLoginAttempts();
  } catch (err) {
    logError("scheduler housekeeping", err);
  }

  return summaries;
}
