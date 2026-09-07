# Phase 1b — Authorization

> Part of the [Assets Management System plan](./00-overview.md). Read `00-overview.md` first — its Global Constraints apply to every task here.

**Tasks 4a–4c.** Replaces the four hardcoded roles with roles a company defines and manages itself, optionally scoped to particular branches.

**Spec sections:** extends §4.4 (tenant isolation) and §5.1 (API conventions); supersedes the fixed four-role model described in §10.2's *Users and roles* article.

## Why this runs before Phase 2

Phase 1 shipped `user_role` as a Postgres enum of four values, with
`scopesForRole()` mapping each to a fixed scope list. Spec §14 already concedes
"the four roles will not survive contact with a real organisation".

Three things make this cheaper now than after Phase 2:

1. **The permission vocabulary must be settled before the handlers exist.** Every
   endpoint in Phases 2–4 calls `requireAuth(req, <permission>)`. Fixing the
   vocabulary now means dynamic roles slot in underneath without touching a
   single handler. Discovering later that `assets:delete` should have been
   distinct from `assets:write` means revisiting roughly thirty handlers.
2. **Branch scoping changes `requireAuth`'s signature.** It gains an optional
   target location. Every asset handler is a caller, so the signature wants to
   be right before they are written.
3. **`user_role` is in the return type of two `auth_lookup_*` functions** from
   migration 006. Replacing an enum that function signatures depend on is
   cheaper before Phase 2's tables reference it.

## The decisions this phase implements

Taken with the product owner on 2026-09-04:

| Question | Decision |
|---|---|
| How many roles per user? | Exactly one. Resolution is a single join, and "what can this person do?" has one answer. |
| Who owns a role? | The company. Roles are tenant rows under the existing RLS, so one customer never sees another's. |
| Branch scoping? | Optional. Most roles are organisation-wide; a role assignment may be narrowed to specific locations. |
| Can a customer invent permissions? | No. |

**Permissions are code-defined and fixed; roles are data and dynamic.** This is
the distinction that makes the feature tractable. A permission only means
something because a handler checks it, so a permission a customer invents would
be inert — it would grant nothing and forbid nothing. What a customer actually
needs is to compose *their own roles* out of the permission vocabulary the
product enforces. So `permissions` is seeded reference data, and `roles` is
tenant data they own.

## Two vocabularies, deliberately

The public API's scopes are a published contract: spec §5.1 fixes them as
`assets:read`, `assets:write`, `reports:read` and `admin`, and Phase 7's
developer portal documents them. Changing that set is a breaking API change.

The internal permission vocabulary needs to be finer than four values for roles
to be worth managing. So:

- **API key scopes** stay exactly the four published strings. Each expands to a
  fixed bundle of permissions.
- **User roles** grant permissions directly.
- `requireAuth` checks the resolved permission set, and neither mechanism knows
  which the caller used.

This keeps `/api/v1` additive-only while letting the dashboard's authorization
be as granular as it needs to be.

## Why branch scoping is enforced in the domain layer, not by RLS

Tenant isolation is enforced by Postgres because a leak there crosses
*customers*, and no amount of care in application code is a match for a policy
the database applies unconditionally.

Branch scoping is a different risk. A leak crosses *departments inside one
customer*, who can already see each other in the org chart; and customers
routinely want partial cross-branch visibility, which a blanket policy fights.
It also varies per user rather than per connection, so it would mean setting and
resetting a second GUC on every `withTenant` call and adding a clause to every
policy — for a weaker payoff.

So branch scope is applied in the domain layer, through one choke point
(`locationScopeClause`) that every asset query uses, with a test proving a
scoped user cannot read another branch's asset. If branch scoping later grows
into a hard security boundary, revisit this: the GUC approach is viable, just
not yet worth its cost.

## Task deliverables

| Task | Deliverable |
|---|---|
| 4a | Permission vocabulary, roles schema, seeded system roles, `users.role` backfilled |
| 4b | Permission resolution, `Ctx` carrying permissions and branch scope, `requireAuth` |
| 4c | Admin API: role CRUD, permission catalogue, role assignment and branch scoping |

---

### Task 4a: Permission vocabulary, roles schema and seeded system roles

**Files:**
- Create: `api/src/lib/auth/permissions.ts`
- Create: `api/migrations/008_roles.sql`
- Test: `api/src/lib/auth/permissions.test.ts`, `api/src/lib/auth/roles.schema.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `query` (Task 1); the `organizations`, `users` and `locations` tables (Task 2).
- Produces:
  - `PERMISSIONS: readonly Permission[]` — the fixed vocabulary
  - `type PermissionKey` — a union of every permission string
  - `SYSTEM_ROLES: Record<string, { description: string; permissions: PermissionKey[] }>`
  - `API_SCOPE_PERMISSIONS: Record<ApiScope, PermissionKey[]>` — how a published API scope expands
  - Tables `permissions`, `roles`, `role_permissions`, `user_location_scopes`; `users.role_id`

**Design note:** `permissions` is a table as well as a TypeScript constant. The
constant is the source of truth — the migration seeds the table from the same
list, and a test asserts the two agree. The table exists so `role_permissions`
can carry a foreign key, which is what stops a role referencing a permission
that no longer exists after a rename.

- [ ] **Step 1: Write the failing tests**

`api/src/lib/auth/permissions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { query } from "../db";
import {
  PERMISSIONS,
  SYSTEM_ROLES,
  API_SCOPE_PERMISSIONS,
  type PermissionKey,
} from "./permissions";

describe("the permission vocabulary", () => {
  it("uses resource:verb keys throughout", () => {
    for (const p of PERMISSIONS) {
      expect(p.key, `${p.key} should be resource:verb`).toMatch(
        /^[a-z]+(?:_[a-z]+)*:[a-z]+$/,
      );
    }
  });

  it("has no duplicates", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every permission a label and a description a customer can act on", () => {
    for (const p of PERMISSIONS) {
      expect(p.label.length, `${p.key} label`).toBeGreaterThan(3);
      expect(p.description.length, `${p.key} description`).toBeGreaterThan(20);
      expect(p.group.length, `${p.key} group`).toBeGreaterThan(2);
    }
  });

  it("seeds the database table from the same list", async () => {
    // The constant is the source of truth; the table exists so role_permissions
    // can carry a foreign key. They must not drift.
    const rows = await query<{ key: string }>("SELECT key FROM permissions");
    expect(rows.map((r) => r.key).sort()).toEqual(
      PERMISSIONS.map((p) => p.key).sort(),
    );
  });
});

describe("system roles", () => {
  it("defines the four roles the product ships with", () => {
    expect(Object.keys(SYSTEM_ROLES).sort()).toEqual([
      "Administrator", "Manager", "Technician", "Viewer",
    ]);
  });

  it("grants only permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS.map((p) => p.key));
    for (const [name, role] of Object.entries(SYSTEM_ROLES)) {
      for (const key of role.permissions) {
        expect(known.has(key), `${name} grants unknown ${key}`).toBe(true);
      }
    }
  });

  it("gives the administrator every permission", () => {
    expect([...SYSTEM_ROLES.Administrator.permissions].sort()).toEqual(
      PERMISSIONS.map((p) => p.key).sort(),
    );
  });

  it("gives a viewer no permission that changes anything", () => {
    for (const key of SYSTEM_ROLES.Viewer.permissions) {
      expect(key.endsWith(":read")).toBe(true);
    }
  });

  it("does not let a technician manage users, roles or keys", () => {
    const tech = new Set<string>(SYSTEM_ROLES.Technician.permissions);
    for (const forbidden of ["users:write", "roles:write", "api_keys:write"]) {
      expect(tech.has(forbidden), `technician should not have ${forbidden}`).toBe(false);
    }
  });
});

