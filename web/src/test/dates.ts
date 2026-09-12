/**
 * A date-only string N days from today, in the local calendar.
 *
 * Deliberately not `new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)`,
 * which is what this replaced in two suites. That builds the date in UTC, while
 * everything that renders it - relativeDays, formatDate - works in local time.
 * The two agree for most of the day and disagree in the window where the local
 * date is not the UTC date: east of UTC that is the early morning, west of it
 * the late evening.
 *
 * The result was a test that passed all day and failed before breakfast in
 * Jakarta, blaming whatever change happened to be in flight at the time.
 */
export function inDays(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
