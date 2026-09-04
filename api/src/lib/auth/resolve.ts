import { query } from "../db";
import { isPermissionKey, type PermissionKey } from "./permissions";

export interface ResolvedAccess {
  permissions: PermissionKey[];
  /** null means organisation-wide. An empty array would mean "nothing". */
  locationScope: string[] | null;
}

/**
 * Resolves what a user may do, per request rather than at login.
 *
 * Baking permissions into the session would mean an administrator revoking a
 * grant has no effect until that person's session expires - up to seven days of
 * access they were supposed to have lost. Two indexed lookups per request is
 * the price of revocation taking effect immediately.
 */
export async function permissionsForUser(userId: string): Promise<ResolvedAccess> {
  const [granted, scope] = await Promise.all([
    query<{ permission_key: string }>(
      "SELECT * FROM auth_lookup_permissions($1)", [userId],
    ),
    query<{ location_id: string }>(
      "SELECT * FROM auth_lookup_location_scope($1)", [userId],
    ),
  ]);

  // A permission removed from the vocabulary in code but still granted in the
  // database must not leak through as an unknown string.
  const permissions = granted
    .map((r) => r.permission_key)
    .filter(isPermissionKey);

  return {
    permissions,
    locationScope: scope.length === 0 ? null : scope.map((r) => r.location_id),
  };
}