describe("published API scopes", () => {
  it("expands each of the four documented scopes", () => {
    expect(Object.keys(API_SCOPE_PERMISSIONS).sort()).toEqual([
      "admin", "assets:read", "assets:write", "reports:read",
    ]);
  });

  it("expands admin to everything, so the published contract still holds", () => {
    expect([...API_SCOPE_PERMISSIONS.admin].sort()).toEqual(
      PERMISSIONS.map((p) => p.key).sort(),
    );
  });

  it("expands only to permissions that exist", () => {
    const known = new Set<string>(PERMISSIONS.map((p) => p.key));
    for (const [scope, keys] of Object.entries(API_SCOPE_PERMISSIONS)) {
      for (const key of keys as PermissionKey[]) {
        expect(known.has(key), `${scope} expands to unknown ${key}`).toBe(true);
      }
    }
  });

  it("keeps assets:write a superset of assets:read", () => {
    const read = new Set<string>(API_SCOPE_PERMISSIONS["assets:read"]);
    for (const key of read) {
      expect(API_SCOPE_PERMISSIONS["assets:write"]).toContain(key);
    }
  });
});
```

`api/src/lib/auth/roles.schema.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg } from "../../test/org";
import { SYSTEM_ROLES } from "./permissions";

let orgA: string;
let orgB: string;

beforeAll(async () => {
  orgA = await createOrg("Roles Org A");
  orgB = await createOrg("Roles Org B");
});

describe("roles are tenant data", () => {
  it("gives a new organisation its own copy of the system roles", async () => {
    const names = await withTenant(orgA, async (c) =>
      (await c.query<{ name: string }>("SELECT name FROM roles ORDER BY name")).rows,
    );
    expect(names.map((r) => r.name)).toEqual(Object.keys(SYSTEM_ROLES).sort());
  });

  it("hides one company's custom role from another", async () => {
    await withTenant(orgA, (c) =>
      c.query(
        "INSERT INTO roles (org_id, name, description) VALUES ($1, 'Night Shift', 'x')",
        [orgA],
      ),
    );
    const seenByB = await withTenant(orgB, async (c) =>
      (await c.query("SELECT name FROM roles WHERE name = 'Night Shift'")).rows,
    );
    expect(seenByB).toHaveLength(0);
  });

  it("lets two companies use the same role name independently", async () => {
    // Names are unique per organisation, not globally.
    for (const org of [orgA, orgB]) {
      await withTenant(org, (c) =>
        c.query("INSERT INTO roles (org_id, name) VALUES ($1, 'Auditor')", [org]),
      );
    }
    const inB = await withTenant(orgB, async (c) =>
      (await c.query("SELECT name FROM roles WHERE name = 'Auditor'")).rows,
    );
    expect(inB).toHaveLength(1);
  });

  it("refuses a duplicate role name within one company, case-insensitively", async () => {
    await expect(
      withTenant(orgA, async (c) => {
        await c.query("INSERT INTO roles (org_id, name) VALUES ($1, 'Duplicated')", [orgA]);
        await c.query("INSERT INTO roles (org_id, name) VALUES ($1, 'duplicated')", [orgA]);
      }),
    ).rejects.toThrow(/roles_org_name_idx|duplicate key/i);
  });

  it("marks the seeded roles as system roles", async () => {
    const rows = await withTenant(orgA, async (c) =>
      (await c.query<{ is_system: boolean }>(
        "SELECT is_system FROM roles WHERE name = 'Administrator'",
      )).rows,
    );
    expect(rows[0].is_system).toBe(true);
  });

  it("refuses to delete a system role", async () => {
    await expect(
      withTenant(orgA, (c) =>
        c.query("DELETE FROM roles WHERE name = 'Administrator'"),
      ),
    ).rejects.toThrow(/system role/i);
  });

  it("allows deleting a custom role", async () => {
    await withTenant(orgA, async (c) => {
      await c.query("INSERT INTO roles (org_id, name) VALUES ($1, 'Temporary')", [orgA]);
      const { rowCount } = await c.query(
        "DELETE FROM roles WHERE name = 'Temporary'",
      );
      expect(rowCount).toBe(1);
    });
  });

  it("refuses a role permission that is not in the vocabulary", async () => {
    await expect(
      withTenant(orgA, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "SELECT id FROM roles WHERE name = 'Viewer'",
        );
        await c.query(
          `INSERT INTO role_permissions (org_id, role_id, permission_key)
           VALUES ($1, $2, 'assets:teleport')`,
          [orgA, rows[0].id],
        );
      }),
    ).rejects.toThrow(/foreign key|permission/i);
  });
});

