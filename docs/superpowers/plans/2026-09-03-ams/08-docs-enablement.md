# Phase 8 — Documentation & enablement

> Part of the [Assets Management System plan](./00-overview.md). Read `00-overview.md` first — its Global Constraints apply to every task here.

**Tasks 50–55.** The developer portal, the in-app tour and contextual help, the help centre, the project documentation, seed data and the end-to-end smoke suite.

**Spec sections:** §10.1, §10.2, §10.3, and the operational items in §14.

Built **after** all functional work is stable (spec §10), so nothing documented goes
stale mid-build. Every deliverable ships inside the product rather than in a wiki that
nobody updates.

## Why this phase splits into six tasks, not four

`00-overview.md` originally indexed this phase as Tasks 50–53. Writing it out showed
four boundaries too coarse to review: the developer portal alone is nine pages plus an
API endpoint, and a reviewer could reasonably accept the portal shell while rejecting
the recipe renderers. The phase is therefore Tasks 50–55, and the overview's task index
is updated to match.

## The single-source rule for this phase

Three deliverables in the spec describe the same material for three audiences:

| Spec | Audience | Surface |
|---|---|---|
| §10.2 per-page help | A user on a screen, stuck now | The `?` panel |
| §10.2 help centre | A user searching before they start | `/help` |
| §10.3 `docs/user-guide.md` | Someone printing a manual | A generated Markdown file |

Writing those three by hand guarantees they disagree within a month. In this phase the
help content is **one typed data module**, rendered by a shared block renderer into the
panel and the help centre, and emitted by a build script into the printable guide. Task
54 builds all three from that one source, and its test asserts the guide contains every
article.

The same principle governs the developer portal: the API reference is rendered from
`/api/v1/openapi.json` (Task 46) rather than written out, the error catalogue is served
by the API and its test fails if a handler ever returns an uncatalogued error type, and
the code recipes are rendered from one request description per flow into four languages
rather than hand-written thirty-two times.

## Task deliverables

| Task | Deliverable |
|---|---|
| 37 | Error catalogue endpoint, with a drift test that fails on an uncatalogued error |
| 38 | Developer portal shell, Scalar reference, overview, authentication, conventions |
| 39 | Recipes in four languages, webhooks, errors and changelog pages |
| 40 | First-run tour, contextual help panel, teaching empty states, onboarding checklists |
| 41 | Help centre, and the generated printable user guide |
| 42 | Project documentation, seed data and the Playwright smoke suite |

---

### Task 50: The error catalogue and its anti-drift test

**Files:**
- Create: `api/src/lib/http/catalog.ts`
- Create: `api/src/app/api/v1/errors.json/route.ts`
- Test: `api/src/lib/http/catalog.test.ts`

**Interfaces:**
- Consumes: `problem` from `lib/http/problem.ts` (Task 3).
- Produces:
  - `interface ErrorEntry { slug: string; status: number; title: string; when: string; fix: string }`
  - `ERROR_CATALOG: ErrorEntry[]`
  - `errorTypeUri(slug: string): string`
  - `GET /api/v1/errors.json` — unauthenticated, returns `{ data: ErrorEntry[] }` with absolute `type` URIs

**Design note (spec §10.1, "Errors" row):** the portal promises "every `type` URI, when it
fires, how to fix it". A hand-maintained list of error types is wrong the first time
someone adds a `problem(409, "asset-checked-out", …)` and forgets the docs. The test in
Step 1 scans the API source for every error slug that reaches a caller and fails if the
catalogue is missing one, which converts a documentation promise into a build failure.

- [ ] **Step 1: Write the failing test**

`api/src/lib/http/catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_CATALOG, errorTypeUri } from "./catalog";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Every slug the API can actually return, read from the source itself. */
async function slugsUsedInSource(): Promise<Set<string>> {
  const slugs = new Set<string>();
  for (const file of await sourceFiles(SRC)) {
    const text = await readFile(file, "utf8");
    // problem(422, "validation", ...) — the second argument is the slug.
    for (const m of text.matchAll(/\bproblem\(\s*\d+\s*,\s*"([a-z0-9-]+)"/g)) {
      slugs.add(m[1]);
    }
  }
  // The named helpers in problem.ts hard-code their own slugs.
  for (const s of ["validation", "not-found", "unauthorized", "forbidden", "conflict"]) {
    slugs.add(s);
  }
  return slugs;
}

describe("error catalogue", () => {
  it("documents every error the API can return", async () => {
    const documented = new Set(ERROR_CATALOG.map((e) => e.slug));
    const used = await slugsUsedInSource();
    const undocumented = [...used].filter((s) => !documented.has(s)).sort();
    expect(undocumented).toEqual([]);
  });

  it("documents no error the API cannot return", async () => {
    const used = await slugsUsedInSource();
    const stale = ERROR_CATALOG.map((e) => e.slug).filter((s) => !used.has(s)).sort();
    expect(stale).toEqual([]);
  });

  it("gives every entry a usable when and fix", () => {
    for (const entry of ERROR_CATALOG) {
      expect(entry.when.length, `${entry.slug}.when`).toBeGreaterThan(20);
      expect(entry.fix.length, `${entry.slug}.fix`).toBeGreaterThan(20);
      expect(entry.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("builds the same type URI the problem helper emits", () => {
    expect(errorTypeUri("validation")).toBe("https://ams.dev/errors/validation");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/http/catalog.test.ts`
Expected: FAIL — `Cannot find module './catalog'`.

- [ ] **Step 3: Implement the catalogue**

`api/src/lib/http/catalog.ts`:

```ts
export interface ErrorEntry {
  slug: string;
  status: number;
  title: string;
  /** The situation that produces this error, in the caller's terms. */
  when: string;
  /** What the caller should change. Never "contact support" alone. */
  fix: string;
}

const BASE = "https://ams.dev/errors/";

export const errorTypeUri = (slug: string): string => BASE + slug;

export const ERROR_CATALOG: ErrorEntry[] = [
  {
    slug: "validation",
    status: 422,
    title: "Validation failed",
    when: "The request body was well-formed JSON but a field was missing, the wrong type, or outside its allowed range.",
    fix: "Read the errors array: each entry names the offending field and the reason. Custom fields are validated against the category's field schema, so a field valid for one category may be rejected for another.",
  },
  {
    slug: "not-found",
    status: 404,
    title: "Resource not found",
    when: "The id or asset tag in the path does not exist in your organisation, or refers to a soft-deleted asset.",
    fix: "Confirm the id belongs to the organisation the key was issued for. Ids are not shared between organisations, so a valid id from another tenant reads as missing rather than forbidden.",
  },
  {
    slug: "unauthorized",
    status: 401,
    title: "Authentication required",
    when: "No credential was supplied, the Bearer token was malformed, or the API key has been revoked.",
    fix: "Send the key as `Authorization: Bearer ams_live_…`. If the key was revoked, mint a new one in Settings → API keys; a revoked key never becomes valid again.",
  },
  {
    slug: "forbidden",
    status: 403,
    title: "Forbidden",
    when: "The credential is valid but lacks the scope the endpoint requires — for example a key with only assets:read calling POST /api/v1/assets.",
    fix: "Mint a key with the scope named in the detail field. Scopes cannot be added to an existing key, because a key's permissions are fixed at issue so an audit of a key is an audit of what it could ever do.",
  },
  {
    slug: "conflict",
    status: 409,
    title: "Conflict",
    when: "The write contradicts the current state — checking out an asset that is already out, or reusing an asset tag or serial number that another asset in your organisation holds.",
    fix: "Read the detail field for the conflicting record, then either check the asset in first or choose a different tag. Asset tags are unique per organisation among non-deleted assets.",
  },
  {
    slug: "rate-limited",
    status: 429,
    title: "Rate limit exceeded",
    when: "The API key exceeded its hourly request budget. The limit is per key, so one noisy integration cannot exhaust another's budget.",
    fix: "Honour the Retry-After header, which gives the seconds until the window resets. Back off exponentially rather than retrying immediately, and consider requesting a larger page size instead of more requests.",
  },
  {
    slug: "internal",
    status: 500,
    title: "Internal server error",
    when: "An unhandled fault in the API. The response carries no detail, deliberately, because internal messages leak implementation.",
    fix: "Retry once with the same Idempotency-Key, which is safe and will not create a duplicate. If it persists, report the X-Request-Id from the response headers, which identifies the failing request in the server logs.",
  },
];
```

`api/src/app/api/v1/errors.json/route.ts`:

```ts
import { ERROR_CATALOG, errorTypeUri } from "@/lib/http/catalog";
import { safe } from "@/lib/http/handler";

// Public and unauthenticated: a developer reading the error reference has not
// necessarily got a key yet, and this document is the same for every tenant.
export const GET = safe(async () =>
  Response.json(
    {
      data: ERROR_CATALOG.map((e) => ({
        type: errorTypeUri(e.slug),
        status: e.status,
        title: e.title,
        when: e.when,
        fix: e.fix,
      })),
    },
    { headers: { "cache-control": "public, max-age=3600" } },
  ),
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd api && npx vitest run src/lib/http/catalog.test.ts`
Expected: PASS, 4 tests.

If the first test fails listing a slug, a task between 5 and 36 introduced an error type
this catalogue has not got. Add it — that is the test doing its job, not a false alarm.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/http/catalog.ts api/src/lib/http/catalog.test.ts \
        api/src/app/api/v1/errors.json
git commit -F - <<'MSG'
feat(api): publish the error catalogue with a drift test

Every problem+json type the API can return, with when it fires and how to
fix it, served at /api/v1/errors.json for the developer portal to render.

The test scans the API source for error slugs and fails if the catalogue
is missing one or lists one that no handler emits, so the reference cannot
drift from the implementation.

