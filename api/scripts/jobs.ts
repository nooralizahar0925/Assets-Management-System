import { runAllJobs } from "../src/lib/jobs/runner";

const INTERVAL_MS = Number(process.env.JOB_INTERVAL_MS ?? 15 * 60 * 1000);

/**
 * The scheduler entrypoint.
 *
 * A plain interval rather than cron: the jobs are idempotent - each is
 * de-duplicated by an audit marker - so running one more often than needed
 * costs a query, not a duplicate email. That makes a missed tick harmless,
 * which matters more than firing at an exact minute.
 */
async function tick(): Promise<void> {
  const started = Date.now();
  try {
    const summaries = await runAllJobs();
    const totals = summaries.reduce(
      (acc, s) => ({
        overdue: acc.overdue + s.overdue,
        expiring: acc.expiring + s.warranty + s.licence + s.maintenance,
        sent: acc.sent + s.sent,
        failed: acc.failed + s.failed,
      }),
      { overdue: 0, expiring: 0, sent: 0, failed: 0 },
    );
    process.stdout.write(
      JSON.stringify({
        level: "info", event: "jobs.tick",
        organisations: summaries.length, ...totals,
        duration_ms: Date.now() - started,
      }) + "\n",
    );
  } catch (err) {
    process.stderr.write(
      JSON.stringify({
        level: "error", event: "jobs.tick.failed",
        message: (err as Error).message,
      }) + "\n",
    );
  }
}

await tick();
setInterval(() => void tick(), INTERVAL_MS);
