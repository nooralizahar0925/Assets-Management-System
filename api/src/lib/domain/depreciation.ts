import type { DepreciationPolicy } from "./depreciation.repo";

export interface Period {
  /** Last day of the month, YYYY-MM-DD. */
  period_end: string;
  opening: number;
  charge: number;
  closing: number;
  accumulated: number;
}

/**
 * Guards a reducing balance, which approaches its floor without reaching it.
 * A hundred years of monthly periods is far past any asset's life, so hitting
 * this means the arithmetic is wrong rather than the asset unusually long-lived.
 */
const MAX_PERIODS = 1200;

const round2 = (value: number) => Math.round(value * 100) / 100;

export function endOfMonth(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10);
}

const nextPeriodEnd = (periodEnd: string): string => {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0))
    .toISOString().slice(0, 10);
};

/**
 * Every monthly period from the asset's start up to and including `until`.
 *
 * A whole month is charged in the month of acquisition - the convention this
 * system uses, recorded in the Phase 6 plan. Charges round to two decimals, and
 * the period that exhausts the depreciable amount takes whatever is left, so a
 * schedule always reconciles: accumulated + closing === cost.
 *
 * Pure by design: no database, no clock. Depreciation arithmetic is easy to get
 * wrong and expensive to find wrong, and a pure function can be tested
 * exhaustively without fixtures.
 */
export function buildSchedule(
  cost: number,
  start: string,
  policy: DepreciationPolicy,
  until: string,
): Period[] {
  if (policy.method === "none") return [];
  if (policy.method === "straight_line" && !policy.useful_life_months) return [];
  if (policy.method === "reducing_balance" && !policy.declining_rate_pct) return [];

  const floor = round2(cost * (policy.salvage_pct / 100));
  const depreciable = round2(cost - floor);
  if (depreciable <= 0) return [];

  const straightCharge =
    policy.method === "straight_line" && policy.useful_life_months
      ? round2(depreciable / policy.useful_life_months)
      : 0;
  const monthlyRate =
    policy.method === "reducing_balance" && policy.declining_rate_pct
      ? policy.declining_rate_pct / 100 / 12
      : 0;

  const periods: Period[] = [];
  let periodEnd = endOfMonth(start);
  let opening = cost;
  let accumulated = 0;
  let charged = 0;

  while (periodEnd <= until && periods.length < MAX_PERIODS) {
    if (
      policy.method === "straight_line"
      && policy.useful_life_months
      && periods.length >= policy.useful_life_months
    ) {
      break;
    }

    // The last period of a straight-line life always takes what is left.
    // Testing `charge >= remaining` alone is not enough: rounding each period
    // down leaves the final charge slightly SMALLER than the remainder, so the
    // schedule ends short of cost rather than over it.
    const isFinalStraightPeriod =
      policy.method === "straight_line"
      && policy.useful_life_months !== null
      && periods.length === policy.useful_life_months - 1;

    let charge =
      policy.method === "straight_line" ? straightCharge : round2(opening * monthlyRate);

    // The salvage floor, and the rounding drift with it.
    const remaining = round2(depreciable - charged);
    if (charge >= remaining || isFinalStraightPeriod) charge = remaining;
    if (charge <= 0) break;

    const closing = round2(opening - charge);
    accumulated = round2(accumulated + charge);
    charged = round2(charged + charge);

    periods.push({ period_end: periodEnd, opening, charge, closing, accumulated });

    opening = closing;
    periodEnd = nextPeriodEnd(periodEnd);
  }

  return periods;
}

/** The live figure: what the asset is worth on a given date. */
export function bookValueAt(
  cost: number,
  start: string,
  policy: DepreciationPolicy,
  on: string,
): number {
  const schedule = buildSchedule(cost, start, policy, endOfMonth(on));
  return schedule.length === 0 ? cost : schedule[schedule.length - 1].closing;
}
