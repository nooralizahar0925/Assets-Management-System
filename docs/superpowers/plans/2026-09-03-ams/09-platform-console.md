# Phase 9 — The platform console

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the operator a dashboard to run the business — create and suspend
customer organisations, decide which features each one has, hold them to the
limits they pay for, and keep the commercial record of what each is on.

**Architecture:** A second, separate identity plane. Platform administrators are
not users of any tenant: they have their own table, their own sessions, their
own cookie, and their own database role holding `BYPASSRLS`, reached through a
connection string the tenant application does not have. Features are named in
code, bundled into plans that are rows, and overridden per organisation, so what
a customer may do resolves to one list the API enforces and the UI reads.

**Tech Stack:** Unchanged — Node 22, PostgreSQL 16, Next.js route handlers, React
19 + Vite, Zod, Vitest, Playwright.

**Spec:** This phase has no section in the original spec; it comes from a
decision taken on 2026-09-08, recorded in [Decisions](#decisions) below.

## Global Constraints

- **TypeScript strict**, `noUnusedLocals`. Web targets ES2020 — no `Array.prototype.at`.
- **Every tenant table has `org_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`,** and a
  policy on `current_setting('app.org_id')::uuid`. The RLS anti-drift test walks
  `pg_class` and `pg_policy`; a new tenant table that skips this fails the build.
- **Migrations are additive:** add, backfill, switch, drop a release later.
- **Conventional Commits**, with a `release-note:` trailer on anything a customer
  or the operator would notice, all trailers in one unbroken final block.
- **British English** in user-facing copy.
- Verification is always three commands: `npx tsc -b --noEmit`, `npx vitest run`,
  `npm run build`. Read exit codes directly, never through a pipe.

> **This plan is a draft and has not been executed.** Every prior phase of this
> project contained a defect in essentially every task — wrong field names,
> endpoints that do not exist, tests that pass vacuously. Write each test first,
> watch it fail **for the reason you predicted**, and verify wiring through a
> real route rather than trusting a unit test that drives a stub. See
> `docs/development.md`.

---

## Decisions

Taken 2026-09-08, before writing this plan.

1. **Plans, with per-tenant overrides.** Named plans bundle features and limits;
   a single feature can be switched on for one customer without inventing a
   plan for them. The plan is what you sell; the override is what you promise in
   the meeting to win the deal.
2. **A limit blocks the write and explains why.** A limit nobody enforces is a
   suggestion. But it never blocks **reading or exporting** — a customer over
   their cap must always be able to get their data out, or the limit becomes
   hostage-taking.
3. **Commercial record-keeping only.** Plan, price, currency, cycle, contract
   start, renewal, trial end, notes. No payment provider, no invoice generation,
   no tax handling.
4. **Nothing is suspended automatically.** A trial that lapses is *shown* to the
   operator, not enforced at three in the morning. Suspension is always a
   deliberate act with a name against it.

## Why the platform plane is separate

The whole system rests on one property: a request can only ever see one
organisation, because Postgres enforces it and the application role does not own
the tables. A "can see everything" flag on `users` would make the most dangerous
privilege in the product a column the tenant application writes to.

So: `platform_admins` is not `users`, `ams_platform` is not `ams_app`, and
`PLATFORM_DATABASE_URL` is not `DATABASE_URL`. A total compromise of the tenant
application yields no platform access, because the credential is not there.

## File structure

| File | Responsibility |
|---|---|
| `api/migrations/022_platform.sql` | Platform tables, plans, entitlements, the `ams_platform` role and its narrow grants |
| `api/src/lib/platform/db.ts` | `withPlatform` — a pool on the platform connection, used by nothing else |
| `api/src/lib/platform/auth.ts` | Platform sessions, cookie, `requirePlatform` |
| `api/src/lib/platform/audit.ts` | `recordPlatformAction` — one row per operator action |
| `api/src/lib/platform/features.ts` | `FEATURES` — the catalogue, defined in code |
| `api/src/lib/platform/plans.ts` | Plan CRUD, and `effectiveEntitlements(orgId)` |
| `api/src/lib/platform/provision.ts` | Create, suspend, resume and delete an organisation |
| `api/src/lib/platform/usage.ts` | What each organisation currently holds, for the list and the caps |
| `api/src/lib/entitlements.ts` | Tenant-side: `hasFeature`, `assertWithinLimit`, cached per request |
| `api/src/app/api/platform/**` | The console's endpoints |
| `api/scripts/platform-admin.ts` | Bootstrap: create the first operator account |
| `web/src/platform/**` | The console: its own layout, auth context, pages |
| `web/src/api/platform.ts` | The console's client |

---

## Task 56: The platform schema and its role

**Files:**
- Create: `api/migrations/022_platform.sql`
- Create: `api/src/lib/platform/db.ts`
- Modify: `api/scripts/migrate.ts` (set the platform role's password)
- Modify: `.env.example`, `docker-compose.yml`
- Test: `api/src/lib/platform/db.test.ts`

**Interfaces:**
- Produces: `withPlatform<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>`

A draft of this migration was written before this plan and then **backed out of
the branch on purpose**, for two reasons worth knowing before you rewrite it:

1. It creates a login role holding `BYPASSRLS`. An unapplied migration doing
   that has no business sitting in a branch being validated for release.
2. The migration runner change that goes with it **throws in production when
   `PLATFORM_DB_PASSWORD` is unset**. Shipping the two separately would have
   made the first real deploy fail its migration step, demanding a variable for
   a feature that did not exist yet.

Write the migration and the runner change together, in this task, and apply them
to a database before committing. `git log --diff-filter=D -- api/migrations/022_platform.sql`
finds the draft if it is useful.


**Executed 2026-09-08.** One correction to the plan: it says to exclude `plans`
from the RLS suite by whatever mechanism `permissions` uses. There is no such
mechanism - the guard finds tenant tables by looking for an `org_id` column, so
`plans` is passed over automatically.

`platform_audit` did need a decision, though, and not the one the plan
anticipated: it records which customer an operator's action touched, so it
*has* an `org_id`, and the guard demanded a policy for it. It is not a tenant
table - the tenant application is refused it outright - so the guard now also
requires that `ams_app` actually hold a privilege on the table. RLS exists to
stop that role reading a tenant table without a filter; where it cannot read at
all there is nothing to protect against, and a policy there would imply the
protection came from RLS when it comes from the grant. That is checked against
the database rather than kept as a list of exceptions, and two assertions were
added so the new filter can never be what makes the suite pass.

- [x] **Step 1: Write the failing test**

`api/src/lib/platform/db.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { withPlatform } from "./db";

describe("the platform connection", () => {
  it("reads across every tenant, which is the entire point", async () => {
    const orgs = await withPlatform(async (c) =>
      (await c.query("SELECT id FROM organizations")).rows,
    );
    // The tenant pool would return nothing here: no app.org_id is set.
    expect(orgs.length).toBeGreaterThan(0);
  });

  it("cannot read an asset's attachments or audit trail", async () => {
    // Narrow grants are what stop a console bug becoming a data breach: the
    // operator needs counts, not the contents of anybody's register.
    await expect(
      withPlatform((c) => c.query("SELECT * FROM audit_events LIMIT 1")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("is refused to the tenant application entirely", async () => {
    const app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    try {
      await expect(app.query("SELECT * FROM platform_admins"))
        .rejects.toThrow(/permission denied/i);
    } finally {
      await app.end();
    }
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `cd api && npx vitest run src/lib/platform/db.test.ts`
Expected: FAIL — `Cannot find module './db'`.

- [x] **Step 3: Finish the migration**

Extend the existing draft with the commercial and entitlement tables. The draft
already has `platform_admins`, `platform_sessions`, `platform_audit`,
`organizations.suspended_at`, `organizations.notes`, the `ams_platform` role and
its grants. Add:

```sql
CREATE TABLE plans (
  code           text PRIMARY KEY,
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  -- Minor units, integer: 250000 is Rp 250,000. Never a float, for the same
  -- reason asset values are not.
  price_minor    bigint NOT NULL DEFAULT 0,
  currency       char(3) NOT NULL DEFAULT 'IDR',
  billing_cycle  text NOT NULL DEFAULT 'monthly'
                   CHECK (billing_cycle IN ('monthly', 'yearly', 'once')),
  features       text[] NOT NULL DEFAULT '{}',
  -- {"max_assets": 500, "max_users": 10, "max_storage_mb": 2048}
  -- A key that is absent means unlimited; null is not used, so "absent" has
  -- exactly one meaning.
  limits         jsonb NOT NULL DEFAULT '{}'::jsonb,
  active         boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organizations
  ADD COLUMN plan_code        text REFERENCES plans(code),
  ADD COLUMN contract_starts  date,
  ADD COLUMN renews_on        date,
  ADD COLUMN trial_ends_at    date,
  -- What this customer actually pays, when it differs from the plan's price.
  ADD COLUMN price_minor      bigint,
  ADD COLUMN limit_overrides  jsonb NOT NULL DEFAULT '{}'::jsonb;

-- One row per deliberate exception. `enabled` false is as meaningful as true:
-- it takes a feature away that the plan grants.
CREATE TABLE org_entitlements (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled     boolean NOT NULL,
  note        text NOT NULL DEFAULT '',
  set_by      uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  set_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, feature_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON plans TO ams_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_entitlements TO ams_platform;

-- The tenant application reads what it is allowed to do, and nothing else:
-- no price, no contract, no other tenant.
GRANT SELECT ON plans TO ams_app;
GRANT SELECT ON org_entitlements TO ams_app;
```

**`org_entitlements` carries `org_id` and is read by `ams_app`, so the RLS
anti-drift test will demand a policy on it.** Add one, exactly as every other
tenant table has:

```sql
ALTER TABLE org_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON org_entitlements
  USING (org_id = current_setting('app.org_id', true)::uuid);
```

`plans` has no `org_id` — it is a global catalogue, like `permissions`. Check how
`permissions` is excluded from the RLS suite and exclude `plans` the same way,
**with a comment saying why**.

- [x] **Step 4: Write the platform pool**

`api/src/lib/platform/db.ts`:

```ts
import { Pool, type PoolClient } from "pg";

/**
 * The platform connection: one pool, one purpose.
 *
 * `ams_platform` holds BYPASSRLS, so this pool can read every tenant. That is
 * the job - the console lists customers - and it is also why it is a separate
 * pool with a separate credential rather than a flag on the tenant one. A
 * handler that gets hold of the wrong pool would silently lose tenant
 * isolation, and nothing would fail until it was somebody else's data.
 */
const pool = new Pool({
  connectionString: process.env.PLATFORM_DATABASE_URL,
  max: Number(process.env.PLATFORM_POOL_MAX ?? 4),
});

export async function withPlatform<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
```

- [x] **Step 5: Set the role's password in the migration runner**

`scripts/migrate.ts` already has `setAppRolePassword`. Add
`setPlatformRolePassword` beside it, reading `PLATFORM_DB_PASSWORD`, refusing a
default when `NODE_ENV=production`, and **returning early when the role does not
exist yet** — it runs before migration 022 on a fresh database.

This has already been written in the working tree; verify it, do not rewrite it.

- [x] **Step 6: Add the variables**

`.env.example`:

```
# The platform console. This role can read every tenant: treat the password as
# the most sensitive credential in the deployment.
PLATFORM_DB_PASSWORD=ams_platform
PLATFORM_DATABASE_URL=postgres://ams_platform:ams_platform@localhost:5442/ams
```

Add both to the `api` service in `docker-compose.yml`, and `test/setup.ts` must
default `PLATFORM_DATABASE_URL` to the test database exactly as it does
`DATABASE_URL`.

- [x] **Step 7: Run the tests**

Run: `cd api && npm run migrate:test && npx vitest run src/lib/platform src/lib/db.rls.test.ts`
Expected: PASS, including the RLS suite with `org_entitlements` now covered.

- [x] **Step 8: Commit**

```
feat(api): the platform plane's schema, role and connection

Platform administrators are not users of any tenant, so they get their own
tables, their own database role holding BYPASSRLS, and a connection string
the tenant application does not have. A total compromise of the tenant app
yields no platform access, because the credential is not there.

release-note: none
```

---

## Task 57: Platform authentication

**Files:**
- Create: `api/src/lib/platform/auth.ts`, `api/src/lib/platform/audit.ts`
- Create: `api/src/app/api/platform/auth/login/route.ts`, `logout/route.ts`, `me/route.ts`
- Create: `api/scripts/platform-admin.ts`
- Modify: `api/package.json` (`platform:admin` script)
- Test: `api/src/lib/platform/auth.test.ts`, `api/src/app/api/platform/auth/routes.test.ts`

**Interfaces:**
- Consumes: `withPlatform` (Task 56); `hashPassword`, `verifyPassword` from `src/lib/auth/password`; `throttle` from `src/lib/auth/throttle` (reuse the existing login throttle — read its exact export name before writing against it).
- Produces:
  - `interface PlatformActor { id: string; email: string; name: string }`
  - `requirePlatform(req: Request): Promise<PlatformActor | Response>`
  - `createPlatformSession(adminId: string): Promise<string>`
  - `platformCookie(id: string): string`, `clearPlatformCookie(): string`
  - `recordPlatformAction(actor, action, detail): Promise<void>`


**Executed 2026-09-08.** Three things the plan did not anticipate:

- `problem()` takes no `headers` option - its fourth argument is spread into the
  document body. Passing one would have put `Retry-After` in the JSON rather
  than in the response, where no client looks for it. Set on the response, as
  the tenant route does.
- The platform role holds no `UPDATE` on `platform_sessions`, deliberately: a
  session is issued and destroyed, never edited. The plan's expiry test aged a
  session with an UPDATE and was refused by the grant, which is the grant
  working. The test inserts an already-expired session instead.
- `api/.env` set `APP_BASE_URL` to the API's own port. Every QR label and every
  link in an email is built from it, so in development a scanned label led to a
  port that serves no pages. Corrected to the Vite dev server; compose already
  set its own.

- [x] **Step 1: Write the failing tests**

`api/src/lib/platform/auth.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { withPlatform } from "./db";
import { hashPassword } from "../auth/password";
import {
  createPlatformSession, requirePlatform, platformCookie,
} from "./auth";

let adminId: string;

beforeAll(async () => {
  adminId = await withPlatform(async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO platform_admins (email, password_hash, name)
       VALUES ($1, $2, 'Operator') RETURNING id`,
      [`ops-${Date.now()}@platform.test`, await hashPassword("pw")],
    )).rows[0].id,
  );
});

const withCookie = (value: string) =>
  new Request("http://api.test/api/platform/orgs", {
    headers: { cookie: value },
  });

describe("platform sessions", () => {
  it("resolves a valid session to the operator", async () => {
    const sid = await createPlatformSession(adminId);
    const actor = await requirePlatform(withCookie(`ams_platform=${sid}`));
    expect(actor).toMatchObject({ id: adminId, name: "Operator" });
  });

  it("refuses a tenant session, whatever it contains", async () => {
    // The two planes must not accept each other's cookies. A tenant admin
    // holding a valid ams_session must get nowhere near this.
    const result = await requirePlatform(withCookie("ams_session=anything"));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("refuses a disabled operator's existing session", async () => {
    const sid = await createPlatformSession(adminId);
    await withPlatform((c) =>
      c.query("UPDATE platform_admins SET disabled_at = now() WHERE id = $1", [adminId]),
    );
    const result = await requirePlatform(withCookie(`ams_platform=${sid}`));
    expect((result as Response).status).toBe(401);

    await withPlatform((c) =>
      c.query("UPDATE platform_admins SET disabled_at = NULL WHERE id = $1", [adminId]),
    );
  });

  it("marks the cookie Secure when the deployment is HTTPS", () => {
    const before = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://ams.example.com";
    expect(platformCookie("abc")).toContain("Secure");
    process.env.APP_BASE_URL = before;
  });

  it("expires sooner than a tenant session", async () => {
    // This session can create and destroy whole organisations. An unattended
    // browser should stop being able to well before a week is out.
    const sid = await createPlatformSession(adminId);
    const row = await withPlatform(async (c) =>
      (await c.query<{ hours: number }>(
        `SELECT EXTRACT(EPOCH FROM (expires_at - now())) / 3600 AS hours
           FROM platform_sessions WHERE id = $1`,
        [sid],
      )).rows[0],
    );
    expect(Number(row.hours)).toBeLessThanOrEqual(12);
  });
});
```

- [x] **Step 2: Run and watch it fail**

Run: `cd api && npx vitest run src/lib/platform/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`.

- [x] **Step 3: Implement the session layer**

`api/src/lib/platform/auth.ts`. Mirror `src/lib/auth/session.ts` deliberately —
same shape, different table, different cookie, shorter life:

```ts
import { randomBytes } from "node:crypto";
import { withPlatform } from "./db";
import { unauthorized } from "../http/problem";

const COOKIE = "ams_platform";
const TTL_HOURS = 8;

export interface PlatformActor {
  id: string;
  email: string;
  name: string;
}

export async function createPlatformSession(adminId: string): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await withPlatform((c) =>
    c.query(
      `INSERT INTO platform_sessions (id, admin_id, expires_at)
       VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
      [id, adminId, String(TTL_HOURS)],
    ),
  );
  return id;
}

const isHttps = () => (process.env.APP_BASE_URL ?? "").startsWith("https:");

export function platformCookie(id: string): string {
  const secure = isHttps() ? " Secure;" : "";
  // Strict rather than Lax: nothing links into the console from elsewhere, so
  // there is no navigation to preserve and no reason to send this anywhere.
  return `${COOKIE}=${id}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${TTL_HOURS * 3600}`;
}

export const clearPlatformCookie = () =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export async function requirePlatform(
  req: Request,
): Promise<PlatformActor | Response> {
  const sid = readCookie(req, COOKIE);
  if (!sid) return unauthorized();

  const actor = await withPlatform(async (c) =>
    (await c.query<PlatformActor>(
      `SELECT a.id, a.email, a.name
         FROM platform_sessions s
         JOIN platform_admins a ON a.id = s.admin_id
        WHERE s.id = $1
          AND s.expires_at > now()
          AND a.disabled_at IS NULL`,
      [sid],
    )).rows[0],
  );

  return actor ?? unauthorized();
}
```

- [x] **Step 4: Write the audit recorder**

`api/src/lib/platform/audit.ts`:

```ts
import { withPlatform } from "./db";
import type { PlatformActor } from "./auth";

/**
 * One row per action the operator takes against a customer.
 *
 * Written where the customer's own audit trail cannot reach it, and where the
 * operator has INSERT but not UPDATE or DELETE: the point of this record is
 * that it cannot be tidied up afterwards.
 */
export async function recordPlatformAction(
  actor: PlatformActor,
  action: string,
  detail: { orgId?: string; orgSlug?: string; [key: string]: unknown } = {},
): Promise<void> {
  const { orgId, orgSlug, ...rest } = detail;
  await withPlatform((c) =>
    c.query(
      `INSERT INTO platform_audit (admin_id, admin_email, action, org_id, org_slug, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actor.id, actor.email, action, orgId ?? null, orgSlug ?? null, JSON.stringify(rest)],
    ),
  );
}
```

- [x] **Step 5: Write the routes**

`POST /api/platform/auth/login` — throttled by the **same** mechanism as tenant
sign-in (read `src/lib/auth/throttle.ts` and reuse it; do not write a second
one), verifying against `platform_admins`, updating `last_login_at`, recording a
`platform.signed_in` audit row, and returning the cookie.

`POST /api/platform/auth/logout` — delete the session row, clear the cookie.

`GET /api/platform/auth/me` — `requirePlatform`, return `{ id, email, name }`.

Every other platform route in this plan begins with:

```ts
const actor = await requirePlatform(req);
if (actor instanceof Response) return actor;
```

- [x] **Step 6: Write the bootstrap CLI**

`api/scripts/platform-admin.ts`, run as `npm run platform:admin -- --email
ops@example.com --name "Noor"`. There is a chicken and egg here: the console
needs an operator, and only the console can make one. The CLI is how the first
one exists. It:

- refuses to run without `PLATFORM_DATABASE_URL`;
- generates a password with `randomBytes(12).toString("base64url")` unless
  `--password` is given, and **prints it once**;
- upserts on `lower(email)` so re-running resets the password rather than
  failing;
- prints the URL to sign in at.

Add `"platform:admin": "tsx --env-file-if-exists=.env scripts/platform-admin.ts"`.

- [x] **Step 7: Write the route tests**

`api/src/app/api/platform/auth/routes.test.ts` — drive the real handlers:

```ts
it("refuses the right password for a disabled operator", async () => { /* … */ });
it("does not say whether the address exists", async () => {
  // Two different messages here is an account enumeration oracle for the
  // most privileged accounts in the system.
});
it("records the sign-in in the platform audit", async () => { /* … */ });
it("throttles repeated failures", async () => { /* … */ });
```

- [x] **Step 8: Run everything, then commit**

Run: `cd api && npx tsc -b --noEmit && npx vitest run`

```
feat(api): platform sign-in, its audit trail and the bootstrap account

A separate cookie, a shorter session, SameSite=Strict, and a throttle shared
with tenant sign-in. The two planes refuse each other's cookies, which is
asserted rather than assumed.

release-note: none
```

---

## Task 58: Features, plans and effective entitlements

**Files:**
- Create: `api/src/lib/platform/features.ts`, `api/src/lib/platform/plans.ts`
- Create: `api/src/app/api/platform/plans/route.ts`, `plans/[code]/route.ts`
- Test: `api/src/lib/platform/features.test.ts`, `plans.test.ts`

**Interfaces:**
- Produces:
  - `FEATURES: { key: string; label: string; description: string; group: string }[]`
  - `type FeatureKey = (typeof FEATURES)[number]["key"]`
  - `interface Plan { code; name; description; price_minor; currency; billing_cycle; features: string[]; limits: Limits; active; sort_order }`
  - `interface Limits { max_assets?: number; max_users?: number; max_storage_mb?: number }`
  - `effectiveEntitlements(orgId: string): Promise<{ features: string[]; limits: Limits; plan_code: string | null }>`


**Executed 2026-09-08.** Notes for whoever reads this next:

- The plan's "gates only features that something checks" test is present as
  `it.todo`, naming Task 61. Its other half - that nothing is gated on a key
  the catalogue does not list - runs now, since that direction is already
  meaningful.
- `price_minor` is required rather than defaulted. A plan with no price is a
  billing question nobody meant to answer, and defaulting it to zero answers it
  wrongly and silently. Two route tests were written without one and got a
  validation failure instead of the assertion they meant; the tests were wrong,
  not the schema.
- `PATCH` merges onto the stored plan and takes the code from the URL, never
  the body. Renaming a code would leave every customer on the old plan pointing
  at nothing.
- The starting plans are seeded `ON CONFLICT DO NOTHING` on every migrate. An
  update would mean a deploy resetting a customer's price to whatever was last
  committed, which is a billing incident caused by a code change.

- [x] **Step 1: Define the catalogue**

`api/src/lib/platform/features.ts`. Modelled on `src/lib/auth/permissions.ts`,
which is the pattern that has held up best in this codebase: named in code,
proved against the source by a test.

```ts
/**
 * What can be sold separately.
 *
 * Deliberately coarse. A feature here is something a customer would recognise
 * on a price list and could sensibly not have - not every screen and not every
 * endpoint. Splitting "assets" into "create assets" and "edit assets" would be
 * permissions, which already exist and are the customer's business, not ours.
 */
export const FEATURES = [
  { key: "core", group: "Core", label: "Asset register",
    description: "The register, categories, locations, custody and history. Every plan has this." },
  { key: "import", group: "Core", label: "Spreadsheet import",
    description: "Bulk import from CSV and Excel, with a dry run." },
  { key: "labels", group: "Operations", label: "Labels and scanning",
    description: "Printable QR and Code 128 label sheets, camera and handheld scanning." },
  { key: "stocktake", group: "Operations", label: "Stock-takes",
    description: "Physical counting sessions, with missing and unexpected reporting." },
  { key: "maintenance", group: "Operations", label: "Maintenance schedules",
    description: "Repeating service schedules with due dates and reminders." },
  { key: "depreciation", group: "Finance", label: "Depreciation",
    description: "Straight-line and reducing-balance policies, and month-end book values." },
  { key: "reports", group: "Finance", label: "Reports",
    description: "The report catalogue, in five formats." },
  { key: "reports_scheduled", group: "Finance", label: "Scheduled reports",
    description: "Saved reports run on a timetable and emailed." },
  { key: "api", group: "Integration", label: "API access",
    description: "API keys and the published v1 API." },
  { key: "webhooks", group: "Integration", label: "Webhooks",
    description: "Signed event delivery to a customer's own endpoint." },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];

/** Granted to everybody, plan or no plan. Without it there is no product. */
export const ALWAYS_ON: FeatureKey[] = ["core"];
```

- [x] **Step 2: Write the failing tests**

`api/src/lib/platform/features.test.ts`:

```ts
describe("the feature catalogue", () => {
  it("has no duplicate keys", () => { /* … */ });

  it("describes every feature in terms a customer would recognise", () => {
    for (const feature of FEATURES) {
      expect(feature.description.length).toBeGreaterThan(30);
      expect(feature.label.length).toBeGreaterThan(3);
    }
  });

  it("gates only features that something actually checks", async () => {
    // The mirror of the webhook-events guard: a feature nobody enforces is a
    // line on a price list that means nothing, and the customer finds out by
    // using what they did not buy.
    const source = await readAllSource("src");
    const unchecked = FEATURES
      .filter((f) => !ALWAYS_ON.includes(f.key))
      .filter((f) => !source.includes(`hasFeature(ctx, "${f.key}")`)
                  && !source.includes(`requireFeature(ctx, "${f.key}")`));
    expect(unchecked.map((f) => f.key)).toEqual([]);
  });
});
```

**This test will fail until Task 61 wires the gates.** That is deliberate and it
is the point — but it means Task 58 cannot be committed green on its own. Write
the test in Task 58, mark it `it.todo` with a comment naming Task 61, and turn
it on there. Do not delete it and mean to come back.

- [x] **Step 3: Implement plan storage and resolution**

`api/src/lib/platform/plans.ts`:

```ts
import { withPlatform } from "./db";
import { ALWAYS_ON, type FeatureKey } from "./features";

export interface Limits {
  max_assets?: number;
  max_users?: number;
  max_storage_mb?: number;
}

export interface Plan {
  code: string;
  name: string;
  description: string;
  price_minor: number;
  currency: string;
  billing_cycle: "monthly" | "yearly" | "once";
  features: string[];
  limits: Limits;
  active: boolean;
  sort_order: number;
}

/**
 * What one organisation may actually do.
 *
 * The plan grants; an override adds or takes away. An override of `false` is
 * as meaningful as `true` - it is how a feature is withdrawn from one customer
 * without moving them off the plan they pay for.
 */
export async function effectiveEntitlements(orgId: string): Promise<{
  features: string[];
  limits: Limits;
  plan_code: string | null;
}> {
  return withPlatform(async (c) => {
    const org = (await c.query<{
      plan_code: string | null;
      limit_overrides: Limits;
    }>(
      "SELECT plan_code, limit_overrides FROM organizations WHERE id = $1",
      [orgId],
    )).rows[0];
    if (!org) return { features: [...ALWAYS_ON], limits: {}, plan_code: null };

    const plan = org.plan_code
      ? (await c.query<Plan>("SELECT * FROM plans WHERE code = $1", [org.plan_code])).rows[0]
      : undefined;

    const overrides = (await c.query<{ feature_key: string; enabled: boolean }>(
      "SELECT feature_key, enabled FROM org_entitlements WHERE org_id = $1",
      [orgId],
    )).rows;

    const features = new Set<string>([...ALWAYS_ON, ...(plan?.features ?? [])]);
    for (const override of overrides) {
      if (override.enabled) features.add(override.feature_key);
      else features.delete(override.feature_key);
    }
    // Core survives any override: withdrawing it leaves an account that can
    // sign in and do nothing at all, which is a support call, not a plan.
    for (const key of ALWAYS_ON) features.add(key);

    return {
      features: [...features].sort(),
      limits: { ...(plan?.limits ?? {}), ...org.limit_overrides },
      plan_code: org.plan_code,
    };
  });
}
```

Tests for `effectiveEntitlements` must cover, each as its own case: no plan; a
plan; an override adding; an override removing; an override removing `core`
(refused); a limit override replacing the plan's; a limit the plan omits
(unlimited).

- [x] **Step 4: Seed the starting plans**

In `scripts/seed-permissions.ts` — which already runs after every migration —
upsert three plans, `ON CONFLICT (code) DO NOTHING` so an operator's edits are
never overwritten by a deploy:

| code | name | features | limits |
|---|---|---|---|
| `starter` | Starter | core, import, labels, reports | max_assets 500, max_users 10 |
| `professional` | Professional | + stocktake, maintenance, depreciation, reports_scheduled, api | max_assets 5000, max_users 50 |
| `enterprise` | Enterprise | all | none |

- [x] **Step 5: Plan endpoints**

`GET /api/platform/plans` (list), `POST` (create), `PATCH /api/platform/plans/[code]`,
`DELETE` (refuse with 409 when an organisation is on it — name the count in the
detail).

- [x] **Step 6: Run, then commit**

```
feat(api): features, plans and what each customer is entitled to

release-note: none
```

---

## Task 59: Provisioning, suspension and removal

**Files:**
- Create: `api/src/lib/platform/provision.ts`
- Create: `api/src/app/api/platform/orgs/route.ts`, `orgs/[id]/route.ts`, `orgs/[id]/suspend/route.ts`
- Modify: `api/scripts/seed.ts` (use the shared provisioning rather than its own copy)
- Test: `api/src/lib/platform/provision.test.ts`, `api/src/app/api/platform/orgs/routes.test.ts`

**Interfaces:**
- Consumes: `seedRolesForOrg` from `scripts/seed-permissions`; `hashPassword`.
- Produces:
  - `provisionOrg(input): Promise<{ orgId: string; adminEmail: string; password: string }>`
  - `suspendOrg(orgId, reason)`, `resumeOrg(orgId)`, `deleteOrg(orgId, slug)`


**Executed 2026-09-09.** Two defects the tests caught, both of which would have
produced a customer who could not use the product:

1. **`seed_system_roles` creates roles and nothing else.** The permission grants
   are applied afterwards in TypeScript by `seedRolesForOrg`, because the
   permission list lives in code. Calling only the function - as the plan says
   to - produced an administrator holding no permissions at all, refused by
   every screen on their first day. Provisioning now applies the grants in the
   same transaction.
2. **Reading `organizations` outside a tenant context throws.** The `own_org`
   policy from migration 004 is written without the missing-ok flag, so
   `current_setting('app.org_id')` raises rather than returning null. The
   suspension check first read it on the plain pool, which turned every
   authenticated request into a 500. It reads inside `withTenant` instead - an
   organisation can see its own row by design.

Suspension is enforced in `requireAuth`, not only at sign-in, so an existing
session and a running integration both stop. That is the whole difference
between suspending a customer and asking them to stop. The login route checks
separately, after the password, because answering differently before the
credential is known would say which addresses exist and which customers have
stopped paying.

`PATCH` guards each nullable field with "was it mentioned", because for a
renewal date null is a value an operator sets deliberately and coalesce cannot
tell that from an absent field.

The demo seed was left calling its own `provision()`: it targets a fixed slug,
repairs a half-finished earlier run and is idempotent, none of which the
console's path does or should. Sharing them would have made both worse.

- [x] **Step 1: Write the failing tests**

```ts
describe("provisioning a customer", () => {
  it("creates an organisation somebody can immediately sign in to", async () => {
    const { orgId, adminEmail, password } = await provisionOrg({
      name: "Acme Ltd", slug: `acme-${Date.now()}`,
      adminName: "Ayu", adminEmail: `ayu-${Date.now()}@acme.test`,
      planCode: "starter",
    });
    // The whole point: not a row, a working tenant.
    const res = await LOGIN(new Request("http://api.test/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password }),
    }));
    expect(res.status).toBe(200);
    expect(orgId).toBeTruthy();
  });

  it("gives it roles and notification rules, not just a name", async () => {
    // An organisation with no roles has an administrator who can do nothing,
    // and with no rules sends no mail whatever happens.
  });

  it("refuses a slug already taken", async () => { /* 409 */ });

  it("leaves nothing behind when a step fails", async () => {
    // A half-provisioned tenant is worse than none: it exists, so the retry
    // finds it and builds on the leftovers.
  });

  it("does not delete an organisation on a mistyped slug", async () => {
    await expect(deleteOrg(orgId, "not-the-slug")).rejects.toThrow();
  });
});

describe("suspension", () => {
  it("stops that organisation's people signing in", async () => { /* 403 */ });
  it("says the organisation is suspended rather than the password is wrong", async () => {
    // Telling somebody their password is wrong when their company has not
    // paid produces a support call about the wrong problem entirely.
  });
  it("leaves their data untouched and readable once resumed", async () => { /* … */ });
  it("is recorded in the platform audit with a reason", async () => { /* … */ });
});
```

- [x] **Step 2–4: Implement, run, verify**

`provisionOrg` runs the whole thing under one `withPlatform` transaction:
insert the organisation, `SELECT seed_system_roles($1)`, seed the default
notification rules, insert the administrator with the Administrator role's id,
set `plan_code`, `trial_ends_at` and `contract_starts`, then record the audit
row. A throw rolls it all back, which is what makes step "leaves nothing
behind" pass without a compensating delete.

**Enforcement of suspension belongs in `requireAuth`, not in the login route
alone** — a suspended organisation's existing sessions and API keys must stop
working too, not just new sign-ins. Add the check to `src/lib/auth/guard.ts` and
prove it with a test that suspends *after* signing in.

Return a new `problem(403, "organization-suspended", …)` and add it to
`src/lib/http/catalog.ts` — the catalogue test will fail until you do.

- [x] **Step 5: Make the demo seed use this**

`scripts/seed.ts` has its own `provision()` written before this existed. Replace
its body with a call to `provisionOrg`, so there is one way to create a tenant
and the demo exercises it. Its tests must still pass unchanged.

- [x] **Step 6: Commit**

```
feat(api): provision, suspend and remove a customer organisation

release-note: none
```

---

## Task 60: Limits, enforced where the write happens

**Files:**
- Create: `api/src/lib/entitlements.ts`
- Modify: `api/src/app/api/v1/assets/route.ts`, `api/src/app/api/v1/imports/route.ts`, `api/src/app/api/admin/users/route.ts`
- Modify: `api/src/lib/http/catalog.ts`
- Test: `api/src/lib/entitlements.test.ts`, `api/src/app/api/v1/limits.test.ts`

**Interfaces:**
- Produces:
  - `hasFeature(ctx: Ctx, key: FeatureKey): Promise<boolean>`
  - `requireFeature(ctx: Ctx, key: FeatureKey): Promise<Response | null>`
  - `assertWithinLimit(ctx: Ctx, limit: "max_assets" | "max_users", adding?: number): Promise<Response | null>`


**Executed 2026-09-09.**

Two of the three call sites the plan names exist and are wired: creating an
asset, and committing an import. The third does not: **there is no endpoint
that creates a user anywhere in this system.** `POST /api/admin/users` is not
missing a limit check - it is missing. `max_users` is implemented and tested,
and has nothing to gate until somebody can be invited.

That is a product gap rather than a gap in this task, and it is larger than it
looks: the onboarding checklist added in Task 53 tells a customer to "Invite
your colleagues" and links them to a page that can only list the people who are
already there. The item can never be completed by any action the product
offers. Recorded here, and raised with the owner on the day it was found.

The import is checked once for the whole file, before `runImport`, and only for
a run that writes. A dry run is never refused: previewing what would happen is
how somebody discovers they need a bigger plan, and refusing it tells them
nothing.

The asset check sits before `withIdempotency`, so a replayed request returns
the original answer rather than being refused because the register has filled
up since.

402 rather than 403, because a permission failure and a commercial one have
different remedies - one an administrator fixes, the other whoever pays - and a
client that cannot tell them apart tells the customer the wrong thing.

- [x] **Step 1: Write the failing tests**

```ts
describe("plan limits", () => {
  it("refuses a create that would exceed the cap, naming the limit", async () => {
    const res = await POST(request({ name: "One too many" }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.type).toContain("plan-limit");
    expect(body.detail).toMatch(/500/);      // the number they are on
    expect(body.detail).toMatch(/assets/);
  });

  it("never blocks reading, however far over the cap they are", async () => {
    // A customer over their limit must always be able to get their data out.
    // A limit that holds data hostage is not a limit, it is a threat.
    expect((await GET(request())).status).toBe(200);
    expect((await EXPORT(request())).status).toBe(200);
  });

  it("refuses an import that would cross the cap, before writing any of it", async () => {
    // Half an import is the worst outcome: the customer cannot tell what
    // landed, and re-running double-imports the part that did.
  });

  it("allows everything when the plan sets no limit", async () => { /* … */ });

  it("counts only live assets, not deleted ones", async () => {
    // Otherwise deleting to make room does not make room, and the message
    // tells them to do something that does not work.
  });
});
```

- [x] **Step 2: Implement**

```ts
/**
 * Entitlements for the current request, resolved once.
 *
 * Cached per request: several handlers ask more than once, and this is two
 * queries against the platform connection. The cache lives in the same
 * AsyncLocalStorage the request id does - read src/lib/http/logging.ts and
 * follow it rather than inventing a second mechanism.
 */
export async function assertWithinLimit(
  ctx: Ctx,
  limit: "max_assets" | "max_users",
  adding = 1,
): Promise<Response | null> {
  const { limits } = await entitlementsFor(ctx.orgId);
  const cap = limits[limit];
  if (cap === undefined) return null;

  const current = await currentUsage(ctx, limit);
  if (current + adding <= cap) return null;

  return problem(402, "plan-limit", "Plan limit reached", {
    detail:
      `This organisation's plan allows ${cap} ${LABEL[limit]}, and it has `
      + `${current}. Remove some, or ask your administrator to change plan.`,
  });
}
```

Add `plan-limit` (402) and `feature-not-enabled` (403) to the error catalogue
with a real cause and a real remedy — the catalogue test fails otherwise.

- [x] **Step 3: Wire the three call sites, and only those**

`POST /api/v1/assets`, the committed branch of `POST /api/v1/imports` (checking
`rows.length` **before** `runImport`), and `POST /api/admin/users`.

- [x] **Step 4: Run, verify each through its real route, commit**

```
feat(api): hold a customer to the limits their plan sets

Writes are refused with a 402 naming the limit and the current count. Reads
and exports never are: a customer over their cap must always be able to get
their data out.

release-note: Creating an asset or inviting a colleague now tells you plainly
 when the organisation has reached the limit its plan allows.
```

---

## Task 61: Feature gates, and telling the tenant UI

**Files:**
- Modify: route handlers for stocktakes, maintenance, depreciation, reports schedules, imports, labels, api-keys, webhooks
- Modify: `api/src/app/api/admin/auth/me/route.ts`
- Modify: `web/src/context/AuthContext.tsx`, `web/src/layout/AppSidebar.tsx`
- Test: `api/src/app/api/v1/features.test.ts`, `web/src/context/AuthContext.test.tsx`
- Modify: `api/src/lib/platform/features.test.ts` (turn on the `it.todo` from Task 58)


**Executed 2026-09-10.**

`depreciation` has no route of its own - it is fields on an asset, a report,
and a month-end job - so the scanner correctly reported it as sold and never
enforced. Gated where it is *configured*: setting a policy on an asset. Owning
something with a purchase cost is not the feature; writing that cost down is.
The book-value report names its feature in its own definition, so the gallery
leaves it out and running it directly is refused - offering something and then
saying no when it is chosen is worse than not offering it.

The scanner only sees a literal key, which is why passing `definition.feature`
as a variable did not satisfy it. That is the scanner being right: a gate it
cannot see is a gate nobody can audit.

`createOrg` now puts test organisations on a plan that includes everything.
Without it every fixture had only the register, and dozens of tests failed with
"not included in this plan" rather than testing what they meant to. A fixture
should look like a customer.

The interface hides what is not included, and the API refuses it regardless -
both, because a UI-only gate is not a gate. When the API does not say what the
features are (a version behind during a rolling deploy) the interface shows
everything: the worst case is then a menu item leading to an explanation,
rather than half the product silently disappearing.

- [x] **Step 1: Write the failing tests**

```ts
it("refuses a stock-take to an organisation whose plan has none", async () => {
  const res = await POST(request());
  expect(res.status).toBe(403);
  expect((await res.json()).type).toContain("feature-not-enabled");
});

it("hides the navigation for a feature the customer does not have", () => {
  // Hiding is courtesy. The API refusing is the enforcement, and both tests
  // exist because a UI-only gate is not a gate.
});

it("still refuses the endpoint when the UI is bypassed", async () => { /* … */ });
```

- [x] **Step 2: Gate each area at its route**, once per area, immediately after
`requireAuth`. One line per handler:

```ts
const gate = await requireFeature(ctx, "stocktake");
if (gate) return gate;
```

- [x] **Step 3: Publish entitlements to the UI**

`GET /api/admin/auth/me` returns `features: string[]` and `limits` alongside
`permissions`. `SessionUser` gains `features`; `AuthContext` gains
`has(feature: string): boolean` beside `can(permission)`. The sidebar filters on
it, exactly as it does permissions.

- [x] **Step 4: Turn on the "gates only features that something checks" test**

Remove the `it.todo` and run it. It should now pass — and if a feature has no
gate, add the gate rather than removing it from the catalogue.

- [x] **Step 5: Run all three commands in both workspaces, then commit**

```
feat: sell features, and enforce what was sold

release-note: none
```

---

## Task 62: The console — sign-in and the customer list

**Files:**
- Create: `web/src/platform/PlatformAuthContext.tsx`, `PlatformLayout.tsx`, `PlatformSignIn.tsx`, `Organisations.tsx`
- Create: `web/src/api/platform.ts`
- Modify: `web/src/App.tsx` (lazy `/platform` routes, outside `RequireAuth`)
- Test: `web/src/platform/Organisations.test.tsx`, `PlatformSignIn.test.tsx`

**The console is lazy-loaded**, like the developer portal. A tenant should not
download the operator's console on every page load, and `/platform` is guarded
by its own context, not `RequireAuth`.


**Executed 2026-09-11.**

The link guard refused the list as first written: it linked to `/platform/:id`
and `/platform/new`, neither of which existed. Rather than ship dead links,
**creating a customer moved into this task** - a console that can list
customers but not take one on is no use on a fresh deployment, and the API for
it was already built in Task 59. The row is deliberately not a link yet; Task
63 makes it one when there is a page to open.

The confirmation after creating a customer is a page of its own rather than a
toast. It shows a password exactly once, and a stray click must not dismiss the
only copy of a credential before anybody has written it down.

The console is guarded by its own context rather than `RequireAuth`, which
would redirect an operator to the customers' sign-in - the wrong door, and it
would put the two planes one redirect apart. Somebody not signed in gets the
operator sign-in in place, with a link to the ordinary one for whoever arrived
by mistake.

While the session is still resolving the layout says so rather than rendering
the sign-in form: a flash of it reads as having been logged out.

- [x] **Step 1: Write the failing tests**

```tsx
it("lists every customer with what they hold and what they are on", async () => {
  renderConsole();
  expect(await screen.findByText("Acme Ltd")).toBeInTheDocument();
  expect(screen.getByText("Professional")).toBeInTheDocument();
  expect(screen.getByText("1,284 assets")).toBeInTheDocument();
});

it("marks a suspended customer plainly, not with a colour alone", async () => {
  // Colour alone fails for a colour-blind operator and in a screenshot.
});

it("shows a trial that is about to end", async () => { /* … */ });

it("sends somebody who is not signed in to the platform sign-in", async () => {
  // And never to the tenant one: two planes, two doors.
});
```

- [x] **Step 2: Build the list**

Columns: organisation (name and slug), plan, status (active / suspended / trial
ending), assets, users, renews on. Sort by name; filter by status and plan; a
search box over name and slug.

`GET /api/platform/orgs` returns all of it in one query — the counts come from
`usage.ts` (Task 63's `orgUsage`), aggregated with `LEFT JOIN LATERAL` so an
organisation with no assets still appears. **A plain join drops the customers
who have not started yet, which are exactly the ones the operator needs to see.**

- [x] **Step 3: Run, then commit**

```
feat(web): the platform console's sign-in and customer list

release-note: none
```

---

## Task 63: The console — one customer

**Files:**
- Create: `web/src/platform/Organisation.tsx`, `web/src/platform/PlanEditor.tsx`
- Create: `api/src/lib/platform/usage.ts`
- Create: `api/src/app/api/platform/orgs/[id]/entitlements/route.ts`
- Test: `web/src/platform/Organisation.test.tsx`, `api/src/lib/platform/usage.test.ts`

One page holding everything about one customer:

- **Identity** — name, slug, created, notes (free text, saved on blur).
- **Commercial** — plan, price (defaulting to the plan's, overridable), currency,
  cycle, contract start, renewal, trial end.
- **Features** — every entry in `FEATURES`, showing whether it comes from the
  plan or an override, with a switch and a note field for the exception.
- **Limits** — the plan's, each overridable, each shown **against current usage**
  so the operator can see who is close.
- **Actions** — suspend (with a reason), resume, delete (typing the slug).


**Executed 2026-09-11.**

**Storage usage needed a hole in the platform role's grants, and the right size
of hole turned out to be a column.** The console has no grant on `attachments`
at all - deliberately, and asserted in `db.test.ts` - but the storage allowance
is measured in megabytes and the megabytes are in that table. Migration 024
grants `SELECT (org_id, size_bytes)`: `SELECT *` stays refused, filenames and
object keys stay unreadable, and `sum(size_bytes)` works.

Usage counts the same way the limits are enforced - live assets only, pending
invitations counted as people - because two different numbers for the same
question is how an operator comes to distrust the screen.

The entitlements endpoint replaces the whole set rather than merging. Only the
console knows what the operator meant to leave alone, and a per-feature
endpoint would let two half-finished edits land a customer somewhere neither
intended. An override that agrees with the plan is dropped rather than stored:
it would sit there implying somebody had decided something.

Switching off the register is refused by the endpoint as well as by the
resolver. The resolver puts it back regardless, and storing an override that is
silently ignored tells the next operator a lie about what they did.

One test was left flaky by this work: the People page grew an invite form and a
pending-invitations card, and an assertion waiting the default second was seen
taking 1.1s under a full parallel run. Given room rather than left to fail one
run in twenty, which teaches people to re-run instead of to read.

- [x] **Step 1: Write the failing tests**

```tsx
it("shows where each feature comes from", async () => {
  // "From the Professional plan" and "Turned on for this customer" are
  // different facts, and the operator needs to know which they are changing.
  expect(await screen.findByText(/from the Professional plan/i)).toBeInTheDocument();
  expect(screen.getByText(/turned on for this customer/i)).toBeInTheDocument();
});

it("shows usage against each limit", async () => {
  expect(await screen.findByText("1,284 of 5,000")).toBeInTheDocument();
});

it("will not delete without the slug typed exactly", async () => { /* … */ });

it("asks for a reason before suspending", async () => {
  // It goes in the audit trail, and future-you will want to know why.
});

it("warns when a limit is set below what the customer already holds", async () => {
  // Not refused - sometimes that is the intent - but never silent.
});
```

- [x] **Step 2–4:** Implement `orgUsage(orgId)` (live assets, users, storage from
`attachments`), the entitlements endpoint (`PUT` replaces the override set for
one organisation and records one audit row per change), and the page.

- [x] **Step 5: Commit**

```
feat(web): manage one customer's plan, features, limits and contract

release-note: none
```

---

## Task 64: What needs attention

**Files:**
- Create: `web/src/platform/Attention.tsx`
- Create: `api/src/app/api/platform/attention/route.ts`
- Test: `api/src/app/api/platform/attention.test.ts`

The console's front page. Not a chart — a list of things that need a decision:

- trials ending within 14 days,
- renewals due within 30 days,
- organisations over any limit,
- organisations with no plan,
- organisations suspended for more than 90 days (delete or reinstate?),
- organisations with no sign-in for 60 days.


**Executed 2026-09-11.** Two judgements the plan did not make:

**A suspended customer is chased about nothing.** Their access is already off,
so a renewal reminder or a lapsing trial for somebody who cannot sign in is
noise that hides the customers who actually need ringing. The only thing a
suspended customer appears for is having been suspended long enough that
somebody should decide: reinstate, or delete and stop holding their data.

**A customer created this week is not dormant.** "Nobody has signed in" is only
news once they have had the chance to, so the dormancy window applies to the
organisation's age as well as to its last sign-in.

A lapsed trial stays on the list rather than dropping off it, since nothing
suspends anybody automatically and a trial that ended last week is exactly the
conversation that is overdue.

The attention list became the console's front page and the customer list moved
to `/platform/customers`. Opening the console on "here is everything" answers a
question nobody asked; opening it on "here is what needs deciding" is the
reason to open it at all.

- [x] **Step 1: Write the failing tests**

```ts
it("lists a trial ending inside the window and not one outside it", async () => { /* … */ });
it("counts an organisation once even when it needs attention twice", async () => {
  // Otherwise the badge says nine when there are four customers to ring.
});
it("says nothing at all when nothing needs attention", async () => {
  // An empty list is the right answer, not a page of zeroes.
});
```

- [x] **Step 2–3:** One query per category, each returning organisation id, name,
slug and the reason. Group by organisation in the handler.

- [x] **Step 4: Commit**

```
feat: the platform console's attention list

release-note: none
```

---

## Task 65: Documentation, seed and smoke

**Files:**
- Create: `docs/platform.md`
- Modify: `docs/architecture.md`, `docs/deployment.md`, `docs/operations.md`, `README.md`
- Modify: `api/scripts/seed.ts` (a platform admin and two demo customers)
- Modify: `e2e/smoke.spec.ts`
- Modify: `.github/workflows/ci.yml` if the smoke job needs the new variables

- [x] **Step 1: Write `docs/platform.md`** covering: the two planes and why;
creating the first operator; provisioning a customer; what each feature means
commercially; how a limit behaves when reached; suspension versus deletion; and
**what the operator can and cannot see** — the console shows counts, never a
customer's assets, and that boundary is a grant in the database, not a promise.

- [x] **Step 2: Extend the seed** with one platform admin
(`ops@demo.local`), the demo organisation on `professional`, and a second
organisation on `starter` that is **over its asset limit and in a trial ending
in three days**, so the attention list and the limit warnings have something
real to show.

- [x] **Step 3: Extend the smoke suite**

```ts
test("the operator signs in and sees their customers", async ({ page }) => { /* … */ });
test("a tenant session cannot reach the console", async ({ page }) => {
  // The assertion that matters most in this whole phase.
});
test("a suspended customer cannot sign in, and says why", async ({ page }) => { /* … */ });
```

- [x] **Step 4: Run everything and commit**

```
docs: the platform console, and a seed that shows it doing something

release-note: none
```

---

## Self-review

**Coverage of the four decisions.** Plans with overrides — Tasks 58 and 63.
Limits blocking writes but never reads — Task 60, with the read case as an
explicit test. Record-keeping only — Task 63's commercial block; no payment
provider appears anywhere in this plan. Nothing suspended automatically — Task
64 surfaces lapsed trials to the operator and no job acts on them.

**Gaps I know about and have left out on purpose:**

- **No impersonation.** "Sign in as this customer to see what they see" is the
  next thing anybody will ask for, and it is the single most dangerous feature
  in a system like this. It needs its own design: a time-boxed, audited,
  consent-bounded token, not a switch on this console.
- **No usage history.** Everything here is "now". Charting a customer's growth
  needs a rollup table and a job; it is worth doing after there are customers to
  chart.
- **No per-feature pricing.** A plan has one price. Add-on pricing is a billing
  model, and this phase deliberately stops short of billing.

**Ordering risk.** Task 58's anti-drift test cannot pass until Task 61. It is
written in 58 as `it.todo` with a comment naming 61, and turned on there. If the
tasks are executed out of order, that test is the one that will look wrong.

**A thing to verify before Task 60.** `entitlementsFor` reaching for the
platform pool means every tenant write touches a second connection. Check the
pool sizing under the API's own load test before shipping it; if it is a
problem, cache per organisation with a short TTL rather than per request — but
measure first, and do not add a cache to a problem nobody has demonstrated.
