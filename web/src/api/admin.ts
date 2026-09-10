import { api } from "./client";
import type { OrgMember, PermissionGroup, Role } from "./types";

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Only ever returned by create — the plaintext is not stored and cannot be re-read. */
export interface MintedApiKey {
  id: string;
  name: string;
  prefix: string;
  key: string;
}

export const keysApi = {
  list: () => api.get<ApiKey[]>("/api/admin/api-keys"),
  create: (name: string, scopes: string[]) =>
    api.post<MintedApiKey>("/api/admin/api-keys", { name, scopes }),
  revoke: (id: string) => api.del(`/api/admin/api-keys/${id}`),
};

export interface Invitation {
  id: string;
  email: string;
  name: string;
  role_id: string;
  role_name: string | null;
  expires_at: string;
  created_at: string;
}

export interface SentInvitation {
  id: string;
  email: string;
  name: string;
  role_name: string | null;
  expires_at: string;
  /** False when the invitation exists but the email could not be queued. */
  emailed: boolean;
}

export const membersApi = {
  /**
   * People, and the invitations still waiting.
   *
   * getEnvelope rather than get: the response carries both, and `get` peels a
   * `data` wrapper - which would silently drop the invitations and leave an
   * administrator inviting the same person twice.
   */
  list: () =>
    api.getEnvelope<{ data: OrgMember[]; invitations: Invitation[] }>(
      "/api/admin/users",
    ),

  invite: (email: string, name: string, roleId: string) =>
    api.post<SentInvitation>("/api/admin/users", {
      email, name, role_id: roleId,
    }),

  revokeInvitation: (id: string) => api.del(`/api/admin/invitations/${id}`),

  acceptInvitation: (token: string, password: string) =>
    api.post<{ id: string; email: string; org_id: string }>(
      "/api/admin/auth/accept-invitation", { token, password },
    ),
  setRole: (id: string, roleId: string, locationIds: string[]) =>
    api.put(`/api/admin/users/${id}/role`, {
      role_id: roleId, location_ids: locationIds,
    }),
};

export const rolesApi = {
  list: () => api.get<Role[]>("/api/admin/roles"),
  permissions: () => api.get<PermissionGroup[]>("/api/admin/permissions"),
  create: (input: { name: string; description?: string | null; permissions: string[] }) =>
    api.post<Role>("/api/admin/roles", input),
  update: (
    id: string,
    patch: { name?: string; description?: string | null; permissions?: string[] },
  ) => api.patch<Role>(`/api/admin/roles/${id}`, patch),
  remove: (id: string) => api.del(`/api/admin/roles/${id}`),
};
