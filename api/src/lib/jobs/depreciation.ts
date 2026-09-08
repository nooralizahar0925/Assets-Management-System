import { listDepreciableAssets, saveSnapshots } from "../domain/depreciation.repo";
import { buildSchedule } from "../domain/depreciation";
import type { Ctx } from "../http/handler";

export interface DepreciationRunSummary {
  /** How many assets were considered, whether or not anything was written. */
  assets: number;
  periods: number;
}

/** The last day of the month before the one containing `asOf`. */
function lastClosedPeriod(asOf: string): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  // Day 0 of the current month is the last day of the previous one.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))
    .toISOString().slice(0, 10);
}

/**
 * Records book values for every month that has ended.
 *
 * Deliberately not the current month: a snapshot that changes when you re-run
 * it in the same month is not a snapshot. Re-running is otherwise safe, and a
 * run after an outage backfills every month it missed rather than leaving a
 * hole in the ledger.
 */
export async function runDepreciationJob(
  ctx: Ctx,
  asOf: string = new Date().toISOString().slice(0, 10),
): Promise<DepreciationRunSummary> {
  const until = lastClosedPeriod(asOf);
  const assets = await listDepreciableAssets(ctx);

  let periods = 0;
  for (const asset of assets) {
    const schedule = buildSchedule(
      Number(asset.cost), asset.start, asset.policy, until,
    );
    periods += await saveSnapshots(ctx, asset.id, asset.policy.method, schedule);
  }

  return { assets: assets.length, periods };
}
