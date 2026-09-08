import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatDate, formatDateTime, formatIfDate, relativeDays, EMPTY,
} from "./datetime";

afterEach(() => vi.useRealTimers());

describe("formatDate", () => {
  it("reads as a person would write it", () => {
    expect(formatDate("2026-01-15")).toBe("15 Jan 2026");
  });

  it("does not shift a date-only value by timezone", () => {
    // new Date("2026-01-15") is UTC midnight, so west of Greenwich it renders
    // as the 14th. A purchase date that changes depending on who is looking at
    // it is worse than no purchase date.
    expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("drops the leading zero, because nobody writes 05 Jan", () => {
    expect(formatDate("2026-01-05")).toBe("5 Jan 2026");
  });

  it("says nothing rather than nothing-looking", () => {
    expect(formatDate(null)).toBe(EMPTY);
    expect(formatDate(undefined)).toBe(EMPTY);
    expect(formatDate("")).toBe(EMPTY);
  });

  it("hands back something it cannot read, rather than Invalid Date", () => {
    // "Invalid Date" tells the reader nothing and hides what was actually
    // stored, which is exactly what they need to see to report the problem.
    expect(formatDate("not a date")).toBe("not a date");
    expect(formatDate("AMS-000123")).toBe("AMS-000123");
  });
});

describe("formatDateTime", () => {
  it("shows the time alongside the date", () => {
    const out = formatDateTime("2026-10-01T09:00:00Z");
    expect(out).toMatch(/^1 Oct 2026, \d{2}:\d{2}$/);
  });

  it("uses a 24-hour clock, so 13:00 is never 1 o'clock at night", () => {
    expect(formatDateTime("2026-10-01T13:30:00Z")).not.toMatch(/am|pm/i);
  });

  it("does not invent a time of day for a date that has none", () => {
    expect(formatDateTime("2026-01-15")).toBe("15 Jan 2026");
  });

  it("never shows the reader a raw ISO string", () => {
    // The whole reason this module exists: a customer was shown
    // "2026-10-01T09:00:00Z" as a due date.
    expect(formatDateTime("2026-10-01T09:00:00Z")).not.toContain("T");
    expect(formatDateTime("2026-10-01T09:00:00Z")).not.toContain("Z");
  });

  it("says nothing rather than nothing-looking", () => {
    expect(formatDateTime(null)).toBe(EMPTY);
  });
});

describe("formatIfDate", () => {
  it("formats what is a date", () => {
    expect(formatIfDate("2026-01-15")).toBe("15 Jan 2026");
    expect(formatIfDate("2026-10-01T09:00:00Z")).toMatch(/^1 Oct 2026, /);
  });

  it("leaves alone what is not", () => {
    // A custom field can hold anything. Guessing wrong about a serial number
    // that happens to look like a date would corrupt what the reader sees.
    expect(formatIfDate("PF3ABCDE")).toBe("PF3ABCDE");
    expect(formatIfDate("1420")).toBe("1420");
    expect(formatIfDate(1420)).toBe("1420");
  });

  it("reads a boolean out loud", () => {
    expect(formatIfDate(true)).toBe("Yes");
    expect(formatIfDate(false)).toBe("No");
  });

  it("says nothing rather than nothing-looking", () => {
    expect(formatIfDate(null)).toBe(EMPTY);
    expect(formatIfDate("")).toBe(EMPTY);
  });
});

describe("relativeDays", () => {
  it("answers the question somebody actually has about a due date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 12, 0, 0));

    expect(relativeDays(new Date(2026, 9, 1))).toBe("today");
    expect(relativeDays(new Date(2026, 9, 2))).toBe("tomorrow");
    expect(relativeDays(new Date(2026, 8, 30))).toBe("yesterday");
    expect(relativeDays(new Date(2026, 9, 4))).toBe("in 3 days");
    expect(relativeDays(new Date(2026, 8, 28))).toBe("3 days ago");
  });

  it("counts whole days, not periods of 24 hours", () => {
    // Due at 09:00 tomorrow is "tomorrow", even though it is 21 hours away.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 12, 0, 0));
    expect(relativeDays(new Date(2026, 9, 2, 9, 0, 0))).toBe("tomorrow");
  });

  it("has nothing to say about a value that is not a date", () => {
    expect(relativeDays("not a date")).toBeNull();
    expect(relativeDays(null)).toBeNull();
  });
});
