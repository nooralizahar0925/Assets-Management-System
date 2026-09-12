import { describe, it, expect } from "vitest";
import { daysUntilDue, type MaintenanceSchedule } from "./maintenance";
import { inDays } from "../test/dates";

/**
 * Due dates are counted in the reader's calendar, not in UTC.
 *
 * This used to build "today" from `new Date().toISOString().slice(0, 10)`,
 * which is the UTC date. East of UTC that is yesterday's date until mid-
 * morning, so a service due today was reported as due tomorrow to everybody in
 * Jakarta before about seven, and "3 days overdue" read as two. West of UTC the
 * same error appears in the evening, in the other direction.
 *
 * Stated as a property rather than fixed dates: a schedule due n days from now,
 * on the reader's own calendar, is n days from being due. That holds in every
 * timezone, which fixed dates in a test cannot.
 */

const due = (date: string | null): MaintenanceSchedule =>
  ({ next_due_at: date } as MaintenanceSchedule);

describe("days until a service is due", () => {
  it("counts from the reader's today, whatever UTC says", () => {
    expect(daysUntilDue(due(inDays(0)))).toBe(0);
    expect(daysUntilDue(due(inDays(1)))).toBe(1);
    expect(daysUntilDue(due(inDays(30)))).toBe(30);
  });

  it("goes negative for work that is late", () => {
    expect(daysUntilDue(due(inDays(-1)))).toBe(-1);
    expect(daysUntilDue(due(inDays(-10)))).toBe(-10);
  });

  it("says nothing about a schedule that runs on hours alone", () => {
    expect(daysUntilDue(due(null))).toBeNull();
  });
});
