import Badge from "../ui/badge/Badge";
import type { AssetStatus } from "../../api/types";

const STATUS: Record<
  AssetStatus,
  { label: string; color: "success" | "info" | "warning" | "error" | "light" }
> = {
  available: { label: "Available", color: "success" },
  in_use: { label: "In use", color: "info" },
  maintenance: { label: "Maintenance", color: "warning" },
  retired: { label: "Retired", color: "light" },
  lost: { label: "Lost", color: "error" },
};

export const statusLabel = (status: AssetStatus) => STATUS[status]?.label ?? status;

export default function StatusBadge({
  status, size = "sm",
}: { status: AssetStatus; size?: "sm" | "md" }) {
  const config = STATUS[status] ?? { label: status, color: "light" as const };
  return <Badge color={config.color} size={size}>{config.label}</Badge>;
}
