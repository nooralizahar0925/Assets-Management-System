export interface Permission {
  key: string;
  label: string;
  description: string;
  /** Grouping for the role editor in Task 31a. */
  group: string;
}

/**
 * The permission vocabulary.
 *
 * Fixed and code-defined: a permission means something only because a handler
 * checks it, so one a customer invented would grant nothing. Customers compose
 * their own ROLES out of this list; they do not extend the list itself.
 *
 * Adding an entry here is a product change that must land with the handler that
 * enforces it. Removing or renaming one is breaking - role_permissions carries
 * a foreign key to it, and an existing role would lose a grant silently.
 */
export const PERMISSIONS = [
  // Assets
  { key: "assets:read", group: "Assets", label: "View assets",
    description: "See the asset register, asset details and their full history." },
  { key: "assets:write", group: "Assets", label: "Create and edit assets",
    description: "Add assets, change their fields and update their status." },
  { key: "assets:delete", group: "Assets", label: "Delete assets",
    description: "Remove assets from the register. Deleted assets are retained for audit, not destroyed." },
  { key: "assets:import", group: "Assets", label: "Import assets",
    description: "Upload spreadsheets to create or update assets in bulk." },
  { key: "assets:export", group: "Assets", label: "Export assets",
    description: "Download the register as CSV or Excel." },

  // Custody
  { key: "custody:write", group: "Custody", label: "Check assets in and out",
    description: "Issue an asset to a person, place or outside party, and take it back." },

  // Catalogue
  { key: "categories:read", group: "Catalogue", label: "View categories",
    description: "See categories and the custom fields they define." },
  { key: "categories:write", group: "Catalogue", label: "Manage categories",
    description: "Create categories and change which custom fields their assets carry." },
  { key: "locations:read", group: "Catalogue", label: "View locations",
    description: "See the location tree." },
  { key: "locations:write", group: "Catalogue", label: "Manage locations",
    description: "Create, rename and reorganise locations." },

  // Labels
  { key: "labels:print", group: "Labels", label: "Print labels",
    description: "Generate QR and barcode labels and label sheets." },

  // Stock-take
  { key: "stocktake:read", group: "Stock-take", label: "View stock-takes",
    description: "See counting sessions and what they found." },
  { key: "stocktake:write", group: "Stock-take", label: "Run stock-takes",
    description:
      "Open a counting session, scan items into it, and close it - optionally " +
      "marking whatever was not found as lost." },

  // Reports
  { key: "reports:read", group: "Reports", label: "Run reports",
    description: "Run reports and download them in any format." },
  { key: "reports:schedule", group: "Reports", label: "Schedule reports",
    description: "Have reports run automatically and emailed to a list of people." },

  // Administration
  { key: "users:read", group: "Administration", label: "View people",
    description: "See who has access to this organisation and what role they hold." },
  { key: "users:write", group: "Administration", label: "Manage people",
    description: "Invite people, change their role and remove their access." },
  { key: "roles:read", group: "Administration", label: "View roles",
    description: "See the roles defined for this organisation and what each permits." },
  { key: "roles:write", group: "Administration", label: "Manage roles",
    description: "Create roles and change which permissions they grant." },
  { key: "api_keys:read", group: "Administration", label: "View API keys",
    description: "See which API keys exist and when each was last used." },
  { key: "api_keys:write", group: "Administration", label: "Manage API keys",
    description: "Create and revoke API keys for other systems." },
  { key: "webhooks:write", group: "Administration", label: "Manage webhooks",
    description: "Subscribe other systems to events from this one." },
  { key: "settings:write", group: "Administration", label: "Manage settings",
    description: "Change email providers, templates and notification rules." },
  { key: "audit:read", group: "Administration", label: "View the audit trail",
    description: "See the organisation-wide record of who changed what and when." },
] as const satisfies readonly Permission[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

const ALL = PERMISSIONS.map((p) => p.key) as PermissionKey[];

/**
 * The roles every organisation starts with. Seeded per tenant so a customer can
 * edit or rename them; `is_system` only prevents deletion, because deleting the
 * role every user holds would lock the organisation out of itself.
 */
export const SYSTEM_ROLES: Record<
  string,
  { description: string; permissions: PermissionKey[] }
> = {
  Administrator: {
    description: "Full access, including people, roles, keys and settings.",
    permissions: ALL,
  },
  Manager: {
    description:
      "Runs the register day to day: assets, categories, locations, imports and reports.",
    permissions: [
      "assets:read", "assets:write", "assets:delete", "assets:import", "assets:export",
      "custody:write",
      "categories:read", "categories:write",
      "locations:read", "locations:write",
      "labels:print",
      "stocktake:read", "stocktake:write",
      "reports:read", "reports:schedule",
      "users:read", "audit:read",
    ],
  },
  Technician: {
    description:
      "Works with the assets themselves: updates them, moves them, issues and receives them.",
    permissions: [
      "assets:read", "assets:write",
      "custody:write",
      "categories:read", "locations:read",
      "labels:print",
      // Counting the shelves is the technician's job more than anyone's.
      "stocktake:read", "stocktake:write",
      "reports:read",
    ],
  },
  Viewer: {
    description: "Reads the register and runs reports. Changes nothing.",
    // Listed explicitly rather than derived as "everything ending in :read".
    // That derivation swept in api_keys:read, users:read, roles:read and
    // audit:read, so a viewer could see the organisation's integration keys and
    // its administrative history - which is not what "reads the register" means.
    permissions: [
      "assets:read", "categories:read", "locations:read", "reports:read",
    ],
  },
};

/** The four scopes spec 5.1 publishes for API keys. Changing these breaks v1. */
export type ApiScope = "assets:read" | "assets:write" | "reports:read" | "admin";

/**
 * How a published API scope expands into permissions.
 *
 * The scope strings are a contract with integrators and cannot change; the
 * permission vocabulary behind them can. This mapping is the seam between the
 * two, so requireAuth checks one thing regardless of how the caller
 * authenticated.
 */
export const API_SCOPE_PERMISSIONS: Record<ApiScope, PermissionKey[]> = {
  "assets:read": [
    "assets:read", "assets:export", "categories:read", "locations:read",
  ],
  "assets:write": [
    "assets:read", "assets:export", "categories:read", "locations:read",
    "assets:write", "assets:delete", "assets:import", "custody:write",
    "labels:print",
  ],
  "reports:read": ["reports:read", "assets:read", "categories:read", "locations:read"],
  admin: ALL,
};

export const isPermissionKey = (value: string): value is PermissionKey =>
  (ALL as string[]).includes(value);

/**
 * Derives the published API scopes a permission set satisfies, for display and
 * for the v1 compatibility surface. Authorization is decided by permissions;
 * this is only ever descriptive.
 */
export function apiScopesFromPermissions(permissions: PermissionKey[]): ApiScope[] {
  const held = new Set<string>(permissions);
  return (Object.keys(API_SCOPE_PERMISSIONS) as ApiScope[]).filter((scope) =>
    API_SCOPE_PERMISSIONS[scope].every((key) => held.has(key)),
  );
}
