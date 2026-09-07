import { describe, it, expect } from "vitest";
import { buildSchedule, bookValueAt, endOfMonth } from "./depreciation";
import type { DepreciationPolicy } from "./depreciation.repo";

const straightLine = (months: number, salvagePct = 0): DepreciationPolicy => ({
  method: "straight_line",
  useful_life_months: months,
  salvage_pct: salvagePct,
  declining_rate_pct: null,
});

const reducing = (ratePct: number, salvagePct = 0): DepreciationPolicy => ({
  method: "reducing_balance",
  useful_life_months: null,
  salvage_pct: salvagePct,
  declining_rate_pct: ratePct,
});

describe("endOfMonth", () => {
  it("returns the last day of the month", () => {
    expect(endOfMonth("2026-01-10")).toBe("2026-01-31");
    expect(endOfMonth("2026-02-01")).toBe("2026-02-28");
  });

  it("knows about leap years", () => {
    expect(endOfMonth("2028-02-15")).toBe("2028-02-29");
  });
});

describe("buildSchedule - straight line", () => {
  it("charges an equal amount each month", () => {
    const schedule = buildSchedule(36_000_000, "2026-01-15", straightLine(36), "2026-03-31");
    expect(schedule).toHaveLength(3);
    expect(schedule[0].charge).toBe(1_000_000);
    expect(schedule[1].charge).toBe(1_000_000);
  });

  it("charges a whole month in the month of acquisition", () => {
    // The convention this system uses, documented in the phase plan. Pro-rata
    // by day would be a change to this line alone.
    const schedule = buildSchedule(36_000_000, "2026-01-31", straightLine(36), "2026-01-31");
    expect(schedule).toHaveLength(1);
    expect(schedule[0].charge).toBe(1_000_000);
  });

  it("stops at the end of the useful life", () => {
    const schedule = buildSchedule(36_000_000, "2026-01-01", straightLine(36), "2030-12-31");
    expect(schedule).toHaveLength(36);
    expect(schedule[35].closing).toBe(0);
  });

  it("never charges below the salvage value", () => {
    const schedule = buildSchedule(10_000_000, "2026-01-01", straightLine(10, 20), "2027-12-31");
    expect(schedule).toHaveLength(10);
    expect(schedule[schedule.length - 1].closing).toBe(2_000_000);
  });

  it("absorbs rounding drift in the final period so the totals reconcile", () => {
    // 12,000,000 / 36 is 333,333.33, and 36 of those is 11,999,999.88. A report
    // whose depreciation does not sum to cost is one finance will not sign.
    const schedule = buildSchedule(12_000_000, "2026-01-01", straightLine(36), "2029-12-31");
    const total = schedule.reduce((sum, p) => sum + p.charge, 0);
    expect(Number(total.toFixed(2))).toBe(12_000_000);
    expect(schedule[schedule.length - 1].closing).toBe(0);
    expect(schedule).toHaveLength(36);
  });

  it("keeps opening equal to the previous closing throughout", () => {
    const schedule = buildSchedule(7_777_777, "2026-01-01", straightLine(9), "2027-12-31");
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i].opening).toBe(schedule[i - 1].closing);
    }
    const last = schedule[schedule.length - 1];
    expect(Number((last.accumulated + last.closing).toFixed(2))).toBe(7_777_777);
  });
});

describe("buildSchedule - reducing balance", () => {
  it("charges a share of the remaining value, not of cost", () => {
    // 24% a year is 2% a month of whatever is left.
    const schedule = buildSchedule(100_000_000, "2026-01-01", reducing(24), "2026-03-31");
    expect(schedule[0].charge).toBe(2_000_000);
    expect(schedule[1].opening).toBe(98_000_000);
    expect(schedule[1].charge).toBe(1_960_000);
  });

  it("stops at the salvage value rather than approaching zero forever", () => {
    const schedule = buildSchedule(100_000_000, "2026-01-01", reducing(60, 10), "2036-12-31");
    expect(schedule[schedule.length - 1].closing).toBe(10_000_000);
    // Without the floor this would run to the `until` date on every asset.
    expect(schedule.length).toBeLessThan(120);
  });
});

describe("buildSchedule - nothing to do", () => {
  it("returns no periods when the method is none", () => {
    expect(buildSchedule(1_000_000, "2026-01-01", {
      method: "none", useful_life_months: null,
      salvage_pct: 0, declining_rate_pct: null,
    }, "2027-01-31")).toEqual([]);
  });

  it("returns no periods when straight line has no useful life", () => {
    expect(buildSchedule(1_000_000, "2026-01-01",
      { ...straightLine(12), useful_life_months: null }, "2027-01-31")).toEqual([]);
  });

  it("returns no periods when reducing balance has no rate", () => {
    expect(buildSchedule(1_000_000, "2026-01-01",
      { ...reducing(20), declining_rate_pct: null }, "2027-01-31")).toEqual([]);
  });

  it("returns no periods before the asset starts", () => {
    expect(buildSchedule(1_000_000, "2026-06-01", straightLine(12), "2026-03-31")).toEqual([]);
  });

  it("returns no periods when salvage is the whole cost", () => {
    expect(buildSchedule(1_000_000, "2026-01-01", straightLine(12, 100), "2027-01-31"))
      .toEqual([]);
  });
});

describe("bookValueAt", () => {
  it("is the cost on the day before depreciation starts", () => {
    expect(bookValueAt(36_000_000, "2026-02-01", straightLine(36), "2026-01-31"))
      .toBe(36_000_000);
  });

  it("falls by one period's charge after the first month", () => {
    expect(bookValueAt(36_000_000, "2026-01-01", straightLine(36), "2026-01-31"))
      .toBe(35_000_000);
  });

  it("holds at the salvage value once fully depreciated", () => {
    expect(bookValueAt(10_000_000, "2026-01-01", straightLine(10, 20), "2030-01-31"))
      .toBe(2_000_000);
  });
});
