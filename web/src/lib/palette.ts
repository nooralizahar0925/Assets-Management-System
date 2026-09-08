/**
 * Kept identical to api/src/lib/reports/palette.ts. A chart on screen and the same
 * chart in a downloaded PDF must not be different colours.
 */
export const PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444",
  "#14b8a6", "#ec4899", "#6366f1", "#84cc16", "#f97316",
];

export const STATUS_COLORS: Record<string, string> = {
  available: "#10b981",
  in_use: "#3b82f6",
  maintenance: "#f59e0b",
  retired: "#6b7280",
  lost: "#ef4444",
};

export const colorFor = (label: string, index: number): string =>
  STATUS_COLORS[label] ?? PALETTE[index % PALETTE.length];

/**
 * A tile has room for "Rp 8,5 M", not for eleven digits. One fraction digit is
 * the minimum that keeps compact notation honest: at zero, Intl renders
 * Rp 8,450,000,000 as "Rp 8 M" and quietly loses 450 million.
 */
export const money = (value: string | number, currency = "IDR") =>
  new Intl.NumberFormat("id-ID", {
    style: "currency", currency, maximumFractionDigits: 1, notation: "compact",
  }).format(Number(value));

/** The unrounded figure, for a tooltip or anywhere the exact number matters. */
export const moneyExact = (value: string | number, currency = "IDR") =>
  new Intl.NumberFormat("id-ID", {
    style: "currency", currency, maximumFractionDigits: 0,
  }).format(Number(value));
