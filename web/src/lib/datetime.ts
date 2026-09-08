/**
 * How dates are shown to people.
 *
 * One module, because the alternative is what this replaced: eighteen calls to
 * toLocaleString with three different argument lists, and a handful of places
 * that printed the raw value and showed a customer "2026-10-01T09:00:00Z".
 *
 * Two rules that are easy to get wrong and expensive to get wrong:
 *
 * A **date** has no time of day. `new Date("2026-01-15")` is parsed as UTC
 * midnight, so west of Greenwich it renders as the 14th - a purchase date that
 * moves depending on who is looking at it. Date-only values are therefore
 * split and rendered without ever constructing a moment in time.
 *
 * A **timestamp** does have one, and is shown in the reader's own timezone,
 * because "when was this checked out" means when it happened where they are.
 */

const LOCALE = "en-GB";

/** `2026-01-15` — a date with no time of day. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-10-01T09:00:00Z`, and the other shapes the API emits. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type Value = string | number | Date | null | undefined;

/** What to show when there is nothing to show. */
export const EMPTY = "—";

/**
 * A date, with no timezone conversion: `15 Jan 2026`.
 *
 * Anything that is not a date is handed back untouched. Showing the original
 * value is always better than showing "Invalid Date", which tells the reader
 * nothing and hides what the data actually was.
 */
export function formatDate(value: Value): string {
  if (value === null || value === undefined || value === "") return EMPTY;

  if (typeof value === "string") {
    if (DATE_ONLY.test(value)) {
      const [year, month, day] = value.split("-");
      return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
    }
    // Only strings that actually look like dates are handed to Date, because
    // its parser is far too willing: new Date("AMS-000123") is the first of
    // January in the year 123, and an asset tag would render as a date.
    if (!TIMESTAMP.test(value)) return value;
  }

  const date = toDate(value);
  if (!date) return String(value);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** A moment in time, in the reader's timezone: `1 Oct 2026, 16:00`. */
export function formatDateTime(value: Value): string {
  if (value === null || value === undefined || value === "") return EMPTY;

  if (typeof value === "string") {
    // A date with no time of day does not become one by being asked for.
    if (DATE_ONLY.test(value)) return formatDate(value);
    if (!TIMESTAMP.test(value)) return value;
  }

  const date = toDate(value);
  if (!date) return String(value);

  const time = date.toLocaleTimeString(LOCALE, {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return `${formatDate(date)}, ${time}`;
}

/**
 * For a value whose type is not known at the point it is rendered - a custom
 * field, a report cell, an audit entry's before-and-after.
 *
 * Formats what looks like a date and leaves everything else exactly as it is,
 * because guessing wrong about a serial number that happens to look like a
 * date would corrupt what the reader sees.
 */
export function formatIfDate(value: unknown): string {
  if (value === null || value === undefined || value === "") return EMPTY;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value !== "string") return String(value);

  if (DATE_ONLY.test(value)) return formatDate(value);
  if (TIMESTAMP.test(value)) return formatDateTime(value);
  return value;
}

/**
 * How long until something, or how long since: `in 3 days`, `2 days ago`.
 *
 * Paired with the date rather than replacing it. "In 3 days" answers the
 * question people actually have about a due date, but only the date itself
 * settles an argument about it later.
 */
export function relativeDays(value: Value): string | null {
  const date = toDate(value);
  if (!date) return null;

  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round(
    (startOfDay(date) - startOfDay(new Date())) / 86_400_000,
  );

  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

function toDate(value: Value): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
