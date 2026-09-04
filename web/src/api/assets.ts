import { api, type Paginated, type Params } from "./client";
import type { Asset, Assignment, AuditEvent, Attachment } from "./types";

export interface AssetQueryParams extends Params {
  q?: string;
  status?: string[];
  category_id?: string;
  location_id?: string;
  assignee_id?: string;
  page?: number;
  per_page?: number;
  sort?: string;
}

export const assetsApi = {
  list: (params: AssetQueryParams) =>
    api.getPage<Asset>("/api/v1/assets", params),

  get: (id: string) => api.get<Asset>(`/api/v1/assets/${id}`),

  create: (input: Partial<Asset>) => api.post<Asset>("/api/v1/assets", input),

  update: (id: string, patch: Partial<Asset>) =>
    api.patch<Asset>(`/api/v1/assets/${id}`, patch),

  remove: (id: string) => api.del(`/api/v1/assets/${id}`),

  history: (id: string) =>
    api.get<{ events: AuditEvent[]; assignments: Assignment[] }>(
      `/api/v1/assets/${id}/history`,
    ),

  checkOut: (id: string, body: {
    assignee_type: "user" | "location" | "external";
    assignee_id?: string | null;
    assignee_label?: string | null;
    location_id?: string | null;
    due_at?: string | null;
    note?: string | null;
  }) => api.post<Assignment>(`/api/v1/assets/${id}/checkout`, body),

  checkIn: (id: string, body: {
    note?: string | null; condition?: string | null; location_id?: string | null;
  }) => api.post<Assignment>(`/api/v1/assets/${id}/checkin`, body),

  addNote: (id: string, note: string) =>
    api.post(`/api/v1/assets/${id}/notes`, { note }),

  lookup: (tag: string) => api.get<Asset>("/api/v1/assets/lookup", { tag }),

  attachments: (id: string) =>
    api.get<Attachment[]>(`/api/v1/assets/${id}/attachments`),

  addAttachment: (id: string, file: File, kind = "file") => {
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    return api.postForm<Attachment>(`/api/v1/assets/${id}/attachments`, form);
  },

  removeAttachment: (attachmentId: string) =>
    api.del(`/api/v1/attachments/${attachmentId}`),

  attachmentUrl: (attachmentId: string) => api.url(`/api/v1/attachments/${attachmentId}`),

  labelUrl: (id: string, symbology: "qr" | "code128", scale = 4) =>
    api.url(`/api/v1/assets/${id}/label.png`, { symbology, scale }),

  labelSheet: (body: {
    asset_ids: string[]; symbology: "qr" | "code128"; template: string;
  }) => api.post<string>("/api/v1/labels/sheet", body),
};

export type { Paginated };