describe("the users.role backfill", () => {
  it("gives every existing user a role_id matching their old enum role", async () => {
    // 008 backfills role_id from users.role. The enum column stays for one
    // release, per the additive-migration constraint in 00-overview.md.
    const rows = await withTenant(orgA, async (c) => {
      await c.query(
        `INSERT INTO users (org_id, email, password_hash, name, role)
         VALUES ($1, $2, 'x', 'Backfilled', 'technician')`,
        [orgA, `backfill-${orgA}@roles.test`],
      );
      return (await c.query<{ name: string | null }>(
        `SELECT r.name FROM users u LEFT JOIN roles r ON r.id = u.role_id
          WHERE u.email = $1`,
        [`backfill-${orgA}@roles.test`],
      )).rows;
    });
    expect(rows[0].name).toBe("Technician");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && npx vitest run src/lib/auth/permissions.test.ts src/lib/auth/roles.schema.test.ts`
Expected: FAIL — `Cannot find module './permissions'`.

- [ ] **Step 3: Write the permission vocabulary**

`api/src/lib/auth/permissions.ts`:

```ts
export interface Permission {
  key: string;
  label: string;
  description: string;
  /** Grouping for the role editor in Task 31a. */
  group: string;
}

/**
 * The permission vocabulary.
 *
 * Fixed and code-defined: a permission means something only because a handler
 * checks it, so one a customer invented would grant nothing. Customers compose
 * their own ROLES out of this list; they do not extend the list itself.
 *
 * Adding an entry here is a product change that must land with the handler that
 * enforces it. Removing or renaming one is breaking - role_permissions carries
 * a foreign key to it, and an existing role would lose a grant silently.
 */
export const PERMISSIONS = [
  // Assets
  { key: "assets:read", group: "Assets", label: "View assets",
    description: "See the asset register, asset details and their full history." },
  { key: "assets:write", group: "Assets", label: "Create and edit assets",
    description: "Add assets, change their fields and update their status." },
  { key: "assets:delete", group: "Assets", label: "Delete assets",
    description: "Remove assets from the register. Deleted assets are retained for audit, not destroyed." },
  { key: "assets:import", group: "Assets", label: "Import assets",
    description: "Upload spreadsheets to create or update assets in bulk." },
  { key: "assets:export", group: "Assets", label: "Export assets",
    description: "Download the register as CSV or Excel." },

  // Custody
  { key: "custody:write", group: "Custody", label: "Check assets in and out",
    description: "Issue an asset to a person, place or outside party, and take it back." },

  // Catalogue
  { key: "categories:read", group: "Catalogue", label: "View categories",
    description: "See categories and the custom fields they define." },
  { key: "categories:write", group: "Catalogue", label: "Manage categories",
    description: "Create categories and change which custom fields their assets carry." },
  { key: "locations:read", group: "Catalogue", label: "View locations",
    description: "See the location tree." },
  { key: "locations:write", group: "Catalogue", label: "Manage locations",
    description: "Create, rename and reorganise locations." },

  // Labels
  { key: "labels:print", group: "Labels", label: "Print labels",
    description: "Generate QR and barcode labels and label sheets." },

  // Reports
  { key: "reports:read", group: "Reports", label: "Run reports",
    description: "Run reports and download them in any format." },
  { key: "reports:schedule", group: "Reports", label: "Schedule reports",
    description: "Have reports run automatically and emailed to a list of people." },

  // Administration
  { key: "users:read", group: "Administration", label: "View people",
    description: "See who has access to this organisation and what role they hold." },
  { key: "users:write", group: "Administration", label: "Manage people",
    description: "Invite people, change their role and remove their access." },
  { key: "roles:read", group: "Administration", label: "View roles",
    description: "See the roles defined for this organisation and what each permits." },
  { key: "roles:write", group: "Administration", label: "Manage roles",
    description: "Create roles and change which permissions they grant." },
  { key: "api_keys:read", group: "Administration", label: "View API keys",
    description: "See which API keys exist and when each was last used." },
  { key: "api_keys:write", group: "Administration", label: "Manage API keys",
    description: "Create and revoke API keys for other systems." },
  { key: "webhooks:write", group: "Administration", label: "Manage webhooks",
    description: "Subscribe other systems to events from this one." },
  { key: "settings:write", group: "Administration", label: "Manage settings",
    description: "Change email providers, templates and notification rules." },
  { key: "audit:read", group: "Administration", label: "View the audit trail",
    description: "See the organisation-wide record of who changed what and when." },
] as const satisfies readonly Permission[];

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

const ALL = PERMISSIONS.map((p) => p.key) as PermissionKey[];

const READ_ONLY = ALL.filter((k) => k.endsWith(":read")) as PermissionKey[];

/**
 * The roles every organisation starts with. Seeded per tenant so a customer can
 * edit or rename them; `is_system` only prevents deletion, because deleting the
 * role every user holds would lock the organisation out of itself.
 */
export const SYSTEM_ROLES: Record<
  string,
  { description: string; permissions: PermissionKey[] }
> = {
  Administrator: {
    description: "Full access, including people, roles, keys and settings.",
    permissions: ALL,
  },
  Manager: {
    description:
      "Runs the register day to day: assets, categories, locations, imports and reports.",
    permissions: [
      "assets:read", "assets:write", "assets:delete", "assets:import", "assets:export",
      "custody:write",
      "categories:read", "categories:write",
      "locations:read", "locations:write",
      "labels:print",
      "reports:read", "reports:schedule",
      "users:read", "audit:read",
    ],
  },
  Technician: {
    description:
      "Works with the assets themselves: updates them, moves them, issues and receives them.",
    permissions: [
      "assets:read", "assets:write",
      "custody:write",
      "categories:read", "locations:read",
      "labels:print",
      "reports:read",
    ],
  },
  Viewer: {
    description: "Reads the register and runs reports. Changes nothing.",
    permissions: [...READ_ONLY, "reports:read"] as PermissionKey[],
  },
};

/** The four scopes spec 5.1 publishes for API keys. Changing these breaks v1. */
export type ApiScope = "assets:read" | "assets:write" | "reports:read" | "admin";

/**
 * How a published API scope expands into permissions.
 *
 * The scope strings are a contract with integrators and cannot change; the
 * permission vocabulary behind them can. This mapping is the seam between the
 * two, so requireAuth checks one thing regardless of how the caller
 * authenticated.
 */
export const API_SCOPE_PERMISSIONS: Record<ApiScope, PermissionKey[]> = {
  "assets:read": [
    "assets:read", "assets:export", "categories:read", "locations:read",
  ],
  "assets:write": [
    "assets:read", "assets:export", "categories:read", "locations:read",
    "assets:write", "assets:delete", "assets:import", "custody:write",
    "labels:print",
  ],
  "reports:read": ["reports:read", "assets:read", "categories:read", "locations:read"],
  admin: ALL,
};

export const isPermissionKey = (value: string): value is PermissionKey =>
  (ALL as string[]).includes(value);
```

- [ ] **Step 4: Write the migration**

`api/migrations/008_roles.sql`:

```sql
-- Roles a company defines for itself, replacing the fixed user_role enum.
--
-- Permissions are code-defined reference data: identical for every tenant, and
-- meaningless unless a handler checks them, so this table carries no org_id and
-- no row-level security. It exists so role_permissions can hold a foreign key,
-- which is what stops a role keeping a grant to a permission that was removed.
CREATE TABLE permissions (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  description text NOT NULL,
  "group"     text NOT NULL
);
GRANT SELECT ON permissions TO ams_app;

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- Seeded roles. Editable and renameable, but not deletable: deleting the role
  -- every user holds would lock the organisation out of itself.
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Unique per organisation, not globally: two companies may both have "Auditor".
CREATE UNIQUE INDEX roles_org_name_idx ON roles (org_id, lower(name));

CREATE TABLE role_permissions (
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key) ON UPDATE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX role_permissions_org_idx ON role_permissions (org_id);

-- One role per user, decided 2026-09-04: resolution is a single join and
-- "what can this person do?" has exactly one answer.
ALTER TABLE users ADD COLUMN role_id uuid REFERENCES roles(id) ON DELETE RESTRICT;
CREATE INDEX users_role_idx ON users (role_id);

-- Optional branch scoping. No rows for a user means organisation-wide, which is
-- the common case - an administrator or a finance viewer has no natural branch.
-- Scoping lives on the user rather than the role so that one "Technician" role
-- serves every site, each person narrowed to their own.
CREATE TABLE user_location_scopes (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, location_id)
);
CREATE INDEX user_location_scopes_org_idx ON user_location_scopes (org_id);

CREATE TRIGGER roles_touch BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- A system role must survive a careless DELETE, including one issued straight
-- against the database rather than through the API.
CREATE OR REPLACE FUNCTION forbid_system_role_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'cannot delete the system role "%"', OLD.name
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER roles_no_delete_system BEFORE DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION forbid_system_role_delete();

-- Tenant isolation, exactly as every other tenant table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles', 'role_permissions', 'user_location_scopes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON roles, role_permissions, user_location_scopes TO ams_app;

-- Seeding the system roles for an organisation, used by the backfill below and
-- by the sign-up path for every organisation created from now on.
CREATE OR REPLACE FUNCTION seed_system_roles(p_org_id uuid) RETURNS void AS $$
DECLARE
  role_id uuid;
BEGIN
  FOR role_id IN
    INSERT INTO roles (org_id, name, description, is_system)
    SELECT p_org_id, r.name, r.description, true
      FROM (VALUES
        ('Administrator', 'Full access, including people, roles, keys and settings.'),
        ('Manager',       'Runs the register day to day: assets, categories, locations, imports and reports.'),
        ('Technician',    'Works with the assets themselves: updates them, moves them, issues and receives them.'),
        ('Viewer',        'Reads the register and runs reports. Changes nothing.')
      ) AS r(name, description)
    ON CONFLICT (org_id, lower(name)) DO NOTHING
    RETURNING id
  LOOP
    NULL;
  END LOOP;
END $$ LANGUAGE plpgsql;
```

**A note for the implementer.** The permission rows and the role/permission
grants are seeded from `PERMISSIONS` and `SYSTEM_ROLES` by
`api/scripts/seed-permissions.ts` rather than written as SQL literals, so the
constant stays the single source of truth. Write that script in this step:

`api/scripts/seed-permissions.ts`:

```ts
import { Client } from "pg";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/lib/auth/permissions";

/**
 * Reconciles the permissions table and every organisation's system roles with
 * the code. Idempotent, and run by migrate.ts after the migrations, so adding a
 * permission in code is picked up by the next deploy rather than needing a
 * hand-written migration each time.
 */
export async function seedPermissions(client: Client): Promise<void> {
  for (const p of PERMISSIONS) {
    await client.query(
      `INSERT INTO permissions (key, label, description, "group")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE
         SET label = EXCLUDED.label,
             description = EXCLUDED.description,
             "group" = EXCLUDED."group"`,
      [p.key, p.label, p.description, p.group],
    );
  }

  // Every organisation gets the system roles, including ones created before
  // this migration existed.
  const { rows: orgs } = await client.query<{ id: string }>(
    "SELECT id FROM organizations",
  );

  for (const org of orgs) {
    await client.query("SELECT seed_system_roles($1)", [org.id]);

    for (const [name, role] of Object.entries(SYSTEM_ROLES)) {
      const { rows } = await client.query<{ id: string }>(
        "SELECT id FROM roles WHERE org_id = $1 AND lower(name) = lower($2)",
        [org.id, name],
      );
      const roleId = rows[0]?.id;
      if (!roleId) continue;

      // A system role's grants track the code. A customer who wants different
      // grants makes their own role; that is what custom roles are for.
      await client.query(
        "DELETE FROM role_permissions WHERE role_id = $1",
        [roleId],
      );
      for (const key of role.permissions) {
        await client.query(
          `INSERT INTO role_permissions (org_id, role_id, permission_key)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [org.id, roleId, key],
        );
      }
    }

    // Backfill: give every user without a role_id the role matching the enum
    // column they already carry. users.role stays for one release, per the
    // additive-migration constraint - add, backfill, switch, drop later.
    await client.query(
      `UPDATE users u
          SET role_id = r.id
         FROM roles r
        WHERE u.org_id = $1
          AND r.org_id = $1
          AND u.role_id IS NULL
          AND lower(r.name) = CASE u.role
                                WHEN 'admin'      THEN 'administrator'
                                WHEN 'manager'    THEN 'manager'
                                WHEN 'technician' THEN 'technician'
                                ELSE 'viewer'
                              END`,
      [org.id],
    );
  }
}
```

Call it from `migrate.ts`, after the migrations and before the password step:

```ts
import { seedPermissions } from "./seed-permissions";
// ...
await seedPermissions(client);
```

The `createOrg` test fixture must also seed roles, so tests see the same world a
real organisation does. In `api/src/test/org.ts`, after the organisation insert:

```ts
await owner.query("SELECT seed_system_roles($1)", [id]);
await owner.query(
  `INSERT INTO role_permissions (org_id, role_id, permission_key)
   SELECT $1, r.id, p.key FROM roles r CROSS JOIN permissions p
    WHERE r.org_id = $1 AND r.name = 'Administrator'
   ON CONFLICT DO NOTHING`,
  [id],
);
```

- [ ] **Step 5: Run to verify it passes**

```bash
cd api
docker compose -f ../docker-compose.test.yml down -v
docker compose -f ../docker-compose.test.yml up -d
MIGRATION_DATABASE_URL=postgres://ams:ams@localhost:5433/ams_test npm run migrate
npx vitest run src/lib/auth/permissions.test.ts src/lib/auth/roles.schema.test.ts
```

Expected: PASS — 12 vocabulary tests, 9 schema tests.

- [ ] **Step 6: Commit**

```
git add api/src/lib/auth/permissions.ts api/src/lib/auth/permissions.test.ts \
        api/src/lib/auth/roles.schema.test.ts api/migrations/008_roles.sql \
        api/scripts/seed-permissions.ts api/scripts/migrate.ts api/src/test/org.ts
git commit
```

Commit message:

```
feat(auth): company-defined roles over a fixed permission vocabulary

Replaces the four hardcoded roles with roles each company owns, composed from
a code-defined permission vocabulary. Permissions are fixed because one a
customer invented would be inert - no handler checks it - so what they compose
is roles, not permissions.

Roles are tenant rows under the existing RLS. Every organisation is seeded the
four system roles, which are editable and renameable but not deletable, since
deleting the role every user holds would lock the organisation out. users.role
is backfilled to role_id and kept for one release, per the additive-migration
rule.

release-note: Administrators can now define their own roles, choosing exactly which permissions each one grants.
```

---

### Task 4b: Permission resolution, branch scope and the rewritten guard

**Files:**
- Modify: `api/src/lib/http/handler.ts` (`Actor` gains `permissions` and `locationScope`)
- Modify: `api/src/lib/auth/session.ts` (replace `scopesForRole`), `api/src/lib/auth/apikey.ts` (expand scopes), `api/src/lib/auth/guard.ts` (`requireAuth`)
- Modify: `api/migrations/006_auth_lookup.sql` is superseded — add `api/migrations/009_auth_lookup_roles.sql`
- Create: `api/src/lib/auth/resolve.ts`
- Test: `api/src/lib/auth/resolve.test.ts`, extend `api/src/lib/auth/guard.test.ts`

**Interfaces:**
- Consumes: `PERMISSIONS`, `API_SCOPE_PERMISSIONS` (Task 4a); `auth_lookup_session` (Task 4).
- Produces:
  - `interface Actor { type; id; label; scopes: string[]; permissions: PermissionKey[]; locationScope: string[] | null }` — `null` means organisation-wide
  - `permissionsForUser(userId): Promise<{ permissions: PermissionKey[]; locationScope: string[] | null }>`
  - `requireAuth(req, permission: PermissionKey, opts?: { locationId?: string | null }): Promise<Ctx | Response>`
  - `locationScopeClause(ctx, column): { sql: string; params: unknown[] }` — the single choke point for branch filtering
  - `hasPermission(ctx, permission): boolean`

**Design note:** `requireAuth` keeps its shape — authenticate, check, return a
`Ctx` or a `Response` — so no handler written against Task 4 needs restructuring.
What changes is that the permission checked is now fine-grained, and an optional
`locationId` lets a handler say *which* asset it is about, so a branch-scoped
user is refused another branch's asset.

**On `locationScopeClause`:** list endpoints cannot use `opts.locationId`,
because there is no single target. They compose this clause into their `WHERE`
instead. It is deliberately the only way branch filtering is expressed, so there
is one place to audit and one place to fix.

- [ ] **Step 1: Write the failing tests**

`api/src/lib/auth/resolve.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg } from "../../test/org";
import { hashPassword } from "./password";
import { permissionsForUser } from "./resolve";

let orgId: string;
let adminId: string;
let techId: string;
let scopedId: string;
let jakarta: string;
let bekasi: string;

async function roleId(org: string, name: string): Promise<string> {
  return withTenant(org, async (c) =>
    (await c.query<{ id: string }>(
      "SELECT id FROM roles WHERE org_id = $1 AND name = $2", [org, name],
    )).rows[0].id,
  );
}

async function createUser(org: string, name: string, role: string): Promise<string> {
  const rid = await roleId(org, role);
  return withTenant(org, async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO users (org_id, email, password_hash, name, role, role_id)
       VALUES ($1, $2, $3, $4, 'viewer', $5) RETURNING id`,
      [org, `${name}-${org}@resolve.test`, await hashPassword("pw"), name, rid],
    )).rows[0].id,
  );
}

beforeAll(async () => {
  orgId = await createOrg("Resolve Org");
  [jakarta, bekasi] = await withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO locations (org_id, name) VALUES ($1,'Jakarta'), ($1,'Bekasi')
       RETURNING id`,
      [orgId],
    );
    return [rows[0].id, rows[1].id];
  });

  adminId = await createUser(orgId, "admin", "Administrator");
  techId = await createUser(orgId, "tech", "Technician");
  scopedId = await createUser(orgId, "scoped", "Technician");

  await withTenant(orgId, (c) =>
    c.query(
      `INSERT INTO user_location_scopes (org_id, user_id, location_id)
       VALUES ($1, $2, $3)`,
      [orgId, scopedId, bekasi],
    ),
  );
});

describe("permissionsForUser", () => {
  it("resolves an administrator to every permission", async () => {
    const { permissions } = await permissionsForUser(adminId);
    expect(permissions).toContain("roles:write");
    expect(permissions).toContain("assets:delete");
    expect(permissions).toContain("settings:write");
  });

  it("resolves a technician to their role's grants and no more", async () => {
    const { permissions } = await permissionsForUser(techId);
    expect(permissions).toContain("assets:write");
    expect(permissions).toContain("custody:write");
    expect(permissions).not.toContain("roles:write");
    expect(permissions).not.toContain("users:write");
  });

  it("reports an unscoped user as organisation-wide", async () => {
    const { locationScope } = await permissionsForUser(techId);
    expect(locationScope).toBeNull();
  });

  it("reports a scoped user's branches", async () => {
    const { locationScope } = await permissionsForUser(scopedId);
    expect(locationScope).toEqual([bekasi]);
  });

  it("does not widen a scoped user's permissions", async () => {
    // Branch scope narrows where a permission applies; it never adds one.
    const scoped = await permissionsForUser(scopedId);
    const unscoped = await permissionsForUser(techId);
    expect([...scoped.permissions].sort()).toEqual([...unscoped.permissions].sort());
  });

  it("resolves a user with no role to no permissions at all", async () => {
    const orphan = await withTenant(orgId, async (c) =>
      (await c.query<{ id: string }>(
        `INSERT INTO users (org_id, email, password_hash, name, role)
         VALUES ($1, $2, 'x', 'Orphan', 'viewer') RETURNING id`,
        [orgId, `orphan-${orgId}@resolve.test`],
      )).rows[0].id,
    );
    const { permissions } = await permissionsForUser(orphan);
    expect(permissions).toEqual([]);
  });

  it("follows a change to the role immediately", async () => {
    // Permissions are resolved per request, not baked into the session, so
    // revoking a grant takes effect on the next call rather than at next login.
    const before = await permissionsForUser(techId);
    expect(before.permissions).toContain("labels:print");

    const rid = await roleId(orgId, "Technician");
    await withTenant(orgId, (c) =>
      c.query(
        "DELETE FROM role_permissions WHERE role_id = $1 AND permission_key = 'labels:print'",
        [rid],
      ),
    );

    const after = await permissionsForUser(techId);
    expect(after.permissions).not.toContain("labels:print");

    await withTenant(orgId, (c) =>
      c.query(
        `INSERT INTO role_permissions (org_id, role_id, permission_key)
         VALUES ($1, $2, 'labels:print')`,
        [orgId, rid],
      ),
    );
  });
});
```

Extend `api/src/lib/auth/guard.test.ts` with branch cases:

```ts
describe("requireAuth — branch scope", () => {
  it("allows an unscoped user to act on any branch", async () => {
    const res = await requireAuth(req({ session: techSession }), "assets:write", {
      locationId: jakarta,
    });
    expect(isResponse(res)).toBe(false);
  });

  it("allows a scoped user inside their branch", async () => {
    const res = await requireAuth(req({ session: scopedSession }), "assets:write", {
      locationId: bekasi,
    });
    expect(isResponse(res)).toBe(false);
  });

  it("refuses a scoped user outside their branch", async () => {
    const res = await requireAuth(req({ session: scopedSession }), "assets:write", {
      locationId: jakarta,
    });
    expect((res as Response).status).toBe(403);
    const body = (await (res as Response).json()) as { detail: string };
    expect(body.detail).toMatch(/branch|location/i);
  });

  it("refuses a scoped user an asset with no location at all", async () => {
    // An unplaced asset belongs to no branch, so a branch-scoped user has no
    // claim on it. Allowing it would make "unplaced" a hole in the scope.
    const res = await requireAuth(req({ session: scopedSession }), "assets:write", {
      locationId: null,
    });
    expect((res as Response).status).toBe(403);
  });

  it("ignores branch scope when the handler names no location", async () => {
    // Endpoints that are not about a specific asset - listing categories, say -
    // pass no locationId and are unaffected.
    const res = await requireAuth(req({ session: scopedSession }), "categories:read");
    expect(isResponse(res)).toBe(false);
  });

  it("does not branch-scope an api key", async () => {
    // Keys belong to the organisation, not to a person at a site.
    const res = await requireAuth(req({ key: adminKey }), "assets:write", {
      locationId: jakarta,
    });
    expect(isResponse(res)).toBe(false);
  });
});

describe("locationScopeClause", () => {
  it("returns a clause that matches everything for an unscoped user", () => {
    const { sql, params } = locationScopeClause(unscopedCtx, "a.location_id");
    expect(sql).toBe("TRUE");
    expect(params).toEqual([]);
  });

  it("restricts to the user's branches when scoped", () => {
    const { sql, params } = locationScopeClause(scopedCtx, "a.location_id");
    expect(sql).toContain("a.location_id = ANY(");
    expect(params).toEqual([[bekasi]]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && npx vitest run src/lib/auth/resolve.test.ts`
Expected: FAIL — `Cannot find module './resolve'`.

- [ ] **Step 3: Replace the auth lookup so it returns the role, not the enum**

`api/migrations/009_auth_lookup_roles.sql`:

```sql
-- Supersedes auth_lookup_session and auth_lookup_user_by_email from 006. The
-- signatures change because user_role is being retired: the session lookup now
-- returns role_id, and permissions are resolved from it per request rather than
-- derived from an enum.
--
-- The same reasoning as 006 applies: authentication happens before the tenant
-- is known, so these are SECURITY DEFINER with a pinned search_path and EXECUTE
-- revoked from PUBLIC.
DROP FUNCTION IF EXISTS auth_lookup_session(text);

CREATE FUNCTION auth_lookup_session(p_session_id text)
RETURNS TABLE (org_id uuid, user_id uuid, name text, role_id uuid, role_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT s.org_id, u.id, u.name, u.role_id, r.name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN roles r ON r.id = u.role_id
   WHERE s.id = p_session_id
     AND s.expires_at > now();
$fn$;

REVOKE ALL ON FUNCTION auth_lookup_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_session(text) TO ams_app;

-- Resolving a user's permissions is also pre-tenant: readSession needs them
-- before it can build the Ctx that withTenant is keyed on.
CREATE FUNCTION auth_lookup_permissions(p_user_id uuid)
RETURNS TABLE (permission_key text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT rp.permission_key
    FROM users u
    JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.id = p_user_id;
$fn$;

CREATE FUNCTION auth_lookup_location_scope(p_user_id uuid)
RETURNS TABLE (location_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT s.location_id FROM user_location_scopes s WHERE s.user_id = p_user_id;
$fn$;

REVOKE ALL ON FUNCTION auth_lookup_permissions(uuid)    FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_lookup_location_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_permissions(uuid)    TO ams_app;
GRANT EXECUTE ON FUNCTION auth_lookup_location_scope(uuid) TO ams_app;
```

- [ ] **Step 4: Implement resolution**

`api/src/lib/auth/resolve.ts`:

```ts
import { query } from "../db";
import { isPermissionKey, type PermissionKey } from "./permissions";

export interface ResolvedAccess {
  permissions: PermissionKey[];
  /** null means organisation-wide. An empty array would mean "nothing". */
  locationScope: string[] | null;
}

/**
 * Resolves what a user may do, per request rather than at login.
 *
 * Baking permissions into the session would mean an administrator revoking a
 * grant has no effect until that person's session expires - up to seven days of
 * access they were supposed to have lost. Two indexed lookups per request is
 * the price of revocation taking effect immediately.
 */
export async function permissionsForUser(userId: string): Promise<ResolvedAccess> {
  const [granted, scope] = await Promise.all([
    query<{ permission_key: string }>(
      "SELECT * FROM auth_lookup_permissions($1)", [userId],
    ),
    query<{ location_id: string }>(
      "SELECT * FROM auth_lookup_location_scope($1)", [userId],
    ),
  ]);

  // A permission removed from the vocabulary in code but still granted in the
  // database must not leak through as an unknown string.
  const permissions = granted
    .map((r) => r.permission_key)
    .filter(isPermissionKey);

  return {
    permissions,
    locationScope: scope.length === 0 ? null : scope.map((r) => r.location_id),
  };
}
```

- [ ] **Step 5: Widen the Actor and rewrite the guard**

In `api/src/lib/http/handler.ts`:

```ts
import type { PermissionKey } from "../auth/permissions";

export interface Actor {
  type: "user" | "api_key" | "system";
  id: string;
  label: string;
  /** The published API scopes, kept for the v1 contract and for display. */
  scopes: string[];
  /** The resolved fine-grained permissions this actor holds. */
  permissions: PermissionKey[];
  /** Branch restriction. null means organisation-wide. */
  locationScope: string[] | null;
}
```

In `api/src/lib/auth/session.ts`, replace `scopesForRole` with resolution:

```ts
interface SessionRow {
  org_id: string;
  user_id: string;
  name: string;
  role_id: string | null;
  role_name: string | null;
}

export async function readSession(req: Request): Promise<Ctx | null> {
  const id = readCookie(req, COOKIE);
  if (!id) return null;
  const rows = await query<SessionRow>("SELECT * FROM auth_lookup_session($1)", [id]);
  const row = rows[0];
  if (!row) return null;

  const { permissions, locationScope } = await permissionsForUser(row.user_id);

  return {
    orgId: row.org_id,
    actor: {
      type: "user",
      id: row.user_id,
      label: row.name,
      // Published scopes are derived for display and for v1 compatibility;
      // authorization is decided by `permissions`.
      scopes: apiScopesFromPermissions(permissions),
      permissions,
      locationScope,
    },
  };
}
```

In `api/src/lib/auth/apikey.ts`, expand the key's scopes into permissions:

```ts
import { API_SCOPE_PERMISSIONS, type ApiScope, type PermissionKey } from "./permissions";

const expandScopes = (scopes: string[]): PermissionKey[] => {
  const out = new Set<PermissionKey>();
  for (const scope of scopes) {
    for (const key of API_SCOPE_PERMISSIONS[scope as ApiScope] ?? []) out.add(key);
  }
  return [...out];
};

// ...inside readApiKey, when building the Ctx:
return {
  orgId: row.org_id,
  actor: {
    type: "api_key",
    id: row.id,
    label: row.name,
    scopes: row.scopes,
    permissions: expandScopes(row.scopes),
    // A key belongs to the organisation, not to a person at a site.
    locationScope: null,
  },
};
```

`api/src/lib/auth/guard.ts` — the permission and branch checks:

```ts
import type { PermissionKey } from "./permissions";

export interface AuthOptions {
  /**
   * The location the request concerns, when it concerns one. `null` means the
   * target explicitly has no location; omit the field entirely when the request
   * is not about a located thing at all.
   */
  locationId?: string | null;
}

export const hasPermission = (ctx: Ctx, permission: PermissionKey): boolean =>
  ctx.actor.permissions.includes(permission);

/**
 * Whether `ctx` may act on something at `locationId`.
 *
 * An unscoped actor may act anywhere. A scoped one may act only within their
 * branches - and not on an asset with no location, because treating "unplaced"
 * as permitted would make it a hole in every scope.
 */
export function withinLocationScope(ctx: Ctx, locationId: string | null): boolean {
  if (ctx.actor.locationScope === null) return true;
  if (locationId === null) return false;
  return ctx.actor.locationScope.includes(locationId);
}

export async function requireAuth(
  req: Request,
  permission: PermissionKey,
  opts: AuthOptions = {},
): Promise<Ctx | Response> {
  const ctx = (await readApiKey(req)) ?? (await readSession(req));
  if (!ctx) return unauthorized();

  const crossOrigin = assertSameOrigin(req, ctx);
  if (crossOrigin) return crossOrigin;

  if (!hasPermission(ctx, permission)) {
    return forbidden(`This credential lacks the "${permission}" permission.`);
  }

  if ("locationId" in opts && !withinLocationScope(ctx, opts.locationId ?? null)) {
    return forbidden(
      "Your access is limited to specific branches, and this asset is not in one of them.",
    );
  }

  const limit = await checkRateLimit(ctx);
  if (!limit.ok) { /* unchanged */ }

  return ctx;
}

/**
 * The clause a list query composes into its WHERE to honour branch scope.
 *
 * This is deliberately the only way branch filtering is expressed, so there is
 * one place to audit and one place to fix. `column` is a caller-supplied SQL
 * identifier and is never derived from request input.
 */
export function locationScopeClause(
  ctx: Ctx,
  column: string,
): { sql: string; params: unknown[] } {
  if (ctx.actor.locationScope === null) return { sql: "TRUE", params: [] };
  return { sql: `${column} = ANY($1::uuid[])`, params: [ctx.actor.locationScope] };
}
```

**Implementer's note on parameter numbering.** `locationScopeClause` returns
`$1`; a caller composing it into a larger query must renumber. Follow the
pattern the asset query builder in Task 7 uses: collect params in an array and
generate placeholders from their index, rather than hardcoding `$1`.

- [ ] **Step 6: Run to verify it passes**

Run: `cd api && npm test`
Expected: PASS — 7 resolve tests, 8 new guard tests, and every Task 4 test still
green, because `requireAuth` kept its shape.

- [ ] **Step 7: Commit**

```
git add api/src/lib/auth api/src/lib/http/handler.ts api/migrations/009_auth_lookup_roles.sql
git commit
```

Commit message:

```
feat(auth): resolve permissions per request, with optional branch scope

Actor carries resolved permissions and a branch restriction instead of a scope
list derived from an enum. Permissions resolve per request rather than at
login, so revoking a grant takes effect on the next call rather than whenever
the session happens to expire.

requireAuth keeps its shape, so no handler needs restructuring; it gains an
optional locationId, and a branch-scoped user is refused another branch's
asset - including one with no location, which would otherwise be a hole in
every scope. API keys expand their published v1 scopes into the same permission
vocabulary, so the contract in spec 5.1 is unchanged.

release-note: People can now be limited to particular branches, and a change to a role takes effect immediately rather than at next sign-in.
```

---

### Task 4c: The role management API

**Files:**
- Create: `api/src/lib/domain/roles.ts`
- Create: `api/src/app/api/admin/roles/route.ts`, `api/src/app/api/admin/roles/[id]/route.ts`
- Create: `api/src/app/api/admin/permissions/route.ts`
- Create: `api/src/app/api/admin/users/[id]/role/route.ts`
- Test: `api/src/lib/domain/roles.test.ts`, `api/src/app/api/admin/roles/route.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `requireAuth`, `PERMISSIONS`, problem helpers.
- Produces:
  - `listRoles(ctx)`, `createRole(ctx, input)`, `updateRole(ctx, id, input)`, `deleteRole(ctx, id)`
  - `assignRole(ctx, userId, roleId, locationIds)`
  - `GET/POST /api/admin/roles`, `PATCH/DELETE /api/admin/roles/:id`
  - `GET /api/admin/permissions` — the vocabulary, grouped, for the role editor
  - `PUT /api/admin/users/:id/role`

**Design note:** three rules protect an organisation from locking itself out,
and each is enforced in the domain module rather than the handler, so the API
and any future import path share them:

1. A system role cannot be deleted (also enforced by trigger in 4a).
2. A role still assigned to somebody cannot be deleted.
3. The last user holding `roles:write` cannot have it taken away — otherwise a
   single careless edit leaves nobody able to fix it.

- [ ] **Step 1: Write the failing tests**

`api/src/lib/domain/roles.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg } from "../../test/org";
import { hashPassword } from "../auth/password";
import {
  listRoles, createRole, updateRole, deleteRole, assignRole, RoleInUseError,
  LastAdministratorError, SystemRoleError,
} from "./roles";
import type { Ctx } from "../http/handler";

let orgId: string;
let ctx: Ctx;

const adminCtx = (org: string, userId: string): Ctx => ({
  orgId: org,
  actor: {
    type: "user", id: userId, label: "Admin", scopes: ["admin"],
    permissions: ["roles:read", "roles:write", "users:read", "users:write"],
    locationScope: null,
  },
});

beforeAll(async () => {
  orgId = await createOrg("Role API Org");
  const adminRole = await withTenant(orgId, async (c) =>
    (await c.query<{ id: string }>(
      "SELECT id FROM roles WHERE org_id=$1 AND name='Administrator'", [orgId],
    )).rows[0].id,
  );
  const userId = await withTenant(orgId, async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO users (org_id, email, password_hash, name, role, role_id)
       VALUES ($1,$2,$3,'Admin','admin',$4) RETURNING id`,
      [orgId, `admin-${orgId}@roles.test`, await hashPassword("pw"), adminRole],
    )).rows[0].id,
  );
  ctx = adminCtx(orgId, userId);
});

describe("createRole", () => {
  it("creates a role with the permissions given", async () => {
    const role = await createRole(ctx, {
      name: "Warehouse", description: "Floor staff",
      permissions: ["assets:read", "custody:write"],
    });
    expect(role.permissions.sort()).toEqual(["assets:read", "custody:write"]);
    expect(role.is_system).toBe(false);
  });

  it("refuses a duplicate name in the same organisation", async () => {
    await createRole(ctx, { name: "Dupe", permissions: ["assets:read"] });
    await expect(
      createRole(ctx, { name: "dupe", permissions: ["assets:read"] }),
    ).rejects.toThrow(/already/i);
  });

  it("refuses a permission outside the vocabulary", async () => {
    await expect(
      createRole(ctx, { name: "Bogus", permissions: ["assets:teleport"] as never }),
    ).rejects.toThrow(/permission/i);
  });
});

describe("updateRole", () => {
  it("replaces the permission set rather than merging", async () => {
    const role = await createRole(ctx, {
      name: "Shifting", permissions: ["assets:read", "assets:write"],
    });
    const updated = await updateRole(ctx, role.id, { permissions: ["assets:read"] });
    expect(updated.permissions).toEqual(["assets:read"]);
  });

  it("lets a system role be renamed and re-permissioned", async () => {
    const [viewer] = (await listRoles(ctx)).filter((r) => r.name === "Viewer");
    const updated = await updateRole(ctx, viewer.id, { name: "Read Only" });
    expect(updated.name).toBe("Read Only");
    await updateRole(ctx, viewer.id, { name: "Viewer" });
  });

  it("refuses to remove roles:write from the last role that grants it", async () => {
    const [admin] = (await listRoles(ctx)).filter((r) => r.name === "Administrator");
    await expect(
      updateRole(ctx, admin.id, { permissions: ["assets:read"] }),
    ).rejects.toThrow(LastAdministratorError);
  });
});

describe("deleteRole", () => {
  it("refuses to delete a system role", async () => {
    const [admin] = (await listRoles(ctx)).filter((r) => r.name === "Administrator");
    await expect(deleteRole(ctx, admin.id)).rejects.toThrow(SystemRoleError);
  });

  it("refuses to delete a role somebody still holds", async () => {
    const role = await createRole(ctx, { name: "Held", permissions: ["assets:read"] });
    const userId = await withTenant(orgId, async (c) =>
      (await c.query<{ id: string }>(
        `INSERT INTO users (org_id, email, password_hash, name, role, role_id)
         VALUES ($1,$2,'x','Holder','viewer',$3) RETURNING id`,
        [orgId, `holder-${orgId}@roles.test`, role.id],
      )).rows[0].id,
    );
    await expect(deleteRole(ctx, role.id)).rejects.toThrow(RoleInUseError);
    expect(userId).toBeDefined();
  });

  it("deletes an unused custom role", async () => {
    const role = await createRole(ctx, { name: "Unused", permissions: ["assets:read"] });
    await expect(deleteRole(ctx, role.id)).resolves.toBe(true);
  });
});

describe("assignRole", () => {
  it("sets a user's role and branch scope together", async () => {
    const role = await createRole(ctx, { name: "Sited", permissions: ["assets:read"] });
    const { userId, locationId } = await withTenant(orgId, async (c) => {
      const loc = (await c.query<{ id: string }>(
        "INSERT INTO locations (org_id, name) VALUES ($1,'Site A') RETURNING id", [orgId],
      )).rows[0].id;
      const u = (await c.query<{ id: string }>(
        `INSERT INTO users (org_id, email, password_hash, name, role, role_id)
         VALUES ($1,$2,'x','Sited User','viewer',$3) RETURNING id`,
        [orgId, `sited-${orgId}@roles.test`, role.id],
      )).rows[0].id;
      return { userId: u, locationId: loc };
    });

    const result = await assignRole(ctx, userId, role.id, [locationId]);
    expect(result.locationIds).toEqual([locationId]);
  });

  it("clears branch scope when given an empty list", async () => {
    const role = await createRole(ctx, { name: "Unsited", permissions: ["assets:read"] });
    const userId = await withTenant(orgId, async (c) =>
      (await c.query<{ id: string }>(
        `INSERT INTO users (org_id, email, password_hash, name, role, role_id)
         VALUES ($1,$2,'x','Unsited','viewer',$3) RETURNING id`,
        [orgId, `unsited-${orgId}@roles.test`, role.id],
      )).rows[0].id,
    );
    const result = await assignRole(ctx, userId, role.id, []);
    expect(result.locationIds).toEqual([]);
  });

  it("refuses to demote the last person who can manage roles", async () => {
    const viewer = (await listRoles(ctx)).find((r) => r.name === "Viewer")!;
    await expect(assignRole(ctx, ctx.actor.id, viewer.id, [])).rejects.toThrow(
      LastAdministratorError,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/roles.test.ts`
Expected: FAIL — `Cannot find module './roles'`.

- [ ] **Step 3: Implement the domain module**

`api/src/lib/domain/roles.ts` — the rules that keep an organisation from locking
itself out live here, not in the handlers:

```ts
import { z } from "zod";
import { withTenant } from "../db";
import { PERMISSIONS, isPermissionKey, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";

export class SystemRoleError extends Error {}
export class RoleInUseError extends Error {}
export class LastAdministratorError extends Error {}
export class DuplicateRoleError extends Error {}

const PermissionList = z
  .array(z.string().refine(isPermissionKey, "unknown permission"))
  .min(1);

export const RoleInput = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(400).optional(),
  permissions: PermissionList,
});

export const RolePatch = RoleInput.partial();

export interface Role {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: PermissionKey[];
  user_count: number;
}

/**
 * Guards the organisation against losing its last administrator.
 *
 * Checked before a change that could remove the roles:write grant from the last
 * role that has it, or move the last person holding such a role off it. Without
 * this, one careless edit leaves nobody able to undo it - and only a database
 * operator could recover the account.
 */
async function assertNotLastAdministrator(
  ctx: Ctx,
  change: { roleId: string; keepsRolesWrite: boolean } | { userId: string; toRoleId: string },
): Promise<void> {
  await withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<{ n: string }>(
      `SELECT count(DISTINCT u.id) AS n
         FROM users u
         JOIN role_permissions rp ON rp.role_id = u.role_id
        WHERE u.org_id = $1
          AND rp.permission_key = 'roles:write'
          AND ($2::uuid IS NULL OR u.role_id <> $2)
          AND ($3::uuid IS NULL OR u.id <> $3)`,
      [
        ctx.orgId,
        "roleId" in change && !change.keepsRolesWrite ? change.roleId : null,
        "userId" in change ? change.userId : null,
      ],
    );

    // For a reassignment, the destination role may itself grant roles:write.
    if ("toRoleId" in change) {
      const { rows: dest } = await c.query(
        `SELECT 1 FROM role_permissions
          WHERE role_id = $1 AND permission_key = 'roles:write'`,
        [change.toRoleId],
      );
      if (dest.length > 0) return;
    }

    if (Number(rows[0].n) === 0) {
      throw new LastAdministratorError(
        "This would leave nobody able to manage roles. Give another person a " +
          "role that includes 'Manage roles' first.",
      );
    }
  });
}

export async function listRoles(ctx: Ctx): Promise<Role[]> {
  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<Role>(
      `SELECT r.id, r.name, r.description, r.is_system,
              coalesce(array_agg(rp.permission_key)
                       FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions,
              (SELECT count(*) FROM users u WHERE u.role_id = r.id)::int AS user_count
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        GROUP BY r.id
        ORDER BY r.is_system DESC, lower(r.name)`,
    );
    return rows;
  });
}

export async function createRole(
  ctx: Ctx,
  input: z.infer<typeof RoleInput>,
): Promise<Role> {
  const parsed = RoleInput.parse(input);
  return withTenant(ctx.orgId, async (c) => {
    let roleId: string;
    try {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO roles (org_id, name, description)
         VALUES ($1, $2, $3) RETURNING id`,
        [ctx.orgId, parsed.name, parsed.description ?? ""],
      );
      roleId = rows[0].id;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new DuplicateRoleError(`A role called "${parsed.name}" already exists.`);
      }
      throw err;
    }

    await c.query(
      `INSERT INTO role_permissions (org_id, role_id, permission_key)
       SELECT $1, $2, unnest($3::text[])`,
      [ctx.orgId, roleId, parsed.permissions],
    );

    return {
      id: roleId,
      name: parsed.name,
      description: parsed.description ?? "",
      is_system: false,
      permissions: parsed.permissions,
      user_count: 0,
    };
  });
}

export async function updateRole(
  ctx: Ctx,
  id: string,
  patch: z.infer<typeof RolePatch>,
): Promise<Role> {
  const parsed = RolePatch.parse(patch);

  if (parsed.permissions) {
    await assertNotLastAdministrator(ctx, {
      roleId: id,
      keepsRolesWrite: parsed.permissions.includes("roles:write"),
    });
  }

  await withTenant(ctx.orgId, async (c) => {
    if (parsed.name !== undefined || parsed.description !== undefined) {
      await c.query(
        `UPDATE roles
            SET name = coalesce($2, name),
                description = coalesce($3, description)
          WHERE id = $1`,
        [id, parsed.name ?? null, parsed.description ?? null],
      );
    }
    if (parsed.permissions) {
      // Replace, not merge: the editor sends the complete set, and merging
      // would make unticking a box do nothing.
      await c.query("DELETE FROM role_permissions WHERE role_id = $1", [id]);
      await c.query(
        `INSERT INTO role_permissions (org_id, role_id, permission_key)
         SELECT $1, $2, unnest($3::text[])`,
        [ctx.orgId, id, parsed.permissions],
      );
    }
  });

  const role = (await listRoles(ctx)).find((r) => r.id === id);
  if (!role) throw new Error(`role ${id} vanished during update`);
  return role;
}

export async function deleteRole(ctx: Ctx, id: string): Promise<boolean> {
  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<{ is_system: boolean; holders: string }>(
      `SELECT r.is_system,
              (SELECT count(*) FROM users u WHERE u.role_id = r.id) AS holders
         FROM roles r WHERE r.id = $1`,
      [id],
    );
    const role = rows[0];
    if (!role) return false;

    if (role.is_system) {
      throw new SystemRoleError("The roles the product ships with cannot be deleted.");
    }
    if (Number(role.holders) > 0) {
      throw new RoleInUseError(
        `${role.holders} people still hold this role. Move them to another role first.`,
      );
    }

    await c.query("DELETE FROM roles WHERE id = $1", [id]);
    return true;
  });
}

export async function assignRole(
  ctx: Ctx,
  userId: string,
  roleId: string,
  locationIds: string[],
): Promise<{ userId: string; roleId: string; locationIds: string[] }> {
  await assertNotLastAdministrator(ctx, { userId, toRoleId: roleId });

  return withTenant(ctx.orgId, async (c) => {
    await c.query("UPDATE users SET role_id = $2 WHERE id = $1", [userId, roleId]);
    await c.query("DELETE FROM user_location_scopes WHERE user_id = $1", [userId]);
    if (locationIds.length > 0) {
      await c.query(
        `INSERT INTO user_location_scopes (org_id, user_id, location_id)
         SELECT $1, $2, unnest($3::uuid[])`,
        [ctx.orgId, userId, locationIds],
      );
    }
    return { userId, roleId, locationIds };
  });
}

/** The vocabulary, grouped, for the role editor. */
export const permissionCatalogue = () => {
  const groups = new Map<string, typeof PERMISSIONS[number][]>();
  for (const p of PERMISSIONS) {
    const list = groups.get(p.group) ?? [];
    list.push(p);
    groups.set(p.group, list);
  }
  return [...groups.entries()].map(([group, permissions]) => ({ group, permissions }));
};
```

- [ ] **Step 4: Implement the route handlers**

`api/src/app/api/admin/roles/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import {
  listRoles, createRole, RoleInput, DuplicateRoleError,
} from "@/lib/domain/roles";
import { validationProblem, conflict } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "roles:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listRoles(ctx) });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "roles:write");
  if (isResponse(ctx)) return ctx;

  const parsed = RoleInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    return Response.json(await createRole(ctx, parsed.data), { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateRoleError) return conflict(err.message);
    throw err;
  }
});
```

`api/src/app/api/admin/roles/[id]/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import {
  updateRole, deleteRole, RolePatch,
  SystemRoleError, RoleInUseError, LastAdministratorError, DuplicateRoleError,
} from "@/lib/domain/roles";
import { validationProblem, notFound, conflict, forbidden } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

