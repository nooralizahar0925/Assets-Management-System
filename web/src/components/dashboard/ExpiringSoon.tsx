import { Link } from "react-router";
import Badge from "../ui/badge/Badge";
import type { DashboardSummary } from "../../api/types";
import { formatDate } from "../../lib/datetime";

const FIELD_LABEL: Record<string, string> = {
  warranty_end: "Warranty",
  license_expiry: "Licence",
  next_service_at: "Service",
};

export default function ExpiringSoon({
  items,
}: { items: DashboardSummary["expiring_soon"] }) {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        Nothing expires in the next 90 days.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {items.map((item) => (
        <li key={`${item.id}-${item.field}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <Link
              to={`/assets/${item.id}`}
              className="block truncate text-sm font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
            >
              {item.name}
            </Link>
            <span className="text-theme-xs text-gray-500 dark:text-gray-400">
              {FIELD_LABEL[item.field] ?? item.field} · {formatDate(item.expires_on)}
            </span>
          </div>
          <Badge color={item.days_left <= 30 ? "error" : "warning"} size="sm">
            {item.days_left}d
          </Badge>
        </li>
      ))}
    </ul>
  );
}
