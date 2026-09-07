import { api } from "./client";

export interface InspectResult {
  headers: string[];
  row_count: number;
  sample: Record<string, string>[];
  suggested_mapping: Record<string, string>;
}

export interface ImportResult {
  job_id: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; field: string; message: string }[];
}

export const importsApi = {
  /** No mapping sent means "read the file and tell me what you found". */
  inspect: (file: File, categoryId: string) => {
    const form = new FormData();
    form.set("file", file);
    if (categoryId) form.set("category_id", categoryId);
    return api.postForm<InspectResult>("/api/v1/imports", form);
  },

  run: (
    file: File,
    mapping: Record<string, string>,
    categoryId: string,
    dryRun: boolean,
  ) => {
    const form = new FormData();
    form.set("file", file);
    form.set("mapping", JSON.stringify(mapping));
    form.set("dry_run", String(dryRun));
    if (categoryId) form.set("category_id", categoryId);
    return api.postForm<ImportResult>("/api/v1/imports", form);
  },

  job: (id: string) => api.get<ImportResult>(`/api/v1/imports/${id}`),
};
