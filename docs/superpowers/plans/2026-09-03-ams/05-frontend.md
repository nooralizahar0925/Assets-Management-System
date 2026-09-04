# Phase 5 — Frontend

> Part of the [Assets Management System plan](./00-overview.md). Read `00-overview.md` first — its Global Constraints apply to every task here.

**Tasks 21–32.** The dashboard, built on the supplied TailAdmin template, against the API from Phases 1–4.

**Spec section:** §6.

## Working with the template

The template lives at `Dashboard Template/`. Task 21 copies it to `web/` and adapts it
in place. **Reuse its components rather than writing new ones** — matching the existing
visual language is most of what makes this look finished.

| Template asset | Reused for | API notes |
|---|---|---|
| `layout/AppLayout`, `AppSidebar`, `AppHeader` | App shell; nav rewritten for AMS | — |
| `components/ui/table` | Asset register | Exports `Table, TableHeader, TableBody, TableRow, TableCell`; `TableCell` takes `isHeader` |
| `components/ui/badge/Badge` | Status pills | `color`: `primary\|success\|error\|warning\|info\|light\|dark`; `variant`: `light\|solid`; `size`: `sm\|md` |
| `components/ui/modal` + `hooks/useModal` | Check-out / check-in / scan dialogs | `<Modal isOpen onClose className>`; `useModal()` → `{ isOpen, openModal, closeModal }` |
| `components/ui/button/Button` | All buttons | `variant`: `primary\|outline`; `size`: `sm\|md`; `startIcon`/`endIcon`; **`onClick` only — no `type` prop**, so a form submit needs a plain `<button type="submit">` |
| `components/form/input/InputField` | Text/number/date inputs | Props: `type,id,name,placeholder,value,onChange,error,hint,disabled,min,max,step` |
| `components/form/Select`, `MultiSelect`, `Label`, `date-picker` | Filters and forms | — |
| `components/form/input/TextArea`, `Checkbox`, `FileInput` | Forms, import | — |
| `components/common/ComponentCard` | Section cards | `title`, `desc`, `children` |
| `components/common/PageMeta`, `PageBreadCrumb` | Page chrome | — |
| `components/ecommerce/EcommerceMetrics` | **Pattern** for the KPI tiles — copy the markup, do not import it | — |
| `react-apexcharts` | Dashboard charts | Already a dependency |
| `react-dropzone` | Import upload | Already a dependency |
| `context/ThemeContext`, `SidebarContext` | Keep unchanged | — |

**Delete** in Task 21: the ecommerce demo components, `pages/Calendar.tsx`,
`pages/UiElements/*`, `pages/Charts/*`, `pages/Tables/BasicTables.tsx`,
`pages/Forms/FormElements.tsx`, and the `@fullcalendar/*`, `@react-jvectormap/*`,
`swiper` and `react-dnd*` dependencies.

| Task | Deliverable |
|---|---|
| 21 | Template adaptation, API client, auth, routing, shell |
| 22 | Asset register — search, filters, table, bulk actions |
| 23 | Asset detail — overview, history timeline, attachments |
| 24 | Asset create/edit form with dynamic custom fields |
| 25 | Check-out / check-in dialogs |
| 26 | Scanning — camera and HID |
| 27 | Dashboard page |
| 28 | Import wizard and export |
| 29 | Report gallery, viewer and scheduling UI |
| 30 | Settings — email providers, templates, notification rules |
| 31 | Categories, locations, users and API keys |
| 32 | "What's new" release-notes panel |

---

### Task 21: Frontend foundation — template adaptation, API client, auth, routing

**Files:**
- Create: `web/` (copied from `Dashboard Template/`), `web/Dockerfile`, `web/nginx.conf`
- Create: `web/src/api/client.ts`, `web/src/api/types.ts`
- Create: `web/src/context/AuthContext.tsx`, `web/src/components/auth/RequireAuth.tsx`
- Modify: `web/src/App.tsx`, `web/src/layout/AppSidebar.tsx`, `web/src/pages/AuthPages/SignIn.tsx`
- Delete: the demo pages and components listed above
- Test: `web/src/api/client.test.ts`, `web/src/context/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/auth/login`, `POST /api/admin/auth/logout`, `GET /api/admin/auth/me`.
- Produces:
  - `class ApiError extends Error { status: number; problem: Problem; fieldErrors: Record<string,string> }`
  - `api.get<T>(path, params?)`, `api.post<T>(path, body?)`, `api.patch<T>(path, body?)`, `api.del(path)`, `api.postForm<T>(path, FormData)`, `api.blob(path, params?)`
  - `useAuth(): { user, orgId, loading, signIn, signOut, can(scope) }`
  - `<RequireAuth>` — redirects to `/signin`, preserving the attempted path

- [ ] **Step 1: Copy the template and prune it**

```bash
cd AssetsManagementSystem
cp -r "../Dashboard Template" web
cd web
rm -rf .git banner.png LICENSE.md
rm -rf src/components/ecommerce src/pages/UiElements src/pages/Charts
rm -f src/pages/Calendar.tsx src/pages/Tables/BasicTables.tsx \
      src/pages/Forms/FormElements.tsx
rm -rf src/components/tables/BasicTables
npm uninstall @fullcalendar/core @fullcalendar/daygrid @fullcalendar/interaction \
  @fullcalendar/list @fullcalendar/react @fullcalendar/timegrid \
  @react-jvectormap/core @react-jvectormap/world swiper react-dnd react-dnd-html5-backend
npm install
npm install -D vitest @testing-library/react @testing-library/jest-dom \
  @testing-library/user-event jsdom msw
```

Remove the matching `overrides` block for `@react-jvectormap/*` from
`web/package.json`, and add the test scripts:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 2: Write the failing tests**

`web/src/api/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError } from "./client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.restoreAllMocks();
  import.meta.env.VITE_API_BASE_URL = "http://api.test";
});

describe("api.get", () => {
  it("calls the configured base url and unwraps the envelope", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(json({ data: [{ id: "1" }] }));
    await expect(api.get("/api/v1/assets")).resolves.toEqual([{ id: "1" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/v1/assets");
  });

  it("sends cookies so the session travels cross-origin", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ data: [] }));
    await api.get("/api/v1/assets");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  });

  it("serialises params, dropping empty values", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ data: [] }));
    await api.get("/api/v1/assets", { q: "dell", status: "", page: 2 });
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/v1/assets?q=dell&page=2");
  });

  it("repeats an array param rather than joining it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ data: [] }));
    await api.get("/api/v1/assets", { status: ["available", "in_use"] });
    expect(fetchMock.mock.calls[0][0])
      .toBe("http://api.test/api/v1/assets?status=available&status=in_use");
  });

  it("returns the raw body when there is no data envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ id: "1", name: "Laptop" }));
    await expect(api.get("/api/v1/assets/1")).resolves.toEqual({ id: "1", name: "Laptop" });
  });
});

describe("error handling", () => {
  it("throws an ApiError carrying the problem document", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      type: "https://ams.dev/errors/not-found", title: "Asset not found", status: 404,
    }, 404));
    await expect(api.get("/api/v1/assets/x")).rejects.toMatchObject({
      status: 404, message: "Asset not found",
    });
  });

  it("indexes validation errors by field for form display", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      type: "https://ams.dev/errors/validation", title: "Validation failed", status: 422,
      errors: [{ field: "serial_no", message: "already exists" }],
    }, 422));
    try {
      await api.post("/api/v1/assets", { name: "x" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).fieldErrors).toEqual({ serial_no: "already exists" });
    }
  });

  it("reports a network failure as a readable message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.get("/api/v1/assets")).rejects.toThrow(/could not reach/i);
  });
});

describe("api.post and api.del", () => {
  it("sends JSON with the right content type", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ id: "1" }, 201));
    await api.post("/api/v1/assets", { name: "Laptop" });
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ name: "Laptop" }));
  });

  it("tolerates a 204 with no body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.del("/api/v1/assets/1")).resolves.toBeNull();
  });
});
```

`web/src/context/AuthContext.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./AuthContext";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

function Probe() {
  const { user, loading, signIn, signOut, can } = useAuth();
  if (loading) return <p>loading</p>;
  return (
    <div>
      <p data-testid="user">{user ? user.name : "anonymous"}</p>
      <p data-testid="can-write">{String(can("assets:write"))}</p>
      <button onClick={() => signIn("rina@example.com", "pw")}>sign in</button>
      <button onClick={() => signOut()}>sign out</button>
    </div>
  );
}

const renderProbe = () =>
  render(<AuthProvider><Probe /></AuthProvider>);

beforeEach(() => vi.restoreAllMocks());

describe("AuthProvider", () => {
  it("restores an existing session on mount", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      org_id: "org-1",
      user: { id: "u1", name: "Rina", scopes: ["assets:read", "assets:write"] },
    }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("Rina"));
  });

  it("shows anonymous when there is no session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ title: "Authentication required" }, 401));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("anonymous"));
  });

  it("signs a user in and keeps their identity", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ title: "Authentication required" }, 401))
      .mockResolvedValueOnce(json({ id: "u1", name: "Rina", org_id: "org-1", role: "admin" }))
      .mockResolvedValueOnce(json({
        org_id: "org-1", user: { id: "u1", name: "Rina", scopes: ["admin"] },
      }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("anonymous"));
    await userEvent.click(screen.getByText("sign in"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("Rina"));
  });

  it("clears the user on sign out", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({
        org_id: "org-1", user: { id: "u1", name: "Rina", scopes: ["admin"] },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("Rina"));
    await userEvent.click(screen.getByText("sign out"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("anonymous"));
  });

  it("reports scopes through can()", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      org_id: "org-1", user: { id: "u1", name: "Vera", scopes: ["assets:read"] },
    }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("can-write")).toHaveTextContent("false"));
  });

  it("treats the admin scope as granting everything", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      org_id: "org-1", user: { id: "u1", name: "Ada", scopes: ["admin"] },
    }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("can-write")).toHaveTextContent("true"));
  });
});
```

`web/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
```

`web/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd web && npx vitest run src/api src/context`
Expected: FAIL — `Cannot find module './client'`.

- [ ] **Step 4: Implement the API client**

`web/src/api/client.ts`:

```ts
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

const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export type Params = Record<
  string, string | number | boolean | string[] | undefined | null
>;

function withParams(path: string, params?: Params): string {
  if (!params) return `${BASE}${path}`;
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
  return `${BASE}${path}${query ? `?${query}` : ""}`;
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
```

`web/src/api/types.ts`:

```ts
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

export interface OrgUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "technician" | "viewer";
  assigned_count?: number;
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
```

- [ ] **Step 5: Implement auth context and the route guard**

`web/src/context/AuthContext.tsx`:

```tsx
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "../api/client";

export interface SessionUser {
  id: string;
  name: string;
  scopes: string[];
}

interface AuthValue {
  user: SessionUser | null;
  orgId: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (scope: string) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ org_id: string; user: SessionUser }>(
        "/api/admin/auth/me",
      );
      setUser(me.user);
      setOrgId(me.org_id);
    } catch (err) {
      // A 401 here is the normal signed-out state, not a failure worth surfacing.
      if (!(err instanceof ApiError) || err.status !== 401) console.error(err);
      setUser(null);
      setOrgId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    await api.post("/api/admin/auth/login", { email, password });
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.post("/api/admin/auth/logout").catch(() => undefined);
    setUser(null);
    setOrgId(null);
  }, []);

  const can = useCallback(
    (scope: string) =>
      Boolean(user && (user.scopes.includes(scope) || user.scopes.includes("admin"))),
    [user],
  );

  const value = useMemo(
    () => ({ user, orgId, loading, signIn, signOut, can }),
    [user, orgId, loading, signIn, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider");
  return value;
}
```

`web/src/components/auth/RequireAuth.tsx`:

```tsx
import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../../context/AuthContext";

export default function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }

  // Remember where they were headed so sign-in can return them there.
  if (!user) return <Navigate to="/signin" state={{ from: location }} replace />;
  return <Outlet />;
}
```

- [ ] **Step 6: Rewrite routing and the shell**

`web/src/App.tsx`:

```tsx
import { BrowserRouter as Router, Routes, Route } from "react-router";
import { AuthProvider } from "./context/AuthContext";
import RequireAuth from "./components/auth/RequireAuth";
import AppLayout from "./layout/AppLayout";
import { ScrollToTop } from "./components/common/ScrollToTop";

import SignIn from "./pages/AuthPages/SignIn";
import NotFound from "./pages/OtherPage/NotFound";
import Dashboard from "./pages/Dashboard/Home";
import Assets from "./pages/Assets/AssetList";
import AssetDetail from "./pages/Assets/AssetDetail";
import AssetForm from "./pages/Assets/AssetForm";
import TagRedirect from "./pages/Assets/TagRedirect";
import ImportWizard from "./pages/Import/ImportWizard";
import Reports from "./pages/Reports/ReportGallery";
import ReportViewer from "./pages/Reports/ReportViewer";
import Categories from "./pages/Catalog/Categories";
import Locations from "./pages/Catalog/Locations";
import Users from "./pages/Settings/Users";
import ApiKeys from "./pages/Settings/ApiKeys";
import EmailSettings from "./pages/Settings/EmailSettings";
import NotificationSettings from "./pages/Settings/NotificationSettings";
import WhatsNew from "./pages/WhatsNew";
import Help from "./pages/Help";
import UserProfiles from "./pages/UserProfiles";

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <ScrollToTop />
        <Routes>
          <Route path="/signin" element={<SignIn />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route index path="/" element={<Dashboard />} />

              <Route path="/assets" element={<Assets />} />
              <Route path="/assets/new" element={<AssetForm mode="create" />} />
              <Route path="/assets/:id" element={<AssetDetail />} />
              <Route path="/assets/:id/edit" element={<AssetForm mode="edit" />} />
              {/* Scanned QR codes land here and resolve to the asset. */}
              <Route path="/a/:tag" element={<TagRedirect />} />

              <Route path="/import" element={<ImportWizard />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/reports/:key" element={<ReportViewer />} />

              <Route path="/categories" element={<Categories />} />
              <Route path="/locations" element={<Locations />} />

              <Route path="/settings/users" element={<Users />} />
              <Route path="/settings/api-keys" element={<ApiKeys />} />
              <Route path="/settings/email" element={<EmailSettings />} />
              <Route path="/settings/notifications" element={<NotificationSettings />} />

              <Route path="/whats-new" element={<WhatsNew />} />
              <Route path="/help" element={<Help />} />
              <Route path="/profile" element={<UserProfiles />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
```

Rewrite the `navItems` array in `web/src/layout/AppSidebar.tsx`, keeping the file's
existing rendering logic and icon imports untouched:

```tsx
const navItems: NavItem[] = [
  { icon: <GridIcon />, name: "Dashboard", path: "/" },
  { icon: <BoxCubeIcon />, name: "Assets", path: "/assets" },
  { icon: <PieChartIcon />, name: "Reports", path: "/reports" },
  { icon: <TableIcon />, name: "Import", path: "/import" },
  {
    icon: <ListIcon />, name: "Catalogue",
    subItems: [
      { name: "Categories", path: "/categories" },
      { name: "Locations", path: "/locations" },
    ],
  },
  {
    icon: <PlugInIcon />, name: "Settings",
    subItems: [
      { name: "Users", path: "/settings/users" },
      { name: "API keys", path: "/settings/api-keys" },
      { name: "Email", path: "/settings/email" },
      { name: "Notifications", path: "/settings/notifications" },
    ],
  },
];

const othersItems: NavItem[] = [
  { icon: <InfoIcon />, name: "What's new", path: "/whats-new" },
  { icon: <DocsIcon />, name: "Help", path: "/help" },
];
```

Adjust the icon identifiers to whichever exist in `src/icons/index.ts`; the file already
imports a set, so reuse those names rather than adding new SVGs.

- [ ] **Step 7: Wire the sign-in page to the API**

Replace the form body of `web/src/pages/AuthPages/SignIn.tsx` (keep its layout and
`AuthPageLayout` wrapper) with a real submit:

```tsx
import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router";
import { useAuth } from "../../context/AuthContext";
import { ApiError } from "../../api/client";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";

export default function SignInForm() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/";

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? "That email and password do not match an account."
          : "Sign-in failed. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10"
        >
          {error}
        </div>
      )}
      <div>
        <Label htmlFor="email">Email<span className="text-error-500">*</span></Label>
        <Input
          type="email" id="email" name="email" placeholder="you@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="password">Password<span className="text-error-500">*</span></Label>
        <Input
          type="password" id="password" name="password" placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {/* The template Button has no `type` prop, so a submit uses a plain button. */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-brand-500 px-5 py-3.5 text-sm font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
```

- [ ] **Step 8: Add the web Dockerfile and nginx config**

`web/Dockerfile`:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
ARG VITE_API_BASE_URL=http://localhost:4000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

`web/nginx.conf`:

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  # Client-side routing: every unknown path resolves to the SPA shell.
  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \.(js|css|png|jpg|jpeg|gif|svg|woff2?)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/api src/context`
Expected: PASS, 14 tests.

- [ ] **Step 10: Verify the app builds and boots**

```bash
cd web && npm run build
cd .. && docker compose up -d --build
curl -s http://localhost:4000/api/health
```

Expected: the build succeeds, and health returns `{"status":"ok","db":true}`.
Visiting `http://localhost:3000` redirects to `/signin`.

- [ ] **Step 11: Commit**

```bash
git add web docker-compose.yml
git commit -m "feat: adapt tailadmin template with api client, auth context and routing"
```

---

### Task 22: Asset register — search, filters, table, bulk actions

**Files:**
- Create: `web/src/api/assets.ts`, `web/src/api/catalog.ts`
- Create: `web/src/components/assets/StatusBadge.tsx`, `AssetFilters.tsx`, `AssetTable.tsx`, `BulkActionBar.tsx`, `Pagination.tsx`
- Create: `web/src/hooks/useDebounced.ts`, `web/src/hooks/useAssetQuery.ts`
- Create: `web/src/pages/Assets/AssetList.tsx`
- Test: `web/src/components/assets/StatusBadge.test.tsx`, `web/src/components/assets/AssetTable.test.tsx`, `web/src/hooks/useAssetQuery.test.tsx`

**Interfaces:**
- Consumes: `api`, `Asset`, `Category`, `LocationNode`, `OrgUser`, template `Table`/`Badge`/`Button`/`Select`/`InputField`.
- Produces:
  - `assetsApi.list(params)`, `.get(id)`, `.create(input)`, `.update(id, patch)`, `.remove(id)`, `.history(id)`, `.checkOut(id, body)`, `.checkIn(id, body)`, `.addNote(id, note)`, `.lookup(tag)`, `.labelSheet(body)`
  - `catalogApi.categories()`, `.locations()`, `.users()`
  - `<StatusBadge status />` — the status→colour mapping used everywhere
  - `<AssetFilters value onChange categories locations users />`
  - `<AssetTable assets selected onSelect onSelectAll sort onSort />`
  - `useAssetQuery()` — filter/sort/page state synced to the URL query string
  - `<Pagination meta onPage />`

**Design note:** filter state lives in the URL. A filtered register is then a link
someone can paste into a ticket, and the back button behaves the way people expect.

- [ ] **Step 1: Write the failing tests**

`web/src/components/assets/StatusBadge.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusBadge from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders a human label, not the raw enum", () => {
    render(<StatusBadge status="in_use" />);
    expect(screen.getByText("In use")).toBeInTheDocument();
  });

  it("labels every status", () => {
    for (const status of ["available", "in_use", "maintenance", "retired", "lost"] as const) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(/\w/)).toBeInTheDocument();
      unmount();
    }
  });

  it("uses success colouring for available and error colouring for lost", () => {
    const { container: ok } = render(<StatusBadge status="available" />);
    const { container: bad } = render(<StatusBadge status="lost" />);
    expect(ok.innerHTML).toContain("success");
    expect(bad.innerHTML).toContain("error");
  });
});
```

`web/src/components/assets/AssetTable.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import AssetTable from "./AssetTable";
import type { Asset } from "../../api/types";

const asset = (over: Partial<Asset> = {}): Asset => ({
  id: "a1", asset_tag: "AMS-000001", name: "Dell Latitude", description: null,
  category_id: "c1", category_name: "IT", serial_no: "DL-1", status: "available",
  location_id: null, location_name: "Head Office", assignee_id: null,
  assignee_name: null, purchase_date: "2026-01-10", purchase_cost: "15000000",
  currency: "IDR", custom: {}, created_at: "2026-01-10T00:00:00Z",
  updated_at: "2026-01-10T00:00:00Z", ...over,
});

const setup = (props: Partial<React.ComponentProps<typeof AssetTable>> = {}) => {
  const onSelect = vi.fn();
  const onSort = vi.fn();
  render(
    <MemoryRouter>
      <AssetTable
        assets={[asset(), asset({ id: "a2", asset_tag: "AMS-000002", name: "MacBook", status: "in_use", assignee_name: "Rina" })]}
        selected={new Set()}
        onSelect={onSelect}
        onSelectAll={vi.fn()}
        sort="-created_at"
        onSort={onSort}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onSelect, onSort };
};

describe("AssetTable", () => {
  it("renders a row per asset", () => {
    setup();
    expect(screen.getByText("Dell Latitude")).toBeInTheDocument();
    expect(screen.getByText("MacBook")).toBeInTheDocument();
  });

  it("links each row to its detail page", () => {
    setup();
    expect(screen.getByRole("link", { name: /Dell Latitude/ }))
      .toHaveAttribute("href", "/assets/a1");
  });

  it("shows the holder when an asset is checked out", () => {
    setup();
    expect(screen.getByText("Rina")).toBeInTheDocument();
  });

  it("shows a dash rather than blank when a field is empty", () => {
    setup({ assets: [asset({ serial_no: null, location_name: null })] });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("reports a selection when a row checkbox is ticked", async () => {
    const { onSelect } = setup();
    await userEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(onSelect).toHaveBeenCalledWith("a1");
  });

  it("requests the opposite direction when the active sort column is clicked", async () => {
    const { onSort } = setup({ sort: "name" });
    await userEvent.click(screen.getByRole("button", { name: /Asset/ }));
    expect(onSort).toHaveBeenCalledWith("-name");
  });

  it("formats purchase cost as currency", () => {
    setup();
    expect(screen.getAllByText(/15[.,]000[.,]000/).length).toBeGreaterThan(0);
  });

  it("renders an empty state that offers the next action", () => {
    setup({ assets: [] });
    expect(screen.getByText(/No assets/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Import/i })).toBeInTheDocument();
  });
});
```

