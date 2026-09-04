/**
 * Error logging that will not spill row data into the logs.
 *
 * A `pg` error carries `detail`, `where`, `internalQuery` and `query`, and on a
 * constraint violation `detail` quotes the offending row - which for the users
 * table means a password hash, and for any table means tenant data. Logs get
 * shipped, aggregated and read by people who are not entitled to that content,
 * so the fields are dropped rather than trusted.
 */

interface PgLikeError {
  code?: string;
  severity?: string;
  constraint?: string;
  table?: string;
  column?: string;
  schema?: string;
  routine?: string;
}

const PG_SAFE_FIELDS = [
  "code",
  "severity",
  "constraint",
  "table",
  "column",
  "schema",
  "routine",
] as const;

export interface SafeErrorReport {
  message: string;
  name: string;
  stack?: string;
  pg?: Record<string, string>;
}

/** Reduces an unknown thrown value to something safe to write to a log. */
export function redactError(err: unknown): SafeErrorReport {
  if (!(err instanceof Error)) {
    return { name: "NonError", message: String(err) };
  }

  const report: SafeErrorReport = {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };

  // `code` is the marker for a pg error; keep only the identifying fields.
  const candidate = err as unknown as PgLikeError;
  if (typeof candidate.code === "string") {
    const pg: Record<string, string> = {};
    for (const field of PG_SAFE_FIELDS) {
      const value = candidate[field];
      if (typeof value === "string") pg[field] = value;
    }
    report.pg = pg;
  }

  return report;
}

export function logError(context: string, err: unknown): void {
  console.error(JSON.stringify({ level: "error", context, ...redactError(err) }));
}
