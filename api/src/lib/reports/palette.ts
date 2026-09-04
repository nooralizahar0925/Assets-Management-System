/**
 * One categorical palette, used by the server-side SVG renderer and exported to
 * the SPA's ApexCharts config, so a printed PDF matches the screen it came from.
 * Checked for contrast against both the light and dark surfaces the app uses.
 */
export const PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ef4444", // red
  "#14b8a6", // teal
  "#ec4899", // pink
  "#6366f1", // indigo
  "#84cc16", // lime
  "#f97316", // orange
] as const;

/**
 * Status keeps a fixed colour wherever it appears, so "amber means maintenance"
 * holds across the dashboard, a PDF and a printed chart.
 */
export const STATUS_COLORS: Record<string, string> = {
  available: "#10b981",
  in_use: "#3b82f6",
  maintenance: "#f59e0b",
  retired: "#6b7280",
  lost: "#ef4444",
};

export const colorFor = (label: string, index: number): string =>
  STATUS_COLORS[label] ?? PALETTE[index % PALETTE.length];

export const INK = "#1f2937";
export const MUTED = "#6b7280";
export const GRID = "#e5e7eb";
