import { Link } from "react-router";
import { useAuth } from "../../context/AuthContext";
import type { DashboardSummary } from "../../api/types";
import { money, moneyExact } from "../../lib/palette";

interface Tile {
  label: string;
  value: string;
  /** Omitted when the reader has nowhere they are allowed to go. */
  href?: string;
  hint?: string;
  tone?: "default" | "error" | "warning";
  /** Shown on hover where the displayed value is rounded. */
  title?: string;
}

export default function KpiTiles({
  totals, utilisation,
}: Pick<DashboardSummary, "totals" | "utilisation">) {
  const { can } = useAuth();

  // Three of these tiles drill into a report. Without reports:read the number
  // is still worth showing - it is the link that would fail, and there is no
  // register filter for "overdue" or "utilisation" to fall back to.
  const report = (path: string) => (can("reports:read") ? path : undefined);

  const tiles: Tile[] = [
    { label: "Total assets", value: totals.assets.toLocaleString("en-GB"), href: "/assets" },
    {
      label: "Checked out", value: totals.active_assignments.toLocaleString("en-GB"),
      href: "/assets?status=in_use",
      hint: `${utilisation.in_use_pct}% of the register`,
    },
    {
      label: "Overdue", value: totals.overdue.toLocaleString("en-GB"),
      href: report("/reports/assignments-overdue"),
      tone: totals.overdue > 0 ? "error" : "default",
      hint: totals.overdue > 0 ? "Past their return date" : "Nothing is late",
    },
    {
      label: "In maintenance", value: totals.maintenance.toLocaleString("en-GB"),
      href: "/assets?status=maintenance",
      tone: totals.maintenance > 0 ? "warning" : "default",
    },
    {
      label: "Register value", value: money(totals.total_value, totals.currency),
      title: moneyExact(totals.total_value, totals.currency),
      href: report("/reports/assets-by-category"),
    },
    {
      label: "Utilisation", value: `${utilisation.in_use_pct}%`,
      href: report("/reports/utilisation"), hint: "Share of assets in use",
    },
  ];

  const toneClass = {
    default: "text-gray-800 dark:text-white/90",
    error: "text-error-500",
    warning: "text-warning-500",
  } as const;

  const surface =
    "rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]";
  const interactive =
    " transition hover:border-brand-300 hover:shadow-theme-xs dark:hover:border-brand-500/40";

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => {
        const body = (
          <>
            <span className="text-theme-xs text-gray-500 dark:text-gray-400">
              {tile.label}
            </span>
            <p className={`mt-2 text-title-sm font-bold ${toneClass[tile.tone ?? "default"]}`}>
              {tile.value}
            </p>
            {tile.hint && (
              <span className="mt-1 block text-theme-xs text-gray-400">{tile.hint}</span>
            )}
          </>
        );

        return tile.href ? (
          <Link
            key={tile.label} to={tile.href} title={tile.title}
            className={surface + interactive}
          >
            {body}
          </Link>
        ) : (
          <div key={tile.label} title={tile.title} className={surface}>{body}</div>
        );
      })}
    </div>
  );
}