type Params = { params: Promise<{ id: string }> };

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "roles:write");
  if (isResponse(ctx)) return ctx;

  const parsed = RolePatch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    return Response.json(await updateRole(ctx, (await params).id, parsed.data));
  } catch (err) {
    if (err instanceof LastAdministratorError) return conflict(err.message);
    if (err instanceof DuplicateRoleError) return conflict(err.message);
    throw err;
  }
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "roles:write");
  if (isResponse(ctx)) return ctx;

  try {
    const deleted = await deleteRole(ctx, (await params).id);
    return deleted ? new Response(null, { status: 204 }) : notFound("role");
  } catch (err) {
    if (err instanceof SystemRoleError) return forbidden(err.message);
    if (err instanceof RoleInUseError) return conflict(err.message);
    throw err;
  }
});
```

`api/src/app/api/admin/permissions/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { permissionCatalogue } from "@/lib/domain/roles";
import { safe } from "@/lib/http/handler";

// The vocabulary is the same for every tenant, but it still requires a
// credential: it describes the product's internals and there is no reason to
// serve it to an anonymous caller.
export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "roles:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: permissionCatalogue() });
});
```

`api/src/app/api/admin/users/[id]/role/route.ts`:

```ts
import { z } from "zod";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { assignRole, LastAdministratorError } from "@/lib/domain/roles";
import { validationProblem, conflict } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

