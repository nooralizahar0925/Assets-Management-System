export type AssetStatus =
  | "available" | "in_use" | "maintenance" | "retired" | "lost";

export interface Asset {
  id: string;
  asset_tag: string;
  name: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  serial_no: string | null;
  status: AssetStatus;
  location_id: string | null;
  location_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  purchase_date: string | null;
  purchase_cost: string | null;
  currency: string;
  custom: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: "string" | "number" | "date" | "boolean" | "enum";
  required: boolean;
  options?: string[];
}

export interface Category {
  id: string;
  name: string;
  kind: "it" | "equipment" | "media";
  field_schema: { fields: FieldDef[] };
  asset_count?: number;
}

export interface LocationNode {
  id: string;
  name: string;
  parent_id: string | null;
  address: string | null;
  depth: number;
  path: string;
  asset_count: number;
}

/**
 * A person as the check-out picker sees them. /api/v1/users is guarded by
 * assets:read so a technician can choose an assignee, and for that reason it
 * returns no email address and no role. The People page uses OrgMember.
 */
export interface OrgUser {
  id: string;
  name: string;
  assigned_count?: number;
}

/** A person as an administrator sees them, from /api/admin/users. */
export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role_id: string | null;
  role_name: string | null;
  /** Empty means organisation-wide. */
  location_ids: string[];
  assigned_count: number;
}

export interface Role {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: string[];
  user_count: number;
}

export interface PermissionDef {
  key: string;
  group: string;
  label: string;
  description?: string;
}

export interface Assignment {
  id: string;
  asset_id: string;
  assignee_type: "user" | "location" | "external";
  assignee_id: string | null;
  assignee_label: string | null;
  assignee_user_name?: string | null;
  location_name?: string | null;
  checked_out_at: string;
  due_at: string | null;
  checked_in_at: string | null;
  checkout_note: string | null;
  checkin_note: string | null;
  condition: string | null;
}

export interface AuditEvent {
  id: string;
  asset_id: string | null;
  asset_name?: string | null;
  actor_type: string;
  actor_label: string | null;
  event: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  note: string | null;
  created_at: string;
}

export interface Attachment {
  id: string;
  kind: "file" | "photo" | "condition_in" | "condition_out";
  filename: string;
  content_type: string;
  size_bytes: string;
  created_at: string;
}

export interface DashboardSummary {
  totals: {
    assets: number;
    active_assignments: number;
    overdue: number;
    maintenance: number;
    total_value: string;
    currency: string;
  };
  by_status: { status: AssetStatus; count: number }[];
  by_category: { category: string; count: number; value: string }[];
  by_location: { location: string; count: number }[];
  recent_activity: AuditEvent[];
  expiring_soon: {
    id: string; name: string; field: string; expires_on: string; days_left: number;
  }[];
  utilisation: { in_use_pct: number };
}

export interface ReportColumn {
  key: string;
  label: string;
  type: "string" | "number" | "date" | "money" | "percent";
}

export interface ChartSpec {
  type: "donut" | "bar" | "column" | "line" | "none";
  categoryKey: string;
  valueKeys: string[];
  valueLabel: string;
}

export interface ReportResult {
  key: string;
  name: string;
  description: string;
  generated_at: string;
  filter_summary: string;
  columns: ReportColumn[];
  chart: ChartSpec;
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
}
