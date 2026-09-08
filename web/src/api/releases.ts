import { api } from "./client";

export type EntryType = "feature" | "improvement" | "fix";

export interface ReleaseEntry {
  type: EntryType;
  summary: string;
}

export interface Release {
  version: string;
  title: string;
  released_at: string;
  entries: ReleaseEntry[];
}

export interface VersionInfo {
  version: string;
  git_sha: string;
  built_at: string;
  migration: string | null;
}

export const releasesApi = {
  list: () => api.get<Release[]>("/api/releases"),

  version: () => api.get<VersionInfo>("/api/version"),

  /** Clears this person's indicator up to the given release. */
  markSeen: (version: string) =>
    api.post<null>("/api/admin/releases/seen", { version }),

  unseen: () => api.get<{ unseen: number }>("/api/admin/releases/unseen"),
};