const Body = z.object({
  role_id: z.string().uuid(),
  // Empty means organisation-wide. Absent means the same, so a caller that
  // does not know about branches cannot accidentally narrow someone.
  location_ids: z.array(z.string().uuid()).default([]),
});

export const PUT = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "users:write");
  if (isResponse(ctx)) return ctx;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    const result = await assignRole(
      ctx, (await params).id, parsed.data.role_id, parsed.data.location_ids,
    );
    return Response.json(result);
  } catch (err) {
    if (err instanceof LastAdministratorError) return conflict(err.message);
    throw err;
  }
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd api && npm test`
Expected: PASS — 11 domain tests plus the existing suite.

- [ ] **Step 6: Commit**

```
git add api/src/lib/domain/roles.ts api/src/lib/domain/roles.test.ts \
        api/src/app/api/admin/roles api/src/app/api/admin/permissions \
        api/src/app/api/admin/users
git commit
```

Commit message:

```
feat(api): role management endpoints

Role CRUD, the permission catalogue for the editor, and role assignment with
optional branch scoping.

Three rules live in the domain module rather than the handlers, so any future
import path gets them too: a system role cannot be deleted, a role somebody
still holds cannot be deleted, and no change may leave the organisation with
nobody able to manage roles - which would otherwise take a database operator to
undo.

