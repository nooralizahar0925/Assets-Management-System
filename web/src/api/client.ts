export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: { field: string; message: string }[];
}

export class ApiError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(readonly status: number, readonly problem: Problem) {
    super(problem.title || `Request failed with status ${status}`);
    this.name = "ApiError";
    this.fieldErrors = Object.fromEntries(
      (problem.errors ?? []).map((e) => [e.field, e.message]),
    );
  }
}

/**
 * Read per call rather than captured at module load.
 *
 * A module-level constant is fixed the moment the file is first imported, which
 * makes the base URL untestable - a test that sets it in beforeEach is always
 * too late. The cost is one property read per request.
 */
const base = () => (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export type Params = Record<
  string, string | number | boolean | string[] | undefined | null
>;

function withParams(path: string, params?: Params): string {
  if (!params) return `${base()}${path}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      // Repeat the key: the API reads `status` with getAll().
      for (const item of value) if (item !== "") search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return `${base()}${path}${query ? `?${query}` : ""}`;
}

async function request<T>(
  path: string,
  init: RequestInit,
  params?: Params,
): Promise<T> {
  let response: Response;
  try {
    // credentials: "include" — the session cookie must travel to the api origin.
    response = await fetch(withParams(path, params), {
      credentials: "include",
      ...init,
    });
  } catch {
    throw new ApiError(0, {
      type: "network", status: 0,
      title: "Could not reach the server. Check your connection and try again.",
    });
  }

  if (response.status === 204) return null as T;

  const isJson = (response.headers.get("content-type") ?? "").includes("json");
  const body = isJson ? await response.json().catch(() => ({})) : await response.text();

  if (!response.ok) {
    throw new ApiError(response.status, typeof body === "object" && body
      ? (body as Problem)
      : { type: "unknown", status: response.status, title: String(body) });
  }

  // Collection responses wrap rows in `data`; single resources do not.
  if (body && typeof body === "object" && "data" in body && !("id" in body)) {
    return (body as { data: T }).data;
  }
  return body as T;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; per_page: number; total: number; total_pages: number };
}

export const api = {
  get: <T>(path: string, params?: Params) =>
    request<T>(path, { method: "GET" }, params),

  /**
   * The whole response body, unwrapped by nobody.
   *
   * `get` peels a `data` envelope, which is right almost everywhere and wrong
   * for an endpoint that returns something alongside the rows - the webhook
   * list publishes the subscribable events next to the subscriptions, and
   * peeling would silently drop them.
   */
  getEnvelope: async <T>(path: string, params?: Params): Promise<T> => {
    const response = await fetch(withParams(path, params), { credentials: "include" });
    if (!response.ok) {
      throw new ApiError(response.status, await response.json().catch(() => ({
        type: "unknown", status: response.status, title: "Request failed",
      })));
    }
    return response.json() as Promise<T>;
  },

  /** For list endpoints where the caller needs `meta` as well as the rows. */
  getPage: async <T>(path: string, params?: Params): Promise<Paginated<T>> => {
    const response = await fetch(withParams(path, params), { credentials: "include" });
    if (!response.ok) {
      throw new ApiError(response.status, await response.json().catch(() => ({
        type: "unknown", status: response.status, title: "Request failed",
      })));
    }
    return response.json();
  },

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  del: (path: string) => request<null>(path, { method: "DELETE" }),

  /** Multipart — never set content-type by hand, the boundary must be generated. */
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),

  /** Binary downloads: xlsx, pdf, png, the label sheet. */
  blob: async (path: string, params?: Params): Promise<Blob> => {
    const response = await fetch(withParams(path, params), { credentials: "include" });
    if (!response.ok) {
      throw new ApiError(response.status, await response.json().catch(() => ({
        type: "unknown", status: response.status, title: "Download failed",
      })));
    }
    return response.blob();
  },

  url: (path: string, params?: Params) => withParams(path, params),
};

/** Triggers a browser download for a blob the API returned. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
