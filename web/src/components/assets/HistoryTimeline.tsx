import type { AuditEvent, Assignment } from "../../api/types";

const value = (raw: unknown) =>
  raw === null || raw === undefined || raw === "" ? "empty" : String(raw);

/** Turns a stored event into a sentence a non-technical user can read. */
export function describeEvent(event: AuditEvent): string {
  const fields = Object.entries(event.changes ?? {});

  switch (event.event) {
    case "asset.created":
      return "created this asset";
    case "asset.deleted":
      return "deleted this asset";
    case "asset.note":
      return "added a note";
    case "asset.checked_out":
      return "checked out this asset";
    case "asset.checked_in":
      return "checked in this asset";
    case "asset.attachment_added":
      return `attached ${value(fields[0]?.[1]?.to)}`;
    case "asset.attachment_removed":
      return `removed the attachment ${value(fields[0]?.[1]?.from)}`;
    case "asset.overdue_notified":
      return "sent an overdue reminder";
    case "asset.updated": {
      if (fields.length === 0) return "updated this asset";
      if (fields.length === 1) {
        const [field, change] = fields[0];
        return `changed ${field} from ${value(change.from)} to ${value(change.to)}`;
      }
      return `updated ${fields.map(([field]) => field).join(", ")}`;
    }
    default:
      return event.event.replace(/^asset\./, "").replace(/[._]/g, " ");
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const DOT: Record<string, string> = {
  "asset.created": "bg-brand-500",
  "asset.checked_out": "bg-blue-light-500",
  "asset.checked_in": "bg-success-500",
  "asset.updated": "bg-gray-400",
  "asset.note": "bg-warning-500",
  "asset.deleted": "bg-error-500",
};

export default function HistoryTimeline({
  events,
}: {
  events: AuditEvent[];
  assignments: Assignment[];
}) {
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        No activity yet. Everything that happens to this asset will appear here.
      </p>
    );
  }

  return (
    <ol className="relative space-y-6 border-l border-gray-200 pl-6 dark:border-gray-800">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden
            className={`absolute -left-[1.6875rem] top-1.5 h-3 w-3 rounded-full ring-4 ring-white dark:ring-gray-900 ${
              DOT[event.event] ?? "bg-gray-400"
            }`}
          />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-gray-800 dark:text-white/90">
              {event.actor_label ?? "System"}
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {describeEvent(event)}
            </span>
          </div>
          <time className="text-theme-xs text-gray-400" dateTime={event.created_at}>
            {when(event.created_at)}
          </time>
          {event.note && (
            <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-white/[0.03] dark:text-gray-300">
              {event.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
