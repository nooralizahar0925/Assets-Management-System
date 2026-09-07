import { Link } from "react-router";
import { describeEvent } from "../assets/HistoryTimeline";
import type { AuditEvent } from "../../api/types";

const ago = (iso: string) => {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

export default function RecentActivity({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        Nothing has happened yet. Activity appears here as people use the register.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {events.map((event) => (
        <li key={event.id} className="flex items-baseline gap-3 py-3 first:pt-0 last:pb-0">
          <span className="text-sm text-gray-700 dark:text-gray-300">
            <strong className="font-medium text-gray-800 dark:text-white/90">
              {event.actor_label ?? "System"}
            </strong>{" "}
            {describeEvent(event)}
            {event.asset_id && event.asset_name && (
              <>
                {" — "}
                <Link
                  to={`/assets/${event.asset_id}`}
                  className="text-brand-500 hover:text-brand-600"
                >
                  {event.asset_name}
                </Link>
              </>
            )}
          </span>
          <time className="ml-auto shrink-0 text-theme-xs text-gray-400" dateTime={event.created_at}>
            {ago(event.created_at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