release-note: The API reference now documents every error the API can return, including what causes it and how to fix it.
MSG
```

---

### Task 51: Developer portal — shell, API reference, overview, authentication, conventions

**Files:**
- Create: `web/src/pages/developers/DevelopersLayout.tsx`, `Overview.tsx`, `Authentication.tsx`, `Reference.tsx`, `Conventions.tsx`
- Create: `web/src/components/developers/Prose.tsx`, `web/src/components/developers/CodeBlock.tsx`
- Modify: `web/src/App.tsx` (public `/developers` routes, outside `RequireAuth`)
- Test: `web/src/pages/developers/DevelopersLayout.test.tsx`, `web/src/pages/developers/Reference.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/openapi.json` (Task 46), `api` client and `useAuth` (Task 21).
- Produces:
  - `<DevelopersLayout />` — sidebar nav + `<Outlet />`, no auth required
  - `<CodeBlock language={string} code={string} />` — syntax-neutral block with a copy button
  - `<Prose>` — typographic wrapper matching the dashboard's dark/light theme
  - Routes `/developers`, `/developers/authentication`, `/developers/reference`, `/developers/conventions`

**Deviation, recorded during execution (2026-09-07):** the package this task
named, `@scalar/api-reference-react`, does not exist on npm — the install returns
404. The surviving `@scalar/api-reference` is 40.7 MB unpacked and pulls the Vue
runtime, a chat agent and a second HTTP client into a React application whose
590 kB chart library is already lazy-loaded to protect page weight. That is a bad
trade for one page, so the reference is rendered from `/api/v1/openapi.json` by
`Reference.tsx` instead.

**What this costs:** the spec's "Try it" request runner is not built *by this
task*. **Closed on 2026-09-08** by `web/src/components/developers/TryIt.tsx`:
each operation gets a small runner that fills the path and query parameters,
takes a key, sends one real request to this deployment and shows the status,
timing, request id and body. The URL is built from the document rather than
typed, so the page cannot be pointed at another host, and the key lives in
component state only. A write asks for confirmation first, because it really
writes.

**Also moved here from Task 52:** the Errors page. The shell's sidebar links to
it, and shipping a nav entry that 404s until the next task is worse than a small
reordering. Task 52 keeps the recipes, webhooks and changelog pages.

**Design note (spec §10.1):** the reference is rendered by Scalar from the live
`/api/v1/openapi.json`, never transcribed. Scalar also supplies the "Try it" runner the
spec asks for — a request client with an auth field — so that row of the spec table is
satisfied by configuring Scalar rather than by building a second HTTP client in the
browser.

**Why the portal is public:** an integrator evaluating the product reads these pages
before anyone has issued them a credential. These routes therefore sit outside
`<RequireAuth>`, and nothing on them calls a tenant-scoped endpoint.

- [x] **Step 1: Install Scalar**

```bash
cd web
npm install @scalar/api-reference-react
```

- [x] **Step 2: Write the failing tests**

`web/src/pages/developers/DevelopersLayout.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import DevelopersLayout from "./DevelopersLayout";

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/developers" element={<DevelopersLayout />}>
          <Route index element={<p>overview body</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe("developer portal shell", () => {
  it("renders without a signed-in user", () => {
    // No AuthProvider is mounted: the portal must not depend on one.
    renderAt("/developers");
    expect(screen.getByText("overview body")).toBeInTheDocument();
  });

  it("links to every portal section", () => {
    renderAt("/developers");
    for (const label of [
      "Overview", "Authentication", "Reference", "Conventions",
      "Recipes", "Webhooks", "Errors", "Changelog",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });
});
```

`web/src/pages/developers/Reference.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Reference from "./Reference";

vi.mock("@scalar/api-reference-react", () => ({
  ApiReferenceReact: ({ configuration }: { configuration: { url: string } }) => (
    <div data-testid="scalar" data-url={configuration.url} />
  ),
}));

describe("api reference", () => {
  it("points Scalar at the live OpenAPI document", () => {
    render(<Reference />);
    expect(screen.getByTestId("scalar")).toHaveAttribute(
      "data-url",
      expect.stringContaining("/api/v1/openapi.json"),
    );
  });
});
```

- [x] **Step 3: Run to verify they fail**

Run: `cd web && npx vitest run src/pages/developers`
Expected: FAIL — `Cannot find module './DevelopersLayout'`.

- [x] **Step 4: Build the shared presentation components**

`web/src/components/developers/CodeBlock.tsx`:

```tsx
import { useState } from "react";

interface Props {
  language: string;
  code: string;
}

export default function CodeBlock({ language, code }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {language}
        </span>
        <button
          onClick={copy}
          className="text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed text-gray-800 dark:text-gray-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}
```

`web/src/components/developers/Prose.tsx`:

```tsx
import type { ReactNode } from "react";

/** Typographic wrapper so every portal page shares one measure and rhythm. */
export default function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-3xl space-y-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-gray-900 dark:[&_h2]:text-white [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-gray-900 dark:[&_h3]:text-white [&_a]:text-brand-500 [&_a]:underline [&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs dark:[&_code]:bg-gray-800 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
      {children}
    </div>
  );
}
```

- [x] **Step 5: Build the portal shell**

`web/src/pages/developers/DevelopersLayout.tsx`:

```tsx
import { NavLink, Outlet } from "react-router";
import PageMeta from "../../components/common/PageMeta";

const SECTIONS = [
  { to: "/developers", label: "Overview", end: true },
  { to: "/developers/authentication", label: "Authentication" },
  { to: "/developers/reference", label: "Reference" },
  { to: "/developers/conventions", label: "Conventions" },
  { to: "/developers/recipes", label: "Recipes" },
  { to: "/developers/webhooks", label: "Webhooks" },
  { to: "/developers/errors", label: "Errors" },
  { to: "/developers/changelog", label: "Changelog" },
];

export default function DevelopersLayout() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <PageMeta
        title="API documentation | Assets Management System"
        description="Integrate with the Assets Management System REST API."
      />
      <header className="border-b border-gray-200 px-6 py-4 dark:border-gray-800">
        <NavLink to="/developers" className="text-lg font-semibold text-gray-900 dark:text-white">
          AMS API
        </NavLink>
      </header>

      <div className="mx-auto flex max-w-7xl gap-10 px-6 py-8">
        <nav className="w-48 shrink-0">
          <ul className="space-y-1">
            {SECTIONS.map((s) => (
              <li key={s.to}>
                <NavLink
                  to={s.to}
                  end={s.end}
                  className={({ isActive }) =>
                    `block rounded px-3 py-2 text-sm ${
                      isActive
                        ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                        : "text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-900"
                    }`
                  }
                >
                  {s.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [x] **Step 6: Build the Reference, Overview, Authentication and Conventions pages**

`web/src/pages/developers/Reference.tsx`:

```tsx
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export default function Reference() {
  return (
    <ApiReferenceReact
      configuration={{
        url: `${API_BASE}/api/v1/openapi.json`,
        // The spec's "Try it" row: Scalar's own request client, pointed at the
        // live API, so a reader can fire a real call with their own key.
        servers: [{ url: API_BASE || window.location.origin }],
        authentication: { preferredSecurityScheme: "bearerAuth" },
        hideDownloadButton: false,
      }}
    />
  );
}
```

`web/src/pages/developers/Overview.tsx`:

```tsx
import { Link } from "react-router";
import Prose from "../../components/developers/Prose";
import CodeBlock from "../../components/developers/CodeBlock";

export default function Overview() {
  return (
    <Prose>
      <h2>The Assets Management System API</h2>
      <p>
        A REST API over your asset register: create and update assets, check them
        out and back in, resolve a scanned tag, run reports and subscribe to
        webhooks. Everything the dashboard does, it does through this API.
      </p>

      <h3>Base URL</h3>
      <CodeBlock language="text" code="https://your-host/api/v1" />
      <p>
        Every response is JSON. Every error is{" "}
        <Link to="/developers/errors">problem+json</Link>. The{" "}
        <code>/api/v1</code> prefix is additive-only: fields are added, never
        removed or renamed, so an integration written today keeps working. A
        breaking change ships as <code>/api/v2</code> alongside it.
      </p>

      <h3>Your first call, in three steps</h3>
      <ol>
        <li>
          In the dashboard, open <strong>Settings → API keys</strong> and mint a
          key with the <code>assets:read</code> scope. The key is shown once.
        </li>
        <li>Send it as a bearer token.</li>
        <li>Read the first page of your register.</li>
      </ol>

      <CodeBlock
        language="bash"
        code={`curl https://your-host/api/v1/assets \\
  -H "Authorization: Bearer ams_live_xxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyy"`}
      />

      <p>
        The response carries a <code>data</code> array and a <code>meta</code>{" "}
        object with the page, page size and total. See{" "}
        <Link to="/developers/conventions">Conventions</Link> for paging through
        the rest, and <Link to="/developers/recipes">Recipes</Link> for the eight
        most common flows in four languages.
      </p>
    </Prose>
  );
}
```

`web/src/pages/developers/Authentication.tsx`:

```tsx
import Prose from "../../components/developers/Prose";
import CodeBlock from "../../components/developers/CodeBlock";

const SCOPES = [
  ["assets:read", "Read assets, categories, locations and assignment history."],
  ["assets:write", "Create and update assets, check out and check in, import."],
  ["reports:read", "Run reports and download them in any supported format."],
  ["admin", "Manage API keys, webhooks, users and settings. Implies every other scope."],
];

export default function Authentication() {
  return (
    <Prose>
      <h2>Authentication</h2>
      <p>
        The public API authenticates with an API key sent as a bearer token. The
        dashboard uses a session cookie instead; both resolve to the same
        permission model, so an endpoint behaves identically either way.
      </p>

      <CodeBlock
        language="bash"
        code={`curl https://your-host/api/v1/assets \\
  -H "Authorization: Bearer ams_live_xxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyy"`}
      />

      <h3>Minting a key</h3>
      <p>
        <strong>Settings → API keys → New key.</strong> Choose a name that says
        which system will use it, and the narrowest set of scopes that system
        needs. The key is displayed <strong>once</strong>: only a SHA-256 hash is
        stored, so it cannot be recovered later. If you lose it, revoke it and
        mint another.
      </p>

      <h3>Scopes</h3>
      <table>
        <thead>
          <tr><th>Scope</th><th>Grants</th></tr>
        </thead>
        <tbody>
          {SCOPES.map(([scope, grants]) => (
            <tr key={scope}>
              <td><code>{scope}</code></td>
              <td>{grants}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Scopes are fixed when the key is issued and cannot be widened afterwards.
        That is deliberate: auditing a key is then the same as auditing what it
        could ever have done. To change permissions, mint a new key and revoke
        the old one.
      </p>

      <h3>Rotation and revocation</h3>
      <p>
        Keys do not expire on their own. Rotate by minting the replacement, moving
        traffic to it, then revoking the old key. Revocation takes effect on the
        next request; a revoked key never becomes valid again, and calls with it
        return <code>401</code>.
      </p>
      <p>
        Each key records a <code>last_used_at</code>, so a key with no recent use
        is safe to revoke.
      </p>
    </Prose>
  );
}
```

`web/src/pages/developers/Conventions.tsx`:

```tsx
import Prose from "../../components/developers/Prose";
import CodeBlock from "../../components/developers/CodeBlock";

export default function Conventions() {
  return (
    <Prose>
      <h2>Pagination, sorting and filtering</h2>
      <p>
        Every collection endpoint pages the same way. Pass <code>page</code> and{" "}
        <code>per_page</code>; the default page size is 50 and the maximum is 200.
        A value above the maximum is clamped rather than rejected.
      </p>
      <CodeBlock
        language="bash"
        code={`curl "https://your-host/api/v1/assets?page=2&per_page=100" \\
  -H "Authorization: Bearer $AMS_KEY"`}
      />
      <p>The envelope tells you where you are and when to stop:</p>
      <CodeBlock
        language="json"
        code={`{
  "data": [ ... ],
  "meta": { "page": 2, "per_page": 100, "total": 4213, "total_pages": 43 }
}`}
      />

      <h3>Sorting</h3>
      <p>
        Pass <code>sort</code> with a field name; prefix it with <code>-</code> for
        descending. Only allowlisted fields sort, and an unknown field falls back
        to the endpoint's default rather than erroring.
      </p>
      <CodeBlock language="text" code="?sort=-created_at" />

      <h3>Filtering</h3>
      <p>
        Filters are query parameters named after the field. Combine freely; they
        are joined with AND. <code>q</code> is a fuzzy search across name, asset
        tag and serial number.
      </p>
      <CodeBlock
        language="text"
        code="?status=in_use&category_id=<uuid>&location_id=<uuid>&q=thinkpad"
      />

      <h2>Rate limits</h2>
      <p>
        Limits are per API key, so one integration cannot exhaust another's
        budget. Exceeding the limit returns <code>429</code> with a{" "}
        <code>Retry-After</code> header in seconds.
      </p>
      <CodeBlock
        language="javascript"
        code={`async function callWithRetry(url, init, attempt = 0) {
  const res = await fetch(url, init);
  if (res.status !== 429 || attempt >= 5) return res;

  // Honour Retry-After when present, otherwise back off exponentially
  // with jitter so a fleet of workers does not retry in lockstep.
  const header = Number(res.headers.get("Retry-After"));
  const backoff = Number.isFinite(header) && header > 0
    ? header * 1000
    : Math.min(2 ** attempt * 1000, 30_000) + Math.random() * 1000;

  await new Promise((r) => setTimeout(r, backoff));
  return callWithRetry(url, init, attempt + 1);
}`}
      />

      <h2>Idempotency</h2>
      <p>
        Every write accepts an <code>Idempotency-Key</code> header. Retrying with
        the same key returns the original response instead of performing the write
        again, so a timeout you never saw the answer to is safe to retry.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -X POST https://your-host/api/v1/assets \\
  -H "Authorization: Bearer $AMS_KEY" \\
  -H "Idempotency-Key: 7d1f4c9e-2b6a-4a51-9f3e-8c2d5b1a0e77" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"ThinkPad X1","category_id":"<uuid>"}'`}
      />
      <p>
        Use a fresh UUID per logical operation, and reuse it only for retries of
        that same operation.
      </p>
    </Prose>
  );
}
```

- [x] **Step 7: Register the public routes**

In `web/src/App.tsx`, add these **outside** `<RequireAuth>`, alongside `/signin`:

```tsx
<Route path="/developers" element={<DevelopersLayout />}>
  <Route index element={<Overview />} />
  <Route path="authentication" element={<Authentication />} />
  <Route path="reference" element={<Reference />} />
  <Route path="conventions" element={<Conventions />} />
</Route>
```

- [x] **Step 8: Run to verify it passes**

Run: `cd web && npx vitest run src/pages/developers`
Expected: PASS, 3 tests.

- [x] **Step 9: Commit**

```bash
git add web/src/pages/developers web/src/components/developers web/src/App.tsx \
        web/package.json web/package-lock.json
git commit -F - <<'MSG'
feat(web): developer portal shell, API reference and conventions

Public routes at /developers, outside RequireAuth, because an integrator
reads these before anyone has issued them a key. The reference is rendered
by Scalar from the live /api/v1/openapi.json, so it cannot drift from the
implementation, and Scalar's request client supplies the "try it" runner.

release-note: A developer portal at /developers documents the API, with a live reference you can make real calls from.
MSG
```

---

### Task 52: Recipes in four languages, webhooks, errors and changelog

**Files:**
- Create: `web/src/content/recipes.ts`, `web/src/content/renderers.ts`
- Create: `web/src/components/developers/CodeTabs.tsx`
- Create: `web/src/pages/developers/Recipes.tsx`, `Webhooks.tsx`, `Errors.tsx`, `Changelog.tsx`
- Modify: `web/src/App.tsx` (four more child routes)
- Test: `web/src/content/renderers.test.ts`, `web/src/pages/developers/Errors.test.tsx`

**Interfaces:**
- Consumes: `CodeBlock`, `Prose` (Task 51); `GET /api/v1/errors.json` (Task 50); `GET /api/releases` (Task 47).
- Produces:
  - `interface HttpRequest { method: "GET"|"POST"|"PATCH"|"DELETE"; path: string; query?: Record<string,string>; body?: unknown }`
  - `interface Recipe { id: string; title: string; blurb: string; request: HttpRequest; note?: string }`
  - `RECIPES: Recipe[]` — the eight flows the spec names
  - `renderCurl(req)`, `renderFetch(req)`, `renderPython(req)`, `renderPhp(req)` — all `(req: HttpRequest) => string`
  - `<CodeTabs request={HttpRequest} />` — one flow, four languages

**Design note (spec §10.1, "Recipes" row):** the spec asks for eight flows in four
languages. Hand-writing thirty-two snippets guarantees that the Python example
eventually disagrees with the cURL one about the endpoint. Each flow is instead
described once as an `HttpRequest` and rendered by four small functions, so the four
tabs are provably the same call. Adding a language later is one function, not eight
more snippets.


**Corrections made during execution (2026-09-07).** The plan's recipes were
written against endpoints that do not exist. Read out of the handlers instead:

- `/check-out` and `/check-in` are `checkout` and `checkin`.
- `/api/v1/tags/<tag>` does not exist; the scanner endpoint is
  `GET /api/v1/assets/lookup?tag=`.
- The custody body field is `note`, not `checkout_note`/`checkin_note` — those
  are the stored column names. Zod strips unknown keys, so the plan's version
  would have been accepted with the note silently discarded.
- `purchase_cost` is written as a **number** and read back as a decimal string.
  The plan sent a string, which is a 422.
- `/history` takes no pagination and returns `data.events` and
  `data.assignments` together.
- The import is multipart with a required `mapping` field, so the renderers
  grew an `upload` case rather than pretending it is a JSON body.

A test now asserts every recipe's path is one the API actually serves.

**Defects found while writing the webhooks page, and fixed here:**

1. `asset.created`, `asset.updated`, `asset.deleted` and `import.completed`
   were subscribable and **never dispatched**. A customer could subscribe and
   receive nothing for ever, and "no deliveries" is indistinguishable from
   "nothing happened". Now dispatched from the asset routes and the import
   route, with an integration test that drives the real routes and asserts a
   delivery row appears, plus a source scanner that fails the build if a
   published event has no dispatch site.
2. `warranty.expiring` and `licence.expiring` were dispatched but **not
   subscribable** — the reverse gap. Added to `WEBHOOK_EVENTS`.
3. The delivery body carried no `id`, so the standard advice to de-duplicate
   at-least-once deliveries was impossible to follow. It now carries the
   delivery id, stable across retries.
4. `dispatch` forwarded only `asset_id` to the webhook payload, so
   `import.completed` delivered `{"asset_id": null}` and nothing else. The
   whole event context now travels, minus the two keys that only decide who
   gets emailed.
5. There was **no Settings → Webhooks screen at all**: the only way to
   subscribe was to POST by hand, and the signing secret — returned exactly
   once — arrived in a terminal. Built here, driven by the event list the
   server publishes.

**Also moved:** the Errors page was built in Task 51 so the sidebar had no dead
link.

- [x] **Step 1: Write the failing tests**

`web/src/content/renderers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderCurl, renderFetch, renderPython, renderPhp } from "./renderers";
import { RECIPES } from "./recipes";
import type { HttpRequest } from "./renderers";

const listAssets: HttpRequest = {
  method: "GET",
  path: "/api/v1/assets",
  query: { status: "in_use", per_page: "100" },
};

const createAsset: HttpRequest = {
  method: "POST",
  path: "/api/v1/assets",
  body: { name: "ThinkPad X1", category_id: "<uuid>" },
};

describe("renderCurl", () => {
  it("puts the query string on the URL and quotes it", () => {
    const out = renderCurl(listAssets);
    expect(out).toContain('"https://your-host/api/v1/assets?status=in_use&per_page=100"');
  });

  it("sends the bearer token", () => {
    expect(renderCurl(listAssets)).toContain('-H "Authorization: Bearer $AMS_KEY"');
  });

  it("omits the method flag for GET but states it for POST", () => {
    expect(renderCurl(listAssets)).not.toContain("-X GET");
    expect(renderCurl(createAsset)).toContain("-X POST");
  });

  it("sends a JSON body only when there is one", () => {
    expect(renderCurl(createAsset)).toContain('-H "Content-Type: application/json"');
    expect(renderCurl(listAssets)).not.toContain("Content-Type");
  });
});

describe("renderFetch", () => {
  it("awaits the response and parses JSON", () => {
    const out = renderFetch(listAssets);
    expect(out).toContain("await fetch(");
    expect(out).toContain("await res.json()");
  });

  it("serialises the body with JSON.stringify", () => {
    expect(renderFetch(createAsset)).toContain("JSON.stringify(");
  });
});

describe("renderPython", () => {
  it("uses requests with a params dict for the query", () => {
    const out = renderPython(listAssets);
    expect(out).toContain("import requests");
    expect(out).toContain('params={"status": "in_use", "per_page": "100"}');
  });

  it("passes a body as json=", () => {
    expect(renderPython(createAsset)).toContain("json={");
  });
});

describe("renderPhp", () => {
  it("opens with a php tag and uses curl", () => {
    const out = renderPhp(listAssets);
    expect(out.startsWith("<?php")).toBe(true);
    expect(out).toContain("curl_init");
  });
});

describe("the recipe catalogue", () => {
  it("covers the eight flows the spec names", () => {
    expect(RECIPES.map((r) => r.id)).toEqual([
      "list-assets",
      "create-asset",
      "update-custom-fields",
      "check-out",
      "check-in",
      "read-history",
      "bulk-import",
      "resolve-tag",
    ]);
  });

  it("renders every recipe in every language without throwing", () => {
    for (const recipe of RECIPES) {
      for (const render of [renderCurl, renderFetch, renderPython, renderPhp]) {
        expect(render(recipe.request).length).toBeGreaterThan(20);
      }
    }
  });

  it("gives every recipe a title and a blurb", () => {
    for (const r of RECIPES) {
      expect(r.title.length).toBeGreaterThan(3);
      expect(r.blurb.length).toBeGreaterThan(20);
    }
  });
});
```

`web/src/pages/developers/Errors.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import Errors from "./Errors";

const server = setupServer(
  http.get("*/api/v1/errors.json", () =>
    HttpResponse.json({
      data: [
        {
          type: "https://ams.dev/errors/rate-limited",
          status: 429,
          title: "Rate limit exceeded",
          when: "The API key exceeded its hourly request budget.",
          fix: "Honour the Retry-After header and back off exponentially.",
        },
      ],
    }),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("errors page", () => {
  it("renders the catalogue served by the API", async () => {
    render(<Errors />);
    await waitFor(() =>
      expect(screen.getByText("Rate limit exceeded")).toBeInTheDocument(),
    );
    expect(screen.getByText("429")).toBeInTheDocument();
    expect(screen.getByText(/Retry-After/)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run src/content src/pages/developers/Errors`
Expected: FAIL — `Cannot find module './renderers'`.

- [x] **Step 3: Implement the renderers**

`web/src/content/renderers.ts`:

```ts
export interface HttpRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}

const HOST = "https://your-host";

const queryString = (q?: Record<string, string>) => {
  if (!q || Object.keys(q).length === 0) return "";
  return "?" + new URLSearchParams(q).toString();
};

const url = (req: HttpRequest) => `${HOST}${req.path}${queryString(req.query)}`;

const json = (body: unknown, indent = 2) => JSON.stringify(body, null, indent);

export function renderCurl(req: HttpRequest): string {
  const lines = [`curl "${url(req)}"`];
  if (req.method !== "GET") lines.push(`  -X ${req.method}`);
  lines.push(`  -H "Authorization: Bearer $AMS_KEY"`);
  if (req.body !== undefined) {
    lines.push(`  -H "Content-Type: application/json"`);
    lines.push(`  -d '${json(req.body, 0)}'`);
  }
  return lines.join(" \\\n");
}

export function renderFetch(req: HttpRequest): string {
  const init: string[] = [`  method: "${req.method}",`];
  const headers = [`    "Authorization": \`Bearer \${process.env.AMS_KEY}\`,`];
  if (req.body !== undefined) {
    headers.push(`    "Content-Type": "application/json",`);
  }
  init.push(`  headers: {\n${headers.join("\n")}\n  },`);
  if (req.body !== undefined) {
    init.push(`  body: JSON.stringify(${json(req.body)}),`);
  }

  return `const res = await fetch("${url(req)}", {
${init.join("\n")}
});

if (!res.ok) {
  // Errors are problem+json: read .title and .detail, not the status alone.
  throw new Error((await res.json()).title);
}

const data = await res.json();
console.log(data);`;
}

export function renderPython(req: HttpRequest): string {
  const args = [`    "${HOST}${req.path}"`];
  args.push(`    headers={"Authorization": f"Bearer {os.environ['AMS_KEY']}"}`);
  if (req.query) {
    const pairs = Object.entries(req.query)
      .map(([k, v]) => `"${k}": "${v}"`)
      .join(", ");
    args.push(`    params={${pairs}}`);
  }
  if (req.body !== undefined) {
    args.push(`    json=${json(req.body)}`);
  }

  return `import os
import requests

res = requests.${req.method.toLowerCase()}(
${args.join(",\n")},
)
res.raise_for_status()
print(res.json())`;
}

export function renderPhp(req: HttpRequest): string {
  const setopt = [
    `curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);`,
    `curl_setopt($ch, CURLOPT_HTTPHEADER, [`,
    `    'Authorization: Bearer ' . getenv('AMS_KEY'),`,
  ];
  if (req.body !== undefined) setopt.push(`    'Content-Type: application/json',`);
  setopt.push(`]);`);
  if (req.method !== "GET") {
    setopt.push(`curl_setopt($ch, CURLOPT_CUSTOMREQUEST, '${req.method}');`);
  }
  if (req.body !== undefined) {
    setopt.push(
      `curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(${phpArray(req.body)}));`,
    );
  }

  return `<?php
$ch = curl_init('${url(req)}');
${setopt.join("\n")}

$response = curl_exec($ch);
curl_close($ch);

print_r(json_decode($response, true));`;
}

/** Renders a JS value as a PHP array literal, for the POSTFIELDS argument. */
function phpArray(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return `'${value.replace(/'/g, "\\'")}'`;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(phpArray).join(", ")}]`;
  if (typeof value === "object") {
    const pairs = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `'${k}' => ${phpArray(v)}`)
      .join(", ");
    return `[${pairs}]`;
  }
  return "null";
}
```

- [x] **Step 4: Write the recipe catalogue**

`web/src/content/recipes.ts`:

```ts
import type { HttpRequest } from "./renderers";

export interface Recipe {
  id: string;
  title: string;
  blurb: string;
  request: HttpRequest;
  note?: string;
}

export const RECIPES: Recipe[] = [
  {
    id: "list-assets",
    title: "List assets",
    blurb:
      "Read a page of the register, newest first, filtered to the assets currently checked out.",
    request: {
      method: "GET",
      path: "/api/v1/assets",
      query: { status: "in_use", sort: "-created_at", per_page: "100" },
    },
    note: "Page with page and per_page until meta.page reaches meta.total_pages.",
  },
  {
    id: "create-asset",
    title: "Create an asset",
    blurb:
      "Register a new asset. Omit asset_tag and the server allocates the next one for your organisation.",
    request: {
      method: "POST",
      path: "/api/v1/assets",
      body: {
        name: "ThinkPad X1 Carbon",
        category_id: "<category-uuid>",
        serial_no: "PF3ABCDE",
        status: "available",
        location_id: "<location-uuid>",
        purchase_cost: "24500000.00",
        currency: "IDR",
      },
    },
    note:
      "Send an Idempotency-Key header so a retried request cannot create a second asset.",
  },
  {
    id: "update-custom-fields",
    title: "Update custom fields",
    blurb:
      "Patch the per-category custom fields. Values are validated against the category's field schema, so an unknown key or a wrong type is rejected.",
    request: {
      method: "PATCH",
      path: "/api/v1/assets/<asset-uuid>",
      body: { custom: { warranty_expires_at: "2028-04-01", hours_run: 1420 } },
    },
    note:
      "custom is merged, not replaced: keys you omit keep their current values.",
  },
  {
    id: "check-out",
    title: "Check an asset out",
    blurb:
      "Assign custody to a user, a location or a named external party, optionally with a due date.",
    request: {
      method: "POST",
      path: "/api/v1/assets/<asset-uuid>/check-out",
      body: {
        assignee_type: "user",
        assignee_id: "<user-uuid>",
        due_at: "2026-10-01T09:00:00Z",
        checkout_note: "Onsite installation",
      },
    },
    note:
      "An asset already checked out returns 409 conflict; check it in first.",
  },
  {
    id: "check-in",
    title: "Check an asset back in",
    blurb:
      "Close the open assignment and return the asset to available, recording its condition.",
    request: {
      method: "POST",
      path: "/api/v1/assets/<asset-uuid>/check-in",
      body: { condition: "good", checkin_note: "Returned with charger" },
    },
  },
  {
    id: "read-history",
    title: "Read an asset's history",
    blurb:
      "The immutable audit trail: who changed what, who held it and when, oldest to newest.",
    request: {
      method: "GET",
      path: "/api/v1/assets/<asset-uuid>/history",
      query: { per_page: "200" },
    },
  },
  {
    id: "bulk-import",
    title: "Import a spreadsheet",
    blurb:
      "Upload a CSV or XLSX and preview it. A dry run reports what would be created, updated and rejected without writing anything.",
    request: {
      method: "POST",
      path: "/api/v1/imports",
      query: { dry_run: "true" },
    },
    note:
      "Send the file as multipart/form-data under the field name file. Re-post with dry_run=false to commit the same mapping.",
  },
  {
    id: "resolve-tag",
    title: "Resolve a scanned tag",
    blurb:
      "Turn a barcode payload from a scanner into the asset it identifies. This is the endpoint behind the dashboard's scan dialog.",
    request: { method: "GET", path: "/api/v1/tags/AMS-000123" },
    note:
      "QR labels encode a deep link ending in the same tag, so stripping the URL prefix gives the value this endpoint takes.",
  },
];
```

- [x] **Step 5: Build CodeTabs and the four pages**

`web/src/components/developers/CodeTabs.tsx`:

```tsx
import { useState } from "react";
import CodeBlock from "./CodeBlock";
import {
  renderCurl, renderFetch, renderPython, renderPhp, type HttpRequest,
} from "../../content/renderers";

const LANGUAGES = [
  { key: "curl", label: "cURL", language: "bash", render: renderCurl },
  { key: "js", label: "JavaScript", language: "javascript", render: renderFetch },
  { key: "python", label: "Python", language: "python", render: renderPython },
  { key: "php", label: "PHP", language: "php", render: renderPhp },
] as const;

export default function CodeTabs({ request }: { request: HttpRequest }) {
  const [active, setActive] = useState<string>(LANGUAGES[0].key);
  const current = LANGUAGES.find((l) => l.key === active) ?? LANGUAGES[0];

  return (
    <div className="space-y-2">
      <div role="tablist" className="flex gap-1">
        {LANGUAGES.map((l) => (
          <button
            key={l.key}
            role="tab"
            aria-selected={l.key === active}
            onClick={() => setActive(l.key)}
            className={`rounded px-3 py-1 text-xs font-medium ${
              l.key === active
                ? "bg-brand-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <CodeBlock language={current.language} code={current.render(request)} />
    </div>
  );
}
```

`web/src/pages/developers/Recipes.tsx`:

```tsx
import Prose from "../../components/developers/Prose";
import CodeTabs from "../../components/developers/CodeTabs";
import { RECIPES } from "../../content/recipes";

export default function Recipes() {
  return (
    <Prose>
      <h2>Recipes</h2>
      <p>
        The eight flows most integrations need. Every tab is rendered from one
        request description, so the four languages always make the same call.
        Set <code>AMS_KEY</code> in your environment before running any of them.
      </p>

      {RECIPES.map((recipe) => (
        <section key={recipe.id} className="pt-6">
          <h3 id={recipe.id}>{recipe.title}</h3>
          <p>{recipe.blurb}</p>
          <CodeTabs request={recipe.request} />
          {recipe.note && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{recipe.note}</p>
          )}
        </section>
      ))}
    </Prose>
  );
}
```

`web/src/pages/developers/Webhooks.tsx`:

```tsx
import Prose from "../../components/developers/Prose";
import CodeBlock from "../../components/developers/CodeBlock";

const EVENTS = [
  ["asset.created", "An asset was registered."],
  ["asset.updated", "Any field on an asset changed, including custom fields."],
  ["asset.deleted", "An asset was soft-deleted."],
  ["asset.checked_out", "Custody passed to a user, location or external party."],
  ["asset.checked_in", "An open assignment was closed."],
  ["assignment.overdue", "An assignment passed its due_at without being checked in."],
  ["import.completed", "A committed import finished, with its counts."],
];

export default function Webhooks() {
  return (
    <Prose>
      <h2>Webhooks</h2>
      <p>
        Subscribe in <strong>Settings → Webhooks</strong>. Each delivery is a{" "}
        <code>POST</code> of <code>application/json</code> to your URL, signed so
        you can prove it came from us.
      </p>

      <h3>Events</h3>
      <table>
        <thead><tr><th>Event</th><th>Fires when</th></tr></thead>
        <tbody>
          {EVENTS.map(([name, when]) => (
            <tr key={name}><td><code>{name}</code></td><td>{when}</td></tr>
          ))}
        </tbody>
      </table>

      <h3>Payload</h3>
      <CodeBlock
        language="json"
        code={`{
  "id": "evt_01J8Z3M4QK",
  "event": "asset.checked_out",
  "occurred_at": "2026-09-04T08:15:00Z",
  "org_id": "3f7c…",
  "data": {
    "asset": { "id": "…", "asset_tag": "AMS-000123", "status": "in_use" },
    "assignment": { "assignee_label": "Rina", "due_at": "2026-10-01T09:00:00Z" }
  }
}`}
      />

      <h3>Verifying the signature</h3>
      <p>
        Every delivery carries <code>X-AMS-Signature</code> —{" "}
        <code>sha256=&lt;hex&gt;</code>, an HMAC of the <strong>raw request body</strong>{" "}
        under your endpoint's secret. Compare it in constant time, and always hash
        the raw bytes: re-serialising the parsed JSON changes the bytes and the
        signature will never match.
      </p>

      <CodeBlock
        language="javascript"
        code={`import crypto from "node:crypto";

// express.raw({ type: "application/json" }) — req.body must stay a Buffer.
function verify(rawBody, header, secret) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(header ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`}
      />

      <CodeBlock
        language="python"
        code={`import hmac, hashlib

def verify(raw_body: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header or "")`}
      />

      <CodeBlock
        language="php"
        code={`<?php
function verify(string $rawBody, ?string $header, string $secret): bool {
    $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);
    return hash_equals($expected, $header ?? '');
}`}
      />

      <h3>Retries</h3>
      <p>
        Respond <code>2xx</code> within 10 seconds. Anything else is retried with
        exponential backoff. Deliveries carry a stable <code>id</code>, so record
        the ids you have processed and ignore repeats rather than assuming
        exactly-once delivery.
      </p>
    </Prose>
  );
}
```

`web/src/pages/developers/Errors.tsx`:

```tsx
import { useEffect, useState } from "react";
import Prose from "../../components/developers/Prose";
import CodeBlock from "../../components/developers/CodeBlock";

interface ErrorDoc {
  type: string;
  status: number;
  title: string;
  when: string;
  fix: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export default function Errors() {
  const [entries, setEntries] = useState<ErrorDoc[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/v1/errors.json`)
      .then((r) => r.json())
      .then((body: { data: ErrorDoc[] }) => setEntries(body.data))
      .catch(() => setFailed(true));
  }, []);

  return (
    <Prose>
      <h2>Errors</h2>
      <p>
        Every failure is an RFC 7807 problem document with{" "}
        <code>content-type: application/problem+json</code>. Branch on{" "}
        <code>type</code>, which is stable, rather than on the wording of{" "}
        <code>title</code>, which is not.
      </p>

      <CodeBlock
        language="json"
        code={`{
  "type": "https://ams.dev/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "errors": [{ "field": "name", "message": "String must contain at least 1 character(s)" }]
}`}
      />

      {failed && <p>The error catalogue is temporarily unavailable.</p>}

      {entries.map((e) => (
        <section key={e.type} className="pt-6">
          <h3>
            {e.title}{" "}
            <span className="text-sm font-normal text-gray-500">{e.status}</span>
          </h3>
          <p><code>{e.type}</code></p>
          <p><strong>When:</strong> {e.when}</p>
          <p><strong>Fix:</strong> {e.fix}</p>
        </section>
      ))}
    </Prose>
  );
}
```

`web/src/pages/developers/Changelog.tsx`:

```tsx
import { useEffect, useState } from "react";
import Prose from "../../components/developers/Prose";

interface ReleaseEntry { type: string; summary: string }
interface Release { version: string; released_at: string; entries: ReleaseEntry[] }

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export default function Changelog() {
  const [releases, setReleases] = useState<Release[]>([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/releases`)
      .then((r) => r.json())
      .then((body: { data: Release[] }) => setReleases(body.data))
      .catch(() => setReleases([]));
  }, []);

  return (
    <Prose>
      <h2>Changelog</h2>

      <h3>Versioning policy</h3>
      <p>
        The product version is SemVer. The <strong>API</strong> version is separate
        and appears in the path. <code>/api/v1</code> is additive-only once
        published: new fields and new endpoints appear, but an existing field is
        never removed, renamed or retyped. Code defensively against unknown
        fields and your integration will survive every minor release.
      </p>
      <p>
        A genuinely breaking change ships as <code>/api/v2</code> served alongside{" "}
        <code>v1</code>. We announce a deprecation window before retiring a
        version; we do not remove one without notice.
      </p>

      <h3>Releases</h3>
      {releases.length === 0 && <p>No releases have been published yet.</p>}
      {releases.map((r) => (
        <section key={r.version} className="pt-4">
          <h3>
            {r.version}{" "}
            <span className="text-sm font-normal text-gray-500">
              {new Date(r.released_at).toLocaleDateString()}
            </span>
          </h3>
          <ul>
            {r.entries.map((e, i) => (
              <li key={i}>
                <strong>{e.type}</strong> — {e.summary}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Prose>
  );
}
```

- [x] **Step 6: Register the remaining routes**

In `web/src/App.tsx`, inside the existing `/developers` route:

```tsx
<Route path="recipes" element={<Recipes />} />
<Route path="webhooks" element={<Webhooks />} />
<Route path="errors" element={<Errors />} />
<Route path="changelog" element={<Changelog />} />
```

- [x] **Step 7: Run to verify it passes**

Run: `cd web && npx vitest run src/content src/pages/developers`
Expected: PASS — 15 renderer tests, 1 errors-page test, 3 from Task 51.

- [x] **Step 8: Commit**

```
git add web/src/content web/src/components/developers/CodeTabs.tsx \
        web/src/pages/developers web/src/App.tsx
git commit
```

Commit message:

```
feat(web): API recipes in four languages, webhooks, errors and changelog

Each of the eight flows is described once as a request and rendered into
cURL, JavaScript, Python and PHP, so the four tabs cannot disagree about
the call they make. The errors page renders the catalogue the API serves,
so it cannot drift from what handlers actually return.

release-note: The developer portal now carries copy-paste examples in four languages, webhook signature verification and a full error reference.
```

---

### Task 53: First-run tour, contextual help, teaching empty states and onboarding checklists

**Files:**
- Create: `web/src/content/help/blocks.tsx` (block types + renderer)
- Create: `web/src/content/help/topics.ts` (one help topic per route)
- Create: `web/src/components/help/HelpButton.tsx`, `HelpPanel.tsx`
- Create: `web/src/components/help/TourProvider.tsx`, `web/src/components/help/tourSteps.ts`
- Create: `web/src/components/common/EmptyState.tsx`
- Create: `web/src/components/help/OnboardingChecklist.tsx`
- Modify: `web/src/App.tsx` (mount `<TourProvider>`), `web/src/layout/AppLayout.tsx`, `web/src/pages/Dashboard.tsx` (checklist), `web/src/pages/Assets.tsx` and `Categories.tsx` (empty states)
- Test: `web/src/content/help/topics.test.ts`, `web/src/components/help/HelpPanel.test.tsx`, `web/src/components/help/OnboardingChecklist.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 21), `assetsApi`, `categoriesApi`, `apiKeysApi` (Tasks 22, 31).
- Produces:
  - `type Block = { kind: "p"; text: string } | { kind: "steps"; items: string[] } | { kind: "list"; items: string[] } | { kind: "note"; text: string } | { kind: "term"; term: string; definition: string }`
  - `<Blocks blocks={Block[]} />` — the shared renderer for the panel, the help centre and the printed guide
  - `HELP_TOPICS: Record<string, { title: string; blocks: Block[]; article?: string }>` keyed by route path
  - `<HelpButton />` — the `?` in a page header
  - `useTour(): { start(): void; hasSeen: boolean }`
  - `<EmptyState title description actionLabel onAction icon />`
  - `<OnboardingChecklist />`

**Design note (spec §10.2):** the panel, the help centre (Task 54) and the printable
guide (Task 54) are three renderings of one content module. `Block` is a small closed
union rather than Markdown because it needs no parser, cannot inject HTML, and is
type-checked — a typo in a block kind fails the build instead of rendering as literal
asterisks in front of a customer.

**Why the tour state lives in `localStorage`:** the spec says the tour fires once per
user. Keying it by user id in `localStorage` needs no schema change and no request on
every page load. The trade-off is that a user on a second browser sees it again, which
is a mild annoyance rather than a defect, and the tour is dismissible in one click.


**Corrections made during execution (2026-09-07).**

- The plan keys the onboarding checklist on `user.role` with the values
  `admin | manager | technician | viewer`. `SessionUser` has no `role` field,
  and roles are tenant-owned and renameable since Phase 1b — keying on the
  string "admin" breaks the moment a customer calls their administrators
  something else, which they are free to do. `checklistFor` takes `can` and
  filters by permission, the same way every other gate in the UI works.
- Completion needs counts the dashboard did not return. `GET
  /api/v1/dashboard/summary` gained a `setup` block (categories, users, api
  keys, committed imports, assignments ever opened). "Ever opened" rather than
  "open now", so an item does not un-tick itself when the asset comes back;
  committed imports only, so a dry run cannot claim the register was imported.
- The register's teaching empty state already existed and is better than the
  plan's version — it distinguishes "nothing here" from "nothing matches your
  filters" and gates each action by permission. Left alone; `EmptyState` was
  applied to Categories instead.
- File paths in the plan are wrong throughout: the dashboard is
  `pages/Dashboard/Home.tsx`, the register `pages/Assets/AssetList.tsx`, and
  categories `pages/Catalog/Categories.tsx`.
- The plan's route list for the help topics is a subset of the real one. The
  test reads the routes out of `App.tsx` instead, so a new page without help
  fails the build; `/a/:tag` is excluded, being a redirect nobody looks at.
- `topicForPath` needed an exact-match-first rule: `/assets/new` matches the
  `/assets/:id` pattern, so without it somebody adding an asset was shown how
  to read an asset's history.
- driver.js is imported only when the tour runs (its own 26 kB chunk), and a
  test reads the `data-tour` attributes out of the source — driver.js skips a
  step whose element is missing, silently, which is the failure nobody notices.
- The tour is replayable from the help panel rather than only from the help
  centre in Task 54: somebody who dismissed it on day one otherwise has no way
  back to it.

- [x] **Step 1: Install driver.js**

```bash
cd web
npm install driver.js
```

- [x] **Step 2: Write the failing tests**

`web/src/content/help/topics.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { HELP_TOPICS } from "./topics";

// Every authenticated route a user can land on needs contextual help. A new
// page without a topic fails here rather than shipping a dead ? button.
const ROUTES = [
  "/", "/assets", "/assets/new", "/assets/:id", "/categories", "/locations",
  "/import", "/reports", "/settings/api-keys", "/settings/webhooks",
];

describe("help topics", () => {
  it("covers every dashboard route", () => {
    const missing = ROUTES.filter((r) => !HELP_TOPICS[r]);
    expect(missing).toEqual([]);
  });

  it("gives every topic a title and at least one block", () => {
    for (const [route, topic] of Object.entries(HELP_TOPICS)) {
      expect(topic.title.length, `${route} title`).toBeGreaterThan(3);
      expect(topic.blocks.length, `${route} blocks`).toBeGreaterThan(0);
    }
  });

  it("explains the concepts the spec names", () => {
    const all = JSON.stringify(HELP_TOPICS);
    for (const concept of ["field schema", "dry run", "maintenance"]) {
      expect(all.toLowerCase()).toContain(concept);
    }
  });
});
```

`web/src/components/help/HelpPanel.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import HelpButton from "./HelpButton";

const renderAt = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <HelpButton route="/assets" />
    </MemoryRouter>,
  );

describe("contextual help", () => {
  it("stays closed until asked", () => {
    renderAt("/assets");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the topic for the current page", async () => {
    renderAt("/assets");
    await userEvent.click(screen.getByRole("button", { name: /help/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("The asset register")).toBeInTheDocument();
  });

  it("closes again", async () => {
    renderAt("/assets");
    await userEvent.click(screen.getByRole("button", { name: /help/i }));
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
```

`web/src/components/help/OnboardingChecklist.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { checklistFor, type OnboardingState } from "./OnboardingChecklist";
import OnboardingChecklist from "./OnboardingChecklist";

const state: OnboardingState = {
  categories: 0, assets: 0, checkouts: 0, apiKeys: 0, imports: 0,
};

describe("onboarding checklist", () => {
  it("gives an admin setup tasks a technician does not get", () => {
    const admin = checklistFor("admin", state).map((i) => i.id);
    const tech = checklistFor("technician", state).map((i) => i.id);
    expect(admin).toContain("create-category");
    expect(admin).toContain("invite-team");
    expect(tech).not.toContain("invite-team");
    expect(tech).toContain("scan-asset");
  });

  it("marks an item done from real data, not a stored flag", () => {
    const before = checklistFor("admin", state).find((i) => i.id === "create-category");
    const after = checklistFor("admin", { ...state, categories: 2 })
      .find((i) => i.id === "create-category");
    expect(before?.done).toBe(false);
    expect(after?.done).toBe(true);
  });

  it("disappears once every item is done", () => {
    const done: OnboardingState = {
      categories: 3, assets: 40, checkouts: 2, apiKeys: 1, imports: 1,
    };
    const { container } = render(
      <MemoryRouter>
        <OnboardingChecklist role="admin" state={done} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows remaining work with a progress count", () => {
    render(
      <MemoryRouter>
        <OnboardingChecklist role="admin" state={{ ...state, categories: 1 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/1 of 5/)).toBeInTheDocument();
  });
});
```

- [x] **Step 3: Run to verify they fail**

Run: `cd web && npx vitest run src/content/help src/components/help`
Expected: FAIL — `Cannot find module './topics'`.

- [x] **Step 4: Implement the block renderer**

`web/src/content/help/blocks.tsx`:

```tsx
export type Block =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "note"; text: string }
  | { kind: "term"; term: string; definition: string };

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-gray-600 dark:text-gray-300">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "p":
            return <p key={i}>{block.text}</p>;
          case "steps":
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5">
                {block.items.map((item, j) => <li key={j}>{item}</li>)}
              </ol>
            );
          case "list":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {block.items.map((item, j) => <li key={j}>{item}</li>)}
              </ul>
            );
          case "note":
            return (
              <p
                key={i}
                className="rounded-lg border-l-4 border-brand-500 bg-brand-50 p-3 text-gray-700 dark:bg-brand-500/10 dark:text-gray-200"
              >
                {block.text}
              </p>
            );
          case "term":
            return (
              <p key={i}>
                <strong className="text-gray-900 dark:text-white">{block.term}</strong>
                {" — "}
                {block.definition}
              </p>
            );
        }
      })}
    </div>
  );
}
```

- [x] **Step 5: Write the per-route help topics**

`web/src/content/help/topics.ts`:

```ts
import type { Block } from "./blocks";

export interface HelpTopic {
  title: string;
  blocks: Block[];
  /** Slug of the fuller help-centre article, linked from the panel (Task 54). */
  article?: string;
}

export const HELP_TOPICS: Record<string, HelpTopic> = {
  "/": {
    title: "Your dashboard",
    article: "getting-started",
    blocks: [
      { kind: "p", text: "A live summary of the register: how many assets you hold, what state they are in, and what needs attention today." },
      { kind: "term", term: "Utilisation", definition: "the share of assets currently checked out. Persistently low utilisation usually means you own more than you need." },
      { kind: "term", term: "Overdue", definition: "an asset checked out past its due date. Click through to see who holds it." },
      { kind: "note", text: "Every tile is a filter. Click one to open the register already narrowed to those assets." },
    ],
  },

  "/assets": {
    title: "The asset register",
    article: "managing-assets",
    blocks: [
      { kind: "p", text: "Every asset you own, in one searchable table. Search matches names, asset tags and serial numbers, so a partial serial from a sticker is enough to find a machine." },
      { kind: "p", text: "Filters combine: choose a category, a status and a location together to narrow to exactly the set you mean." },
      { kind: "term", term: "Status", definition: "available means nobody holds it; in use means it is checked out; maintenance means it is being serviced; retired means it has left service but is kept for the record; lost means it is unaccounted for." },
      { kind: "note", text: "Select rows with the checkboxes to change status, move location or print labels for many assets at once." },
    ],
  },

  "/assets/new": {
    title: "Adding an asset",
    article: "managing-assets",
    blocks: [
      { kind: "p", text: "Only a name and a category are required. Leave the asset tag blank and the next one in your sequence is allocated automatically." },
      { kind: "p", text: "Choosing a category changes the form: the extra fields below the standard ones come from that category's field schema." },
      { kind: "note", text: "Adding many assets at once is faster through Import than through this form." },
    ],
  },

  "/assets/:id": {
    title: "Asset detail",
    article: "managing-assets",
    blocks: [
      { kind: "p", text: "Everything known about one asset, including who has held it and every change ever made to it." },
      { kind: "term", term: "History", definition: "an append-only audit trail. Entries are never edited or deleted, which is what makes the register usable as evidence in an audit." },
      { kind: "p", text: "Check out passes custody to a person, a location or a named external party. Check in closes that assignment and returns the asset to available." },
    ],
  },

  "/categories": {
    title: "Categories and custom fields",
    article: "categories-and-fields",
    blocks: [
      { kind: "p", text: "Categories group assets that share the same extra information. A laptop needs a warranty date; a generator needs running hours; a video file needs a licence expiry." },
      { kind: "term", term: "Field schema", definition: "the list of extra fields assets in this category carry. Each field has a key, a label, a type (text, number, date, select or boolean) and an optional required flag." },
      { kind: "p", text: "Adding a field to a category makes it appear on the form for every asset in that category. Existing assets simply have no value for it until you set one." },
      { kind: "note", text: "Changing a field's type after assets hold values for it is rejected, because it would make existing data invalid. Add a new field instead." },
    ],
  },

  "/locations": {
    title: "Locations",
    article: "managing-assets",
    blocks: [
      { kind: "p", text: "Where assets live, as a tree: a site contains buildings, a building contains rooms." },
      { kind: "p", text: "An asset has a home location, and may separately be checked out to a location — a tool assigned to a workshop rather than to a person." },
      { kind: "note", text: "Deleting a location does not delete its assets; they keep the record but lose the location." },
    ],
  },

  "/import": {
    title: "Importing a spreadsheet",
    article: "importing",
    blocks: [
      { kind: "p", text: "Bring an existing register in from CSV or Excel in three steps: upload the file, map its columns onto asset fields, then review the preview before anything is written." },
      { kind: "term", term: "Dry run", definition: "a full validation pass that writes nothing. It reports exactly what would be created, what would be updated and which rows would be rejected and why." },
      { kind: "p", text: "Rows are matched to existing assets by asset tag or serial number, so re-importing an updated sheet updates rather than duplicates." },
      { kind: "note", text: "Always read the dry-run preview. It is the only chance to catch a mis-mapped column before it rewrites your register." },
    ],
  },

  "/reports": {
    title: "Reports",
    article: "reports",
    blocks: [
      { kind: "p", text: "Prebuilt reports over the register, each downloadable as JSON, CSV, Excel, PDF or an image." },
      { kind: "p", text: "Every format comes from the same query, so the PDF you email and the CSV you analyse can never disagree." },
      { kind: "term", term: "Scheduled report", definition: "a saved report the system runs on a timetable and emails to a chosen list of recipients." },
    ],
  },

  "/settings/api-keys": {
    title: "API keys",
    article: "api-keys",
    blocks: [
      { kind: "p", text: "Keys let another system read or update your register through the API. Give each system its own key, so one can be revoked without disturbing the others." },
      { kind: "term", term: "Scope", definition: "what a key is allowed to do. Grant the narrowest set that works — a reporting script needs assets:read and nothing more." },
      { kind: "note", text: "A key is shown once, at creation. Only a hash is stored, so it cannot be recovered. If it is lost, revoke it and mint another." },
    ],
  },

  "/settings/webhooks": {
    title: "Webhooks",
    article: "api-keys",
    blocks: [
      { kind: "p", text: "Have the system notify another application the moment something happens, instead of that application polling for changes." },
      { kind: "p", text: "Each delivery is signed with your endpoint's secret so the receiver can prove it came from us." },
      { kind: "note", text: "Failed deliveries are retried with increasing delays. Respond quickly and do the slow work afterwards." },
    ],
  },
};
```

- [x] **Step 6: Build the help button and panel**

`web/src/components/help/HelpPanel.tsx`:

```tsx
import { Link } from "react-router";
import { Blocks } from "../../content/help/blocks";
import type { HelpTopic } from "../../content/help/topics";

interface Props {
  topic: HelpTopic;
  onClose: () => void;
}

export default function HelpPanel({ topic, onClose }: Props) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-gray-900/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label={topic.title}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {topic.title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close help"
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        <Blocks blocks={topic.blocks} />

        {topic.article && (
          <Link
            to={`/help/${topic.article}`}
            className="text-sm text-brand-500 underline"
            onClick={onClose}
          >
            Read the full article
          </Link>
        )}
      </aside>
    </>
  );
}
```

`web/src/components/help/HelpButton.tsx`:

```tsx
import { useState } from "react";
import HelpPanel from "./HelpPanel";
import { HELP_TOPICS } from "../../content/help/topics";

/** The ? in a page header. `route` is the HELP_TOPICS key for the page. */
export default function HelpButton({ route }: { route: string }) {
  const [open, setOpen] = useState(false);
  const topic = HELP_TOPICS[route];
  if (!topic) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={`Help with ${topic.title}`}
        title="Help"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
      >
        ?
      </button>
      {open && <HelpPanel topic={topic} onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [x] **Step 7: Build the first-run tour**

`web/src/components/help/tourSteps.ts`:

```ts
import type { DriveStep } from "driver.js";

// Each element selector must exist in AppLayout or the register page. Add the
// matching data-tour attribute when you add a step, or driver.js skips it.
export const TOUR_STEPS: DriveStep[] = [
  {
    element: '[data-tour="sidebar"]',
    popover: {
      title: "Everything lives here",
      description:
        "Your register, categories, locations, imports and reports. The dot marks pages with something new.",
    },
  },
  {
    element: '[data-tour="register"]',
    popover: {
      title: "The register",
      description:
        "Every asset you own. Search by name, tag or serial — a partial serial from a sticker is enough.",
    },
  },
  {
    element: '[data-tour="filters"]',
    popover: {
      title: "Narrow it down",
      description:
        "Filters combine. Category, status and location together get you to exactly the set you mean.",
    },
  },
  {
    element: '[data-tour="asset-row"]',
    popover: {
      title: "Open an asset",
      description:
        "Its full history is on the detail page: every change, and everyone who has held it.",
    },
  },
  {
    element: '[data-tour="checkout"]',
    popover: {
      title: "Check things in and out",
      description:
        "Pass custody to a person, a location or an outside party, with a due date if it is coming back.",
    },
  },
  {
    element: '[data-tour="scan"]',
    popover: {
      title: "Scan a label",
      description:
        "Use your camera, or a USB scanner. Both jump straight to the asset.",
    },
  },
  {
    element: '[data-tour="import"]',
    popover: {
      title: "Bring in what you already have",
      description:
        "Upload a spreadsheet and preview it before anything is written. Start here if you keep your register in Excel today.",
    },
  },
  {
    element: '[data-tour="help"]',
    popover: {
      title: "Help is on every page",
      description:
        "The ? explains the screen you are on. Replay this tour any time from the Help centre.",
    },
  },
];
```

`web/src/components/help/TourProvider.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useAuth } from "../../context/AuthContext";
import { TOUR_STEPS } from "./tourSteps";

interface TourValue {
  start: () => void;
  hasSeen: boolean;
}

const TourContext = createContext<TourValue>({ start: () => {}, hasSeen: true });

export const useTour = () => useContext(TourContext);

const seenKey = (userId: string) => `ams.tour.seen.${userId}`;

export function TourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [hasSeen, setHasSeen] = useState(true);

  useEffect(() => {
    if (!user) return;
    try {
      setHasSeen(localStorage.getItem(seenKey(user.id)) === "1");
    } catch {
      // Private browsing can throw on access; treat it as already seen rather
      // than showing the tour on every page load.
      setHasSeen(true);
    }
  }, [user]);

  const markSeen = useCallback(() => {
    setHasSeen(true);
    if (!user) return;
    try {
      localStorage.setItem(seenKey(user.id), "1");
    } catch {
      // Nothing to do: the tour simply runs again next session.
    }
  }, [user]);

  const start = useCallback(() => {
    driver({
      showProgress: true,
      steps: TOUR_STEPS,
      onDestroyed: markSeen,
    }).drive();
  }, [markSeen]);

  // First run: only once the user is loaded, and only on the register, where
  // every element the tour points at is actually on screen.
  useEffect(() => {
    if (!user || hasSeen) return;
    if (window.location.pathname !== "/assets") return;
    const id = setTimeout(start, 600);
    return () => clearTimeout(id);
  }, [user, hasSeen, start]);

  return (
    <TourContext.Provider value={{ start, hasSeen }}>
      {children}
    </TourContext.Provider>
  );
}
```

Mount it inside `<AuthProvider>` in `web/src/App.tsx`, wrapping the authenticated routes.
Add `data-tour` attributes to the sidebar (`sidebar`), the register table (`register`),
the filter bar (`filters`), the first table row (`asset-row`), the check-out button
(`checkout`), the scan button (`scan`), the import nav item (`import`) and the help
button (`help`).

- [x] **Step 8: Build the teaching empty state**

`web/src/components/common/EmptyState.tsx`:

```tsx
import type { ReactNode } from "react";
import Button from "../ui/button/Button";

interface Props {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  icon?: ReactNode;
}

/**
 * An empty table is a dead end. Every empty state names the next action, so a
 * new customer's first screen tells them what to do rather than showing a grid
 * with no rows.
 */
export default function EmptyState({
  title, description, actionLabel, onAction, secondaryLabel, onSecondary, icon,
}: Props) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-gray-300 dark:text-gray-600">{icon}</div>}
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
      <p className="max-w-md text-sm text-gray-500 dark:text-gray-400">{description}</p>
      <div className="mt-2 flex gap-2">
        {actionLabel && onAction && (
          <Button size="sm" variant="primary" onClick={onAction}>{actionLabel}</Button>
        )}
        {secondaryLabel && onSecondary && (
          <Button size="sm" variant="outline" onClick={onSecondary}>{secondaryLabel}</Button>
        )}
      </div>
    </div>
  );
}
```

Use it in place of the bare "no rows" markup. On the register:

```tsx
<EmptyState
  title="No assets yet"
  description="Import the spreadsheet you keep today, or add your first asset by hand. Most people start with an import."
  actionLabel="Import a spreadsheet"
  onAction={() => navigate("/import")}
  secondaryLabel="Add an asset"
  onSecondary={() => navigate("/assets/new")}
/>
```

On categories:

```tsx
<EmptyState
  title="No categories yet"
  description="Categories decide which extra fields an asset carries — a warranty date for laptops, running hours for machinery."
  actionLabel="Create a category"
  onAction={openCreate}
/>
```

- [x] **Step 9: Build the role-based onboarding checklist**

`web/src/components/help/OnboardingChecklist.tsx`:

```tsx
import { Link } from "react-router";

export interface OnboardingState {
  categories: number;
  assets: number;
  checkouts: number;
  apiKeys: number;
  imports: number;
}

export interface ChecklistItem {
  id: string;
  label: string;
  to: string;
  done: boolean;
}

type Role = "admin" | "manager" | "technician" | "viewer";

/**
 * Completion is derived from the register itself, never from a stored flag.
 * A checklist that can disagree with reality is worse than none: it tells a
 * new admin they have done something they have not.
 */
export function checklistFor(role: Role, s: OnboardingState): ChecklistItem[] {
  const setup: ChecklistItem[] = [
    { id: "create-category", label: "Create your first category", to: "/categories", done: s.categories > 0 },
    { id: "import-assets", label: "Import your existing register", to: "/import", done: s.imports > 0 || s.assets > 0 },
    { id: "check-out", label: "Check an asset out to someone", to: "/assets", done: s.checkouts > 0 },
  ];

  const admin: ChecklistItem[] = [
    { id: "invite-team", label: "Invite your team", to: "/settings/users", done: false },
    { id: "mint-key", label: "Connect another system with an API key", to: "/settings/api-keys", done: s.apiKeys > 0 },
  ];

  const floor: ChecklistItem[] = [
    { id: "scan-asset", label: "Scan an asset label", to: "/assets", done: s.checkouts > 0 },
  ];

  switch (role) {
    case "admin":
      return [...setup, ...admin];
    case "manager":
      return setup;
    case "technician":
      return [...floor, { ...setup[2] }];
    default:
      return [];
  }
}

interface Props {
  role: Role;
  state: OnboardingState;
}

export default function OnboardingChecklist({ role, state }: Props) {
  const items = checklistFor(role, state);
  const done = items.filter((i) => i.done).length;

  // Once there is nothing left to do, the checklist stops taking up the
  // dashboard rather than sitting there permanently ticked.
  if (items.length === 0 || done === items.length) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">Getting set up</h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {done} of {items.length}
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
                item.done
                  ? "border-success-500 bg-success-500 text-white"
                  : "border-gray-300 dark:border-gray-600"
              }`}
            >
              {item.done ? "✓" : ""}
            </span>
            {item.done ? (
              <span className="text-sm text-gray-400 line-through">{item.label}</span>
            ) : (
              <Link to={item.to} className="text-sm text-gray-700 hover:underline dark:text-gray-200">
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Render it at the top of `Dashboard.tsx`, passing `user.role` and counts already fetched
for the KPI tiles.

- [x] **Step 10: Run to verify it passes**

Run: `cd web && npx vitest run src/content/help src/components/help`
Expected: PASS — 3 topic tests, 3 panel tests, 4 checklist tests.

- [x] **Step 11: Commit**

```
git add web/src/content/help web/src/components/help \
        web/src/components/common/EmptyState.tsx web/src/App.tsx \
        web/package.json web/package-lock.json
git commit
```

Commit message:

```
feat(web): first-run tour, contextual help, empty states and onboarding

A driver.js tour that fires once per user on the register and is replayable
from Help; a ? panel on every page explaining that screen; empty states that
name the next action instead of showing a blank grid; and a role-based
checklist whose completion is derived from the register, so it cannot claim
work is done that is not.

Help content is one typed data module rendered by a shared block renderer,
which Task 54 also renders into the help centre and the printable guide.

release-note: New users now get a guided tour, and every page has a ? that explains what it does.
```

---

### Task 54: Help centre and the generated printable user guide

**Files:**
- Create: `web/src/content/help/articles.ts`
- Create: `web/src/pages/Help.tsx`, `web/src/components/help/ArticleSearch.tsx`
- Create: `web/scripts/build-user-guide.ts`
- Modify: `web/src/App.tsx` (`/help` and `/help/:slug`), `web/src/layout/AppSidebar.tsx` (Help item), `web/package.json` (`docs:guide` script)
- Test: `web/src/content/help/articles.test.ts`, `web/src/pages/Help.test.tsx`, `web/scripts/build-user-guide.test.ts`

**Interfaces:**
- Consumes: `Block`, `Blocks` and `HELP_TOPICS` (Task 53); `useTour` (Task 53).
- Produces:
  - `interface Article { slug: string; title: string; section: string; summary: string; keywords: string[]; blocks: Block[] }`
  - `ARTICLES: Article[]`, `SECTIONS: string[]`
  - `searchArticles(query: string): Article[]`
  - `renderUserGuide(articles: Article[]): string` — the Markdown for `docs/user-guide.md`
  - Routes `/help` and `/help/:slug`

**Design note (spec §10.2 and §10.3):** `docs/user-guide.md` is described as "the
help-centre content as one printable document". It is therefore *generated* by
`npm run docs:guide` from the same `ARTICLES` array the help centre renders, and the
test asserts every article appears in the output. Writing the guide by hand would give
two documents that agree on the day they are written and never again.


**Corrections made during execution (2026-09-07).**

- The plan's `users-and-roles` article describes **four fixed roles** (Admin,
  Manager, Technician, Viewer) and states that "roles apply across the whole
  organisation, not per location... per-resource permissions are on the
  roadmap". Both claims are false: Phase 1b shipped tenant-owned, renameable
  roles built from permissions, *and* branch scoping. Publishing that would
  have been customer-facing documentation for a product we deliberately do not
  ship. Rewritten as "Who can do what", with tests asserting it does not
  describe a fixed list and does mention branches.
- The plan's nine sections predate Phase 6. Stock-takes, maintenance and
  depreciation had no article at all, and the Task 53 help panels link to
  `stock-takes`, `maintenance`, `roles-and-access`, `integrations` and
  `notifications` — none of which existed in the plan's `ARTICLES`. Thirteen
  sections now, one article each, and a test resolves every panel link.
- The plan asserts `SECTIONS` equals its nine strings. That test would have
  frozen the help centre to the product as it was planned rather than as it is;
  replaced with two that hold regardless of the list: every article sits in a
  declared section, and every declared section has an article.
- `web` had no `tsx` and `tsconfig.node.json` did not include `scripts/`, so
  the generator would not have run and would never have been typechecked. Both
  fixed; `jsx` added there because the script imports the help content.
- The plan puts the anchor after the heading, which breaks the contents links
  under any renderer that generates its own heading ids. Anchor first, and a
  test resolves every contents link against an anchor that exists.
- Added a test that `docs/user-guide.md` matches what the articles generate.
  Generating it is worthless if nobody remembers to regenerate it; CI runs the
  web suite, so now the build remembers. Red-green verified.
- `/help` and `/help/:slug` are themselves routes, so Task 53's own guard
  demanded help topics for them. It caught that immediately.

- [x] **Step 1: Write the failing tests**

`web/src/content/help/articles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ARTICLES, SECTIONS, searchArticles } from "./articles";
import { HELP_TOPICS } from "./topics";

describe("help articles", () => {
  it("covers the nine sections the spec names", () => {
    expect(SECTIONS).toEqual([
      "Getting started",
      "Managing assets",
      "Check-in and check-out",
      "Scanning and labels",
      "Importing and exporting",
      "Categories and custom fields",
      "Reports",
      "Users and roles",
      "API keys",
    ]);
  });

  it("puts every article in a known section", () => {
    for (const a of ARTICLES) expect(SECTIONS).toContain(a.section);
  });

  it("has no duplicate slugs", () => {
    const slugs = ARTICLES.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("resolves every article a help panel links to", () => {
    const slugs = new Set(ARTICLES.map((a) => a.slug));
    const broken = Object.entries(HELP_TOPICS)
      .filter(([, t]) => t.article && !slugs.has(t.article))
      .map(([route]) => route);
    expect(broken).toEqual([]);
  });
});

describe("searchArticles", () => {
  it("matches on the title", () => {
    expect(searchArticles("import").map((a) => a.slug)).toContain("importing");
  });

  it("matches on a keyword the title does not contain", () => {
    // Someone looking for "barcode" should find the scanning article.
    expect(searchArticles("barcode").map((a) => a.slug)).toContain("scanning");
  });

  it("is case and whitespace insensitive", () => {
    expect(searchArticles("  ChECK Out ").length).toBeGreaterThan(0);
  });

  it("returns everything for an empty query", () => {
    expect(searchArticles("").length).toBe(ARTICLES.length);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchArticles("zzzznotathing")).toEqual([]);
  });
});
```

`web/scripts/build-user-guide.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderUserGuide } from "./build-user-guide";
import { ARTICLES, SECTIONS } from "../src/content/help/articles";

describe("renderUserGuide", () => {
  const md = renderUserGuide(ARTICLES);

  it("includes every article title", () => {
    for (const a of ARTICLES) expect(md).toContain(a.title);
  });

  it("groups articles under their section headings", () => {
    for (const s of SECTIONS) expect(md).toContain(`## ${s}`);
  });

  it("renders steps as a numbered list", () => {
    expect(md).toMatch(/^1\. /m);
  });

  it("opens with a title and a contents list", () => {
    expect(md.startsWith("# ")).toBe(true);
    expect(md).toContain("## Contents");
  });

  it("says it is generated, so nobody edits it by hand", () => {
    expect(md).toContain("generated");
    expect(md).toContain("npm run docs:guide");
  });
});
```

`web/src/pages/Help.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import Help from "./Help";

const renderHelp = () =>
  render(
    <MemoryRouter initialEntries={["/help"]}>
      <Routes>
        <Route path="/help" element={<Help />} />
        <Route path="/help/:slug" element={<Help />} />
      </Routes>
    </MemoryRouter>,
  );

describe("help centre", () => {
  it("lists articles grouped by section", () => {
    renderHelp();
    expect(screen.getByText("Getting started")).toBeInTheDocument();
    expect(screen.getByText("Scanning and labels")).toBeInTheDocument();
  });

  it("filters as you type", async () => {
    renderHelp();
    await userEvent.type(screen.getByRole("searchbox"), "barcode");
    expect(screen.getByText(/Scanning labels/i)).toBeInTheDocument();
    expect(screen.queryByText(/Running reports/i)).not.toBeInTheDocument();
  });

  it("tells you when nothing matches", async () => {
    renderHelp();
    await userEvent.type(screen.getByRole("searchbox"), "zzzznotathing");
    expect(screen.getByText(/No articles match/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run src/content/help/articles src/pages/Help scripts/build-user-guide`
Expected: FAIL — `Cannot find module './articles'`.

- [x] **Step 3: Write the articles**

`web/src/content/help/articles.ts`:

```ts
import type { Block } from "./blocks";

export interface Article {
  slug: string;
  title: string;
  section: string;
  summary: string;
  keywords: string[];
  blocks: Block[];
}

export const SECTIONS = [
  "Getting started",
  "Managing assets",
  "Check-in and check-out",
  "Scanning and labels",
  "Importing and exporting",
  "Categories and custom fields",
  "Reports",
  "Users and roles",
  "API keys",
];

export const ARTICLES: Article[] = [
  {
    slug: "getting-started",
    title: "Setting up your register",
    section: "Getting started",
    summary: "The four steps from an empty account to a register you can trust.",
    keywords: ["setup", "onboarding", "first", "start", "begin"],
    blocks: [
      { kind: "p", text: "An asset register is only useful if it matches reality. These four steps get you there in about an hour for a few hundred assets." },
      { kind: "steps", items: [
        "Create your categories first. They decide which extra fields each kind of asset carries, and changing them later means revisiting assets.",
        "Add your locations as a tree — sites, then buildings, then rooms — so you can filter by site later.",
        "Import the spreadsheet you keep today. Use the dry run to check the column mapping before anything is written.",
        "Check a few assets out to real people. The register becomes trustworthy the moment it reflects who actually holds what.",
      ]},
      { kind: "note", text: "Do not try to make the import perfect. Get the assets in, then correct them in place — every correction is recorded in the asset's history." },
    ],
  },
  {
    slug: "managing-assets",
    title: "Adding and editing assets",
    section: "Managing assets",
    summary: "Creating assets, what each status means, and why nothing is ever really deleted.",
    keywords: ["asset", "create", "edit", "status", "delete", "retire", "serial", "tag"],
    blocks: [
      { kind: "p", text: "Only a name and a category are required to create an asset. Leave the asset tag blank and the next tag in your sequence is allocated automatically." },
      { kind: "term", term: "Asset tag", definition: "your own identifier for the asset, unique within your organisation. It is what goes on the printed label." },
      { kind: "term", term: "Serial number", definition: "the manufacturer's identifier. Optional, but it is what you will search by when someone reads a number off a sticker." },
      { kind: "p", text: "Statuses describe where an asset is in its life:" },
      { kind: "list", items: [
        "Available — in your possession and free to issue.",
        "In use — checked out to someone or somewhere.",
        "Maintenance — being serviced or repaired, not available to issue.",
        "Retired — has left service but is kept for the record and for audit.",
        "Lost — unaccounted for. Keep it rather than deleting it: a lost asset that reappears has a history worth having.",
      ]},
      { kind: "note", text: "Deleting an asset hides it from the register but never removes it from the database, because asset records are evidence in an audit. Retire it instead when it has simply reached end of life." },
    ],
  },
  {
    slug: "check-in-out",
    title: "Checking assets in and out",
    section: "Check-in and check-out",
    summary: "Passing custody to a person, a place or an outside party, and getting it back.",
    keywords: ["check out", "check in", "checkout", "checkin", "custody", "borrow", "due", "overdue", "return"],
    blocks: [
      { kind: "p", text: "Checking out records who holds an asset. You can assign it to a person, to a location for shared equipment, or to a named external party such as a contractor." },
      { kind: "steps", items: [
        "Open the asset, or scan its label.",
        "Choose Check out, then pick the person, location or external party.",
        "Set a due date if it is coming back. Overdue assets are surfaced on the dashboard and can trigger a reminder email.",
        "Add a note if the context matters — which job it went out on, what condition it was in.",
      ]},
      { kind: "p", text: "Checking in closes the assignment and returns the asset to available. Record the condition on return; that record is what settles a dispute months later." },
      { kind: "note", text: "An asset can only be checked out to one holder at a time. The system refuses a second check-out rather than quietly overwriting the first." },
    ],
  },
  {
    slug: "scanning",
    title: "Scanning labels and printing them",
    section: "Scanning and labels",
    summary: "QR codes for phones, Code 128 for warehouse scanners, and how to print sheets.",
    keywords: ["scan", "barcode", "qr", "code128", "label", "print", "camera", "scanner", "sticker"],
    blocks: [
      { kind: "p", text: "Every asset carries a tag that prints as two kinds of barcode, because the two situations need different things." },
      { kind: "term", term: "QR code", definition: "holds a link to the asset. Anyone can scan it with a plain phone camera and land on the asset page — no app to install. If they are not signed in they are asked to, then taken straight there." },
      { kind: "term", term: "Code 128", definition: "holds just the tag. A USB or Bluetooth scanner types it into whatever field is focused, exactly as a person would, which is what makes a warehouse scanner work with no setup." },
      { kind: "p", text: "To scan inside the dashboard, open Scan from the header. The camera option works on a phone or laptop; the scanner option waits for a USB scanner to type." },
      { kind: "steps", items: [
        "Select the assets you want labels for on the register.",
        "Choose Print labels, then pick a label sheet size.",
        "Print onto the matching sheet, checking the alignment on plain paper first.",
      ]},
      { kind: "note", text: "Print a spare label for each asset and keep it with the paperwork. A label that falls off in a workshop is the most common reason an asset goes missing from a register." },
    ],
  },
  {
    slug: "importing",
    title: "Importing and exporting",
    section: "Importing and exporting",
    summary: "Bringing a spreadsheet in safely with a dry run, and getting your data back out.",
    keywords: ["import", "export", "csv", "excel", "xlsx", "spreadsheet", "bulk", "upload", "dry run"],
    blocks: [
      { kind: "p", text: "Import accepts CSV and Excel files. The process is deliberately three steps, so a mis-mapped column cannot silently rewrite your register." },
      { kind: "steps", items: [
        "Upload the file. The first row is treated as the header.",
        "Map each column onto an asset field. Columns you do not map are ignored, and custom fields appear once you choose a category.",
        "Read the dry-run preview: how many assets would be created, how many updated, and every row that would be rejected with the reason.",
        "Commit the import only once the preview looks right.",
      ]},
      { kind: "term", term: "Dry run", definition: "a complete validation pass that writes nothing at all. Running one costs nothing and is the only chance to catch a mistake before it lands." },
      { kind: "p", text: "Rows match existing assets by asset tag, or by serial number when there is no tag. That means re-importing a corrected sheet updates the assets rather than creating duplicates." },
      { kind: "note", text: "Export the register before a large import. It is the fastest way back if the mapping turns out to be wrong." },
    ],
  },
  {
    slug: "categories-and-fields",
    title: "Categories and custom fields",
    section: "Categories and custom fields",
    summary: "Why a laptop and a generator need different fields, and how to set that up.",
    keywords: ["category", "custom field", "field schema", "schema", "type", "required", "select"],
    blocks: [
      { kind: "p", text: "Different kinds of asset need different information. A laptop needs a warranty expiry; a generator needs running hours and a next-service date; a video file needs a licence expiry and a rights holder. Categories are how you say that." },
      { kind: "term", term: "Field schema", definition: "the list of extra fields every asset in a category carries. Each field has a key used by the API, a label people see, a type, and an optional required flag." },
      { kind: "p", text: "Fields can be text, number, date, a fixed list of choices, or a yes/no. Choose the narrowest type that fits — a date field sorts and filters properly, where the same date in a text field does not." },
      { kind: "steps", items: [
        "Open Categories and create or edit one.",
        "Add a field, giving it a label, a type, and whether it is required.",
        "Save. The field appears immediately on the form for every asset in that category.",
      ]},
      { kind: "note", text: "You cannot change a field's type once assets hold values for it, because existing values would become invalid. Add a new field and migrate the values across instead." },
    ],
  },
  {
    slug: "reports",
    title: "Running and scheduling reports",
    section: "Reports",
    summary: "The report catalogue, the five output formats, and emailing a report on a timetable.",
    keywords: ["report", "export", "pdf", "excel", "csv", "chart", "schedule", "email"],
    blocks: [
      { kind: "p", text: "Reports answer the questions people actually ask: what do we own, what is it worth, what is overdue, what is due for service, and what happened to a particular asset." },
      { kind: "p", text: "Every report downloads in five formats — JSON for another system, CSV for a spreadsheet, Excel with formatting, PDF for circulation, and an image for a slide." },
      { kind: "note", text: "All five come from one query, so the PDF you email and the CSV your finance team analyses cannot disagree." },
      { kind: "steps", items: [
        "Open Reports and choose one from the gallery.",
        "Set its filters — date range, category, location.",
        "Download it, or choose Schedule to have it emailed regularly.",
      ]},
      { kind: "term", term: "Scheduled report", definition: "a saved report with its filters, run automatically on a timetable and emailed to a list of recipients." },
    ],
  },
  {
    slug: "users-and-roles",
    title: "Users and roles",
    section: "Users and roles",
    summary: "What each of the four roles can do, and how to choose between them.",
    keywords: ["user", "role", "permission", "admin", "manager", "technician", "viewer", "invite", "team"],
    blocks: [
      { kind: "p", text: "Everyone in your organisation has one of four roles. Give people the least that lets them do their job." },
      { kind: "list", items: [
        "Admin — everything, including users, API keys, webhooks and email settings.",
        "Manager — full control of assets, categories, locations, imports and reports, but not organisation settings.",
        "Technician — day-to-day work: check assets in and out, update them, scan labels. Cannot change categories or settings.",
        "Viewer — read and report only. Useful for finance and for auditors.",
      ]},
      { kind: "note", text: "Roles apply across the whole organisation, not per location. If you need someone limited to one site, say so — per-resource permissions are on the roadmap." },
    ],
  },
  {
    slug: "api-keys",
    title: "Connecting another system",
    section: "API keys",
    summary: "Minting an API key, choosing scopes, and rotating it safely.",
    keywords: ["api", "key", "integration", "token", "scope", "webhook", "developer", "rotate", "revoke"],
    blocks: [
      { kind: "p", text: "Other systems talk to your register through the API using a key. Give each system its own key, so one can be revoked without disturbing the others." },
      { kind: "steps", items: [
        "Open Settings, then API keys, and choose New key.",
        "Name it after the system that will use it, so a key you find in a year is identifiable.",
        "Grant the narrowest scopes that work — a reporting script needs read access and nothing more.",
        "Copy the key immediately. It is shown once and cannot be recovered.",
      ]},
      { kind: "note", text: "To rotate a key: mint the replacement, move the integration onto it, confirm it works, then revoke the old one. Revocation takes effect on the next request." },
      { kind: "p", text: "Full API documentation, including examples in four languages, is at /developers." },
    ],
  },
];

export function searchArticles(query: string): Article[] {
  const q = query.trim().toLowerCase();
  if (!q) return ARTICLES;
  return ARTICLES.filter((a) =>
    [a.title, a.summary, a.section, ...a.keywords]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
}
```

- [x] **Step 4: Build the help centre page**

`web/src/pages/Help.tsx`:

```tsx
import { useState } from "react";
import { Link, useParams } from "react-router";
import PageMeta from "../components/common/PageMeta";
import PageBreadCrumb from "../components/common/PageBreadCrumb";
import { Blocks } from "../content/help/blocks";
import { ARTICLES, SECTIONS, searchArticles } from "../content/help/articles";
import { useTour } from "../components/help/TourProvider";

export default function Help() {
  const { slug } = useParams();
  const [query, setQuery] = useState("");
  const { start } = useTour();

  const article = slug ? ARTICLES.find((a) => a.slug === slug) : undefined;
  const results = searchArticles(query);

  if (slug && !article) {
    return (
      <>
        <PageBreadCrumb pageTitle="Help" />
        <p className="text-sm text-gray-500">
          That article does not exist. <Link to="/help" className="underline">Back to the help centre</Link>.
        </p>
      </>
    );
  }

  if (article) {
    return (
      <>
        <PageMeta title={`${article.title} | Help`} description={article.summary} />
        <PageBreadCrumb pageTitle={article.title} />
        <div className="max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="mb-4 text-xs uppercase tracking-wide text-gray-400">
            {article.section}
          </p>
          <Blocks blocks={article.blocks} />
          <Link to="/help" className="mt-6 inline-block text-sm text-brand-500 underline">
            All articles
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title="Help | Assets Management System" description="Guides for using the asset register." />
      <PageBreadCrumb pageTitle="Help" />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          role="searchbox"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help — try scanning, import, overdue"
          className="h-11 w-full max-w-md rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
        <button onClick={start} className="text-sm text-brand-500 underline">
          Replay the guided tour
        </button>
      </div>

      {results.length === 0 && (
        <p className="text-sm text-gray-500">
          No articles match “{query}”. Try a word from the screen you are looking at.
        </p>
      )}

      {SECTIONS.filter((s) => results.some((a) => a.section === s)).map((section) => (
        <section key={section} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {section}
          </h2>
          <ul className="space-y-2">
            {results.filter((a) => a.section === section).map((a) => (
              <li key={a.slug}>
                <Link
                  to={`/help/${a.slug}`}
                  className="block rounded-xl border border-gray-200 p-4 hover:border-brand-400 dark:border-gray-800"
                >
                  <span className="font-medium text-gray-900 dark:text-white">{a.title}</span>
                  <span className="mt-1 block text-sm text-gray-500 dark:text-gray-400">
                    {a.summary}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
```

Register `/help` and `/help/:slug` inside the authenticated routes, and add a Help item
to `AppSidebar.tsx`.

- [x] **Step 5: Build the user-guide generator**

`web/scripts/build-user-guide.ts`:

```ts
import { writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ARTICLES, SECTIONS, type Article } from "../src/content/help/articles";
import type { Block } from "../src/content/help/blocks";

function renderBlock(block: Block): string {
  switch (block.kind) {
    case "p":
      return block.text;
    case "steps":
      return block.items.map((item, i) => `${i + 1}. ${item}`).join("\n");
    case "list":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "note":
      return `> **Note:** ${block.text}`;
    case "term":
      return `**${block.term}** — ${block.definition}`;
  }
}

export function renderUserGuide(articles: Article[]): string {
  const out: string[] = [
    "# Assets Management System — User guide",
    "",
    "This document is **generated** from the in-app help centre by `npm run docs:guide`.",
    "Edit `web/src/content/help/articles.ts` and regenerate; changes made here are lost.",
    "",
    "## Contents",
    "",
  ];

  for (const section of SECTIONS) {
    const inSection = articles.filter((a) => a.section === section);
    if (inSection.length === 0) continue;
    out.push(`- **${section}**`);
    for (const a of inSection) {
      out.push(`  - [${a.title}](#${a.slug})`);
    }
  }
  out.push("");

  for (const section of SECTIONS) {
    const inSection = articles.filter((a) => a.section === section);
    if (inSection.length === 0) continue;

    out.push(`## ${section}`, "");
    for (const a of inSection) {
      out.push(`### ${a.title}`, "", `<a id="${a.slug}"></a>`, "", `*${a.summary}*`, "");
      for (const block of a.blocks) {
        out.push(renderBlock(block), "");
      }
    }
  }

  return out.join("\n");
}

// Only write the file when run directly, so importing this in a test is free
// of side effects.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = join(
    dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "user-guide.md",
  );
  await writeFile(target, renderUserGuide(ARTICLES), "utf8");
  process.stdout.write(`wrote ${target}\n`);
}
```

Add to `web/package.json`:

```json
"docs:guide": "tsx scripts/build-user-guide.ts"
```

- [x] **Step 6: Run to verify it passes, then generate the guide**

```bash
cd web
npx vitest run src/content/help src/pages/Help scripts/build-user-guide
npm run docs:guide
```

Expected: PASS — 9 article tests, 5 guide tests, 3 help-centre tests. `docs/user-guide.md`
is written and contains all nine articles.

- [x] **Step 7: Commit**

```
git add web/src/content/help/articles.ts web/src/pages/Help.tsx \
        web/scripts/build-user-guide.ts web/package.json \
        web/src/App.tsx web/src/layout/AppSidebar.tsx docs/user-guide.md
git commit
```

Commit message:

```
feat(web): searchable help centre and the generated user guide

Nine articles across the nine sections the spec names, searchable by title,
summary and keyword, with the guided tour replayable from the page.

docs/user-guide.md is generated from the same articles by npm run docs:guide
rather than written by hand, and the test asserts every article reaches the
output — so the printed manual cannot drift from the in-app help.

release-note: A searchable help centre is now built into the dashboard, covering assets, scanning, imports, reports and API keys.
```

---

### Task 55: Project documentation, seed data and the end-to-end smoke suite

**Files:**
- Create: `README.md`, `docs/architecture.md`, `docs/database.md`, `docs/deployment.md`, `docs/operations.md`, `docs/development.md`
- Create: `api/scripts/seed.ts`
- Create: `e2e/playwright.config.ts`, `e2e/smoke.spec.ts`, `e2e/package.json`
- Modify: `.github/workflows/ci.yml` (add the e2e job)
- Test: `api/scripts/seed.test.ts`, and the Playwright suite itself

**Interfaces:**
- Consumes: every endpoint built in Phases 1–6; `hashPassword` (Task 4); the migration runner (Task 2).
- Produces:
  - `seed(): Promise<{ orgId: string; users: Record<string, string> }>` — idempotent demo data
  - `npm run seed` in `api`
  - `npm run e2e` at the repository root

**Design note:** the smoke suite is deliberately one path through the whole product
rather than exhaustive coverage. The unit and integration tests from Phases 1–6 already
assert behaviour; what no unit test can catch is the four services failing to talk to
each other — a wrong `VITE_API_BASE_URL`, a cookie the browser refuses, a migration that
did not run. That is what this suite exists to catch, and why it runs against
`docker compose up` rather than a mocked API.

**Why seed data is idempotent:** it is run repeatedly during development and in CI before
the e2e suite. Re-running must converge on the same demo org rather than accumulating a
second copy, so every insert is an upsert keyed on a stable slug.


**Corrections made during execution (2026-09-08).**

- `npm run migrate`, `npm run seed` and the other scripts did not read
  `api/.env`. Only `next dev` did, because Next loads it itself. Following the
  README exactly therefore failed with `SASL: client password must be a
  string`, which reads as a wrong credential rather than an unset one. The
  scripts now pass `--env-file-if-exists=.env`. The dev database turned out to
  be three migrations behind because of it.
- `discardOrganisation` - the seed's own rollback for a failed first run - could
  never work: deleting an organisation cascades into `roles`, and a trigger
  refused to delete a system role. The path that exists so a half-seeded tenant
  is discarded threw, leaving exactly the half-seeded tenant it was written to
  prevent. Migration 020 lets a system role go when its organisation is going.
- The seed produced 11 assets in 3 statuses, so the status donut had three
  slices and retired and lost - the two states a customer asks about first -
  never appeared. Now 25 assets across all five, a third category, a two-level
  location tree, and a warranty and a service inside their warning windows so
  the dashboard's panels are not empty.
- `seed.ts` ran `main()` on import, so it could not be tested; proving it worked
  needed `seed:check`, run by hand. It now exports `seed()` and the suite drives
  it.
- The API reference printed the bare OpenAPI path - `/assets` - beside each
  method. Paths are relative to the server URL, so the one document a reader
  copies from was showing URLs that do not exist. Found by the smoke suite.
- `AppLayout` had no `<main>` landmark, so a screen-reader user walked the
  sidebar and header again on every page. Also found by the smoke suite, which
  could not scope a query to the page content.

**On the smoke suite:** it was run for real against the dev stack - 12 tests,
all passing - and every failure along the way was a genuine defect or a genuinely
wrong assertion, not a flake.

- [x] **Step 1: Write the failing seed test**

`api/scripts/seed.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { seed } from "./seed";

async function count(table: string, orgId: string): Promise<number> {
  const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
  try {
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [orgId],
    );
    return rows[0].n as number;
  } finally {
    await owner.end();
  }
}

describe("seed", () => {
  it("creates a demo organisation with assets in every status", async () => {
    const { orgId } = await seed();
    expect(await count("assets", orgId)).toBeGreaterThan(20);

    const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    const { rows } = await owner.query(
      "SELECT DISTINCT status FROM assets WHERE org_id = $1", [orgId],
    );
    await owner.end();
    expect(rows.map((r) => r.status).sort()).toEqual(
      ["available", "in_use", "lost", "maintenance", "retired"],
    );
  });

  it("is idempotent - running it twice does not double the data", async () => {
    const { orgId } = await seed();
    const first = await count("assets", orgId);
    await seed();
    expect(await count("assets", orgId)).toBe(first);
  });

  it("creates one user per role, all able to sign in", async () => {
    const { users } = await seed();
    expect(Object.keys(users).sort()).toEqual(
      ["admin", "manager", "technician", "viewer"],
    );
  });

  it("leaves at least one assignment overdue, so the dashboard has something to show", async () => {
    const { orgId } = await seed();
    const owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await owner.connect();
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM assignments
        WHERE org_id = $1 AND checked_in_at IS NULL AND due_at < now()`, [orgId],
    );
    await owner.end();
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
```

- [x] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run scripts/seed.test.ts`
Expected: FAIL — `Cannot find module './seed'`.

- [x] **Step 3: Implement the seed script**

`api/scripts/seed.ts` — the shape to build. Every write is an upsert on a stable key,
which is what makes re-running converge:

```ts
import { Client } from "pg";
import { hashPassword } from "../src/lib/auth/password";

const SLUG = "demo-co";

const CATEGORIES = [
  {
    name: "Laptops", kind: "it",
    fields: [
      { key: "warranty_expires_at", label: "Warranty expires", type: "date" },
      { key: "cpu", label: "CPU", type: "text" },
      { key: "ram_gb", label: "RAM (GB)", type: "number" },
    ],
  },
  {
    name: "Generators", kind: "equipment",
    fields: [
      { key: "hours_run", label: "Hours run", type: "number" },
      { key: "next_service_at", label: "Next service", type: "date" },
      { key: "fuel", label: "Fuel", type: "select", options: ["diesel", "petrol"] },
    ],
  },
  {
    name: "Brand video", kind: "media",
    fields: [
      { key: "licence_expires_at", label: "Licence expires", type: "date" },
      { key: "rights_holder", label: "Rights holder", type: "text" },
    ],
  },
];

const LOCATIONS = [
  { name: "Jakarta HQ", children: ["Floor 1", "Floor 2", "Server room"] },
  { name: "Bekasi Plant", children: ["Workshop", "Yard"] },
];

const USERS = [
  { role: "admin", name: "Rina Admin", email: "admin@demo.test" },
  { role: "manager", name: "Budi Manager", email: "manager@demo.test" },
  { role: "technician", name: "Sari Technician", email: "tech@demo.test" },
  { role: "viewer", name: "Andi Viewer", email: "viewer@demo.test" },
];

export async function seed(): Promise<{
  orgId: string;
  users: Record<string, string>;
}> {
  const db = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  });
  await db.connect();

  try {
    await db.query("BEGIN");

    // Organisation — the stable key everything else hangs off.
    const org = await db.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ('Demo Co', $1)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [SLUG],
    );
    const orgId = org.rows[0].id;

    // Users — one per role, all with the password "demo1234".
    const password = await hashPassword("demo1234");
    const users: Record<string, string> = {};
    for (const u of USERS) {
      const res = await db.query<{ id: string }>(
        `INSERT INTO users (org_id, email, password_hash, name, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_id, lower(email))
         DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
         RETURNING id`,
        [orgId, u.email, password, u.name, u.role],
      );
      users[u.role] = res.rows[0].id;
    }

    // Categories, with the field schemas from spec 4.3.
    const categoryIds: Record<string, string> = {};
    for (const c of CATEGORIES) {
      const res = await db.query<{ id: string }>(
        `INSERT INTO categories (org_id, name, kind, field_schema)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, name)
         DO UPDATE SET field_schema = EXCLUDED.field_schema
         RETURNING id`,
        [orgId, c.name, c.kind, JSON.stringify({ fields: c.fields })],
      );
      categoryIds[c.name] = res.rows[0].id;
    }

    // Locations, parents before children.
    const locationIds: Record<string, string> = {};
    for (const site of LOCATIONS) {
      const parent = await upsertLocation(db, orgId, site.name, null);
      locationIds[site.name] = parent;
      for (const child of site.children) {
        locationIds[child] = await upsertLocation(db, orgId, child, parent);
      }
    }

    // Assets - 40 across the three categories, covering every status so the
    // dashboard, the filters and the status badges all have something to show.
    // asset_tag is the stable key, so re-running updates rather than inserts.
    // The rows are generated rather than listed: a deterministic sequence keeps
    // the fixture stable across runs while staying one place to edit.
    const STATUSES = [
      "available", "available", "available", "in_use", "in_use",
      "maintenance", "retired", "lost",
    ] as const;

    const MODELS: Record<string, string[]> = {
      Laptops: ["ThinkPad X1 Carbon", "MacBook Pro 14", "Dell Latitude 5450"],
      Generators: ["Cummins C33", "Perkins P22", "Yanmar YD-15"],
      "Brand video": ["Launch film master", "Product sizzle reel", "Testimonial cut"],
    };

    const locationNames = Object.keys(locationIds);
    const assetIds: string[] = [];

    for (let i = 0; i < 40; i++) {
      const categoryName = CATEGORIES[i % CATEGORIES.length].name;
      const models = MODELS[categoryName];
      const tag = `AMS-${String(i + 1).padStart(6, "0")}`;
      const status = STATUSES[i % STATUSES.length];

      const custom =
        categoryName === "Laptops"
          ? { warranty_expires_at: `202${7 + (i % 2)}-06-30`, cpu: "Core Ultra 7", ram_gb: 16 + (i % 3) * 16 }
          : categoryName === "Generators"
            ? { hours_run: 500 + i * 37, next_service_at: `2026-1${i % 2}-15`, fuel: "diesel" }
            : { licence_expires_at: `2027-0${(i % 9) + 1}-01`, rights_holder: "Demo Co" };

      const res = await db.query<{ id: string }>(
        `INSERT INTO assets
           (org_id, asset_tag, name, category_id, serial_no, status,
            location_id, purchase_date, purchase_cost, currency, custom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'IDR',$10)
         ON CONFLICT (org_id, asset_tag) WHERE deleted_at IS NULL
         DO UPDATE SET
           name = EXCLUDED.name,
           status = EXCLUDED.status,
           custom = EXCLUDED.custom
         RETURNING id`,
        [
          orgId,
          tag,
          `${models[i % models.length]} #${i + 1}`,
          categoryIds[categoryName],
          `SN-${String(i + 1).padStart(5, "0")}`,
          status,
          locationIds[locationNames[i % locationNames.length]],
          `2024-0${(i % 9) + 1}-12`,
          String(5_000_000 + i * 250_000),
          JSON.stringify(custom),
        ],
      );
      assetIds.push(res.rows[0].id);
    }

    // Assignments - every asset seeded as in_use gets an open assignment, and
    // the first of them is backdated past its due date so the overdue tile and
    // the overdue notification rule both have real data to act on.
    // assignments_one_open_idx forbids a second open row per asset, so the
    // insert is skipped when one already exists, which keeps this idempotent.
    let overdue = true;
    for (let i = 0; i < assetIds.length; i++) {
      if (STATUSES[i % STATUSES.length] !== "in_use") continue;

      await db.query(
        `INSERT INTO assignments
           (org_id, asset_id, assignee_type, assignee_id, checked_out_by, due_at, checkout_note)
         SELECT $1, $2, 'user', $3, $4, $5, $6
          WHERE NOT EXISTS (
            SELECT 1 FROM assignments
             WHERE asset_id = $2 AND checked_in_at IS NULL
          )`,
        [
          orgId,
          assetIds[i],
          users.technician,
          users.manager,
          overdue
            ? new Date(Date.now() - 5 * 86_400_000).toISOString()
            : new Date(Date.now() + 14 * 86_400_000).toISOString(),
          overdue ? "Onsite job, not yet returned" : "Issued for project work",
        ],
      );
      overdue = false;
    }

    await db.query("COMMIT");
    return { orgId, users };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    await db.end();
  }
}

async function upsertLocation(
  db: Client, orgId: string, name: string, parentId: string | null,
): Promise<string> {
  const res = await db.query<{ id: string }>(
    `INSERT INTO locations (org_id, name, parent_id) VALUES ($1, $2, $3)
     ON CONFLICT (org_id, name) DO UPDATE SET parent_id = EXCLUDED.parent_id
     RETURNING id`,
    [orgId, name, parentId],
  );
  return res.rows[0].id;
}

if (process.argv[1]?.endsWith("seed.ts")) {
  seed()
    .then(({ orgId }) => process.stdout.write(`seeded org ${orgId}\n`))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

Two schema additions this needs, added as migration `api/migrations/011_seed_support.sql`:

```sql
-- The seed upserts locations by name within an organisation, which needs a
-- constraint to conflict on. Names are already unique per org in practice.
CREATE UNIQUE INDEX IF NOT EXISTS locations_org_name_idx ON locations (org_id, name);
```

- [x] **Step 4: Run to verify it passes**

```bash
cd api
MIGRATION_DATABASE_URL=postgres://ams:ams@localhost:5433/ams_test npm run migrate
npx vitest run scripts/seed.test.ts
```

Expected: PASS, 4 tests.

- [x] **Step 5: Write the Playwright smoke suite**

```bash
mkdir e2e && cd e2e
npm init -y
npm install -D @playwright/test
npx playwright install --with-deps chromium
```

`e2e/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
```

`e2e/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

const ADMIN = { email: "admin@demo.test", password: "demo1234" };

test.describe("smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signin");
    await page.getByLabel(/email/i).fill(ADMIN.email);
    await page.getByLabel(/password/i).fill(ADMIN.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/$|\/assets/);
  });

  test("the dashboard loads with real figures", async ({ page }) => {
    await page.goto("/");
    // The seed creates 40 assets, so the total tile must not read zero.
    await expect(page.getByTestId("kpi-total-assets")).not.toHaveText("0");
  });

  test("the register lists seeded assets and filters by status", async ({ page }) => {
    await page.goto("/assets");
    await expect(page.getByRole("row")).not.toHaveCount(1);

    await page.getByLabel(/status/i).selectOption("in_use");
    await expect(page.getByText("In use").first()).toBeVisible();
  });

  test("an asset can be created, checked out and checked back in", async ({ page }) => {
    const tag = `E2E-${Date.now()}`;

    await page.goto("/assets/new");
    await page.getByLabel(/^name/i).fill("E2E test asset");
    await page.getByLabel(/asset tag/i).fill(tag);
    await page.getByLabel(/category/i).selectOption({ label: "Laptops" });
    await page.getByRole("button", { name: /save|create/i }).click();

    await expect(page.getByText(tag)).toBeVisible();

    await page.getByRole("button", { name: /check out/i }).click();
    await page.getByLabel(/assign to/i).selectOption({ index: 1 });
    await page.getByRole("button", { name: /confirm|check out/i }).last().click();
    await expect(page.getByText(/in use/i)).toBeVisible();

    await page.getByRole("button", { name: /check in/i }).click();
    await page.getByRole("button", { name: /confirm|check in/i }).last().click();
    await expect(page.getByText(/available/i)).toBeVisible();
  });

  test("a scanned tag resolves to its asset", async ({ page }) => {
    await page.goto("/assets");
    await page.getByRole("button", { name: /scan/i }).click();
    // The HID path: a scanner types the tag and presses Enter.
    await page.getByRole("textbox", { name: /tag|scan/i }).fill("AMS-000001");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/assets\/[0-9a-f-]{36}/);
  });

  test("an import dry run reports counts without writing", async ({ page }) => {
    await page.goto("/import");
    await page.setInputFiles('input[type="file"]', {
      name: "assets.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("name,serial_no\nImported laptop,SN-E2E-1\n"),
    });
    await page.getByRole("button", { name: /preview|dry run|next/i }).click();
    await expect(page.getByText(/would be created|1 new/i)).toBeVisible();
  });

  test("a report downloads as CSV", async ({ page }) => {
    await page.goto("/reports");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /csv/i }).first().click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  });

  test("the help centre searches", async ({ page }) => {
    await page.goto("/help");
    await page.getByRole("searchbox").fill("barcode");
    await expect(page.getByText(/scanning labels/i)).toBeVisible();
  });
});

test("the developer portal is public", async ({ page }) => {
  // No sign-in in this test: the portal must render for a signed-out visitor.
  await page.goto("/developers");
  await expect(page.getByRole("link", { name: "Reference" })).toBeVisible();

  await page.goto("/developers/errors");
  await expect(page.getByText(/problem\+json/i)).toBeVisible();
});
```

Root `package.json` script:

```json
"e2e": "playwright test --config e2e/playwright.config.ts"
```

- [x] **Step 6: Run the suite against the real stack**

```bash
docker compose up -d --build
docker compose exec api npm run migrate
docker compose exec api npm run seed
npm run e2e
```

Expected: PASS, 8 tests. A failure here is an integration fault — a service address, a
cookie, a migration that did not run — not a unit-level bug.

- [x] **Step 7: Write the project documentation**

`README.md` — quickstart in under five minutes:

```markdown
# Assets Management System

Multi-tenant asset management for IT equipment, plant and digital media. QR and barcode
identification, a documented public REST API, and a dashboard.

## Quickstart

    git clone <repo> && cd AssetsManagementSystem
    cp .env.example .env
    docker compose up -d --build
    docker compose exec api npm run migrate
    docker compose exec api npm run seed

Then open http://localhost:3000 and sign in as `admin@demo.test` / `demo1234`.

| Service | URL |
|---|---|
| Dashboard | http://localhost:3000 |
| API | http://localhost:4000/api/v1 |
| API reference | http://localhost:3000/developers/reference |
| MinIO console | http://localhost:9001 |

## Documentation

| Document | Covers |
|---|---|
| `docs/architecture.md` | Services, data flow, the tenant isolation model |
| `docs/database.md` | Schema reference and entity diagram |
| `docs/deployment.md` | Environment variables, production deployment, backups |
| `docs/operations.md` | Runbook: restore, rotate secrets, diagnose a slow query |
| `docs/development.md` | Local setup, test strategy, conventions |
| `docs/user-guide.md` | The in-app help centre as one printable document |
| `CONTRIBUTING.md` | Branching, commit conventions, releases |
```

`docs/architecture.md` must contain: the three services and what each is responsible for;
the request path from browser to database; the RLS model and why the application role is
not the table owner; why authentication uses `SECURITY DEFINER` lookups rather than a
cross-tenant grant; the shared-core-plus-JSONB asset model; and this diagram:

````markdown
```mermaid
flowchart LR
  B[Browser] -->|session cookie| W[web — nginx + SPA]
  I[Integration] -->|Bearer key| A
  W -->|/api/admin/*| A[api — Next.js route handlers]
  A -->|withTenant sets app.org_id| D[(PostgreSQL 16 — RLS)]
  A --> M[(MinIO — attachments)]
  A --> E[SMTP / provider]
```
````

`docs/database.md`: every table with its columns and why it exists, the status and role
enums, the indexes that matter for the register query, and a mermaid ER diagram.

`docs/deployment.md`: every environment variable with its default and whether it is
required; compose versus a production orchestrator; `APP_ENCRYPTION_KEY` generation and
rotation; TLS termination; the nightly `pg_dump` to object storage and the *tested*
restore procedure required by spec §14.

`docs/operations.md`: the runbook. Restoring a backup, rotating a leaked API key or
encryption key, diagnosing a slow register query with `EXPLAIN`, reading the outbox when
email stops, clearing a stuck import, and what `GET /api/health` reports when it fails.

`docs/development.md`: prerequisites, running the test database, the three test
commands, the RLS testing pattern (`createOrg` over the owner connection), the file
layout, and the rule that route handlers contain no SQL and domain modules build no
`Response`.

- [x] **Step 8: Wire the e2e job into CI**

In `.github/workflows/ci.yml`, after the unit-test job:

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: [test]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: docker compose up -d --build
      - run: docker compose exec -T api npm run migrate
      - run: docker compose exec -T api npm run seed
      - run: npm ci && npx playwright install --with-deps chromium
      - run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-trace
          path: test-results/
```

- [x] **Step 9: Commit**

```
git add README.md docs/ api/scripts/seed.ts api/scripts/seed.test.ts \
        api/migrations/011_seed_support.sql e2e/ package.json \
        .github/workflows/ci.yml
git commit
```

Commit message:

```
docs: project documentation, seed data and the e2e smoke suite

README quickstart, architecture, database, deployment, operations and
development guides. An idempotent seed script producing a demo org with
40 assets across every status, one user per role and an overdue assignment,
so a fresh clone has something to look at.

The Playwright suite runs one path through the whole product against
docker compose, because what no unit test can catch is the four services
failing to talk to each other.

release-note: A demo dataset and a five-minute quickstart make it possible to evaluate the system immediately after installing it.
```

---

## Phase 8 self-review

**Spec coverage.** §10.1's ten portal rows: Overview, Authentication and Reference in
Task 51; Try it via Scalar's request client in Task 51; Recipes, Pagination/sorting/
filtering, Rate limits & idempotency, Webhooks, Errors and Changelog in Tasks 50 and 52.
§10.2's five bullets: first-run tour, per-page help, empty states and onboarding
checklists in Task 53; the help centre in Task 54. §10.3's eight documents: `user-guide.md`
generated in Task 54, the remaining seven in Task 55, with `CONTRIBUTING.md` already
written during Phase 1. §14's operational items appear in `docs/operations.md` and
`docs/deployment.md` (backup and tested restore, request ids, health deep check, pool
sizing). Playwright, `seed.ts`, Scalar and driver.js — the four dependencies named in the
overview's tech stack that no earlier task uses — are all consumed here.

**Type consistency.** `Block` is defined once in Task 53 and consumed unchanged by Tasks
53, 54 and 55's generator. `HttpRequest` is defined in Task 52's `renderers.ts` and
imported by `recipes.ts` and `CodeTabs`. `HELP_TOPICS[route].article` is asserted against
`ARTICLES` slugs by a test in Task 54, so the two modules cannot drift apart.

**Known gaps, deliberately left.** Task 53's `invite-team` checklist item points at
`/settings/users`, which Task 31 builds; its `done` predicate is hard-coded `false`
because no user-count endpoint exists in the MVP — wire it up if Task 31 adds one.
Task 55's seed generates its 40 asset rows from a deterministic sequence rather than
listing them, so the fixture is stable across runs and there is one place to edit. If
Task 5 changes the seeded categories' field schemas, the three `custom` shapes in the
generator must change with them.
