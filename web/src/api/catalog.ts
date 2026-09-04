import { api } from "./client";
import type { Category, LocationNode, OrgUser } from "./types";

export const catalogApi = {
  categories: () => api.get<Category[]>("/api/v1/categories"),
  createCategory: (input: Partial<Category>) =>
    api.post<Category>("/api/v1/categories", input),
  updateCategory: (id: string, patch: Partial<Category>) =>
    api.patch<Category>(`/api/v1/categories/${id}`, patch),

  locations: () => api.get<LocationNode[]>("/api/v1/locations"),
  createLocation: (input: { name: string; parent_id?: string | null; address?: string | null }) =>
    api.post<LocationNode>("/api/v1/locations", input),

  users: () => api.get<OrgUser[]>("/api/v1/users"),
};