release-note: Administrators can create and edit roles, and limit a person's access to particular branches.
```

---

## Downstream changes this phase creates

Not tasks in this phase, but work it adds elsewhere. Record them so they are not
discovered late:

| Where | Change |
|---|---|
| **Phase 2, Tasks 6–9** | Every asset handler passes `locationId` to `requireAuth`, and every list query composes `locationScopeClause`. The permissions to use are `assets:read`, `assets:write`, `assets:delete`, `custody:write`, `audit:read`. |
| **Phase 3, Task 10** | Import uses `assets:import`; export uses `assets:export`. |
| **Phase 3, Task 14** | Notification recipient resolution keys off roles; "everyone with `assets:write`" replaces "every manager". |
| **Phase 4, Task 19–20** | Label printing uses `labels:print`. |
| **Phase 5, Task 31** | The users page gains a role column and a branch-scope editor. |
| **Phase 5, new Task 31a** | The role editor: list roles, create, tick permissions by group, see how many people hold each. |
| **Phase 6, Task 46** | The OpenAPI document gains the four role endpoints. |
| **Phase 7, Task 54** | The `users-and-roles` help article currently describes four fixed roles and must be rewritten around custom roles and branch scoping. |
| **Phase 7, Task 55** | The seed script gives its demo users the seeded system roles, and should demonstrate one branch-scoped user. |
| **A later release** | Drop `users.role` and the `user_role` enum, once nothing reads them. |

## Phase 1b self-review

**Decision coverage.** One role per user: `users.role_id` is a single column, and
`permissionsForUser` is one join. Company-owned: `roles` carries `org_id` with
the standard tenant policy, and a schema test proves one company's custom role
is invisible to another. Optional branch scoping: no rows in
`user_location_scopes` means organisation-wide, which is the default for every
seeded role. SaaS: nothing here is global except the permission vocabulary,
which is product reference data rather than customer data.

**Type consistency.** `PermissionKey` is defined in 4a and consumed by 4b's
`Actor` and 4c's `RoleInput`. `Ctx` gains two fields in 4b and every construction
site in 4c's tests supplies them. `locationScope: null` means organisation-wide
throughout — 4b's resolver, 4b's guard and 4c's `assignRole` all use the same
convention, and the empty array never means "everything".

**Known gaps, deliberately left.** `assertNotLastAdministrator` counts people
holding a role that grants `roles:write`; it does not consider API keys with the
`admin` scope, so an organisation whose last administrator is a key rather than a
person can still be locked out of the UI. That is the right trade-off — a key is
not a person who can be asked to fix things — but it should be stated in the help
article. Branch scoping is enforced in the domain layer rather than by RLS, for
the reasons given at the top of this file; if it becomes a hard security boundary,
revisit it.
