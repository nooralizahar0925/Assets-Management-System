import { api } from "./client";
import type { OrgMember, PermissionDef, Role } from "./types";

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

export const membersApi = {
  list: () => api.get<OrgMember[]>("/api/admin/users"),
  setRole: (id: string, roleId: string, locationIds: string[]) =>
    api.put(`/api/admin/users/${id}/role`, {
      role_id: roleId, location_ids: locationIds,
    }),
};

export const rolesApi = {
  list: () => api.get<Role[]>("/api/admin/roles"),
  permissions: () => api.get<PermissionDef[]>("/api/admin/permissions"),
  create: (input: { name: string; description?: string | null; permissions: string[] }) =>
    api.post<Role>("/api/admin/roles", input),
  update: (
    id: string,
    patch: { name?: string; description?: string | null; permissions?: string[] },
  ) => api.patch<Role>(`/api/admin/roles/${id}`, patch),
  remove: (id: string) => api.del(`/api/admin/roles/${id}`),
};
