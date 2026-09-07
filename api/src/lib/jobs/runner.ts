import { query } from "../db";
import type { Ctx } from "../http/handler";
import { systemCtx } from "./context";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import { processOutbox, } from "../email/outbox";
import { purgeRateLimitEvents } from "../auth/apikey";
import { purgeOldLoginAttempts } from "../auth/loginThrottle";
import { runOverdueJob } from "./overdue";
import { runExpiryJobs } from "./expiring";
import { runDepreciationJob } from "./depreciation";
import { runMaintenanceJob } from "./maintenance";
import { deliverPending } from "../domain/webhooks";
import { runDueSchedules } from "../reports/schedules";
import { logError } from "../http/logger";


export interface JobRunSummary {
  scheduled_reports?: number;
  org_id: string;
  overdue: number;
  /** Book-value rows written. Zero for most of the month, by design. */
  depreciation: number;
  /** Service reminders sent from recurring schedules. */
  servicing: number;
  /** Webhook deliveries that reached their endpoint this sweep. */
  webhooks: number;
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

      // Month-end book values. Runs nightly and writes nothing for most of the
      // month; the first run after a month closes records that month.
      const depreciation = await runDepreciationJob(ctx);

      // Recurring service schedules. The expiry sweep above still covers
      // assets that carry only the one-off next_service_at field.
      const servicing = await runMaintenanceJob(ctx);

      // Queued webhook deliveries, including retries whose backoff has
      // elapsed. Sending inline would make a customer's slow endpoint into our
      // slow request.
      const hooks = await deliverPending(ctx);

      summaries.push({
        org_id: org.id,
        overdue: overdue.notified,
        depreciation: depreciation.periods,
        servicing: servicing.notified,
        webhooks: hooks.delivered,
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