`web/src/hooks/useAssetQuery.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useAssetQuery } from "./useAssetQuery";

const wrapper = (initial: string) =>
  ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );

describe("useAssetQuery", () => {
  it("defaults to page 1 and no filters", () => {
    const { result } = renderHook(() => useAssetQuery(), { wrapper: wrapper("/assets") });
    expect(result.current.query).toMatchObject({ page: 1, q: "", status: [] });
  });

  it("reads filters out of the url", () => {
    const { result } = renderHook(() => useAssetQuery(), {
      wrapper: wrapper("/assets?q=dell&status=available&status=in_use&page=3"),
    });
    expect(result.current.query).toMatchObject({
      q: "dell", status: ["available", "in_use"], page: 3,
    });
  });

  it("resets to page 1 when a filter changes", () => {
    const { result } = renderHook(() => useAssetQuery(), {
      wrapper: wrapper("/assets?page=5"),
    });
    act(() => result.current.setFilter("q", "laptop"));
    expect(result.current.query.page).toBe(1);
  });

  it("keeps the page when only the page changes", () => {
    const { result } = renderHook(() => useAssetQuery(), {
      wrapper: wrapper("/assets?q=dell"),
    });
    act(() => result.current.setPage(4));
    expect(result.current.query).toMatchObject({ q: "dell", page: 4 });
  });

  it("toggles sort direction on the active column", () => {
    const { result } = renderHook(() => useAssetQuery(), {
      wrapper: wrapper("/assets?sort=name"),
    });
    act(() => result.current.setSort("-name"));
    expect(result.current.query.sort).toBe("-name");
  });

  it("clears every filter but keeps the sort", () => {
    const { result } = renderHook(() => useAssetQuery(), {
      wrapper: wrapper("/assets?q=x&status=lost&sort=-name"),
    });
    act(() => result.current.clear());
    expect(result.current.query).toMatchObject({ q: "", status: [], sort: "-name" });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run src/components/assets src/hooks`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the API modules**

`web/src/api/assets.ts`:

```ts
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
```

`web/src/api/catalog.ts`:

```ts
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
```

- [ ] **Step 4: Implement the hooks**

`web/src/hooks/useDebounced.ts`:

```ts
import { useEffect, useState } from "react";

/** Delays a fast-changing value — used so typing in search does not fire a request per keystroke. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
```

`web/src/hooks/useAssetQuery.ts`:

```ts
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

export interface AssetQuery {
  q: string;
  status: string[];
  category_id: string;
  location_id: string;
  assignee_id: string;
  sort: string;
  page: number;
  per_page: number;
}

const DEFAULT_SORT = "-created_at";

/**
 * Filter state lives in the URL, so a filtered register is a shareable link and the
 * back button restores the previous view instead of resetting it.
 */
export function useAssetQuery() {
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useMemo<AssetQuery>(() => ({
    q: searchParams.get("q") ?? "",
    status: searchParams.getAll("status"),
    category_id: searchParams.get("category_id") ?? "",
    location_id: searchParams.get("location_id") ?? "",
    assignee_id: searchParams.get("assignee_id") ?? "",
    sort: searchParams.get("sort") ?? DEFAULT_SORT,
    page: Math.max(1, Number(searchParams.get("page")) || 1),
    per_page: Math.min(200, Number(searchParams.get("per_page")) || 25),
  }), [searchParams]);

  const write = useCallback((next: Partial<AssetQuery>, resetPage: boolean) => {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(next)) {
      params.delete(key);
      if (Array.isArray(value)) {
        for (const item of value) params.append(key, item);
      } else if (value !== "" && value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    // Changing a filter while on page 7 of the old result set shows nothing.
    if (resetPage) params.delete("page");
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  return {
    query,
    setFilter: useCallback(
      (key: keyof AssetQuery, value: string | string[]) => write({ [key]: value }, true),
      [write],
    ),
    setSort: useCallback((sort: string) => write({ sort }, true), [write]),
    setPage: useCallback((page: number) => write({ page }, false), [write]),
    clear: useCallback(() => write({
      q: "", status: [], category_id: "", location_id: "", assignee_id: "",
    }, true), [write]),
  };
}
```

- [ ] **Step 5: Implement the register components**

`web/src/components/assets/StatusBadge.tsx`:

```tsx
import Badge from "../ui/badge/Badge";
import type { AssetStatus } from "../../api/types";

const STATUS: Record<
  AssetStatus,
  { label: string; color: "success" | "info" | "warning" | "error" | "light" }
> = {
  available: { label: "Available", color: "success" },
  in_use: { label: "In use", color: "info" },
  maintenance: { label: "Maintenance", color: "warning" },
  retired: { label: "Retired", color: "light" },
  lost: { label: "Lost", color: "error" },
};

export const statusLabel = (status: AssetStatus) => STATUS[status]?.label ?? status;

export default function StatusBadge({
  status, size = "sm",
}: { status: AssetStatus; size?: "sm" | "md" }) {
  const config = STATUS[status] ?? { label: status, color: "light" as const };
  return <Badge color={config.color} size={size}>{config.label}</Badge>;
}
```

`web/src/components/assets/AssetTable.tsx`:

```tsx
import { Link } from "react-router";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "../ui/table";
import StatusBadge from "./StatusBadge";
import type { Asset } from "../../api/types";

interface Column {
  key: string;
  label: string;
  sortable: boolean;
  align?: "right";
}

const COLUMNS: Column[] = [
  { key: "asset_tag", label: "Tag", sortable: true },
  { key: "name", label: "Asset", sortable: true },
  { key: "category", label: "Category", sortable: false },
  { key: "status", label: "Status", sortable: true },
  { key: "location", label: "Location", sortable: false },
  { key: "assignee", label: "Held by", sortable: false },
  { key: "purchase_cost", label: "Value", sortable: false, align: "right" },
];

const money = (value: string | null, currency: string) =>
  value === null || value === ""
    ? "—"
    : new Intl.NumberFormat("id-ID", {
        style: "currency", currency, maximumFractionDigits: 0,
      }).format(Number(value));

interface Props {
  assets: Asset[];
  selected: Set<string>;
  onSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  sort: string;
  onSort: (sort: string) => void;
}

export default function AssetTable({
  assets, selected, onSelect, onSelectAll, sort, onSort,
}: Props) {
  const activeColumn = sort.replace(/^-/, "");
  const descending = sort.startsWith("-");
  const allSelected = assets.length > 0 && assets.every((a) => selected.has(a.id));

  if (assets.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
          No assets match this view
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
          Clear the filters, add an asset, or bring your existing register in from a
          spreadsheet.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            to="/assets/new"
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
          >
            Add an asset
          </Link>
          <Link
            to="/import"
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
          >
            Import a spreadsheet
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="max-w-full overflow-x-auto">
        <Table>
          <TableHeader className="border-b border-gray-100 dark:border-gray-800">
            <TableRow>
              <TableCell isHeader className="w-10 px-5 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all assets on this page"
                  checked={allSelected}
                  onChange={() => onSelectAll(assets.map((a) => a.id))}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                />
              </TableCell>
              {COLUMNS.map((column) => (
                <TableCell
                  key={column.key}
                  isHeader
                  className={`px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 ${
                    column.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSort(
                          activeColumn === column.key && !descending
                            ? `-${column.key}`
                            : column.key,
                        )
                      }
                      className="inline-flex items-center gap-1 hover:text-gray-800 dark:hover:text-white/90"
                    >
                      {column.label}
                      {activeColumn === column.key && (
                        <span aria-hidden>{descending ? "↓" : "↑"}</span>
                      )}
                    </button>
                  ) : (
                    column.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
            {assets.map((asset) => (
              <TableRow key={asset.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                <TableCell className="px-5 py-4">
                  <input
                    type="checkbox"
                    aria-label={`Select ${asset.name}`}
                    checked={selected.has(asset.id)}
                    onChange={() => onSelect(asset.id)}
                    className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                  />
                </TableCell>
                <TableCell className="px-5 py-4 font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                  {asset.asset_tag}
                </TableCell>
                <TableCell className="px-5 py-4">
                  <Link
                    to={`/assets/${asset.id}`}
                    className="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                  >
                    {asset.name}
                  </Link>
                  <div className="text-theme-xs text-gray-500 dark:text-gray-400">
                    {asset.serial_no ?? "—"}
                  </div>
                </TableCell>
                <TableCell className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">
                  {asset.category_name ?? "—"}
                </TableCell>
                <TableCell className="px-5 py-4">
                  <StatusBadge status={asset.status} />
                </TableCell>
                <TableCell className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">
                  {asset.location_name ?? "—"}
                </TableCell>
                <TableCell className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">
                  {asset.assignee_name ?? "—"}
                </TableCell>
                <TableCell className="px-5 py-4 text-right text-sm text-gray-600 dark:text-gray-400">
                  {money(asset.purchase_cost, asset.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

`web/src/components/assets/AssetFilters.tsx`:

```tsx
import { useEffect, useState } from "react";
import Input from "../form/input/InputField";
import Label from "../form/Label";
import { useDebounced } from "../../hooks/useDebounced";
import type { Category, LocationNode, OrgUser, AssetStatus } from "../../api/types";
import type { AssetQuery } from "../../hooks/useAssetQuery";

const STATUSES: { value: AssetStatus; label: string }[] = [
  { value: "available", label: "Available" },
  { value: "in_use", label: "In use" },
  { value: "maintenance", label: "Maintenance" },
  { value: "retired", label: "Retired" },
  { value: "lost", label: "Lost" },
];

interface Props {
  query: AssetQuery;
  categories: Category[];
  locations: LocationNode[];
  users: OrgUser[];
  onFilter: (key: keyof AssetQuery, value: string | string[]) => void;
  onClear: () => void;
}

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export default function AssetFilters({
  query, categories, locations, users, onFilter, onClear,
}: Props) {
  const [search, setSearch] = useState(query.q);
  const debounced = useDebounced(search, 300);

  useEffect(() => {
    if (debounced !== query.q) onFilter("q", debounced);
    // Only react to the debounced value; query.q changing from outside is handled below.
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSearch(query.q);
  }, [query.q]);

  const toggleStatus = (status: string) => {
    const next = query.status.includes(status)
      ? query.status.filter((s) => s !== status)
      : [...query.status, status];
    onFilter("status", next);
  };

  const activeCount =
    (query.q ? 1 : 0) + query.status.length +
    (query.category_id ? 1 : 0) + (query.location_id ? 1 : 0) +
    (query.assignee_id ? 1 : 0);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Label htmlFor="asset-search">Search</Label>
          <Input
            id="asset-search" type="text"
            placeholder="Name, serial number or asset tag"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="filter-category">Category</Label>
          <select
            id="filter-category" className={selectClass}
            value={query.category_id}
            onChange={(e) => onFilter("category_id", e.target.value)}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="filter-location">Location</Label>
          <select
            id="filter-location" className={selectClass}
            value={query.location_id}
            onChange={(e) => onFilter("location_id", e.target.value)}
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {" ".repeat(l.depth * 2)}{l.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="filter-assignee">Held by</Label>
          <select
            id="filter-assignee" className={selectClass}
            value={query.assignee_id}
            onChange={(e) => onFilter("assignee_id", e.target.value)}
          >
            <option value="">Anyone</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-theme-xs text-gray-500 dark:text-gray-400">Status</span>
        {STATUSES.map((status) => {
          const active = query.status.includes(status.value);
          return (
            <button
              key={status.value}
              type="button"
              aria-pressed={active}
              onClick={() => toggleStatus(status.value)}
              className={`rounded-full px-3 py-1 text-theme-xs font-medium transition ${
                active
                  ? "bg-brand-500 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.05] dark:text-gray-300 dark:hover:bg-white/[0.08]"
              }`}
            >
              {status.label}
            </button>
          );
        })}
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto text-theme-xs font-medium text-brand-500 hover:text-brand-600"
          >
            Clear {activeCount} filter{activeCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </div>
  );
}
```

`web/src/components/assets/Pagination.tsx`:

```tsx
interface Props {
  meta: { page: number; per_page: number; total: number; total_pages: number };
  onPage: (page: number) => void;
}

export default function Pagination({ meta, onPage }: Props) {
  if (meta.total === 0) return null;
  const first = (meta.page - 1) * meta.per_page + 1;
  const last = Math.min(meta.page * meta.per_page, meta.total);

  const buttonClass =
    "rounded-lg px-3 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset " +
    "ring-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 " +
    "dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]";

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Showing <strong>{first}</strong>–<strong>{last}</strong> of{" "}
        <strong>{meta.total.toLocaleString()}</strong>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button" className={buttonClass}
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          Previous
        </button>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Page {meta.page} of {meta.total_pages}
        </span>
        <button
          type="button" className={buttonClass}
          disabled={meta.page >= meta.total_pages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
```

`web/src/components/assets/BulkActionBar.tsx`:

```tsx
import { useState } from "react";
import { assetsApi } from "../../api/assets";

interface Props {
  selected: Set<string>;
  onClear: () => void;
  onChanged: () => void;
}

export default function BulkActionBar({ selected, onClear, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const ids = [...selected];
  if (ids.length === 0) return null;

  async function setStatus(status: string) {
    setBusy(true);
    try {
      // Sequential rather than parallel: a bulk retire of 300 assets should not
      // open 300 connections.
      for (const id of ids) await assetsApi.update(id, { status: status as never });
      onClear();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function printLabels(symbology: "qr" | "code128") {
    setBusy(true);
    try {
      const html = await assetsApi.labelSheet({
        asset_ids: ids, symbology, template: "avery5160",
      });
      const sheet = window.open("", "_blank");
      if (sheet) {
        sheet.document.write(html);
        sheet.document.close();
      }
    } finally {
      setBusy(false);
    }
  }

  const action =
    "rounded-lg px-3 py-2 text-theme-xs font-medium text-white/90 " +
    "ring-1 ring-inset ring-white/25 hover:bg-white/10 disabled:opacity-50";

  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-gray-900 px-5 py-3.5 shadow-lg dark:bg-gray-800">
      <span className="text-sm font-medium text-white">
        {ids.length} selected
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={action} disabled={busy}
                onClick={() => printLabels("qr")}>
          Print QR labels
        </button>
        <button type="button" className={action} disabled={busy}
                onClick={() => printLabels("code128")}>
          Print barcodes
        </button>
        <button type="button" className={action} disabled={busy}
                onClick={() => setStatus("maintenance")}>
          Send to maintenance
        </button>
        <button type="button" className={action} disabled={busy}
                onClick={() => setStatus("retired")}>
          Retire
        </button>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-theme-xs font-medium text-white/70 hover:text-white"
      >
        Clear selection
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Implement the register page**

`web/src/pages/Assets/AssetList.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import AssetFilters from "../../components/assets/AssetFilters";
import AssetTable from "../../components/assets/AssetTable";
import BulkActionBar from "../../components/assets/BulkActionBar";
import Pagination from "../../components/assets/Pagination";
import { useAssetQuery } from "../../hooks/useAssetQuery";
import { assetsApi } from "../../api/assets";
import { catalogApi } from "../../api/catalog";
import { downloadBlob, api, ApiError } from "../../api/client";
import type { Asset, Category, LocationNode, OrgUser } from "../../api/types";

export default function AssetList() {
  const { query, setFilter, setSort, setPage, clear } = useAssetQuery();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [meta, setMeta] = useState({ page: 1, per_page: 25, total: 0, total_pages: 1 });
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await assetsApi.list(query);
      setAssets(page.data);
      setMeta(page.meta);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load assets.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void Promise.all([
      catalogApi.categories(), catalogApi.locations(), catalogApi.users(),
    ]).then(([c, l, u]) => {
      setCategories(c);
      setLocations(l);
      setUsers(u);
    }).catch(() => undefined);
  }, []);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = (ids: string[]) =>
    setSelected((current) =>
      ids.every((id) => current.has(id)) ? new Set() : new Set(ids),
    );

  async function exportRegister(format: "csv" | "xlsx") {
    // The export honours the filters currently on screen, not the whole register.
    const blob = await api.blob(`/api/v1/exports/assets.${format}`, query);
    downloadBlob(blob, `assets-${new Date().toISOString().slice(0, 10)}.${format}`);
  }

  return (
    <>
      <PageMeta title="Assets | AMS" description="The asset register" />
      <PageBreadcrumb pageTitle="Assets" />

      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {loading ? "Loading…" : `${meta.total.toLocaleString()} assets`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void exportRegister("csv")}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => void exportRegister("xlsx")}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
            >
              Export Excel
            </button>
            <Link
              to="/assets/new"
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Add asset
            </Link>
          </div>
        </div>

        <AssetFilters
          query={query} categories={categories} locations={locations} users={users}
          onFilter={setFilter} onClear={clear}
        />

        {error && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
            {error}
          </div>
        )}

        <AssetTable
          assets={assets}
          selected={selected}
          onSelect={toggle}
          onSelectAll={toggleAll}
          sort={query.sort}
          onSort={setSort}
        />

        <Pagination meta={meta} onPage={setPage} />
      </div>

      <BulkActionBar
        selected={selected}
        onClear={() => setSelected(new Set())}
        onChanged={() => void load()}
      />
    </>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/assets src/hooks`
Expected: PASS, 17 tests.

- [ ] **Step 8: Commit**

```bash
git add web/src/api web/src/components/assets web/src/hooks web/src/pages/Assets
git commit -m "feat: asset register with url-driven filters, sorting and bulk actions"
```

---

### Task 23: Asset detail — overview, history timeline, attachments

**Files:**
- Create: `web/src/components/assets/HistoryTimeline.tsx`, `AssetAttachments.tsx`, `LabelPreview.tsx`
- Create: `web/src/pages/Assets/AssetDetail.tsx`, `web/src/pages/Assets/TagRedirect.tsx`
- Test: `web/src/components/assets/HistoryTimeline.test.tsx`

**Interfaces:**
- Consumes: `assetsApi.get/history/attachments/labelUrl`, template `ComponentCard`, `Badge`, `Table`.
- Produces:
  - `<HistoryTimeline events assignments />` — one merged chronological narrative
  - `<AssetAttachments assetId attachments onChanged />`
  - `<LabelPreview assetId assetTag />`
  - `describeEvent(event): string` — turns `asset.updated` + a changes diff into a sentence

- [ ] **Step 1: Write the failing test**

`web/src/components/assets/HistoryTimeline.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HistoryTimeline, { describeEvent } from "./HistoryTimeline";
import type { AuditEvent } from "../../api/types";

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: "e1", asset_id: "a1", actor_type: "user", actor_label: "Rina",
  event: "asset.created", changes: {}, note: null,
  created_at: "2026-09-01T10:00:00Z", ...over,
});

describe("describeEvent", () => {
  it("describes creation in plain language", () => {
    expect(describeEvent(event())).toBe("created this asset");
  });

  it("names the fields an update changed", () => {
    expect(describeEvent(event({
      event: "asset.updated",
      changes: { status: { from: "available", to: "maintenance" } },
    }))).toBe("changed status from available to maintenance");
  });

  it("summarises an update touching several fields", () => {
    const text = describeEvent(event({
      event: "asset.updated",
      changes: {
        name: { from: "A", to: "B" },
        serial_no: { from: null, to: "SN-1" },
      },
    }));
    expect(text).toContain("name");
    expect(text).toContain("serial_no");
  });

  it("describes check-out and check-in", () => {
    expect(describeEvent(event({ event: "asset.checked_out" }))).toMatch(/checked out/i);
    expect(describeEvent(event({ event: "asset.checked_in" }))).toMatch(/checked in/i);
  });

  it("falls back to the raw event name for an unknown type", () => {
    expect(describeEvent(event({ event: "asset.teleported" }))).toContain("teleported");
  });
});

describe("HistoryTimeline", () => {
  it("renders one entry per event with its actor", () => {
    render(<HistoryTimeline events={[event(), event({ id: "e2", actor_label: "Budi" })]} assignments={[]} />);
    expect(screen.getByText("Rina")).toBeInTheDocument();
    expect(screen.getByText("Budi")).toBeInTheDocument();
  });

  it("shows a note when the event carries one", () => {
    render(<HistoryTimeline events={[event({ event: "asset.note", note: "Screen scratched" })]} assignments={[]} />);
    expect(screen.getByText("Screen scratched")).toBeInTheDocument();
  });

  it("renders an empty state rather than a blank panel", () => {
    render(<HistoryTimeline events={[]} assignments={[]} />);
    expect(screen.getByText(/No activity yet/i)).toBeInTheDocument();
  });

  it("attributes a system event to the scheduler rather than a person", () => {
    render(<HistoryTimeline events={[event({ actor_type: "system", actor_label: "Scheduler" })]} assignments={[]} />);
    expect(screen.getByText("Scheduler")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/assets/HistoryTimeline.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the timeline**

`web/src/components/assets/HistoryTimeline.tsx`:

```tsx
import type { AuditEvent, Assignment } from "../../api/types";

const value = (raw: unknown) =>
  raw === null || raw === undefined || raw === "" ? "empty" : String(raw);

/** Turns a stored event into a sentence a non-technical user can read. */
export function describeEvent(event: AuditEvent): string {
  const fields = Object.entries(event.changes ?? {});

  switch (event.event) {
    case "asset.created":
      return "created this asset";
    case "asset.deleted":
      return "deleted this asset";
    case "asset.note":
      return "added a note";
    case "asset.checked_out":
      return "checked out this asset";
    case "asset.checked_in":
      return "checked in this asset";
    case "asset.attachment_added":
      return `attached ${value(fields[0]?.[1]?.to)}`;
    case "asset.attachment_removed":
      return `removed the attachment ${value(fields[0]?.[1]?.from)}`;
    case "asset.overdue_notified":
      return "sent an overdue reminder";
    case "asset.updated": {
      if (fields.length === 0) return "updated this asset";
      if (fields.length === 1) {
        const [field, change] = fields[0];
        return `changed ${field} from ${value(change.from)} to ${value(change.to)}`;
      }
      return `updated ${fields.map(([field]) => field).join(", ")}`;
    }
    default:
      return event.event.replace(/^asset\./, "").replace(/[._]/g, " ");
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

const DOT: Record<string, string> = {
  "asset.created": "bg-brand-500",
  "asset.checked_out": "bg-blue-light-500",
  "asset.checked_in": "bg-success-500",
  "asset.updated": "bg-gray-400",
  "asset.note": "bg-warning-500",
  "asset.deleted": "bg-error-500",
};

export default function HistoryTimeline({
  events,
}: {
  events: AuditEvent[];
  assignments: Assignment[];
}) {
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        No activity yet. Everything that happens to this asset will appear here.
      </p>
    );
  }

  return (
    <ol className="relative space-y-6 border-l border-gray-200 pl-6 dark:border-gray-800">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden
            className={`absolute -left-[1.6875rem] top-1.5 h-3 w-3 rounded-full ring-4 ring-white dark:ring-gray-900 ${
              DOT[event.event] ?? "bg-gray-400"
            }`}
          />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-sm font-medium text-gray-800 dark:text-white/90">
              {event.actor_label ?? "System"}
            </span>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {describeEvent(event)}
            </span>
          </div>
          <time className="text-theme-xs text-gray-400" dateTime={event.created_at}>
            {when(event.created_at)}
          </time>
          {event.note && (
            <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-white/[0.03] dark:text-gray-300">
              {event.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Implement attachments and the label preview**

`web/src/components/assets/AssetAttachments.tsx`:

```tsx
import { useRef, useState } from "react";
import { assetsApi } from "../../api/assets";
import { ApiError } from "../../api/client";
import type { Attachment } from "../../api/types";

const size = (bytes: string) => {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export default function AssetAttachments({
  assetId, attachments, onChanged,
}: { assetId: string; attachments: Attachment[]; onChanged: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const kind = file.type.startsWith("image/") ? "photo" : "file";
        await assetsApi.addAttachment(assetId, file, kind);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.detail ?? err.message) : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
          {error}
        </p>
      )}

      {attachments.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No files yet. Attach condition photos, warranty documents or the manual.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800"
            >
              {attachment.content_type.startsWith("image/") ? (
                <img
                  src={assetsApi.attachmentUrl(attachment.id)}
                  alt={attachment.filename}
                  className="h-12 w-12 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-theme-xs font-medium text-gray-500 dark:bg-gray-800">
                  {attachment.filename.split(".").pop()?.toUpperCase() ?? "FILE"}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <a
                  href={assetsApi.attachmentUrl(attachment.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                >
                  {attachment.filename}
                </a>
                <span className="text-theme-xs text-gray-400">
                  {size(attachment.size_bytes)}
                </span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await assetsApi.removeAttachment(attachment.id);
                  onChanged();
                }}
                className="text-theme-xs text-gray-400 hover:text-error-500"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv"
        onChange={(e) => void upload(e.target.files)}
        className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-600 dark:text-gray-400"
        disabled={busy}
      />
    </div>
  );
}
```

`web/src/components/assets/LabelPreview.tsx`:

```tsx
import { useState } from "react";
import { assetsApi } from "../../api/assets";

export default function LabelPreview({
  assetId, assetTag,
}: { assetId: string; assetTag: string }) {
  const [symbology, setSymbology] = useState<"qr" | "code128">("qr");

  async function print() {
    const html = await assetsApi.labelSheet({
      asset_ids: [assetId], symbology, template: "thermal50x25",
    });
    const sheet = window.open("", "_blank");
    if (sheet) {
      sheet.document.write(html);
      sheet.document.close();
    }
  }

  return (
    <div className="space-y-4 text-center">
      <img
        src={assetsApi.labelUrl(assetId, symbology, 4)}
        alt={`${symbology === "qr" ? "QR code" : "Barcode"} for ${assetTag}`}
        className="mx-auto max-h-40 bg-white p-2"
      />
      <p className="font-mono text-theme-xs text-gray-500 dark:text-gray-400">{assetTag}</p>

      <div className="flex items-center justify-center gap-2">
        {(["qr", "code128"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={symbology === option}
            onClick={() => setSymbology(option)}
            className={`rounded-full px-3 py-1 text-theme-xs font-medium ${
              symbology === option
                ? "bg-brand-500 text-white"
                : "bg-gray-100 text-gray-600 dark:bg-white/[0.05] dark:text-gray-300"
            }`}
          >
            {option === "qr" ? "QR" : "Barcode"}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void print()}
        className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
      >
        Print label
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Implement the detail page and the tag redirect**

`web/src/pages/Assets/AssetDetail.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import StatusBadge from "../../components/assets/StatusBadge";
import HistoryTimeline from "../../components/assets/HistoryTimeline";
import AssetAttachments from "../../components/assets/AssetAttachments";
import LabelPreview from "../../components/assets/LabelPreview";
import CheckOutDialog from "../../components/assets/CheckOutDialog";
import CheckInDialog from "../../components/assets/CheckInDialog";
import { useModal } from "../../hooks/useModal";
import { assetsApi } from "../../api/assets";
import { useAuth } from "../../context/AuthContext";
import type { Asset, Assignment, AuditEvent, Attachment } from "../../api/types";

type Tab = "overview" | "history" | "files";

export default function AssetDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const checkOut = useModal();
  const checkIn = useModal();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, history, files] = await Promise.all([
        assetsApi.get(id), assetsApi.history(id), assetsApi.attachments(id),
      ]);
      setAsset(detail);
      setEvents(history.events);
      setAssignments(history.assignments);
      setAttachments(files);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <p className="p-8 text-sm text-gray-500">Loading asset…</p>;
  }
  if (!asset) {
    return (
      <div className="p-8">
        <p className="text-sm text-gray-500">This asset could not be found.</p>
        <Link to="/assets" className="text-sm text-brand-500">Back to the register</Link>
      </div>
    );
  }

  const facts: [string, string][] = [
    ["Asset tag", asset.asset_tag],
    ["Serial number", asset.serial_no ?? "—"],
    ["Category", asset.category_name ?? "—"],
    ["Location", asset.location_name ?? "—"],
    ["Held by", asset.assignee_name ?? "—"],
    ["Purchased", asset.purchase_date ?? "—"],
    ["Purchase cost", asset.purchase_cost
      ? new Intl.NumberFormat("id-ID", {
          style: "currency", currency: asset.currency, maximumFractionDigits: 0,
        }).format(Number(asset.purchase_cost))
      : "—"],
  ];

  return (
    <>
      <PageMeta title={`${asset.name} | AMS`} description="Asset detail" />
      <PageBreadcrumb pageTitle={asset.name} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <StatusBadge status={asset.status} size="md" />
        <div className="ml-auto flex flex-wrap gap-2">
          {can("assets:write") && asset.status !== "in_use" && (
            <button
              type="button" onClick={checkOut.openModal}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Check out
            </button>
          )}
          {can("assets:write") && asset.status === "in_use" && (
            <button
              type="button" onClick={checkIn.openModal}
              className="rounded-lg bg-success-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-success-600"
            >
              Check in
            </button>
          )}
          {can("assets:write") && (
            <Link
              to={`/assets/${asset.id}/edit`}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
            >
              Edit
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
            {(["overview", "history", "files"] as Tab[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTab(option)}
                className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium capitalize transition ${
                  tab === option
                    ? "border-brand-500 text-brand-500"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
                }`}
              >
                {option === "files" ? `Files (${attachments.length})` : option}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <ComponentCard title="Details">
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</dt>
                    <dd className="mt-0.5 text-sm text-gray-800 dark:text-white/90">{value}</dd>
                  </div>
                ))}
              </dl>

              {Object.keys(asset.custom).length > 0 && (
                <div className="mt-6 border-t border-gray-100 pt-6 dark:border-gray-800">
                  <h4 className="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
                    {asset.category_name} fields
                  </h4>
                  <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    {Object.entries(asset.custom).map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-theme-xs text-gray-500 dark:text-gray-400">{key}</dt>
                        <dd className="mt-0.5 text-sm text-gray-800 dark:text-white/90">
                          {String(value ?? "—")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {asset.description && (
                <p className="mt-6 border-t border-gray-100 pt-6 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-400">
                  {asset.description}
                </p>
              )}
            </ComponentCard>
          )}

          {tab === "history" && (
            <ComponentCard title="History" desc="Every recorded change, newest first.">
              <HistoryTimeline events={events} assignments={assignments} />
            </ComponentCard>
          )}

          {tab === "files" && (
            <ComponentCard title="Files" desc="Photos, documents and manuals.">
              <AssetAttachments
                assetId={asset.id} attachments={attachments}
                onChanged={() => void load()}
              />
            </ComponentCard>
          )}
        </div>

        <div className="space-y-5">
          <ComponentCard title="Label">
            <LabelPreview assetId={asset.id} assetTag={asset.asset_tag} />
          </ComponentCard>
        </div>
      </div>

      <CheckOutDialog
        assetId={asset.id} isOpen={checkOut.isOpen} onClose={checkOut.closeModal}
        onDone={() => { checkOut.closeModal(); void load(); }}
      />
      <CheckInDialog
        assetId={asset.id} isOpen={checkIn.isOpen} onClose={checkIn.closeModal}
        onDone={() => { checkIn.closeModal(); void load(); }}
      />
    </>
  );
}
```

`web/src/pages/Assets/TagRedirect.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { assetsApi } from "../../api/assets";

/** Where a scanned QR code lands. Resolves the tag and forwards to the asset. */
export default function TagRedirect() {
  const { tag = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    assetsApi.lookup(tag)
      .then((asset) => navigate(`/assets/${asset.id}`, { replace: true }))
      .catch(() => setError(`No asset is registered with the tag "${tag}".`));
  }, [tag, navigate]);

  if (!error) {
    return <p className="p-8 text-sm text-gray-500">Looking up {tag}…</p>;
  }
  return (
    <div className="p-8">
      <h2 className="text-base font-medium text-gray-800 dark:text-white/90">
        Tag not found
      </h2>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{error}</p>
      <Link to="/assets" className="mt-4 inline-block text-sm text-brand-500">
        Search the register instead
      </Link>
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/assets/HistoryTimeline.test.tsx`
Expected: PASS, 9 tests. (`AssetDetail` imports the dialogs built in Task 25; create
them as empty stubs returning `null` now if you run the page before then.)

- [ ] **Step 7: Commit**

```bash
git add web/src/components/assets web/src/pages/Assets
git commit -m "feat: asset detail with history timeline, attachments and label preview"
```

---

### Task 24: Asset create/edit form with dynamic custom fields

**Files:**
- Create: `web/src/components/assets/CustomFields.tsx`, `web/src/components/assets/AssetFormFields.tsx`
- Create: `web/src/pages/Assets/AssetForm.tsx`
- Test: `web/src/components/assets/CustomFields.test.tsx`

**Interfaces:**
- Consumes: `catalogApi`, `assetsApi`, `ApiError.fieldErrors`, template form components.
- Produces:
  - `<CustomFields schema value onChange errors />` — renders an input per `FieldDef` type
  - `<AssetForm mode="create" | "edit" />`

**Design note:** the custom-field inputs are generated from the category's
`field_schema`, so adding a field in Categories immediately changes this form with no
frontend release. Server-side validation errors come back keyed by field and are shown
inline — the form never silently discards what the user typed.

- [ ] **Step 1: Write the failing test**

`web/src/components/assets/CustomFields.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CustomFields from "./CustomFields";
import type { FieldDef } from "../../api/types";

const schema: FieldDef[] = [
  { key: "os", label: "Operating System", type: "enum", required: true,
    options: ["Windows 11", "macOS"] },
  { key: "ram_gb", label: "RAM (GB)", type: "number", required: false },
  { key: "warranty_end", label: "Warranty End", type: "date", required: false },
  { key: "is_leased", label: "Leased", type: "boolean", required: false },
  { key: "supplier", label: "Supplier", type: "string", required: false },
];

const setup = (over: Partial<React.ComponentProps<typeof CustomFields>> = {}) => {
  const onChange = vi.fn();
  render(
    <CustomFields schema={schema} value={{}} onChange={onChange} errors={{}} {...over} />,
  );
  return { onChange };
};

describe("CustomFields", () => {
  it("renders an input for every field in the schema", () => {
    setup();
    for (const field of schema) {
      expect(screen.getByLabelText(new RegExp(field.label))).toBeInTheDocument();
    }
  });

  it("renders an enum field as a select carrying its options", () => {
    setup();
    const select = screen.getByLabelText(/Operating System/) as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect([...select.options].map((o) => o.value)).toContain("macOS");
  });

  it("marks a required field", () => {
    setup();
    expect(screen.getByLabelText(/Operating System/)).toBeRequired();
  });

  it("renders a boolean field as a checkbox", () => {
    setup();
    expect(screen.getByLabelText(/Leased/)).toHaveAttribute("type", "checkbox");
  });

  it("renders a date field as a date input", () => {
    setup();
    expect(screen.getByLabelText(/Warranty End/)).toHaveAttribute("type", "date");
  });

  it("emits a number, not a string, from a number field", async () => {
    const { onChange } = setup();
    await userEvent.type(screen.getByLabelText(/RAM/), "16");
    expect(onChange).toHaveBeenLastCalledWith("ram_gb", 16);
  });

  it("shows the stored value", () => {
    setup({ value: { supplier: "Acme Supplies" } });
    expect(screen.getByLabelText(/Supplier/)).toHaveValue("Acme Supplies");
  });

  it("shows a server-side error against its field", () => {
    setup({ errors: { os: "is required" } });
    expect(screen.getByText("is required")).toBeInTheDocument();
  });

  it("tells the user when the category defines no extra fields", () => {
    setup({ schema: [] });
    expect(screen.getByText(/no additional fields/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/assets/CustomFields.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dynamic field renderer**

`web/src/components/assets/CustomFields.tsx`:

```tsx
import Label from "../form/Label";
import Input from "../form/input/InputField";
import type { FieldDef } from "../../api/types";

interface Props {
  schema: FieldDef[];
  value: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  errors: Record<string, string>;
}

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export default function CustomFields({ schema, value, onChange, errors }: Props) {
  if (schema.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        This category defines no additional fields. Add them under Categories to capture
        details specific to this kind of asset.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {schema.map((field) => {
        const id = `custom-${field.key}`;
        const error = errors[field.key] ?? errors[`custom.${field.key}`];
        const current = value[field.key];

        return (
          <div key={field.key}>
            <Label htmlFor={id}>
              {field.label}
              {field.required && <span className="text-error-500">*</span>}
            </Label>

            {field.type === "enum" ? (
              <select
                id={id}
                className={selectClass}
                required={field.required}
                value={String(current ?? "")}
                onChange={(e) => onChange(field.key, e.target.value || null)}
              >
                <option value="">Not set</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            ) : field.type === "boolean" ? (
              <label className="flex h-11 items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(current)}
                  onChange={(e) => onChange(field.key, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                />
                Yes
              </label>
            ) : (
              <Input
                id={id}
                type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                value={current === null || current === undefined ? "" : String(current)}
                error={Boolean(error)}
                onChange={(e) => {
                  const raw = e.target.value;
                  // A number field must emit a number — the API rejects "16".
                  onChange(
                    field.key,
                    field.type === "number"
                      ? raw === "" ? null : Number(raw)
                      : raw === "" ? null : raw,
                  );
                }}
              />
            )}

            {error && <p className="mt-1 text-theme-xs text-error-500">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Implement the form page**

`web/src/pages/Assets/AssetForm.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import TextArea from "../../components/form/input/TextArea";
import CustomFields from "../../components/assets/CustomFields";
import { assetsApi } from "../../api/assets";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";
import type { Category, LocationNode, OrgUser, AssetStatus } from "../../api/types";

const STATUSES: AssetStatus[] = [
  "available", "in_use", "maintenance", "retired", "lost",
];

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface FormState {
  name: string;
  asset_tag: string;
  serial_no: string;
  description: string;
  category_id: string;
  status: AssetStatus;
  location_id: string;
  purchase_date: string;
  purchase_cost: string;
  currency: string;
  custom: Record<string, unknown>;
}

const EMPTY: FormState = {
  name: "", asset_tag: "", serial_no: "", description: "", category_id: "",
  status: "available", location_id: "", purchase_date: "", purchase_cost: "",
  currency: "IDR", custom: {},
};

export default function AssetForm({ mode }: { mode: "create" | "edit" }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void Promise.all([catalogApi.categories(), catalogApi.locations()])
      .then(([c, l]) => { setCategories(c); setLocations(l); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    void assetsApi.get(id).then((asset) => setForm({
      name: asset.name,
      asset_tag: asset.asset_tag,
      serial_no: asset.serial_no ?? "",
      description: asset.description ?? "",
      category_id: asset.category_id ?? "",
      status: asset.status,
      location_id: asset.location_id ?? "",
      purchase_date: asset.purchase_date ?? "",
      purchase_cost: asset.purchase_cost ?? "",
      currency: asset.currency,
      custom: asset.custom,
    }));
  }, [mode, id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const schema =
    categories.find((c) => c.id === form.category_id)?.field_schema.fields ?? [];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setBanner(null);

    // Empty strings mean "not set", not "set to empty" — send null instead.
    const payload = {
      name: form.name,
      asset_tag: form.asset_tag || undefined,
      serial_no: form.serial_no || null,
      description: form.description || null,
      category_id: form.category_id || null,
      status: form.status,
      location_id: form.location_id || null,
      purchase_date: form.purchase_date || null,
      purchase_cost: form.purchase_cost === "" ? null : Number(form.purchase_cost),
      currency: form.currency,
      custom: form.custom,
    };

    try {
      const saved = mode === "create"
        ? await assetsApi.create(payload as never)
        : await assetsApi.update(id!, payload as never);
      navigate(`/assets/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setBanner(err.problem.detail ?? err.message);
      } else {
        setBanner("Could not save this asset.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageMeta
        title={`${mode === "create" ? "New asset" : "Edit asset"} | AMS`}
        description="Create or edit an asset"
      />
      <PageBreadcrumb pageTitle={mode === "create" ? "New asset" : "Edit asset"} />

      <form onSubmit={onSubmit} className="space-y-5">
        {banner && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
            {banner}
          </div>
        )}

        <ComponentCard title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="name">Name<span className="text-error-500">*</span></Label>
              <Input
                id="name" type="text" value={form.name} error={Boolean(errors.name)}
                placeholder="Dell Latitude 5540"
                onChange={(e) => set("name", e.target.value)}
              />
              {errors.name && <p className="mt-1 text-theme-xs text-error-500">{errors.name}</p>}
            </div>
            <div>
              <Label htmlFor="asset_tag">Asset tag</Label>
              <Input
                id="asset_tag" type="text" value={form.asset_tag}
                error={Boolean(errors.asset_tag)}
                placeholder="Generated automatically if left blank"
                onChange={(e) => set("asset_tag", e.target.value)}
              />
              {errors.asset_tag && (
                <p className="mt-1 text-theme-xs text-error-500">{errors.asset_tag}</p>
              )}
            </div>
            <div>
              <Label htmlFor="serial_no">Serial number</Label>
              <Input
                id="serial_no" type="text" value={form.serial_no}
                error={Boolean(errors.serial_no)}
                onChange={(e) => set("serial_no", e.target.value)}
              />
              {errors.serial_no && (
                <p className="mt-1 text-theme-xs text-error-500">{errors.serial_no}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="description">Description</Label>
              <TextArea
                value={form.description}
                onChange={(value: string) => set("description", value)}
                rows={3}
              />
            </div>
          </div>
        </ComponentCard>

        <ComponentCard title="Classification">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="category_id">Category</Label>
              <select
                id="category_id" className={selectClass} value={form.category_id}
                onChange={(e) => {
                  // Switching category changes which custom fields apply; drop the
                  // old values rather than sending fields the new schema rejects.
                  set("category_id", e.target.value);
                  set("custom", {});
                }}
              >
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <select
                id="status" className={selectClass} value={form.status}
                onChange={(e) => set("status", e.target.value as AssetStatus)}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>{status.replace("_", " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="location_id">Location</Label>
              <select
                id="location_id" className={selectClass} value={form.location_id}
                onChange={(e) => set("location_id", e.target.value)}
              >
                <option value="">Unassigned</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {" ".repeat(l.depth * 2)}{l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </ComponentCard>

        <ComponentCard title="Purchase">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="purchase_date">Purchase date</Label>
              <Input
                id="purchase_date" type="date" value={form.purchase_date}
                onChange={(e) => set("purchase_date", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="purchase_cost">Purchase cost</Label>
              <Input
                id="purchase_cost" type="number" step={1} value={form.purchase_cost}
                error={Boolean(errors.purchase_cost)}
                onChange={(e) => set("purchase_cost", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency" type="text" value={form.currency}
                onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))}
              />
            </div>
          </div>
        </ComponentCard>

        <ComponentCard
          title={`${categories.find((c) => c.id === form.category_id)?.name ?? "Category"} fields`}
          desc="Defined by the asset's category."
        >
          <CustomFields
            schema={schema}
            value={form.custom}
            errors={errors}
            onChange={(key, value) =>
              set("custom", { ...form.custom, [key]: value })
            }
          />
        </ComponentCard>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand-500 px-5 py-3.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : mode === "create" ? "Create asset" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-lg px-5 py-3.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/assets`
Expected: PASS, 9 new tests (26 in the folder).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/assets/CustomFields.tsx web/src/pages/Assets/AssetForm.tsx
git commit -m "feat: asset form with category-driven dynamic custom fields"
```

---

### Task 25: Check-out and check-in dialogs

**Files:**
- Create: `web/src/components/assets/CheckOutDialog.tsx`, `web/src/components/assets/CheckInDialog.tsx`
- Test: `web/src/components/assets/CheckOutDialog.test.tsx`

**Interfaces:**
- Consumes: `assetsApi.checkOut/checkIn`, `catalogApi.users/locations`, template `Modal`, `useModal`.
- Produces:
  - `<CheckOutDialog assetId isOpen onClose onDone />`
  - `<CheckInDialog assetId isOpen onClose onDone />`

**Design note:** the API returns `409 invalid-transition` when an asset cannot be checked
out (already out, retired, lost). The dialog shows that message verbatim — the server's
explanation is better than any guess the UI could make.

- [ ] **Step 1: Write the failing test**

`web/src/components/assets/CheckOutDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CheckOutDialog from "./CheckOutDialog";
import { assetsApi } from "../../api/assets";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";

vi.mock("../../api/assets");
vi.mock("../../api/catalog");

const users = [
  { id: "u1", name: "Rina", email: "rina@example.com", role: "technician" as const },
  { id: "u2", name: "Budi", email: "budi@example.com", role: "manager" as const },
];
const locations = [
  { id: "l1", name: "Site B", parent_id: null, address: null, depth: 0,
    path: "Site B", asset_count: 0 },
];

beforeEach(() => {
  vi.mocked(catalogApi.users).mockResolvedValue(users);
  vi.mocked(catalogApi.locations).mockResolvedValue(locations);
  vi.mocked(assetsApi.checkOut).mockResolvedValue({} as never);
});

const setup = () => {
  const onDone = vi.fn();
  render(
    <CheckOutDialog assetId="a1" isOpen onClose={vi.fn()} onDone={onDone} />,
  );
  return { onDone };
};

describe("CheckOutDialog", () => {
  it("defaults to assigning a person", async () => {
    setup();
    await waitFor(() => expect(screen.getByLabelText(/Person/)).toBeInTheDocument());
  });

  it("checks out to the chosen user", async () => {
    const { onDone } = setup();
    await waitFor(() => expect(screen.getByLabelText(/Person/)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/Person/), "u2");
    await userEvent.click(screen.getByRole("button", { name: /Check out/i }));

    await waitFor(() => expect(assetsApi.checkOut).toHaveBeenCalledWith("a1",
      expect.objectContaining({ assignee_type: "user", assignee_id: "u2" })));
    expect(onDone).toHaveBeenCalled();
  });

  it("swaps to a location picker when assigning to a location", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: /Location/i }));
    expect(await screen.findByLabelText(/Location/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Person/)).not.toBeInTheDocument();
  });

  it("collects a free-text name for an external party", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: /External/i }));
    await userEvent.type(await screen.findByLabelText(/Name/), "Acme Agency");
    await userEvent.click(screen.getByRole("button", { name: /Check out/i }));

    await waitFor(() => expect(assetsApi.checkOut).toHaveBeenCalledWith("a1",
      expect.objectContaining({
        assignee_type: "external", assignee_label: "Acme Agency",
      })));
  });

  it("sends the due date as an ISO timestamp", async () => {
    setup();
    await waitFor(() => expect(screen.getByLabelText(/Person/)).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/Due back/), "2026-12-31");
    await userEvent.click(screen.getByRole("button", { name: /Check out/i }));

    await waitFor(() => {
      const body = vi.mocked(assetsApi.checkOut).mock.calls[0][1];
      expect(body.due_at).toMatch(/^2026-12-31T/);
    });
  });

  it("shows the server's explanation when the transition is refused", async () => {
    vi.mocked(assetsApi.checkOut).mockRejectedValue(new ApiError(409, {
      type: "https://ams.dev/errors/invalid-transition",
      title: "Invalid status transition", status: 409,
      detail: "Cannot check out an asset that is retired.",
    }));
    setup();
    await waitFor(() => expect(screen.getByLabelText(/Person/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Check out/i }));
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Cannot check out an asset that is retired.");
  });

  it("does not call onDone when the request fails", async () => {
    vi.mocked(assetsApi.checkOut).mockRejectedValue(new ApiError(409, {
      type: "x", title: "Invalid status transition", status: 409,
    }));
    const { onDone } = setup();
    await waitFor(() => expect(screen.getByLabelText(/Person/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Check out/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/assets/CheckOutDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the check-out dialog**

`web/src/components/assets/CheckOutDialog.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../ui/modal";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import TextArea from "../form/input/TextArea";
import { assetsApi } from "../../api/assets";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";
import type { LocationNode, OrgUser } from "../../api/types";

type AssigneeType = "user" | "location" | "external";

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  assetId: string;
  isOpen: boolean;
  onClose: () => void;
  onDone: () => void;
}

export default function CheckOutDialog({ assetId, isOpen, onClose, onDone }: Props) {
  const [type, setType] = useState<AssigneeType>("user");
  const [userId, setUserId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [label, setLabel] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    void Promise.all([catalogApi.users(), catalogApi.locations()])
      .then(([u, l]) => {
        setUsers(u);
        setLocations(l);
        if (u.length && !userId) setUserId(u[0].id);
        if (l.length && !locationId) setLocationId(l[0].id);
      })
      .catch(() => undefined);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await assetsApi.checkOut(assetId, {
        assignee_type: type,
        assignee_id: type === "user" ? userId : null,
        assignee_label: type === "external" ? label : null,
        location_id: type === "location" ? locationId : null,
        // The API wants a timestamp; a date input gives a date. End of that day
        // is what "due back on the 31st" means to a person.
        due_at: dueDate ? new Date(`${dueDate}T23:59:59Z`).toISOString() : null,
        note: note || null,
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not check out this asset.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
        Check out
      </h3>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        Record who is taking this asset and when it is due back.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
            {error}
          </div>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            Assign to
          </legend>
          <div className="flex gap-4">
            {([
              ["user", "Person"], ["location", "Location"], ["external", "External"],
            ] as [AssigneeType, string][]).map(([option, optionLabel]) => (
              <label key={option} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="radio" name="assignee_type" value={option}
                  checked={type === option}
                  onChange={() => setType(option)}
                  className="h-4 w-4 border-gray-300 text-brand-500 focus:ring-brand-500"
                />
                {optionLabel}
              </label>
            ))}
          </div>
        </fieldset>

        {type === "user" && (
          <div>
            <Label htmlFor="checkout-user">Person</Label>
            <select
              id="checkout-user" className={selectClass}
              value={userId} onChange={(e) => setUserId(e.target.value)}
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
          </div>
        )}

        {type === "location" && (
          <div>
            <Label htmlFor="checkout-location">Location</Label>
            <select
              id="checkout-location" className={selectClass}
              value={locationId} onChange={(e) => setLocationId(e.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.path}</option>
              ))}
            </select>
          </div>
        )}

        {type === "external" && (
          <div>
            <Label htmlFor="checkout-label">Name</Label>
            <Input
              id="checkout-label" type="text" value={label}
              placeholder="Company or person outside the organisation"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        )}

        <div>
          <Label htmlFor="checkout-due">Due back</Label>
          <Input
            id="checkout-due" type="date" value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <p className="mt-1 text-theme-xs text-gray-400">
            Leave blank for an open-ended assignment. A due date enables overdue reminders.
          </p>
        </div>

        <div>
          <Label htmlFor="checkout-note">Note</Label>
          <TextArea value={note} onChange={setNote} rows={2} />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button" onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
          >
            Cancel
          </button>
          <button
            type="submit" disabled={saving}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "Checking out…" : "Check out"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 4: Implement the check-in dialog**

`web/src/components/assets/CheckInDialog.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../ui/modal";
import Label from "../form/Label";
import TextArea from "../form/input/TextArea";
import { assetsApi } from "../../api/assets";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";
import type { LocationNode } from "../../api/types";

const CONDITIONS = ["Good", "Fair", "Damaged", "Needs service"];

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  assetId: string;
  isOpen: boolean;
  onClose: () => void;
  onDone: () => void;
}

export default function CheckInDialog({ assetId, isOpen, onClose, onDone }: Props) {
  const [condition, setCondition] = useState("Good");
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    void catalogApi.locations().then(setLocations).catch(() => undefined);
  }, [isOpen]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await assetsApi.checkIn(assetId, {
        condition,
        location_id: locationId || null,
        note: note || null,
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not check in this asset.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
        Check in
      </h3>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        Record the asset's return and the condition it came back in.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
            {error}
          </div>
        )}

        <div>
          <Label htmlFor="checkin-condition">Condition</Label>
          <select
            id="checkin-condition" className={selectClass}
            value={condition} onChange={(e) => setCondition(e.target.value)}
          >
            {CONDITIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="checkin-location">Returned to</Label>
          <select
            id="checkin-location" className={selectClass}
            value={locationId} onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">Leave the location unchanged</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.path}</option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="checkin-note">Note</Label>
          <TextArea value={note} onChange={setNote} rows={2} />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button" onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
          >
            Cancel
          </button>
          <button
            type="submit" disabled={saving}
            className="rounded-lg bg-success-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-success-600 disabled:opacity-50"
          >
            {saving ? "Checking in…" : "Check in"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/assets/CheckOutDialog.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/assets/CheckOutDialog.tsx web/src/components/assets/CheckInDialog.tsx
git commit -m "feat: check-out and check-in dialogs with server-explained transitions"
```

---

### Task 26: Scanning — camera and HID

**Files:**
- Create: `web/src/hooks/useHidScanner.ts`, `web/src/components/scan/ScanModal.tsx`, `web/src/components/scan/ScanButton.tsx`
- Modify: `web/src/layout/AppHeader.tsx` (add the scan button)
- Test: `web/src/hooks/useHidScanner.test.tsx`

**Interfaces:**
- Consumes: `assetsApi.lookup`, `@zxing/browser`.
- Produces:
  - `useHidScanner(onScan, enabled?)` — detects a hardware-scanner keystroke burst anywhere on the page
  - `<ScanModal isOpen onClose onResolved />` — camera scanning with a manual-entry fallback
  - `<ScanButton />` — header button wiring both paths together

**Design note (spec §7.3):** a hardware barcode scanner is a keyboard. It types a full
payload in a few milliseconds and finishes with Enter. Detecting that burst pattern —
rather than requiring a focused input — means warehouse and plant staff can scan from
any screen without touching the mouse, and it needs no permissions at all.

- [ ] **Step 1: Write the failing test**

`web/src/hooks/useHidScanner.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHidScanner } from "./useHidScanner";

/** Types a payload at a given inter-key delay, the way a scanner or a person would. */
function type(text: string, gapMs: number, terminate = true) {
  for (const char of text) {
    vi.advanceTimersByTime(gapMs);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
  }
  if (terminate) {
    vi.advanceTimersByTime(gapMs);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useHidScanner", () => {
  it("fires on a fast keystroke burst ending in Enter", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    type("AMS-000123", 10);
    expect(onScan).toHaveBeenCalledWith("AMS-000123");
  });

  it("ignores human typing speed", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    type("AMS-000123", 120);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("ignores a burst too short to be a scan", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    type("AB", 10);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("ignores a burst that never terminates", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    type("AMS-000123", 10, false);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("does not hijack typing into an input", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    for (const char of "AMS-000123") {
      vi.advanceTimersByTime(10);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
    }
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onScan).not.toHaveBeenCalled();
    input.remove();
  });

  it("resets between scans so two scans both fire", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    type("AMS-000123", 10);
    vi.advanceTimersByTime(500);
    type("AMS-000456", 10);
    expect(onScan).toHaveBeenNthCalledWith(1, "AMS-000123");
    expect(onScan).toHaveBeenNthCalledWith(2, "AMS-000456");
  });

  it("does nothing while disabled", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan, false));
    type("AMS-000123", 10);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("detaches its listener on unmount", () => {
    const onScan = vi.fn();
    const { unmount } = renderHook(() => useHidScanner(onScan));
    unmount();
    type("AMS-000123", 10);
    expect(onScan).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/hooks/useHidScanner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the HID scanner hook**

`web/src/hooks/useHidScanner.ts`:

```ts
import { useEffect, useRef } from "react";

/** A scanner types far faster than a person; 50 ms is comfortably between the two. */
const MAX_GAP_MS = 50;
const MIN_LENGTH = 3;

/**
 * Detects a hardware barcode scanner. Such a scanner presents as a keyboard: it
 * types the payload in a burst and finishes with Enter. Watching for that burst
 * anywhere on the page means staff can scan from any screen with no field focused
 * and no camera permission.
 */
export function useHidScanner(
  onScan: (value: string) => void,
  enabled = true,
): void {
  const buffer = useRef("");
  const lastKeyAt = useRef(0);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    function handle(event: KeyboardEvent) {
      // Someone typing into a field is not scanning.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      const now = Date.now();
      const gap = now - lastKeyAt.current;
      lastKeyAt.current = now;

      if (event.key === "Enter") {
        const value = buffer.current;
        buffer.current = "";
        if (value.length >= MIN_LENGTH && gap <= MAX_GAP_MS) onScanRef.current(value);
        return;
      }

      // A slow keystroke means a person: start the buffer over.
      if (gap > MAX_GAP_MS) buffer.current = "";
      if (event.key.length === 1) buffer.current += event.key;
    }

    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [enabled]);
}
```

- [ ] **Step 4: Implement the scan UI**

```bash
cd web && npm install @zxing/browser @zxing/library
```

`web/src/components/scan/ScanModal.tsx`:

```tsx
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Modal } from "../ui/modal";
import Input from "../form/input/InputField";
import Label from "../form/Label";
import { assetsApi } from "../../api/assets";
import type { Asset } from "../../api/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onResolved: (asset: Asset) => void;
}

export default function ScanModal({ isOpen, onClose, onResolved }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  async function resolve(value: string) {
    setError(null);
    try {
      const asset = await assetsApi.lookup(value);
      controlsRef.current?.stop();
      onResolved(asset);
    } catch {
      setError(`No asset is registered with the tag "${value}".`);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
      if (result && !cancelled) void resolve(result.getText());
    })
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setCameraReady(true);
      })
      .catch(() => {
        // No camera, or permission refused. Manual entry still works, so this is
        // a downgrade rather than a failure.
        setCameraReady(false);
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      setCameraReady(false);
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  function onManualSubmit(event: FormEvent) {
    event.preventDefault();
    if (manual.trim()) void resolve(manual.trim());
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md p-6">
      <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
        Scan an asset
      </h3>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Point the camera at a QR code or barcode, use a handheld scanner, or type the
        tag.
      </p>

      <div className="relative mb-4 aspect-video overflow-hidden rounded-xl bg-gray-900">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {!cameraReady && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/70">
            Camera unavailable. Use a handheld scanner or enter the tag below.
          </p>
        )}
        {cameraReady && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70"
          />
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
          {error}
        </div>
      )}

      <form onSubmit={onManualSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="scan-manual">Asset tag</Label>
          <Input
            id="scan-manual" type="text" value={manual} placeholder="AMS-000123"
            onChange={(e) => setManual(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="h-11 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600"
        >
          Find
        </button>
      </form>
    </Modal>
  );
}
```

`web/src/components/scan/ScanButton.tsx`:

```tsx
import { useNavigate } from "react-router";
import ScanModal from "./ScanModal";
import { useModal } from "../../hooks/useModal";
import { useHidScanner } from "../../hooks/useHidScanner";
import { assetsApi } from "../../api/assets";

export default function ScanButton() {
  const navigate = useNavigate();
  const { isOpen, openModal, closeModal } = useModal();

  // A handheld scanner works from any screen, whether or not the dialog is open.
  useHidScanner((value) => {
    void assetsApi.lookup(value)
      .then((asset) => navigate(`/assets/${asset.id}`))
      .catch(() => navigate(`/assets?q=${encodeURIComponent(value)}`));
  });

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Scan an asset (or use a handheld scanner from any screen)"
        className="flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-200 hover:bg-gray-100 dark:text-gray-300 dark:ring-gray-800 dark:hover:bg-white/[0.03]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 7V5a1 1 0 011-1h2M4 17v2a1 1 0 001 1h2M20 7V5a1 1 0 00-1-1h-2M20 17v2a1 1 0 01-1 1h-2M4 12h16"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
          />
        </svg>
        <span className="hidden sm:inline">Scan</span>
      </button>

      <ScanModal
        isOpen={isOpen}
        onClose={closeModal}
        onResolved={(asset) => {
          closeModal();
          navigate(`/assets/${asset.id}`);
        }}
      />
    </>
  );
}
```

In `web/src/layout/AppHeader.tsx`, import `ScanButton` and render it in the header's
right-hand control group, beside the existing theme toggle.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/hooks/useHidScanner.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Verify camera scanning by hand**

Camera access needs a secure context. Open `http://localhost:3000` (localhost counts as
secure), sign in, click **Scan**, and grant camera permission. Print a label from an
asset detail page and scan it — the modal should navigate to that asset.

- [ ] **Step 7: Commit**

```bash
git add web/src/hooks/useHidScanner.ts web/src/components/scan web/src/layout/AppHeader.tsx web/package.json
git commit -m "feat: camera and hardware scanner support with tag lookup"
```

---

### Task 27: Dashboard page

**Files:**
- Create: `web/src/api/dashboard.ts`, `web/src/lib/palette.ts`
- Create: `web/src/components/dashboard/KpiTiles.tsx`, `StatusDonut.tsx`, `CategoryBars.tsx`, `RecentActivity.tsx`, `ExpiringSoon.tsx`
- Modify: `web/src/pages/Dashboard/Home.tsx`
- Test: `web/src/components/dashboard/KpiTiles.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/dashboard/summary`, `react-apexcharts`.
- Produces:
  - `PALETTE`, `STATUS_COLORS` — **the same values as the server's `api/src/lib/reports/palette.ts`**, so an on-screen chart and a printed PDF match
  - `<KpiTiles totals utilisation />`, `<StatusDonut data />`, `<CategoryBars data />`, `<RecentActivity events />`, `<ExpiringSoon items />`

**Design note:** each KPI tile is a link into a pre-filtered register. A number nobody can
click is a dead end; "4 overdue" should be one click away from the list of those four.

- [ ] **Step 1: Write the failing test**

`web/src/components/dashboard/KpiTiles.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import KpiTiles from "./KpiTiles";

const totals = {
  assets: 1284, active_assignments: 96, overdue: 4, maintenance: 12,
  total_value: "8450000000", currency: "IDR",
};

const setup = (over: Partial<typeof totals> = {}) =>
  render(
    <MemoryRouter>
      <KpiTiles totals={{ ...totals, ...over }} utilisation={{ in_use_pct: 42 }} />
    </MemoryRouter>,
  );

describe("KpiTiles", () => {
  it("shows the headline counts with thousands separators", () => {
    setup();
    expect(screen.getByText("1,284")).toBeInTheDocument();
    expect(screen.getByText("96")).toBeInTheDocument();
  });

  it("formats total value as currency", () => {
    setup();
    expect(screen.getByText(/8[.,]450[.,]000[.,]000|8,5 M|8\.5/)).toBeInTheDocument();
  });

  it("links each tile into a pre-filtered register", () => {
    setup();
    expect(screen.getByRole("link", { name: /Total assets/i }))
      .toHaveAttribute("href", "/assets");
    expect(screen.getByRole("link", { name: /In maintenance/i }))
      .toHaveAttribute("href", "/assets?status=maintenance");
  });

  it("highlights overdue when there are any", () => {
    const { container } = setup({ overdue: 4 });
    expect(container.innerHTML).toContain("error");
  });

  it("does not raise an alarm when nothing is overdue", () => {
    setup({ overdue: 0 });
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("shows utilisation as a percentage", () => {
    setup();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/dashboard`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the shared palette and API module**

`web/src/lib/palette.ts`:

```ts
/**
 * Kept identical to api/src/lib/reports/palette.ts. A chart on screen and the same
 * chart in a downloaded PDF must not be different colours.
 */
export const PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444",
  "#14b8a6", "#ec4899", "#6366f1", "#84cc16", "#f97316",
];

export const STATUS_COLORS: Record<string, string> = {
  available: "#10b981",
  in_use: "#3b82f6",
  maintenance: "#f59e0b",
  retired: "#6b7280",
  lost: "#ef4444",
};

export const colorFor = (label: string, index: number): string =>
  STATUS_COLORS[label] ?? PALETTE[index % PALETTE.length];

export const money = (value: string | number, currency = "IDR") =>
  new Intl.NumberFormat("id-ID", {
    style: "currency", currency, maximumFractionDigits: 0, notation: "compact",
  }).format(Number(value));
```

`web/src/api/dashboard.ts`:

```ts
import { api } from "./client";
import type { DashboardSummary } from "./types";

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>("/api/v1/dashboard/summary"),
};
```

- [ ] **Step 4: Implement the dashboard components**

`web/src/components/dashboard/KpiTiles.tsx`:

```tsx
import { Link } from "react-router";
import type { DashboardSummary } from "../../api/types";
import { money } from "../../lib/palette";

interface Tile {
  label: string;
  value: string;
  href: string;
  hint?: string;
  tone?: "default" | "error" | "warning";
}

export default function KpiTiles({
  totals, utilisation,
}: Pick<DashboardSummary, "totals" | "utilisation">) {
  const tiles: Tile[] = [
    { label: "Total assets", value: totals.assets.toLocaleString("en-GB"), href: "/assets" },
    {
      label: "Checked out", value: totals.active_assignments.toLocaleString("en-GB"),
      href: "/assets?status=in_use",
      hint: `${utilisation.in_use_pct}% of the register`,
    },
    {
      label: "Overdue", value: totals.overdue.toLocaleString("en-GB"),
      href: "/reports/assignments-overdue",
      tone: totals.overdue > 0 ? "error" : "default",
      hint: totals.overdue > 0 ? "Past their return date" : "Nothing is late",
    },
    {
      label: "In maintenance", value: totals.maintenance.toLocaleString("en-GB"),
      href: "/assets?status=maintenance",
      tone: totals.maintenance > 0 ? "warning" : "default",
    },
    {
      label: "Register value", value: money(totals.total_value, totals.currency),
      href: "/reports/assets-by-category",
    },
    {
      label: "Utilisation", value: `${utilisation.in_use_pct}%`,
      href: "/reports/utilisation", hint: "Share of assets in use",
    },
  ];

  const toneClass = {
    default: "text-gray-800 dark:text-white/90",
    error: "text-error-500",
    warning: "text-warning-500",
  } as const;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <Link
          key={tile.label}
          to={tile.href}
          className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-500/40"
        >
          <span className="text-theme-xs text-gray-500 dark:text-gray-400">
            {tile.label}
          </span>
          <p className={`mt-2 text-title-sm font-bold ${toneClass[tile.tone ?? "default"]}`}>
            {tile.value}
          </p>
          {tile.hint && (
            <span className="mt-1 block text-theme-xs text-gray-400">{tile.hint}</span>
          )}
        </Link>
      ))}
    </div>
  );
}
```

`web/src/components/dashboard/StatusDonut.tsx`:

```tsx
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { STATUS_COLORS } from "../../lib/palette";
import { statusLabel } from "../assets/StatusBadge";
import type { AssetStatus } from "../../api/types";

export default function StatusDonut({
  data,
}: { data: { status: AssetStatus; count: number }[] }) {
  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
        No assets to chart yet.
      </p>
    );
  }

  const options: ApexOptions = {
    chart: { type: "donut", fontFamily: "inherit" },
    labels: data.map((d) => statusLabel(d.status)),
    colors: data.map((d) => STATUS_COLORS[d.status] ?? "#9ca3af"),
    legend: { position: "bottom", fontSize: "13px" },
    dataLabels: { enabled: false },
    stroke: { width: 2 },
    plotOptions: {
      pie: {
        donut: {
          size: "62%",
          labels: {
            show: true,
            total: {
              show: true, label: "Assets",
              formatter: () =>
                data.reduce((sum, d) => sum + d.count, 0).toLocaleString("en-GB"),
            },
          },
        },
      },
    },
  };

  return (
    <Chart options={options} series={data.map((d) => d.count)} type="donut" height={300} />
  );
}
```

`web/src/components/dashboard/CategoryBars.tsx`:

```tsx
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { PALETTE } from "../../lib/palette";

export default function CategoryBars({
  data,
}: { data: { category: string; count: number }[] }) {
  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
        No categories yet.
      </p>
    );
  }

  const options: ApexOptions = {
    chart: { type: "bar", fontFamily: "inherit", toolbar: { show: false } },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "60%" } },
    colors: [PALETTE[0]],
    xaxis: { categories: data.map((d) => d.category) },
    dataLabels: { enabled: true },
    grid: { borderColor: "#e5e7eb", strokeDashArray: 3 },
  };

  return (
    <Chart
      options={options}
      series={[{ name: "Assets", data: data.map((d) => d.count) }]}
      type="bar"
      height={Math.max(220, data.length * 42)}
    />
  );
}
```

`web/src/components/dashboard/RecentActivity.tsx`:

```tsx
import { Link } from "react-router";
import { describeEvent } from "../assets/HistoryTimeline";
import type { AuditEvent } from "../../api/types";

const ago = (iso: string) => {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
};

export default function RecentActivity({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        Nothing has happened yet. Activity appears here as people use the register.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {events.map((event) => (
        <li key={event.id} className="flex items-baseline gap-3 py-3 first:pt-0 last:pb-0">
          <span className="text-sm text-gray-700 dark:text-gray-300">
            <strong className="font-medium text-gray-800 dark:text-white/90">
              {event.actor_label ?? "System"}
            </strong>{" "}
            {describeEvent(event)}
            {event.asset_id && event.asset_name && (
              <>
                {" — "}
                <Link
                  to={`/assets/${event.asset_id}`}
                  className="text-brand-500 hover:text-brand-600"
                >
                  {event.asset_name}
                </Link>
              </>
            )}
          </span>
          <time className="ml-auto shrink-0 text-theme-xs text-gray-400" dateTime={event.created_at}>
            {ago(event.created_at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
```

`web/src/components/dashboard/ExpiringSoon.tsx`:

```tsx
import { Link } from "react-router";
import Badge from "../ui/badge/Badge";
import type { DashboardSummary } from "../../api/types";

const FIELD_LABEL: Record<string, string> = {
  warranty_end: "Warranty",
  license_expiry: "Licence",
  next_service_at: "Service",
};

export default function ExpiringSoon({
  items,
}: { items: DashboardSummary["expiring_soon"] }) {
  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        Nothing expires in the next 90 days.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {items.map((item) => (
        <li key={`${item.id}-${item.field}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <Link
              to={`/assets/${item.id}`}
              className="block truncate text-sm font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
            >
              {item.name}
            </Link>
            <span className="text-theme-xs text-gray-500 dark:text-gray-400">
              {FIELD_LABEL[item.field] ?? item.field} · {item.expires_on}
            </span>
          </div>
          <Badge color={item.days_left <= 30 ? "error" : "warning"} size="sm">
            {item.days_left}d
          </Badge>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Implement the dashboard page**

Replace `web/src/pages/Dashboard/Home.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import ComponentCard from "../../components/common/ComponentCard";
import KpiTiles from "../../components/dashboard/KpiTiles";
import StatusDonut from "../../components/dashboard/StatusDonut";
import CategoryBars from "../../components/dashboard/CategoryBars";
import RecentActivity from "../../components/dashboard/RecentActivity";
import ExpiringSoon from "../../components/dashboard/ExpiringSoon";
import { dashboardApi } from "../../api/dashboard";
import type { DashboardSummary } from "../../api/types";

export default function Home() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dashboardApi.summary()
      .then(setSummary)
      .catch(() => setError("Could not load the dashboard."));
  }, []);

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
        {error}
      </div>
    );
  }
  if (!summary) {
    return <p className="p-8 text-sm text-gray-500">Loading dashboard…</p>;
  }

  // A brand-new organisation gets an onboarding path, not six zeroes.
  if (summary.totals.assets === 0) {
    return (
      <>
        <PageMeta title="Dashboard | AMS" description="Asset management dashboard" />
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            Welcome — your register is empty
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
            Start by setting up the categories your assets fall into, then bring in your
            existing register from a spreadsheet.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link to="/import" className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600">
              Import a spreadsheet
            </Link>
            <Link to="/categories" className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700">
              Set up categories
            </Link>
            <Link to="/assets/new" className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700">
              Add one asset
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title="Dashboard | AMS" description="Asset management dashboard" />

      <div className="space-y-5">
        <KpiTiles totals={summary.totals} utilisation={summary.utilisation} />

        <div className="grid gap-5 lg:grid-cols-2">
          <ComponentCard title="By status" desc="Where the register sits right now.">
            <StatusDonut data={summary.by_status} />
          </ComponentCard>
          <ComponentCard title="By category" desc="How the register splits across asset types.">
            <CategoryBars data={summary.by_category} />
          </ComponentCard>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <ComponentCard title="Recent activity" desc="The last fifteen recorded events.">
            <RecentActivity events={summary.recent_activity} />
          </ComponentCard>
          <ComponentCard title="Expiring soon" desc="Warranties, licences and services due in 90 days.">
            <ExpiringSoon items={summary.expiring_soon} />
          </ComponentCard>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/dashboard`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/dashboard.ts web/src/lib/palette.ts web/src/components/dashboard web/src/pages/Dashboard
git commit -m "feat: dashboard with clickable kpi tiles, charts and activity feed"
```

---

### Task 28: Import wizard

**Files:**
- Create: `web/src/api/imports.ts`
- Create: `web/src/components/import/UploadStep.tsx`, `MappingStep.tsx`, `PreviewStep.tsx`, `ResultStep.tsx`
- Create: `web/src/pages/Import/ImportWizard.tsx`
- Test: `web/src/components/import/MappingStep.test.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/imports` (headers/suggestion pass, dry-run pass, commit pass), `react-dropzone`.
- Produces:
  - `importsApi.inspect(file, categoryId)`, `.run(file, mapping, categoryId, dryRun)`
  - `<UploadStep onInspected />`, `<MappingStep headers sample suggested value onChange schema />`, `<PreviewStep result onCommit onBack />`, `<ResultStep result />`

**Design note:** four steps — upload, map, dry-run preview, commit. The dry run is not
optional. A bulk import that cannot be previewed will eventually destroy someone's
register, and the preview is what makes the destructive step safe.

- [ ] **Step 1: Write the failing test**

`web/src/components/import/MappingStep.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MappingStep from "./MappingStep";
import type { FieldDef } from "../../api/types";

const headers = ["Asset Name", "Serial Number", "Cost Centre"];
const sample = [
  { "Asset Name": "Dell Latitude", "Serial Number": "DL-1", "Cost Centre": "IT-01" },
];
const schema: FieldDef[] = [
  { key: "os", label: "Operating System", type: "string", required: false },
];

const setup = (over: Partial<React.ComponentProps<typeof MappingStep>> = {}) => {
  const onChange = vi.fn();
  render(
    <MappingStep
      headers={headers}
      sample={sample}
      schema={schema}
      value={{ "Asset Name": "name", "Serial Number": "serial_no" }}
      onChange={onChange}
      {...over}
    />,
  );
  return { onChange };
};

describe("MappingStep", () => {
  it("lists every column from the file", () => {
    setup();
    for (const header of headers) expect(screen.getByText(header)).toBeInTheDocument();
  });

  it("shows a sample value so the user can see what they are mapping", () => {
    setup();
    expect(screen.getByText("Dell Latitude")).toBeInTheDocument();
  });

  it("preselects the suggested target field", () => {
    setup();
    expect(screen.getByLabelText(/Map Asset Name/)).toHaveValue("name");
  });

  it("offers custom fields from the chosen category", () => {
    setup();
    const select = screen.getByLabelText(/Map Cost Centre/) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain("custom.os");
  });

  it("lets a column be skipped", () => {
    setup();
    const select = screen.getByLabelText(/Map Cost Centre/) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toContain("");
  });

  it("reports a mapping change", async () => {
    const { onChange } = setup();
    await userEvent.selectOptions(screen.getByLabelText(/Map Cost Centre/), "custom.os");
    expect(onChange).toHaveBeenCalledWith("Cost Centre", "custom.os");
  });

  it("warns when no column is mapped to name", () => {
    setup({ value: { "Serial Number": "serial_no" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/name/i);
  });

  it("does not warn once name is mapped", () => {
    setup();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/import`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the imports API module**

`web/src/api/imports.ts`:

```ts
import { api } from "./client";

export interface InspectResult {
  headers: string[];
  row_count: number;
  sample: Record<string, string>[];
  suggested_mapping: Record<string, string>;
}

export interface ImportResult {
  jobId: string;
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
```

- [ ] **Step 4: Implement the wizard steps**

`web/src/components/import/UploadStep.tsx`:

```tsx
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import Label from "../form/Label";
import type { Category } from "../../api/types";

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  categories: Category[];
  categoryId: string;
  onCategory: (id: string) => void;
  onFile: (file: File) => void;
  busy: boolean;
}

export default function UploadStep({
  categories, categoryId, onCategory, onFile, busy,
}: Props) {
  const [rejected, setRejected] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[], fileRejections: unknown[]) => {
    if (fileRejections.length > 0) {
      setRejected("That file type is not supported. Upload a .csv, .xlsx or .xls file.");
      return;
    }
    setRejected(null);
    if (accepted[0]) onFile(accepted[0]);
  }, [onFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor="import-category">Category for the imported assets</Label>
        <select
          id="import-category" className={selectClass}
          value={categoryId} onChange={(e) => onCategory(e.target.value)}
        >
          <option value="">Uncategorised</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <p className="mt-1 text-theme-xs text-gray-400">
          Choosing a category lets you map spreadsheet columns onto its custom fields.
        </p>
      </div>

      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition ${
          isDragActive
            ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
            : "border-gray-300 hover:border-brand-400 dark:border-gray-700"
        }`}
      >
        <input {...getInputProps()} />
        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
          {busy
            ? "Reading the file…"
            : isDragActive
              ? "Drop the file here"
              : "Drag a spreadsheet here, or click to choose one"}
        </p>
        <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
          CSV, XLSX or XLS · up to 10 MB · nothing is saved until you confirm
        </p>
      </div>

      {rejected && (
        <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
          {rejected}
        </p>
      )}
    </div>
  );
}
```

`web/src/components/import/MappingStep.tsx`:

```tsx
import type { FieldDef } from "../../api/types";

const CORE_FIELDS: { value: string; label: string }[] = [
  { value: "name", label: "Name (required)" },
  { value: "asset_tag", label: "Asset tag" },
  { value: "serial_no", label: "Serial number" },
  { value: "status", label: "Status" },
  { value: "description", label: "Description" },
  { value: "purchase_date", label: "Purchase date" },
  { value: "purchase_cost", label: "Purchase cost" },
  { value: "currency", label: "Currency" },
];

const selectClass =
  "h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  headers: string[];
  sample: Record<string, string>[];
  schema: FieldDef[];
  value: Record<string, string>;
  onChange: (header: string, target: string) => void;
}

export default function MappingStep({ headers, sample, schema, value, onChange }: Props) {
  const nameMapped = Object.values(value).includes("name");

  return (
    <div className="space-y-4">
      {!nameMapped && (
        <div role="alert" className="rounded-lg border border-warning-500 bg-warning-50 px-4 py-3 text-sm text-warning-600 dark:bg-warning-500/10">
          Map one column to <strong>Name</strong> — every asset needs one, and rows
          without it will be skipped.
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full">
          <thead className="bg-gray-50 dark:bg-white/[0.03]">
            <tr>
              {["Column in your file", "First value", "Import as"].map((label) => (
                <th
                  key={label}
                  className="px-5 py-3 text-left text-theme-xs font-medium text-gray-500 dark:text-gray-400"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {headers.map((header) => (
              <tr key={header}>
                <td className="px-5 py-3 text-sm font-medium text-gray-800 dark:text-white/90">
                  {header}
                </td>
                <td className="max-w-[16rem] truncate px-5 py-3 text-sm text-gray-500 dark:text-gray-400">
                  {sample[0]?.[header] || "—"}
                </td>
                <td className="px-5 py-3">
                  <select
                    aria-label={`Map ${header}`}
                    className={selectClass}
                    value={value[header] ?? ""}
                    onChange={(e) => onChange(header, e.target.value)}
                  >
                    <option value="">Skip this column</option>
                    <optgroup label="Asset fields">
                      {CORE_FIELDS.map((field) => (
                        <option key={field.value} value={field.value}>{field.label}</option>
                      ))}
                    </optgroup>
                    {schema.length > 0 && (
                      <optgroup label="Category fields">
                        {schema.map((field) => (
                          <option key={field.key} value={`custom.${field.key}`}>
                            {field.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

`web/src/components/import/PreviewStep.tsx`:

```tsx
import type { ImportResult } from "../../api/imports";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "error" }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 text-center dark:border-gray-800">
      <p className={`text-title-sm font-bold ${
        tone === "error" ? "text-error-500" : "text-gray-800 dark:text-white/90"
      }`}>
        {value.toLocaleString("en-GB")}
      </p>
      <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}

interface Props {
  result: ImportResult;
  committing: boolean;
  onCommit: () => void;
  onBack: () => void;
}

export default function PreviewStep({ result, committing, onCommit, onBack }: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-blue-light-50 px-4 py-3 text-sm text-blue-light-600 dark:bg-blue-light-500/10">
        This was a dry run — <strong>nothing has been saved yet</strong>. Review the
        numbers below, then confirm.
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Rows in file" value={result.total} />
        <Stat label="Will be created" value={result.created} />
        <Stat label="Will be updated" value={result.updated} />
        <Stat
          label="Will be skipped" value={result.skipped}
          tone={result.skipped > 0 ? "error" : undefined}
        />
      </div>

      {result.errors.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-error-500/40">
          <div className="bg-error-50 px-5 py-3 text-sm font-medium text-error-600 dark:bg-error-500/10">
            {result.errors.length} row{result.errors.length === 1 ? "" : "s"} cannot be
            imported. Fix them in the file, or continue and import the rest.
          </div>
          <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
            {result.errors.slice(0, 100).map((error, index) => (
              <li key={index} className="px-5 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                <span className="font-mono text-theme-xs text-gray-400">
                  Row {error.row}
                </span>{" "}
                — <strong>{error.field}</strong>: {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCommit}
          disabled={committing || result.created + result.updated === 0}
          className="rounded-lg bg-brand-500 px-5 py-3.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {committing
            ? "Importing…"
            : `Import ${(result.created + result.updated).toLocaleString("en-GB")} assets`}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg px-5 py-3.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
        >
          Back to mapping
        </button>
      </div>
    </div>
  );
}
```

`web/src/components/import/ResultStep.tsx`:

```tsx
import { Link } from "react-router";
import type { ImportResult } from "../../api/imports";

export default function ResultStep({
  result, onAnother,
}: { result: ImportResult; onAnother: () => void }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-50 dark:bg-success-500/15">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 13l4 4L19 7" stroke="#10b981" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="mt-4 text-lg font-medium text-gray-800 dark:text-white/90">
        Import finished
      </h3>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        {result.created.toLocaleString("en-GB")} created ·{" "}
        {result.updated.toLocaleString("en-GB")} updated ·{" "}
        {result.skipped.toLocaleString("en-GB")} skipped
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link
          to="/assets"
          className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          View the register
        </Link>
        <button
          type="button"
          onClick={onAnother}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
        >
          Import another file
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement the wizard page**

`web/src/pages/Import/ImportWizard.tsx`:

```tsx
import { useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import UploadStep from "../../components/import/UploadStep";
import MappingStep from "../../components/import/MappingStep";
import PreviewStep from "../../components/import/PreviewStep";
import ResultStep from "../../components/import/ResultStep";
import { importsApi, type ImportResult, type InspectResult } from "../../api/imports";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";
import type { Category } from "../../api/types";

type Step = "upload" | "map" | "preview" | "done";

const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "map", label: "Map columns" },
  { key: "preview", label: "Preview" },
  { key: "done", label: "Done" },
];

export default function ImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [inspected, setInspected] = useState<InspectResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void catalogApi.categories().then(setCategories).catch(() => undefined);
  }, []);

  const schema =
    categories.find((c) => c.id === categoryId)?.field_schema.fields ?? [];

  async function onFile(chosen: File) {
    setBusy(true);
    setError(null);
    try {
      const inspection = await importsApi.inspect(chosen, categoryId);
      setFile(chosen);
      setInspected(inspection);
      setMapping(inspection.suggested_mapping);
      setStep("map");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not read that file.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function runDryRun() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setDryRun(await importsApi.run(file, mapping, categoryId, true));
      setStep("preview");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await importsApi.run(file, mapping, categoryId, false));
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setInspected(null);
    setMapping({});
    setDryRun(null);
    setResult(null);
  }

  const activeIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <>
      <PageMeta title="Import | AMS" description="Bulk import assets" />
      <PageBreadcrumb pageTitle="Import" />

      <ol className="mb-6 flex flex-wrap items-center gap-2">
        {STEPS.map((entry, index) => (
          <li key={entry.key} className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-theme-xs font-medium ${
                index <= activeIndex
                  ? "bg-brand-500 text-white"
                  : "bg-gray-100 text-gray-500 dark:bg-white/[0.05] dark:text-gray-400"
              }`}
            >
              {index + 1}
            </span>
            <span className={`text-sm ${
              index === activeIndex
                ? "font-medium text-gray-800 dark:text-white/90"
                : "text-gray-500 dark:text-gray-400"
            }`}>
              {entry.label}
            </span>
            {index < STEPS.length - 1 && (
              <span aria-hidden className="mx-2 h-px w-8 bg-gray-200 dark:bg-gray-800" />
            )}
          </li>
        ))}
      </ol>

      {error && (
        <div role="alert" className="mb-5 rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
          {error}
        </div>
      )}

      {step === "upload" && (
        <ComponentCard title="Choose a file" desc="CSV or Excel, up to 10 MB.">
          <UploadStep
            categories={categories} categoryId={categoryId}
            onCategory={setCategoryId} onFile={onFile} busy={busy}
          />
        </ComponentCard>
      )}

      {step === "map" && inspected && (
        <ComponentCard
          title="Map your columns"
          desc={`${inspected.row_count.toLocaleString("en-GB")} rows found. Confirm where each column should land.`}
        >
          <MappingStep
            headers={inspected.headers}
            sample={inspected.sample}
            schema={schema}
            value={mapping}
            onChange={(header, target) =>
              setMapping((current) => ({ ...current, [header]: target }))
            }
          />
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button" onClick={runDryRun} disabled={busy}
              className="rounded-lg bg-brand-500 px-5 py-3.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? "Checking…" : "Preview the import"}
            </button>
            <button
              type="button" onClick={reset}
              className="rounded-lg px-5 py-3.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
            >
              Start over
            </button>
          </div>
        </ComponentCard>
      )}

      {step === "preview" && dryRun && (
        <ComponentCard title="Preview" desc="Nothing is saved until you confirm.">
          <PreviewStep
            result={dryRun} committing={busy}
            onCommit={commit} onBack={() => setStep("map")}
          />
        </ComponentCard>
      )}

      {step === "done" && result && <ResultStep result={result} onAnother={reset} />}
    </>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/import`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/imports.ts web/src/components/import web/src/pages/Import
git commit -m "feat: four-step import wizard with column mapping and dry-run preview"
```

---

### Task 29: Report gallery, viewer and scheduling UI

**Files:**
- Create: `web/src/api/reports.ts`
- Create: `web/src/components/reports/ReportChart.tsx`, `ReportTable.tsx`, `ReportFilters.tsx`, `ScheduleDialog.tsx`
- Create: `web/src/pages/Reports/ReportGallery.tsx`, `web/src/pages/Reports/ReportViewer.tsx`
- Test: `web/src/components/reports/ReportTable.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/reports`, `GET /api/v1/reports/{key}?format=…`, `/api/v1/saved-reports`, `/api/admin/report-schedules`.
- Produces:
  - `reportsApi.list()`, `.run(key, params)`, `.download(key, params, format)`, `.saved()`, `.save(input)`, `.schedules()`, `.schedule(input)`
  - `<ReportChart result />` — renders the server's `ChartSpec` through ApexCharts
  - `<ReportTable result />` — formats each column by its declared type
  - `<ScheduleDialog savedReportId ... />`

**Design note:** the chart is not chosen here. The server's report definition declares a
`ChartSpec`, and this component renders it — which is why the on-screen chart and the
PDF's chart are the same chart.

- [ ] **Step 1: Write the failing test**

`web/src/components/reports/ReportTable.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportTable from "./ReportTable";
import type { ReportResult } from "../../api/types";

const result: ReportResult = {
  key: "assets-by-category", name: "Assets by category", description: "d",
  generated_at: "2026-09-03T10:00:00Z", filter_summary: "All assets",
  columns: [
    { key: "category", label: "Category", type: "string" },
    { key: "count", label: "Assets", type: "number" },
    { key: "value", label: "Value", type: "money" },
    { key: "share", label: "Share", type: "percent" },
    { key: "as_of", label: "As of", type: "date" },
  ],
  chart: { type: "bar", categoryKey: "category", valueKeys: ["count"], valueLabel: "Assets" },
  rows: [
    { category: "IT", count: 42, value: "520000000", share: 79.2, as_of: "2026-09-01" },
    { category: "Plant", count: 11, value: null, share: 20.8, as_of: null },
  ],
  totals: { category: "Total", count: 53, value: "520000000", share: 100, as_of: null },
};

describe("ReportTable", () => {
  it("renders a header per column", () => {
    render(<ReportTable result={result} />);
    for (const column of result.columns) {
      expect(screen.getByText(column.label)).toBeInTheDocument();
    }
  });

  it("renders a row per data row", () => {
    render(<ReportTable result={result} />);
    expect(screen.getByText("IT")).toBeInTheDocument();
    expect(screen.getByText("Plant")).toBeInTheDocument();
  });

  it("formats a money column", () => {
    render(<ReportTable result={result} />);
    expect(screen.getByText(/520[.,]000[.,]000/)).toBeInTheDocument();
  });

  it("formats a percent column", () => {
    render(<ReportTable result={result} />);
    expect(screen.getByText("79.2%")).toBeInTheDocument();
  });

  it("formats a date column readably", () => {
    render(<ReportTable result={result} />);
    expect(screen.getByText(/1 Sep 2026/)).toBeInTheDocument();
  });

  it("shows a dash for an empty cell", () => {
    render(<ReportTable result={result} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("renders the totals row when the report has one", () => {
    render(<ReportTable result={result} />);
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  it("says so plainly when a report returns no rows", () => {
    render(<ReportTable result={{ ...result, rows: [], totals: null }} />);
    expect(screen.getByText(/No rows/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/reports`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reports API module**

`web/src/api/reports.ts`:

```ts
import { api, downloadBlob, type Params } from "./client";
import type { ChartSpec, ReportColumn, ReportResult } from "./types";

export interface ReportSummary {
  key: string;
  name: string;
  description: string;
  columns: ReportColumn[];
  chart: ChartSpec;
  formats: string[];
}

export interface SavedReport {
  id: string;
  name: string;
  report_key: string;
  params: Record<string, unknown>;
  created_at: string;
}

export interface ReportSchedule {
  id: string;
  saved_report_id: string;
  report_name?: string;
  format: "csv" | "xlsx" | "pdf" | "png";
  cadence: "daily" | "weekly" | "monthly";
  day_of_week: number | null;
  day_of_month: number | null;
  hour_utc: number;
  recipients: string[];
  active: boolean;
  last_run_at: string | null;
}

export const reportsApi = {
  list: () => api.get<ReportSummary[]>("/api/v1/reports"),

  run: (key: string, params: Params) =>
    api.get<ReportResult>(`/api/v1/reports/${key}`, { ...params, format: "json" }),

  download: async (
    key: string,
    params: Params,
    format: "csv" | "xlsx" | "pdf" | "png",
  ) => {
    const blob = await api.blob(`/api/v1/reports/${key}`, { ...params, format });
    downloadBlob(blob, `${key}-${new Date().toISOString().slice(0, 10)}.${format}`);
  },

  saved: () => api.get<SavedReport[]>("/api/v1/saved-reports"),
  save: (input: { name: string; report_key: string; params: Record<string, unknown> }) =>
    api.post<SavedReport>("/api/v1/saved-reports", input),
  removeSaved: (id: string) => api.del(`/api/v1/saved-reports/${id}`),

  schedules: () => api.get<ReportSchedule[]>("/api/admin/report-schedules"),
  schedule: (input: Omit<ReportSchedule, "id" | "last_run_at" | "report_name">) =>
    api.post<ReportSchedule>("/api/admin/report-schedules", input),
  removeSchedule: (id: string) => api.del(`/api/admin/report-schedules/${id}`),
};
```

- [ ] **Step 4: Implement the report components**

`web/src/components/reports/ReportTable.tsx`:

```tsx
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "../ui/table";
import type { ReportColumn, ReportResult } from "../../api/types";

const NUMERIC = new Set(["number", "money", "percent"]);

export function formatCell(column: ReportColumn, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  switch (column.type) {
    case "money":
      return new Intl.NumberFormat("id-ID", {
        style: "currency", currency: "IDR", maximumFractionDigits: 0,
      }).format(Number(raw));
    case "number":
      return Number(raw).toLocaleString("en-GB");
    case "percent":
      return `${Number(raw).toFixed(1)}%`;
    case "date": {
      const date = new Date(String(raw));
      return Number.isNaN(date.getTime())
        ? String(raw)
        : date.toLocaleDateString("en-GB", {
            day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
          });
    }
    default:
      return String(raw);
  }
}

export default function ReportTable({ result }: { result: ReportResult }) {
  if (result.rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
        No rows matched this report's filters.
      </p>
    );
  }

  return (
    <div className="max-w-full overflow-x-auto">
      <Table>
        <TableHeader className="border-b border-gray-100 dark:border-gray-800">
          <TableRow>
            {result.columns.map((column) => (
              <TableCell
                key={column.key}
                isHeader
                className={`px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 ${
                  NUMERIC.has(column.type) ? "text-right" : "text-left"
                }`}
              >
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
          {result.rows.map((row, index) => (
            <TableRow key={index}>
              {result.columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={`px-5 py-3 text-sm text-gray-700 dark:text-gray-300 ${
                    NUMERIC.has(column.type) ? "text-right" : "text-left"
                  }`}
                >
                  {formatCell(column, row[column.key])}
                </TableCell>
              ))}
            </TableRow>
          ))}

          {result.totals && (
            <TableRow className="border-t-2 border-gray-200 font-medium dark:border-gray-700">
              {result.columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={`px-5 py-3 text-sm text-gray-800 dark:text-white/90 ${
                    NUMERIC.has(column.type) ? "text-right" : "text-left"
                  }`}
                >
                  {formatCell(column, result.totals![column.key])}
                </TableCell>
              ))}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

`web/src/components/reports/ReportChart.tsx`:

```tsx
import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { colorFor, PALETTE } from "../../lib/palette";
import type { ReportResult } from "../../api/types";

/** Renders the server's ChartSpec, so screen and PDF show the same chart. */
export default function ReportChart({ result }: { result: ReportResult }) {
  const { chart, rows } = result;
  if (chart.type === "none" || rows.length === 0) return null;

  const categories = rows.map((row) => String(row[chart.categoryKey] ?? ""));
  const values = rows.map((row) => Number(row[chart.valueKeys[0]] ?? 0));

  if (chart.type === "donut") {
    const options: ApexOptions = {
      chart: { type: "donut", fontFamily: "inherit" },
      labels: categories,
      colors: categories.map((label, i) => colorFor(label, i)),
      legend: { position: "bottom" },
      dataLabels: { enabled: false },
      plotOptions: { pie: { donut: { size: "62%" } } },
    };
    return <Chart options={options} series={values} type="donut" height={320} />;
  }

  const horizontal = chart.type === "bar";
  const type = chart.type === "line" ? "line" : "bar";
  const options: ApexOptions = {
    chart: { type, fontFamily: "inherit", toolbar: { show: false } },
    colors: [PALETTE[0]],
    plotOptions: { bar: { horizontal, borderRadius: 4, barHeight: "60%" } },
    xaxis: { categories },
    stroke: type === "line" ? { curve: "smooth", width: 2 } : undefined,
    markers: type === "line" ? { size: 4 } : undefined,
    dataLabels: { enabled: type !== "line" },
    grid: { borderColor: "#e5e7eb", strokeDashArray: 3 },
  };

  return (
    <Chart
      options={options}
      series={[{ name: chart.valueLabel, data: values }]}
      type={type}
      height={horizontal ? Math.max(260, rows.length * 40) : 320}
    />
  );
}
```

`web/src/components/reports/ScheduleDialog.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { Modal } from "../ui/modal";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import { reportsApi } from "../../api/reports";
import { ApiError } from "../../api/client";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  savedReportId: string;
  isOpen: boolean;
  onClose: () => void;
  onDone: () => void;
}

export default function ScheduleDialog({ savedReportId, isOpen, onClose, onDone }: Props) {
  const [format, setFormat] = useState<"pdf" | "xlsx" | "csv" | "png">("pdf");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(8);
  const [recipients, setRecipients] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await reportsApi.schedule({
        saved_report_id: savedReportId,
        format, cadence,
        day_of_week: cadence === "weekly" ? dayOfWeek : null,
        day_of_month: cadence === "monthly" ? dayOfMonth : null,
        hour_utc: hour,
        recipients: recipients.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean),
        active: true,
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not create the schedule.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
        Email this report on a schedule
      </h3>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        The report is generated and sent as an attachment. Times are UTC.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="schedule-format">Format</Label>
            <select
              id="schedule-format" className={selectClass} value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
            >
              <option value="pdf">PDF</option>
              <option value="xlsx">Excel</option>
              <option value="csv">CSV</option>
              <option value="png">Chart image</option>
            </select>
          </div>
          <div>
            <Label htmlFor="schedule-cadence">How often</Label>
            <select
              id="schedule-cadence" className={selectClass} value={cadence}
              onChange={(e) => setCadence(e.target.value as typeof cadence)}
            >
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </div>

          {cadence === "weekly" && (
            <div>
              <Label htmlFor="schedule-dow">Day</Label>
              <select
                id="schedule-dow" className={selectClass} value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
              >
                {DAYS.map((day, index) => (
                  <option key={day} value={index}>{day}</option>
                ))}
              </select>
            </div>
          )}

          {cadence === "monthly" && (
            <div>
              <Label htmlFor="schedule-dom">Day of month</Label>
              <Input
                id="schedule-dom" type="number" min="1" max="28"
                value={String(dayOfMonth)}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
              />
              <p className="mt-1 text-theme-xs text-gray-400">
                1–28, so the schedule fires in February too.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="schedule-hour">Hour (UTC)</Label>
            <Input
              id="schedule-hour" type="number" min="0" max="23"
              value={String(hour)}
              onChange={(e) => setHour(Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="schedule-recipients">Send to</Label>
          <Input
            id="schedule-recipients" type="text" value={recipients}
            placeholder="ops@example.com, finance@example.com"
            onChange={(e) => setRecipients(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button" onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit" disabled={saving}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Create schedule"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 5: Implement the gallery and viewer pages**

`web/src/pages/Reports/ReportGallery.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import { reportsApi, type ReportSummary, type SavedReport, type ReportSchedule } from "../../api/reports";
import { useAuth } from "../../context/AuthContext";

export default function ReportGallery() {
  const { can } = useAuth();
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);

  useEffect(() => {
    void reportsApi.list().then(setReports).catch(() => undefined);
    void reportsApi.saved().then(setSaved).catch(() => undefined);
    if (can("admin")) {
      void reportsApi.schedules().then(setSchedules).catch(() => undefined);
    }
  }, [can]);

  return (
    <>
      <PageMeta title="Reports | AMS" description="Reports and exports" />
      <PageBreadcrumb pageTitle="Reports" />

      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => (
            <Link
              key={report.key}
              to={`/reports/${report.key}`}
              className="rounded-2xl border border-gray-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03] dark:hover:border-brand-500/40"
            >
              <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
                {report.name}
              </h3>
              <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">
                {report.description}
              </p>
              <p className="mt-3 text-theme-xs uppercase tracking-wide text-gray-400">
                {report.formats.join(" · ")}
              </p>
            </Link>
          ))}
        </div>

        {saved.length > 0 && (
          <ComponentCard title="Saved reports" desc="Your named filter sets.">
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {saved.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0">
                  <Link
                    to={`/reports/${item.report_key}?${new URLSearchParams(
                      item.params as Record<string, string>,
                    )}`}
                    className="text-sm font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                  >
                    {item.name}
                  </Link>
                  <button
                    type="button"
                    onClick={async () => {
                      await reportsApi.removeSaved(item.id);
                      setSaved((current) => current.filter((s) => s.id !== item.id));
                    }}
                    className="ml-auto text-theme-xs text-gray-400 hover:text-error-500"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </ComponentCard>
        )}

        {can("admin") && schedules.length > 0 && (
          <ComponentCard title="Scheduled deliveries" desc="Reports emailed automatically.">
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {schedules.map((schedule) => (
                <li key={schedule.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {schedule.report_name ?? "Report"}
                  </span>
                  <span className="text-theme-xs text-gray-500 dark:text-gray-400">
                    {schedule.cadence} · {String(schedule.hour_utc).padStart(2, "0")}:00 UTC ·{" "}
                    {schedule.format.toUpperCase()} · {schedule.recipients.join(", ")}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await reportsApi.removeSchedule(schedule.id);
                      setSchedules((current) => current.filter((s) => s.id !== schedule.id));
                    }}
                    className="ml-auto text-theme-xs text-gray-400 hover:text-error-500"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </ComponentCard>
        )}
      </div>
    </>
  );
}
```

`web/src/pages/Reports/ReportViewer.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import ReportChart from "../../components/reports/ReportChart";
import ReportTable from "../../components/reports/ReportTable";
import ScheduleDialog from "../../components/reports/ScheduleDialog";
import { useModal } from "../../hooks/useModal";
import { reportsApi } from "../../api/reports";
import { useAuth } from "../../context/AuthContext";
import type { ReportResult } from "../../api/types";

export default function ReportViewer() {
  const { key = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useAuth();
  const scheduleModal = useModal();

  const [result, setResult] = useState<ReportResult | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = Object.fromEntries(searchParams);

  const load = useCallback(() => {
    reportsApi.run(key, params)
      .then(setResult)
      .catch(() => setError("Could not run this report."));
    // params is derived from searchParams; depending on the string keeps this stable.
  }, [key, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(load, [load]);

  async function saveView() {
    const name = window.prompt("Name this saved report");
    if (!name) return;
    const saved = await reportsApi.save({ name, report_key: key, params });
    setSavedId(saved.id);
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
        {error}
      </div>
    );
  }
  if (!result) return <p className="p-8 text-sm text-gray-500">Running report…</p>;

  const download = (format: "csv" | "xlsx" | "pdf" | "png") =>
    void reportsApi.download(key, params, format);

  const buttonClass =
    "rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset " +
    "ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 " +
    "dark:hover:bg-white/[0.03]";

  return (
    <>
      <PageMeta title={`${result.name} | AMS`} description={result.description} />
      <PageBreadcrumb pageTitle={result.name} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{result.description}</p>
          <p className="text-theme-xs text-gray-400">
            {result.filter_summary} · {result.rows.length.toLocaleString("en-GB")} rows ·
            generated {new Date(result.generated_at).toLocaleString("en-GB")}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap gap-2">
          {(["csv", "xlsx", "pdf", "png"] as const).map((format) => (
            <button key={format} type="button" className={buttonClass}
                    onClick={() => download(format)}>
              {format.toUpperCase()}
            </button>
          ))}
          <button type="button" className={buttonClass} onClick={() => void saveView()}>
            Save this view
          </button>
          {can("admin") && savedId && (
            <button
              type="button"
              onClick={scheduleModal.openModal}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Schedule by email
            </button>
          )}
        </div>
      </div>

      <div className="space-y-5">
        {result.chart.type !== "none" && (
          <ComponentCard title="Chart">
            <ReportChart result={result} />
          </ComponentCard>
        )}
        <ComponentCard title="Data">
          <ReportTable result={result} />
        </ComponentCard>
      </div>

      {savedId && (
        <ScheduleDialog
          savedReportId={savedId}
          isOpen={scheduleModal.isOpen}
          onClose={scheduleModal.closeModal}
          onDone={scheduleModal.closeModal}
        />
      )}
    </>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/reports`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/reports.ts web/src/components/reports web/src/pages/Reports
git commit -m "feat: report gallery, viewer with charts and multi-format export and scheduling"
```

---

### Task 30: Settings — email providers, templates, notification rules

**Files:**
- Create: `web/src/api/settings.ts`
- Create: `web/src/components/settings/ProviderDialog.tsx`, `ProviderList.tsx`, `TemplateEditor.tsx`, `RuleList.tsx`
- Create: `web/src/pages/Settings/EmailSettings.tsx`, `web/src/pages/Settings/NotificationSettings.tsx`
- Test: `web/src/components/settings/ProviderDialog.test.tsx`

**Interfaces:**
- Consumes: `/api/admin/email/providers`, `…/[id]/test`, `…/templates`, `…/messages`, `/api/admin/notifications/rules`, `…/preferences`.
- Produces:
  - `settingsApi.providers()`, `.createProvider()`, `.updateProvider()`, `.deleteProvider()`, `.testProvider(id, to)`, `.templates()`, `.saveTemplate()`, `.messages()`, `.rules()`, `.saveRule()`, `.deleteRule()`, `.preferences()`, `.savePreferences()`
  - `PROVIDER_FIELDS: Record<ProviderType, {key,label,type,secret}[]>` — the per-type config form
  - `<ProviderDialog />`, `<ProviderList />`, `<TemplateEditor />`, `<RuleList />`

**Design note:** the API returns secrets masked (`SG.••••4f2a`). The dialog shows the
mask as a placeholder and only sends a secret field when the user actually types a new
value — so saving a provider to change its priority does not overwrite its API key with
the mask.

- [ ] **Step 1: Write the failing test**

`web/src/components/settings/ProviderDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProviderDialog from "./ProviderDialog";
import { settingsApi } from "../../api/settings";

vi.mock("../../api/settings");

beforeEach(() => {
  vi.mocked(settingsApi.createProvider).mockResolvedValue({} as never);
  vi.mocked(settingsApi.updateProvider).mockResolvedValue({} as never);
});

const setup = (provider?: Parameters<typeof ProviderDialog>[0]["provider"]) => {
  const onDone = vi.fn();
  render(
    <ProviderDialog isOpen provider={provider} onClose={vi.fn()} onDone={onDone} />,
  );
  return { onDone };
};

describe("ProviderDialog", () => {
  it("shows SMTP fields when SMTP is chosen", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "smtp");
    expect(screen.getByLabelText(/Host/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Port/)).toBeInTheDocument();
  });

  it("shows a single API key field for SendGrid", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "sendgrid");
    expect(screen.getByLabelText(/API key/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Host/)).not.toBeInTheDocument();
  });

  it("swaps the fields when the type changes", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "smtp");
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "mailgun");
    expect(screen.getByLabelText(/Domain/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Host/)).not.toBeInTheDocument();
  });

  it("renders a secret as a password field", async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "sendgrid");
    expect(screen.getByLabelText(/API key/)).toHaveAttribute("type", "password");
  });

  it("creates a provider with the config nested under config", async () => {
    const { onDone } = setup();
    await userEvent.type(screen.getByLabelText(/Display name/), "Primary");
    await userEvent.type(screen.getByLabelText(/From address/), "ams@example.com");
    await userEvent.selectOptions(screen.getByLabelText(/Provider type/), "sendgrid");
    await userEvent.type(screen.getByLabelText(/API key/), "SG.test");
    await userEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => expect(settingsApi.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Primary", type: "sendgrid", from_email: "ams@example.com",
        config: { api_key: "SG.test" },
      }),
    ));
    expect(onDone).toHaveBeenCalled();
  });

  it("shows the masked secret as a placeholder when editing", () => {
    setup({
      id: "p1", name: "Primary", type: "sendgrid", from_email: "ams@example.com",
      from_name: null, reply_to: null, priority: 10, active: true,
      config: { api_key: "SG.••••4f2a" }, verified_at: null, last_error: null,
    });
    expect(screen.getByLabelText(/API key/))
      .toHaveAttribute("placeholder", expect.stringContaining("••••"));
  });

  it("omits an untouched secret so saving does not overwrite the stored key", async () => {
    setup({
      id: "p1", name: "Primary", type: "sendgrid", from_email: "ams@example.com",
      from_name: null, reply_to: null, priority: 10, active: true,
      config: { api_key: "SG.••••4f2a" }, verified_at: null, last_error: null,
    });
    await userEvent.clear(screen.getByLabelText(/Priority/));
    await userEvent.type(screen.getByLabelText(/Priority/), "20");
    await userEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() => {
      const body = vi.mocked(settingsApi.updateProvider).mock.calls[0][1];
      expect(body.config).toEqual({});
      expect(body.priority).toBe(20);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/settings`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the settings API module**

`web/src/api/settings.ts`:

```ts
import { api } from "./client";

export type ProviderType =
  | "smtp" | "sendgrid" | "ses" | "postmark" | "mailgun" | "resend";

export interface EmailProvider {
  id: string;
  name: string;
  type: ProviderType;
  from_email: string;
  from_name: string | null;
  reply_to: string | null;
  priority: number;
  active: boolean;
  config: Record<string, unknown>;
  verified_at: string | null;
  last_error: string | null;
}

export interface EmailTemplate {
  key: string;
  customised: boolean;
  subject: string;
  html_body: string;
  text_body: string;
}

export interface EmailMessage {
  id: string;
  to_addresses: string[];
  subject: string;
  status: string;
  attempts: number;
  last_error: string | null;
  provider_name: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface NotificationRule {
  id: string;
  event: string;
  channel: "email" | "webhook";
  template_key: string;
  recipient_spec: {
    roles?: string[]; user_ids?: string[]; emails?: string[];
    assignee?: boolean; actor?: boolean;
  };
  active: boolean;
}

export const settingsApi = {
  providers: () => api.get<EmailProvider[]>("/api/admin/email/providers"),
  createProvider: (input: Partial<EmailProvider>) =>
    api.post<EmailProvider>("/api/admin/email/providers", input),
  updateProvider: (id: string, patch: Partial<EmailProvider>) =>
    api.patch<EmailProvider>(`/api/admin/email/providers/${id}`, patch),
  deleteProvider: (id: string) => api.del(`/api/admin/email/providers/${id}`),
  testProvider: (id: string, to: string) =>
    api.post<{ ok: boolean; error?: string }>(
      `/api/admin/email/providers/${id}/test`, { to },
    ),

  templates: () => api.get<EmailTemplate[]>("/api/admin/email/templates"),
  saveTemplate: (template: Omit<EmailTemplate, "customised">) =>
    api.put("/api/admin/email/templates", template),

  messages: (limit = 100) =>
    api.get<EmailMessage[]>("/api/admin/email/messages", { limit }),

  rules: () =>
    api.get<NotificationRule[]>("/api/admin/notifications/rules"),
  saveRule: (input: Partial<NotificationRule>) =>
    api.post<NotificationRule>("/api/admin/notifications/rules", input),
  updateRule: (id: string, patch: Partial<NotificationRule>) =>
    api.patch<NotificationRule>(`/api/admin/notifications/rules/${id}`, patch),
  deleteRule: (id: string) => api.del(`/api/admin/notifications/rules/${id}`),

  preferences: () =>
    api.get<{ event: string; email_enabled: boolean }[]>(
      "/api/admin/notifications/preferences",
    ),
  savePreferences: (preferences: { event: string; email_enabled: boolean }[]) =>
    api.put("/api/admin/notifications/preferences", { preferences }),
};

export interface ProviderField {
  key: string;
  label: string;
  type: "text" | "number" | "password" | "checkbox" | "select";
  options?: string[];
  secret?: boolean;
}

/** Mirrors CONFIG_SCHEMAS in api/src/lib/email/providers/index.ts. */
export const PROVIDER_FIELDS: Record<ProviderType, ProviderField[]> = {
  smtp: [
    { key: "host", label: "Host", type: "text" },
    { key: "port", label: "Port", type: "number" },
    { key: "secure", label: "Use TLS on connect (port 465)", type: "checkbox" },
    { key: "username", label: "Username", type: "text" },
    { key: "password", label: "Password", type: "password", secret: true },
  ],
  sendgrid: [{ key: "api_key", label: "API key", type: "password", secret: true }],
  ses: [
    { key: "region", label: "Region", type: "text" },
    { key: "access_key_id", label: "Access key ID", type: "text" },
    { key: "secret_access_key", label: "Secret access key", type: "password", secret: true },
  ],
  postmark: [
    { key: "server_token", label: "Server token", type: "password", secret: true },
  ],
  mailgun: [
    { key: "api_key", label: "API key", type: "password", secret: true },
    { key: "domain", label: "Domain", type: "text" },
    { key: "region", label: "Region", type: "select", options: ["us", "eu"] },
  ],
  resend: [{ key: "api_key", label: "API key", type: "password", secret: true }],
};

export const PROVIDER_LABELS: Record<ProviderType, string> = {
  smtp: "SMTP",
  sendgrid: "SendGrid",
  ses: "Amazon SES",
  postmark: "Postmark",
  mailgun: "Mailgun",
  resend: "Resend",
};
```

- [ ] **Step 4: Implement the provider dialog**

`web/src/components/settings/ProviderDialog.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../ui/modal";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import {
  settingsApi, PROVIDER_FIELDS, PROVIDER_LABELS,
  type EmailProvider, type ProviderType,
} from "../../api/settings";
import { ApiError } from "../../api/client";

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  isOpen: boolean;
  provider?: EmailProvider;
  onClose: () => void;
  onDone: () => void;
}

export default function ProviderDialog({ isOpen, provider, onClose, onDone }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ProviderType>("smtp");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [priority, setPriority] = useState(100);
  const [active, setActive] = useState(true);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!provider) return;
    setName(provider.name);
    setType(provider.type);
    setFromEmail(provider.from_email);
    setFromName(provider.from_name ?? "");
    setReplyTo(provider.reply_to ?? "");
    setPriority(provider.priority);
    setActive(provider.active);
    // Non-secret values are editable; secrets stay out of state so an untouched
    // secret is never sent back as its own mask.
    const fields = PROVIDER_FIELDS[provider.type];
    setConfig(Object.fromEntries(
      Object.entries(provider.config).filter(([key]) =>
        !fields.find((f) => f.key === key)?.secret,
      ),
    ));
  }, [provider]);

  const fields = PROVIDER_FIELDS[type];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setBanner(null);

    const payload = {
      name, type, from_email: fromEmail,
      from_name: fromName || null,
      reply_to: replyTo || null,
      priority, active, config,
    };

    try {
      if (provider) await settingsApi.updateProvider(provider.id, payload);
      else await settingsApi.createProvider(payload);
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setBanner(err.problem.detail ?? err.message);
      } else {
        setBanner("Could not save this provider.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-h-[90vh] max-w-xl overflow-y-auto p-6">
      <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
        {provider ? "Edit email provider" : "Add an email provider"}
      </h3>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        Providers are tried in priority order — a lower number is tried first — so a
        second provider acts as a fallback.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        {banner && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
            {banner}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="provider-name">Display name</Label>
            <Input id="provider-name" type="text" value={name}
                   error={Boolean(errors.name)}
                   onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="provider-type">Provider type</Label>
            <select
              id="provider-type" className={selectClass} value={type}
              onChange={(e) => {
                setType(e.target.value as ProviderType);
                setConfig({});
              }}
            >
              {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="provider-from">From address</Label>
            <Input id="provider-from" type="email" value={fromEmail}
                   error={Boolean(errors.from_email)}
                   onChange={(e) => setFromEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="provider-from-name">From name</Label>
            <Input id="provider-from-name" type="text" value={fromName}
                   onChange={(e) => setFromName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="provider-reply">Reply-to</Label>
            <Input id="provider-reply" type="email" value={replyTo}
                   onChange={(e) => setReplyTo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="provider-priority">Priority</Label>
            <Input id="provider-priority" type="number" value={String(priority)}
                   onChange={(e) => setPriority(Number(e.target.value))} />
          </div>
        </div>

        <fieldset className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <legend className="px-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            {PROVIDER_LABELS[type]} settings
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => {
              const id = `provider-${field.key}`;
              const error = errors[`config.${field.key}`];
              const masked =
                field.secret && provider
                  ? String(provider.config[field.key] ?? "")
                  : "";

              return (
                <div key={field.key} className={field.type === "checkbox" ? "sm:col-span-2" : ""}>
                  {field.type === "checkbox" ? (
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        id={id} type="checkbox"
                        checked={Boolean(config[field.key])}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, [field.key]: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      {field.label}
                    </label>
                  ) : field.type === "select" ? (
                    <>
                      <Label htmlFor={id}>{field.label}</Label>
                      <select
                        id={id} className={selectClass}
                        value={String(config[field.key] ?? field.options?.[0] ?? "")}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, [field.key]: e.target.value }))
                        }
                      >
                        {field.options?.map((option) => (
                          <option key={option} value={option}>{option.toUpperCase()}</option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <Label htmlFor={id}>{field.label}</Label>
                      <Input
                        id={id}
                        type={field.type === "number" ? "number" : field.type}
                        value={String(config[field.key] ?? "")}
                        error={Boolean(error)}
                        placeholder={masked ? `${masked} — leave blank to keep` : undefined}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setConfig((c) => {
                            const next = { ...c };
                            // An emptied secret means "keep what is stored".
                            if (field.secret && raw === "") delete next[field.key];
                            else next[field.key] =
                              field.type === "number" ? Number(raw) : raw;
                            return next;
                          });
                        }}
                      />
                      {error && <p className="mt-1 text-theme-xs text-error-500">{error}</p>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox" checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
          />
          Active — include this provider when sending
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button" onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit" disabled={saving}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save provider"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
```

- [ ] **Step 5: Implement the provider list and the settings pages**

`web/src/components/settings/ProviderList.tsx`:

```tsx
import { useState } from "react";
import Badge from "../ui/badge/Badge";
import { settingsApi, PROVIDER_LABELS, type EmailProvider } from "../../api/settings";

export default function ProviderList({
  providers, onEdit, onChanged,
}: {
  providers: EmailProvider[];
  onEdit: (provider: EmailProvider) => void;
  onChanged: () => void;
}) {
  const [testing, setTesting] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, string>>({});

  async function test(provider: EmailProvider) {
    const to = window.prompt("Send a test email to which address?");
    if (!to) return;
    setTesting(provider.id);
    try {
      const result = await settingsApi.testProvider(provider.id, to);
      setOutcome((current) => ({
        ...current,
        [provider.id]: result.ok
          ? `Test email sent to ${to}.`
          : `Failed: ${result.error ?? "unknown error"}`,
      }));
      onChanged();
    } finally {
      setTesting(null);
    }
  }

  if (providers.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        No email provider is configured yet. Until one is added, notifications queue but
        cannot be delivered.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {providers.map((provider) => (
        <li key={provider.id} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {provider.name}
                </span>
                <Badge color={provider.active ? "success" : "light"} size="sm">
                  {provider.active ? "Active" : "Inactive"}
                </Badge>
                {provider.verified_at && (
                  <Badge color="info" size="sm">Verified</Badge>
                )}
              </div>
              <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                {PROVIDER_LABELS[provider.type]} · {provider.from_email} · priority{" "}
                {provider.priority}
              </p>
            </div>

            <div className="ml-auto flex gap-2">
              <button
                type="button" onClick={() => void test(provider)}
                disabled={testing === provider.id}
                className="rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-300 dark:ring-gray-700"
              >
                {testing === provider.id ? "Sending…" : "Send test"}
              </button>
              <button
                type="button" onClick={() => onEdit(provider)}
                className="rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={async () => {
                  await settingsApi.deleteProvider(provider.id);
                  onChanged();
                }}
                className="rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-400 hover:text-error-500"
              >
                Remove
              </button>
            </div>
          </div>

          {provider.last_error && (
            <p className="mt-2 rounded-lg bg-error-50 px-3 py-2 text-theme-xs text-error-600 dark:bg-error-500/10">
              Last error: {provider.last_error}
            </p>
          )}
          {outcome[provider.id] && (
            <p className="mt-2 text-theme-xs text-gray-500 dark:text-gray-400">
              {outcome[provider.id]}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
```

`web/src/pages/Settings/EmailSettings.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import ProviderList from "../../components/settings/ProviderList";
import ProviderDialog from "../../components/settings/ProviderDialog";
import Badge from "../../components/ui/badge/Badge";
import { useModal } from "../../hooks/useModal";
import { settingsApi, type EmailProvider, type EmailMessage } from "../../api/settings";

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "light"> = {
  sent: "success", queued: "warning", sending: "warning",
  failed: "error", cancelled: "light",
};

export default function EmailSettings() {
  const dialog = useModal();
  const [providers, setProviders] = useState<EmailProvider[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [editing, setEditing] = useState<EmailProvider | undefined>();

  const load = useCallback(() => {
    void settingsApi.providers().then(setProviders).catch(() => undefined);
    void settingsApi.messages(25).then(setMessages).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  return (
    <>
      <PageMeta title="Email settings | AMS" description="Email providers and delivery log" />
      <PageBreadcrumb pageTitle="Email" />

      <div className="space-y-5">
        <ComponentCard
          title="Providers"
          desc="Add more than one — if the first fails, the next is tried automatically."
        >
          <div className="mb-4">
            <button
              type="button"
              onClick={() => { setEditing(undefined); dialog.openModal(); }}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Add provider
            </button>
          </div>
          <ProviderList
            providers={providers}
            onEdit={(provider) => { setEditing(provider); dialog.openModal(); }}
            onChanged={load}
          />
        </ComponentCard>

        <ComponentCard title="Recent messages" desc="The last 25 emails this system queued.">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No email has been queued yet.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {messages.map((message) => (
                <li key={message.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <Badge color={STATUS_COLOR[message.status] ?? "light"} size="sm">
                    {message.status}
                  </Badge>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-800 dark:text-white/90">
                      {message.subject}
                    </p>
                    <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                      {message.to_addresses.join(", ")}
                      {message.provider_name && ` · via ${message.provider_name}`}
                      {message.attempts > 1 && ` · ${message.attempts} attempts`}
                    </p>
                    {message.last_error && (
                      <p className="text-theme-xs text-error-500">{message.last_error}</p>
                    )}
                  </div>
                  <time className="ml-auto shrink-0 text-theme-xs text-gray-400">
                    {new Date(message.created_at).toLocaleString("en-GB")}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </ComponentCard>
      </div>

      <ProviderDialog
        isOpen={dialog.isOpen}
        provider={editing}
        onClose={dialog.closeModal}
        onDone={() => { dialog.closeModal(); load(); }}
      />
    </>
  );
}
```

`web/src/pages/Settings/NotificationSettings.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import { settingsApi, type NotificationRule } from "../../api/settings";

const EVENT_LABEL: Record<string, string> = {
  "asset.checked_out": "An asset is checked out",
  "asset.checked_in": "An asset is returned",
  "asset.overdue": "An asset is overdue",
  "warranty.expiring": "A warranty is expiring",
  "licence.expiring": "A licence is expiring",
  "maintenance.due": "Maintenance is due",
  "import.completed": "An import finishes",
  "report.scheduled": "A scheduled report is sent",
};

function describeRecipients(spec: NotificationRule["recipient_spec"]): string {
  const parts: string[] = [];
  if (spec.assignee) parts.push("the assignee");
  if (spec.actor) parts.push("whoever performed the action");
  if (spec.roles?.length) parts.push(`all ${spec.roles.join(" and ")}s`);
  if (spec.emails?.length) parts.push(spec.emails.join(", "));
  return parts.length ? parts.join(", ") : "the schedule's recipient list";
}

export default function NotificationSettings() {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [prefs, setPrefs] = useState<{ event: string; email_enabled: boolean }[]>([]);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    void settingsApi.rules().then(setRules).catch(() => undefined);
    void settingsApi.preferences().then(setPrefs).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  async function savePreferences() {
    await settingsApi.savePreferences(prefs);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <>
      <PageMeta title="Notifications | AMS" description="Notification rules and preferences" />
      <PageBreadcrumb pageTitle="Notifications" />

      <div className="space-y-5">
        <ComponentCard
          title="Organisation rules"
          desc="Who gets told when something happens. Turning a rule off stops it for everyone."
        >
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                    {EVENT_LABEL[rule.event] ?? rule.event}
                  </p>
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                    Emails {describeRecipients(rule.recipient_spec)}
                  </p>
                </div>
                <label className="ml-auto flex items-center gap-2 text-theme-xs text-gray-600 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={rule.active}
                    onChange={async (e) => {
                      await settingsApi.updateRule(rule.id, { active: e.target.checked });
                      load();
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                  />
                  Enabled
                </label>
              </li>
            ))}
          </ul>
        </ComponentCard>

        <ComponentCard
          title="Your preferences"
          desc="Turn off the emails you personally do not want. Organisation rules still apply to everyone else."
        >
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {prefs.map((pref) => (
              <li key={pref.event} className="flex items-center gap-3 py-3 first:pt-0">
                <span className="text-sm text-gray-800 dark:text-white/90">
                  {EVENT_LABEL[pref.event] ?? pref.event}
                </span>
                <label className="ml-auto flex items-center gap-2 text-theme-xs text-gray-600 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={pref.email_enabled}
                    onChange={(e) =>
                      setPrefs((current) => current.map((p) =>
                        p.event === pref.event
                          ? { ...p, email_enabled: e.target.checked }
                          : p,
                      ))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                  />
                  Email me
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button" onClick={() => void savePreferences()}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Save preferences
            </button>
            {saved && (
              <span className="text-theme-xs text-success-500">Preferences saved.</span>
            )}
          </div>
        </ComponentCard>
      </div>
    </>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/settings`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/settings.ts web/src/components/settings web/src/pages/Settings
git commit -m "feat: email provider, template and notification rule settings"
```

---

### Task 31: Categories, locations, users and API keys

**Files:**
- Create: `web/src/components/catalog/FieldSchemaEditor.tsx`, `CategoryDialog.tsx`, `LocationTree.tsx`
- Create: `web/src/pages/Catalog/Categories.tsx`, `web/src/pages/Catalog/Locations.tsx`
- Create: `web/src/pages/Settings/Users.tsx`, `web/src/pages/Settings/ApiKeys.tsx`
- Test: `web/src/components/catalog/FieldSchemaEditor.test.tsx`

**Interfaces:**
- Consumes: `catalogApi`, `/api/admin/api-keys`.
- Produces:
  - `<FieldSchemaEditor fields onChange />` — add, edit, reorder and remove custom fields
  - `<CategoryDialog />`, `<LocationTree locations />`
  - `keysApi.list()`, `.create(name, scopes)`, `.revoke(id)`

**Design note:** a minted API key's plaintext is returned exactly once. The page shows it
in a copy-once panel with an explicit warning, because there is no way to retrieve it
afterwards — only to revoke and mint another.

- [ ] **Step 1: Write the failing test**

`web/src/components/catalog/FieldSchemaEditor.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FieldSchemaEditor from "./FieldSchemaEditor";
import type { FieldDef } from "../../api/types";

const fields: FieldDef[] = [
  { key: "os", label: "Operating System", type: "string", required: false },
  { key: "ram_gb", label: "RAM", type: "number", required: true },
];

const setup = (over: Partial<React.ComponentProps<typeof FieldSchemaEditor>> = {}) => {
  const onChange = vi.fn();
  render(<FieldSchemaEditor fields={fields} onChange={onChange} {...over} />);
  return { onChange };
};

describe("FieldSchemaEditor", () => {
  it("lists the existing fields", () => {
    setup();
    expect(screen.getByDisplayValue("Operating System")).toBeInTheDocument();
    expect(screen.getByDisplayValue("RAM")).toBeInTheDocument();
  });

  it("adds a field", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: /Add field/i }));
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ key: expect.any(String) }),
    ]));
    expect(onChange.mock.calls[0][0]).toHaveLength(3);
  });

  it("removes a field", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getAllByRole("button", { name: /Remove/i })[0]);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
  });

  it("derives a snake_case key from the label", async () => {
    const { onChange } = setup({ fields: [
      { key: "", label: "", type: "string", required: false },
    ] });
    await userEvent.type(screen.getByLabelText(/Label/), "Cost Centre");
    expect(onChange.mock.calls.at(-1)![0][0].key).toBe("cost_centre");
  });

  it("reveals an options input when the type is enum", async () => {
    setup({ fields: [{ key: "os", label: "OS", type: "enum", required: false, options: ["A"] }] });
    expect(screen.getByLabelText(/Options/)).toBeInTheDocument();
  });

  it("splits comma-separated options into a list", async () => {
    const { onChange } = setup({ fields: [
      { key: "os", label: "OS", type: "enum", required: false, options: [] },
    ] });
    await userEvent.type(screen.getByLabelText(/Options/), "Windows, macOS");
    expect(onChange.mock.calls.at(-1)![0][0].options).toEqual(["Windows", "macOS"]);
  });

  it("warns about a duplicate key", () => {
    setup({ fields: [
      { key: "os", label: "A", type: "string", required: false },
      { key: "os", label: "B", type: "string", required: false },
    ] });
    expect(screen.getByRole("alert")).toHaveTextContent(/unique/i);
  });

  it("explains what the editor is for when there are no fields", () => {
    setup({ fields: [] });
    expect(screen.getByText(/No custom fields/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/components/catalog`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the field schema editor**

`web/src/components/catalog/FieldSchemaEditor.tsx`:

```tsx
import Label from "../form/Label";
import Input from "../form/input/InputField";
import type { FieldDef } from "../../api/types";

const TYPES: FieldDef["type"][] = ["string", "number", "date", "boolean", "enum"];

const selectClass =
  "h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/** Server-side keys must be snake_case; deriving them removes a whole class of error. */
export const toKey = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

interface Props {
  fields: FieldDef[];
  onChange: (fields: FieldDef[]) => void;
}

export default function FieldSchemaEditor({ fields, onChange }: Props) {
  const duplicates = fields
    .map((f) => f.key)
    .filter((key, index, all) => key && all.indexOf(key) !== index);

  const update = (index: number, patch: Partial<FieldDef>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));

  return (
    <div className="space-y-4">
      {duplicates.length > 0 && (
        <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
          Field keys must be unique — <strong>{duplicates.join(", ")}</strong> is used
          more than once.
        </div>
      )}

      {fields.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No custom fields yet. Add the details this kind of asset needs — warranty dates
          for IT, running hours for plant, licence expiry for media.
        </p>
      )}

      {fields.map((field, index) => (
        <div
          key={index}
          className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Label htmlFor={`field-label-${index}`}>Label</Label>
              <Input
                id={`field-label-${index}`} type="text" value={field.label}
                onChange={(e) => {
                  const label = e.target.value;
                  // Keep the key in step with the label until a field is saved;
                  // an existing key is left alone so stored data keeps matching.
                  update(index, { label, key: field.key || toKey(label) });
                }}
              />
            </div>
            <div>
              <Label htmlFor={`field-type-${index}`}>Type</Label>
              <select
                id={`field-type-${index}`} className={selectClass} value={field.type}
                onChange={(e) => update(index, {
                  type: e.target.value as FieldDef["type"],
                  options: e.target.value === "enum" ? field.options ?? [] : undefined,
                })}
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end justify-between gap-2">
              <label className="flex h-10 items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox" checked={field.required}
                  onChange={(e) => update(index, { required: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                />
                Required
              </label>
              <button
                type="button"
                onClick={() => onChange(fields.filter((_, i) => i !== index))}
                className="h-10 text-theme-xs text-gray-400 hover:text-error-500"
              >
                Remove
              </button>
            </div>
          </div>

          {field.type === "enum" && (
            <div className="mt-3">
              <Label htmlFor={`field-options-${index}`}>Options</Label>
              <Input
                id={`field-options-${index}`} type="text"
                placeholder="Windows 11, macOS, Ubuntu"
                value={(field.options ?? []).join(", ")}
                onChange={(e) => update(index, {
                  options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean),
                })}
              />
              <p className="mt-1 text-theme-xs text-gray-400">
                Separate the choices with commas.
              </p>
            </div>
          )}

          <p className="mt-2 font-mono text-theme-xs text-gray-400">
            key: {field.key || "—"}
          </p>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([
          ...fields,
          { key: "", label: "", type: "string", required: false },
        ])}
        className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
      >
        Add field
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Implement the catalogue pages**

`web/src/pages/Catalog/Categories.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Badge from "../../components/ui/badge/Badge";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import FieldSchemaEditor from "../../components/catalog/FieldSchemaEditor";
import { Modal } from "../../components/ui/modal";
import { useModal } from "../../hooks/useModal";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";
import type { Category, FieldDef } from "../../api/types";

const KINDS = [
  { value: "it", label: "IT equipment" },
  { value: "equipment", label: "Plant & equipment" },
  { value: "media", label: "Digital media" },
] as const;

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export default function Categories() {
  const dialog = useModal();
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Category["kind"]>("it");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void catalogApi.categories().then(setCategories).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  function open(category: Category | null) {
    setEditing(category);
    setName(category?.name ?? "");
    setKind(category?.kind ?? "it");
    setFields(category?.field_schema.fields ?? []);
    setError(null);
    dialog.openModal();
  }

  async function save() {
    setError(null);
    const payload = { name, kind, field_schema: { fields } };
    try {
      if (editing) await catalogApi.updateCategory(editing.id, payload as never);
      else await catalogApi.createCategory(payload as never);
      dialog.closeModal();
      load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not save this category.",
      );
    }
  }

  return (
    <>
      <PageMeta title="Categories | AMS" description="Asset categories and custom fields" />
      <PageBreadcrumb pageTitle="Categories" />

      <ComponentCard
        title="Categories"
        desc="Each category defines the extra fields its assets carry. Changing them takes effect immediately — no release needed."
      >
        <div className="mb-4">
          <button
            type="button" onClick={() => open(null)}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
          >
            Add category
          </button>
        </div>

        {categories.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No categories yet. Create one for each kind of asset you track.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {categories.map((category) => (
              <li key={category.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                      {category.name}
                    </span>
                    <Badge color="light" size="sm">
                      {KINDS.find((k) => k.value === category.kind)?.label ?? category.kind}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                    {category.field_schema.fields.length} custom field
                    {category.field_schema.fields.length === 1 ? "" : "s"} ·{" "}
                    {category.asset_count ?? 0} asset
                    {category.asset_count === 1 ? "" : "s"}
                  </p>
                </div>
                <button
                  type="button" onClick={() => open(category)}
                  className="ml-auto rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
                >
                  Edit
                </button>
              </li>
            ))}
          </ul>
        )}
      </ComponentCard>

      <Modal
        isOpen={dialog.isOpen} onClose={dialog.closeModal}
        className="max-h-[90vh] max-w-2xl overflow-y-auto p-6"
      >
        <h3 className="mb-5 text-lg font-medium text-gray-800 dark:text-white/90">
          {editing ? `Edit ${editing.name}` : "New category"}
        </h3>

        <div className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="category-name">Name</Label>
              <Input id="category-name" type="text" value={name}
                     onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="category-kind">Kind</Label>
              <select
                id="category-kind" className={selectClass} value={kind}
                onChange={(e) => setKind(e.target.value as Category["kind"])}
              >
                {KINDS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
              Custom fields
            </h4>
            <FieldSchemaEditor fields={fields} onChange={setFields} />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button" onClick={dialog.closeModal}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
            >
              Cancel
            </button>
            <button
              type="button" onClick={() => void save()}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Save category
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
```

`web/src/pages/Catalog/Locations.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { catalogApi } from "../../api/catalog";
import type { LocationNode } from "../../api/types";

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export default function Locations() {
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [address, setAddress] = useState("");

  const load = useCallback(() => {
    void catalogApi.locations().then(setLocations).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  async function add() {
    if (!name.trim()) return;
    await catalogApi.createLocation({
      name, parent_id: parentId || null, address: address || null,
    });
    setName("");
    setAddress("");
    load();
  }

  return (
    <>
      <PageMeta title="Locations | AMS" description="Sites and sub-locations" />
      <PageBreadcrumb pageTitle="Locations" />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ComponentCard title="Locations" desc="Sites, buildings, rooms — nested as deep as you need.">
            {locations.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                No locations yet. Add your first site on the right.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {locations.map((location) => (
                  <li key={location.id} className="flex items-center gap-3 py-3 first:pt-0">
                    <span
                      className="text-sm text-gray-800 dark:text-white/90"
                      style={{ paddingLeft: `${location.depth * 20}px` }}
                    >
                      {location.depth > 0 && (
                        <span aria-hidden className="mr-2 text-gray-300">└</span>
                      )}
                      {location.name}
                      {location.address && (
                        <span className="ml-2 text-theme-xs text-gray-400">
                          {location.address}
                        </span>
                      )}
                    </span>
                    <Link
                      to={`/assets?location_id=${location.id}`}
                      className="ml-auto text-theme-xs text-brand-500 hover:text-brand-600"
                    >
                      {location.asset_count} asset{location.asset_count === 1 ? "" : "s"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ComponentCard>
        </div>

        <ComponentCard title="Add a location">
          <div className="space-y-4">
            <div>
              <Label htmlFor="location-name">Name</Label>
              <Input id="location-name" type="text" value={name}
                     onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="location-parent">Inside</Label>
              <select
                id="location-parent" className={selectClass} value={parentId}
                onChange={(e) => setParentId(e.target.value)}
              >
                <option value="">Top level</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.path}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="location-address">Address</Label>
              <Input id="location-address" type="text" value={address}
                     onChange={(e) => setAddress(e.target.value)} />
            </div>
            <button
              type="button" onClick={() => void add()}
              className="w-full rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Add location
            </button>
          </div>
        </ComponentCard>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Implement the users and API-key pages**

`web/src/pages/Settings/Users.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Badge from "../../components/ui/badge/Badge";
import { catalogApi } from "../../api/catalog";
import type { OrgUser } from "../../api/types";

const ROLE_COLOR: Record<string, "primary" | "info" | "light"> = {
  admin: "primary", manager: "info", technician: "info", viewer: "light",
};

export default function Users() {
  const [users, setUsers] = useState<OrgUser[]>([]);

  useEffect(() => {
    void catalogApi.users().then(setUsers).catch(() => undefined);
  }, []);

  return (
    <>
      <PageMeta title="Users | AMS" description="People in this organisation" />
      <PageBreadcrumb pageTitle="Users" />

      <ComponentCard title="People" desc="Everyone who can be assigned an asset.">
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
              <div>
                <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {user.name}
                </p>
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {user.email}
                </p>
              </div>
              <Badge color={ROLE_COLOR[user.role] ?? "light"} size="sm">{user.role}</Badge>
              <Link
                to={`/assets?assignee_id=${user.id}`}
                className="ml-auto text-theme-xs text-brand-500 hover:text-brand-600"
              >
                {user.assigned_count ?? 0} asset{user.assigned_count === 1 ? "" : "s"}
              </Link>
            </li>
          ))}
        </ul>
      </ComponentCard>
    </>
  );
}
```

`web/src/pages/Settings/ApiKeys.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Badge from "../../components/ui/badge/Badge";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { api } from "../../api/client";

const SCOPES = ["assets:read", "assets:write", "reports:read", "admin"] as const;

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["assets:read"]);
  const [minted, setMinted] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    void api.get<ApiKey[]>("/api/admin/api-keys").then(setKeys).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  async function mint() {
    if (!name.trim() || scopes.length === 0) return;
    const created = await api.post<{ name: string; key: string }>(
      "/api/admin/api-keys", { name, scopes },
    );
    setMinted(created);
    setName("");
    setCopied(false);
    load();
  }

  return (
    <>
      <PageMeta title="API keys | AMS" description="Keys for integrating other systems" />
      <PageBreadcrumb pageTitle="API keys" />

      <div className="space-y-5">
        {minted && (
          <div className="rounded-2xl border border-warning-500 bg-warning-50 p-5 dark:bg-warning-500/10">
            <h3 className="text-sm font-medium text-warning-600">
              Copy this key now — it will not be shown again
            </h3>
            <p className="mt-1 text-theme-xs text-warning-600/80">
              Only a hash is stored. If you lose this key, revoke it and mint another.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2.5 font-mono text-sm dark:bg-gray-900">
                {minted.key}
              </code>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(minted.key);
                  setCopied(true);
                }}
                className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setMinted(null)}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-white dark:text-gray-300 dark:ring-gray-700"
              >
                Done
              </button>
            </div>
          </div>
        )}

        <ComponentCard
          title="Create a key"
          desc="Give each integration its own key with the narrowest scopes it needs."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="key-name">Name</Label>
              <Input
                id="key-name" type="text" value={name}
                placeholder="HR system, warehouse scanner, reporting job"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="key-scopes">Scopes</Label>
              <div className="flex flex-wrap gap-2 pt-2">
                {SCOPES.map((scope) => {
                  const on = scopes.includes(scope);
                  return (
                    <button
                      key={scope}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setScopes((current) =>
                          on ? current.filter((s) => s !== scope) : [...current, scope],
                        )
                      }
                      className={`rounded-full px-3 py-1 text-theme-xs font-medium ${
                        on
                          ? "bg-brand-500 text-white"
                          : "bg-gray-100 text-gray-600 dark:bg-white/[0.05] dark:text-gray-300"
                      }`}
                    >
                      {scope}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <button
              type="button" onClick={() => void mint()}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Create key
            </button>
          </div>
        </ComponentCard>

        <ComponentCard title="Existing keys">
          {keys.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No keys yet. Create one to let another system talk to this API.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {keys.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                        {key.name}
                      </span>
                      {key.revoked_at && <Badge color="error" size="sm">Revoked</Badge>}
                    </div>
                    <p className="mt-0.5 font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                      {key.prefix}… · {key.scopes.join(", ")}
                    </p>
                    <p className="text-theme-xs text-gray-400">
                      {key.last_used_at
                        ? `Last used ${new Date(key.last_used_at).toLocaleString("en-GB")}`
                        : "Never used"}
                    </p>
                  </div>
                  {!key.revoked_at && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(
                          `Revoke "${key.name}"? Any integration using it will stop working immediately.`,
                        )) return;
                        await api.del(`/api/admin/api-keys/${key.id}`);
                        load();
                      }}
                      className="ml-auto rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-400 hover:text-error-500"
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ComponentCard>
      </div>
    </>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/components/catalog`
Expected: PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/catalog web/src/pages/Catalog web/src/pages/Settings
git commit -m "feat: category field schema editor, locations, users and api key pages"
```

---

### Task 32: "What's new" release-notes panel

**Files:**
- Create: `web/src/api/releases.ts`, `web/src/pages/WhatsNew.tsx`
- Modify: `web/src/layout/AppSidebar.tsx` (unseen indicator and version footer)
- Test: `web/src/pages/WhatsNew.test.tsx`

**Interfaces:**
- Consumes: `GET /api/releases`, `GET /api/version`, `POST /api/admin/releases/seen` (all built in Task 35).
- Produces:
  - `releasesApi.list()`, `.version()`, `.markSeen(version)`
  - `<WhatsNew />` — the user-facing changelog
  - `useUnseenReleases()` — the sidebar dot

**Design note (spec §11.5):** users of an asset system notice when a screen changes and
are unsettled when nobody told them. Entries are written for users, not from commit
subjects. Task 35 builds the API side; this task builds the page against it, and both
degrade quietly to an empty state if no releases have been published.

- [ ] **Step 1: Write the failing test**

`web/src/pages/WhatsNew.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import WhatsNew from "./WhatsNew";
import { releasesApi } from "../api/releases";

vi.mock("../api/releases");

const releases = [
  {
    version: "1.2.0", title: "Scanning and labels", released_at: "2026-09-01",
    entries: [
      { type: "feature", summary: "Scan a QR code to open an asset instantly." },
      { type: "fix", summary: "Overdue reminders no longer send twice in a day." },
    ],
  },
  {
    version: "1.1.0", title: "Reporting", released_at: "2026-08-15",
    entries: [{ type: "improvement", summary: "Reports now export to PDF." }],
  },
];

beforeEach(() => {
  vi.mocked(releasesApi.list).mockResolvedValue(releases);
  vi.mocked(releasesApi.markSeen).mockResolvedValue(undefined as never);
});

const setup = () => render(<MemoryRouter><WhatsNew /></MemoryRouter>);

describe("WhatsNew", () => {
  it("lists releases newest first", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("Scanning and labels")).toBeInTheDocument());
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings[0]).toHaveTextContent("Scanning and labels");
  });

  it("shows the version and date for each release", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("1.2.0")).toBeInTheDocument());
    expect(screen.getByText(/1 Sep 2026/)).toBeInTheDocument();
  });

  it("renders every entry with its type", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText(/Scan a QR code/)).toBeInTheDocument());
    expect(screen.getByText("feature")).toBeInTheDocument();
    expect(screen.getByText("fix")).toBeInTheDocument();
  });

  it("marks the newest version as seen once viewed", async () => {
    setup();
    await waitFor(() => expect(releasesApi.markSeen).toHaveBeenCalledWith("1.2.0"));
  });

  it("shows an empty state when nothing has been published", async () => {
    vi.mocked(releasesApi.list).mockResolvedValue([]);
    setup();
    await waitFor(() =>
      expect(screen.getByText(/No release notes yet/i)).toBeInTheDocument());
  });

  it("does not crash when the release endpoint is unavailable", async () => {
    vi.mocked(releasesApi.list).mockRejectedValue(new Error("offline"));
    setup();
    await waitFor(() =>
      expect(screen.getByText(/No release notes yet/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/pages/WhatsNew.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the releases API module and page**

`web/src/api/releases.ts`:

```ts
import { api } from "./client";

export type EntryType = "feature" | "improvement" | "fix" | "breaking";

export interface ReleaseEntry {
  type: EntryType;
  summary: string;
  help_url?: string | null;
  api_affecting?: boolean;
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
  api_version: string;
  migration_head: string;
  environment: string;
}

export const releasesApi = {
  list: () => api.get<Release[]>("/api/releases"),
  version: () => api.get<VersionInfo>("/api/version"),
  markSeen: (version: string) =>
    api.post("/api/admin/releases/seen", { version }),
  unseenCount: () => api.get<{ count: number }>("/api/admin/releases/unseen"),
};
```

`web/src/pages/WhatsNew.tsx`:

```tsx
import { useEffect, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import PageBreadcrumb from "../components/common/PageBreadCrumb";
import Badge from "../components/ui/badge/Badge";
import { releasesApi, type Release, type EntryType } from "../api/releases";

const TYPE_COLOR: Record<EntryType, "success" | "info" | "warning" | "error"> = {
  feature: "success",
  improvement: "info",
  fix: "warning",
  breaking: "error",
};

const asDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });

export default function WhatsNew() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    releasesApi.list()
      .then((list) => {
        setReleases(list);
        // Opening the page is the acknowledgement — it clears the sidebar dot.
        if (list[0]) void releasesApi.markSeen(list[0].version).catch(() => undefined);
      })
      .catch(() => setReleases([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageMeta title="What's new | AMS" description="Release notes" />
      <PageBreadcrumb pageTitle="What's new" />

      {loading ? (
        <p className="text-sm text-gray-500">Loading release notes…</p>
      ) : releases.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            No release notes yet
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
            When a new version ships, what changed will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {releases.map((release) => (
            <article
              key={release.version}
              className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
                  {release.title}
                </h2>
                <Badge color="light" size="sm">{release.version}</Badge>
                <time
                  className="ml-auto text-theme-xs text-gray-400"
                  dateTime={release.released_at}
                >
                  {asDate(release.released_at)}
                </time>
              </div>

              <ul className="mt-4 space-y-3">
                {release.entries.map((entry, index) => (
                  <li key={index} className="flex flex-wrap items-baseline gap-2">
                    <Badge color={TYPE_COLOR[entry.type]} size="sm">{entry.type}</Badge>
                    <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">
                      {entry.summary}
                      {entry.help_url && (
                        <>
                          {" "}
                          <a
                            href={entry.help_url}
                            className="text-brand-500 hover:text-brand-600"
                          >
                            Learn more
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Add the sidebar indicator and version footer**

In `web/src/layout/AppSidebar.tsx`, replace the template's `SidebarWidget` with a version
footer, and mark the "What's new" nav item when there are unseen releases:

```tsx
import { useEffect, useState } from "react";
import { releasesApi, type VersionInfo } from "../api/releases";

function SidebarFooter() {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    void releasesApi.version().then(setVersion).catch(() => undefined);
    void releasesApi.unseenCount()
      .then((r) => setUnseen(r.count))
      .catch(() => undefined);
  }, []);

  if (!version) return null;

  return (
    <div className="mt-auto px-5 py-4 text-theme-xs text-gray-400">
      <a href="/whats-new" className="flex items-center gap-2 hover:text-brand-500">
        <span>v{version.version}</span>
        {unseen > 0 && (
          <span
            aria-label={`${unseen} unread release notes`}
            className="h-2 w-2 rounded-full bg-brand-500"
          />
        )}
      </a>
      <span className="mt-1 block font-mono">{version.git_sha}</span>
    </div>
  );
}
```

Render `<SidebarFooter />` where `SidebarWidget` was, and delete
`web/src/layout/SidebarWidget.tsx`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/pages/WhatsNew.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the whole web suite**

Run: `cd web && npm test`
Expected: PASS — every suite from Tasks 21–32 green.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/releases.ts web/src/pages/WhatsNew.tsx web/src/layout
git commit -m "feat: what's new release notes panel with unseen indicator"
```

---

**Phase 5 complete.** The dashboard is fully functional against the API: register,
detail, forms, custody, scanning, dashboard, import, reports, settings and release notes.
Continue to [Phase 6 — Integration & release](./06-integration-and-release.md).
