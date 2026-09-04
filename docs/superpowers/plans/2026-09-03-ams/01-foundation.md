# Phase 1 — Foundation

> Part of the [Assets Management System plan](./00-overview.md). Read `00-overview.md` first — its Global Constraints apply to every task here.

**Tasks 1–4.** Docker stack, database schema with row-level security, session auth for the dashboard, scoped API keys for the public API.

---



### Task 1: Docker stack, Postgres, and a health-checked API service

**Files:**
- Create: `docker-compose.yml`, `docker-compose.test.yml`, `.env.example`, `.gitignore`
- Create: `api/Dockerfile`, `api/package.json`, `api/tsconfig.json`, `api/next.config.ts`, `api/vitest.config.ts`
- Create: `api/src/lib/db.ts`, `api/src/app/api/health/route.ts`
- Test: `api/src/app/api/health/route.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pool: Pool` and `query(text, params)` from `src/lib/db.ts`; `GET /api/health` returning `{ status: "ok", db: true }`.

- [ ] **Step 1: Initialise the repository and write the failing test**

```bash
cd AssetsManagementSystem
git init
mkdir -p api/src/app/api/health api/src/lib api/migrations api/scripts
```

`api/src/app/api/health/route.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("reports ok and a reachable database", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok", db: true });
  });
});
```

- [ ] **Step 2: Write the package manifest and config**

`api/package.json`:

```json
{
  "name": "ams-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 4000",
    "build": "next build",
    "start": "next start -p 4000",
    "migrate": "tsx scripts/migrate.ts",
    "seed": "tsx scripts/seed.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "pg": "^8.13.1",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/pg": "^8.11.10",
    "tsx": "^4.19.2",
    "typescript": "~5.7.2",
    "vitest": "^2.1.8"
  }
}
```

`api/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "paths": { "@/*": ["./src/*"] },
    "baseUrl": "."
  },
  "include": ["src/**/*.ts", "scripts/**/*.ts", "next-env.d.ts"]
}
```

`api/next.config.ts`:

```ts
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["pg"],
};

export default config;
```

`api/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
```

- [ ] **Step 3: Write the database pool and health route**

`api/src/lib/db.ts`:

```ts
import { Pool, type PoolClient, type QueryResultRow } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 10),
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/** Runs `fn` inside a transaction with the tenant guard set for RLS. */
export async function withTenant<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

`api/src/app/api/health/route.ts`:

```ts
import { query } from "@/lib/db";

export async function GET() {
  let db = false;
  try {
    await query("SELECT 1");
    db = true;
  } catch {
    db = false;
  }
  return Response.json({ status: "ok", db }, { status: db ? 200 : 503 });
}
```

`api/src/test/setup.ts`:

```ts
process.env.DATABASE_URL ??=
  "postgres://ams_app:ams_app@localhost:5433/ams_test";
```

- [ ] **Step 4: Write the Docker stack**

`docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ams
      POSTGRES_USER: ams
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-ams}
    ports: ["5432:5432"]
    volumes: ["db_data:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ams -d ams"]
      interval: 5s
      timeout: 3s
      retries: 10

  api:
    build: ./api
    environment:
      DATABASE_URL: postgres://ams_app:${APP_DB_PASSWORD:-ams_app}@db:5432/ams
      MIGRATION_DATABASE_URL: postgres://ams:${POSTGRES_PASSWORD:-ams}@db:5432/ams
      SESSION_SECRET: ${SESSION_SECRET:-dev-secret-change-me}
      APP_BASE_URL: ${APP_BASE_URL:-http://localhost:3000}
    ports: ["4000:4000"]
    depends_on:
      db: { condition: service_healthy }

  web:
    build: ./web
    environment:
      VITE_API_BASE_URL: ${VITE_API_BASE_URL:-http://localhost:4000}
    ports: ["3000:80"]
    depends_on: [api]

  # Object storage for attachments (Task 12). S3-compatible, so production can
  # swap in real S3 by changing the endpoint and credentials only.
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-ams}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-ams-secret}
    ports: ["9000:9000", "9001:9001"]
    volumes: ["minio_data:/data"]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  db_data:
  minio_data:
```

Add the matching entries to the `api` service environment:

```yaml
      S3_ENDPOINT: http://minio:9000
      S3_BUCKET: ams-attachments
      S3_ACCESS_KEY: ${MINIO_ROOT_USER:-ams}
      S3_SECRET_KEY: ${MINIO_ROOT_PASSWORD:-ams-secret}
```

`docker-compose.test.yml`:

```yaml
services:
  db-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ams_test
      POSTGRES_USER: ams
      POSTGRES_PASSWORD: ams
    ports: ["5433:5432"]
    tmpfs: ["/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ams -d ams_test"]
      interval: 3s
      timeout: 3s
      retries: 10
```

`api/Dockerfile`:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/migrations ./migrations
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/node_modules ./node_modules
EXPOSE 4000
CMD ["node", "server.js"]
```

`.env.example`:

```
POSTGRES_PASSWORD=ams
APP_DB_PASSWORD=ams_app
SESSION_SECRET=change-me-to-32-random-bytes
APP_BASE_URL=http://localhost:3000
VITE_API_BASE_URL=http://localhost:4000
MINIO_ROOT_USER=ams
MINIO_ROOT_PASSWORD=ams-secret
RATE_LIMIT_PER_HOUR=1000
```

`.gitignore`:

```
node_modules/
.next/
dist/
.env
*.log
```

- [ ] **Step 5: Run the test to verify it fails, then passes**

```bash
docker compose -f docker-compose.test.yml up -d
cd api && npm install && npm test
```

Expected first run: FAIL — `db: false` because the `ams_app` role does not exist yet.
Create the role, then re-run:

```bash
docker compose -f docker-compose.test.yml exec db-test \
  psql -U ams -d ams_test -c \
  "CREATE ROLE ams_app LOGIN PASSWORD 'ams_app'; GRANT CONNECT ON DATABASE ams_test TO ams_app;"
cd api && npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: docker stack with postgres and health-checked api service"
```

---

### Task 2: Database schema with row-level security

**Files:**
- Create: `api/migrations/001_extensions_and_org.sql`, `api/migrations/002_catalog.sql`, `api/migrations/003_assets.sql`, `api/migrations/004_rls.sql`
- Create: `api/scripts/migrate.ts`
- Test: `api/src/lib/db.rls.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `query` from Task 1.
- Produces: the full schema; `npm run migrate` applies pending migrations idempotently and records them in `schema_migrations(filename, applied_at)`.

- [ ] **Step 1: Write the failing RLS test**

`api/src/lib/db.rls.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { pool, withTenant } from "./db";
import { randomUUID } from "node:crypto";

const orgA = randomUUID();
const orgB = randomUUID();

beforeAll(async () => {
  const admin = await pool.connect();
  await admin.query(
    `INSERT INTO organizations (id, name, slug) VALUES
       ($1, 'Org A', 'org-a'), ($2, 'Org B', 'org-b')
     ON CONFLICT DO NOTHING`,
    [orgA, orgB],
  );
  admin.release();
});

describe("row-level security", () => {
  it("hides another tenant's assets", async () => {
    await withTenant(orgA, (c) =>
      c.query(
        `INSERT INTO assets (org_id, asset_tag, name, status)
         VALUES ($1, 'A-1', 'Org A laptop', 'available')`,
        [orgA],
      ),
    );

    const seenByA = await withTenant(orgA, async (c) =>
      (await c.query("SELECT asset_tag FROM assets")).rows,
    );
    const seenByB = await withTenant(orgB, async (c) =>
      (await c.query("SELECT asset_tag FROM assets")).rows,
    );

    expect(seenByA.map((r) => r.asset_tag)).toContain("A-1");
    expect(seenByB).toHaveLength(0);
  });

  it("refuses to write a row belonging to another tenant", async () => {
    await expect(
      withTenant(orgA, (c) =>
        c.query(
          `INSERT INTO assets (org_id, asset_tag, name, status)
           VALUES ($1, 'X-1', 'smuggled', 'available')`,
          [orgB],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

// Spec §11 — these tables carry no MVP behaviour, but the constraint that makes
// rental safe must be proven the day it is created, not the day it is used.
describe("rental-ready schema", () => {
  it("refuses two overlapping live reservations for one asset", async () => {
    await withTenant(orgA, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO assets (org_id, asset_tag, name, status)
         VALUES ($1, 'RES-1', 'Scaffold tower', 'available') RETURNING id`,
        [orgA],
      );
      const assetId = rows[0].id;
      await c.query(
        `INSERT INTO reservations (org_id, asset_id, period, state)
         VALUES ($1, $2, tstzrange('2026-10-12', '2026-10-19'), 'confirmed')`,
        [orgA, assetId],
      );
      await expect(
        c.query(
          `INSERT INTO reservations (org_id, asset_id, period, state)
           VALUES ($1, $2, tstzrange('2026-10-15', '2026-10-22'), 'held')`,
          [orgA, assetId],
        ),
      ).rejects.toThrow(/reservations_no_double_book/);
    }).catch((err) => {
      // The rejection above is asserted inside the transaction; the surrounding
      // withTenant rolls back, which is the desired cleanup.
      if (!/no_double_book/.test(String(err))) throw err;
    });
  });

  it("allows a second reservation once the first is cancelled", async () => {
    await withTenant(orgA, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO assets (org_id, asset_tag, name, status)
         VALUES ($1, 'RES-2', 'Generator', 'available') RETURNING id`,
        [orgA],
      );
      const assetId = rows[0].id;
      await c.query(
        `INSERT INTO reservations (org_id, asset_id, period, state)
         VALUES ($1, $2, tstzrange('2026-11-01', '2026-11-05'), 'cancelled')`,
        [orgA, assetId],
      );
      const second = await c.query(
        `INSERT INTO reservations (org_id, asset_id, period, state)
         VALUES ($1, $2, tstzrange('2026-11-02', '2026-11-06'), 'held')
         RETURNING id`,
        [orgA, assetId],
      );
      expect(second.rows).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd api && npx vitest run src/lib/db.rls.test.ts`
Expected: FAIL with `relation "organizations" does not exist`.

- [ ] **Step 3: Write the migrations**

`api/migrations/001_extensions_and_org.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE user_role AS ENUM ('admin', 'manager', 'technician', 'viewer');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         text NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL,
  role          user_role NOT NULL DEFAULT 'viewer',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness per tenant; login looks up with lower(email).
CREATE UNIQUE INDEX users_org_email_idx ON users (org_id, lower(email));
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

CREATE TABLE sessions (
  id         text PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL UNIQUE,
  key_hash     text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_org_idx ON api_keys (org_id);
```

`api/migrations/002_catalog.sql`:

```sql
CREATE TABLE locations (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name      text NOT NULL,
  parent_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  address   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locations_org_idx ON locations (org_id);

CREATE TYPE category_kind AS ENUM ('it', 'equipment', 'media');

CREATE TABLE categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         category_kind NOT NULL,
  field_schema jsonb NOT NULL DEFAULT '{"fields": []}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
```

`api/migrations/003_assets.sql`:

```sql
CREATE TYPE asset_status AS ENUM
  ('available', 'in_use', 'maintenance', 'retired', 'lost');

CREATE TABLE assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_tag     text NOT NULL,
  name          text NOT NULL,
  description   text,
  category_id   uuid REFERENCES categories(id) ON DELETE SET NULL,
  serial_no     text,
  status        asset_status NOT NULL DEFAULT 'available',
  location_id   uuid REFERENCES locations(id) ON DELETE SET NULL,
  assignee_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  purchase_date date,
  purchase_cost numeric(14,2),
  currency      char(3) NOT NULL DEFAULT 'IDR',
  custom        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE UNIQUE INDEX assets_org_tag_idx ON assets (org_id, asset_tag)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX assets_org_serial_idx ON assets (org_id, serial_no)
  WHERE serial_no IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX assets_org_status_idx   ON assets (org_id, status);
CREATE INDEX assets_org_category_idx ON assets (org_id, category_id);
CREATE INDEX assets_org_location_idx ON assets (org_id, location_id);
CREATE INDEX assets_custom_gin_idx   ON assets USING gin (custom jsonb_path_ops);
CREATE INDEX assets_search_idx ON assets
  USING gin ((name || ' ' || coalesce(serial_no, '') || ' ' || asset_tag) gin_trgm_ops);

CREATE TYPE assignee_type AS ENUM ('user', 'location', 'external');

CREATE TABLE assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id       uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  assignee_type  assignee_type NOT NULL,
  assignee_id    uuid,
  assignee_label text,
  location_id    uuid REFERENCES locations(id) ON DELETE SET NULL,
  checked_out_at timestamptz NOT NULL DEFAULT now(),
  checked_out_by uuid REFERENCES users(id) ON DELETE SET NULL,
  due_at         timestamptz,
  checked_in_at  timestamptz,
  checked_in_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  checkout_note  text,
  checkin_note   text,
  condition      text
);
CREATE INDEX assignments_asset_idx ON assignments (asset_id, checked_out_at DESC);
-- At most one open assignment per asset.
CREATE UNIQUE INDEX assignments_one_open_idx ON assignments (asset_id)
  WHERE checked_in_at IS NULL;

CREATE TABLE audit_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id   uuid REFERENCES assets(id) ON DELETE CASCADE,
  actor_type text NOT NULL,                -- 'user' | 'api_key' | 'system'
  actor_id   uuid,
  actor_label text,
  event      text NOT NULL,                -- 'asset.created', 'asset.checked_out', ...
  changes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_asset_idx ON audit_events (asset_id, created_at DESC);
CREATE INDEX audit_org_time_idx ON audit_events (org_id, created_at DESC);

CREATE TABLE import_jobs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  filename   text NOT NULL,
  status     text NOT NULL DEFAULT 'pending',
  dry_run    boolean NOT NULL DEFAULT true,
  total      integer NOT NULL DEFAULT 0,
  created    integer NOT NULL DEFAULT 0,
  updated    integer NOT NULL DEFAULT 0,
  errors     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhooks (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url     text NOT NULL,
  secret  text NOT NULL,
  events  text[] NOT NULL DEFAULT '{}',
  active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  key        text NOT NULL,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  response   jsonb NOT NULL,
  status     integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key)
);

CREATE TABLE rate_limit_events (
  api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_limit_lookup_idx ON rate_limit_events (api_key_id, occurred_at DESC);
```

`api/migrations/004_rls.sql`:

```sql
-- Application role: least privilege, NOT the table owner, so RLS always applies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ams_app') THEN
    CREATE ROLE ams_app LOGIN PASSWORD 'ams_app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO ams_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ams_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ams_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','sessions','api_keys','locations','categories','assets',
    'assignments','audit_events','import_jobs','webhooks',
    'idempotency_keys','rate_limit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $$;

-- organizations is readable only for the caller's own row.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY own_org ON organizations
  USING (id = current_setting('app.org_id')::uuid);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER assets_touch BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

`api/migrations/005_rental_ready.sql`:

```sql
-- Spec §11. Nothing in the MVP writes to any of this. It exists now because
-- retrofitting custody-as-a-time-range onto live assignment data is a migration
-- nobody wants to run, and because a free-text external assignee cannot become a
-- customer record without backfilling by hand.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A counterparty that is not an employee: an external borrower today, a rental
-- customer later. MVP writes these only for `assignee_type = 'external'`.
CREATE TABLE parties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'company',   -- 'person' | 'company'
  relation        text NOT NULL DEFAULT 'customer',  -- 'employee'|'customer'|'supplier'
  name            text NOT NULL,
  email           text,
  phone           text,
  billing_address text,
  tax_id          text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parties_kind_chk CHECK (kind IN ('person', 'company')),
  CONSTRAINT parties_relation_chk
    CHECK (relation IN ('employee', 'customer', 'supplier'))
);
CREATE INDEX parties_org_idx ON parties (org_id, relation);

CREATE TYPE assignment_kind AS ENUM ('internal', 'rental');

ALTER TABLE assignments
  ADD COLUMN kind          assignment_kind NOT NULL DEFAULT 'internal',
  ADD COLUMN party_id      uuid REFERENCES parties(id) ON DELETE SET NULL,
  ADD COLUMN rate_snapshot jsonb,                 -- price agreed, frozen at booking
  ADD COLUMN charge_total  numeric(14,2),
  ADD COLUMN currency      char(3);

-- Future bookings. The exclusion constraint is the point: Postgres itself refuses
-- to store two live reservations that overlap in time for one asset, which no
-- amount of application code does reliably under concurrency.
CREATE TABLE reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id      uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  party_id      uuid REFERENCES parties(id) ON DELETE SET NULL,
  period        tstzrange NOT NULL,
  state         text NOT NULL DEFAULT 'held',
  assignment_id uuid REFERENCES assignments(id) ON DELETE SET NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservations_state_chk CHECK (
    state IN ('held', 'confirmed', 'collected', 'returned', 'cancelled')),
  CONSTRAINT reservations_no_double_book EXCLUDE USING gist (
    asset_id WITH =,
    period   WITH &&
  ) WHERE (state IN ('held', 'confirmed', 'collected'))
);
CREATE INDEX reservations_period_idx ON reservations USING gist (period);
CREATE INDEX reservations_org_asset_idx ON reservations (org_id, asset_id);

-- Attachments (Task 12) — photos, receipts, manuals. Rental condition evidence
-- lands here too.
CREATE TABLE attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id      uuid REFERENCES assets(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES assignments(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'file',  -- 'file'|'photo'|'condition_in'|'condition_out'
  object_key    text NOT NULL,
  filename      text NOT NULL,
  content_type  text NOT NULL,
  size_bytes    bigint NOT NULL,
  uploaded_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_asset_idx ON attachments (asset_id, created_at DESC);

-- Extend the tenant policy set to the tables added above.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parties', 'reservations', 'attachments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON parties, reservations, attachments TO ams_app;
```

- [ ] **Step 4: Write the migration runner**

`api/scripts/migrate.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  const client = new Client({
    connectionString:
      process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  });
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const applied = new Set(
    (await client.query<{ filename: string }>("SELECT filename FROM schema_migrations"))
      .rows.map((r) => r.filename),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    process.stdout.write(`applying ${file}\n`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${(err as Error).message}`);
    }
  }
  await client.end();
  process.stdout.write("migrations up to date\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Run migrations and the test**

```bash
cd api
MIGRATION_DATABASE_URL=postgres://ams:ams@localhost:5433/ams_test npm run migrate
npx vitest run src/lib/db.rls.test.ts
```

Expected: PASS — both isolation cases hold.

- [ ] **Step 6: Commit**

```bash
git add api/migrations api/scripts/migrate.ts api/src/lib/db.rls.test.ts
git commit -m "feat: database schema with row-level security tenant isolation"
```

---

### Task 3: HTTP conventions — problem+json, pagination, request guard

**Files:**
- Create: `api/src/lib/http/problem.ts`, `api/src/lib/http/pagination.ts`, `api/src/lib/http/handler.ts`
- Test: `api/src/lib/http/problem.test.ts`, `api/src/lib/http/pagination.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `problem(status, type, title, extra?): Response`
  - `validationProblem(zodError): Response` → 422
  - `notFound(resource): Response` → 404
  - `parsePagination(url): { page, perPage, offset }`
  - `parseSort(url, allowed, fallback): { column, direction }`
  - `paginated<T>(data, meta): Response`
  - `type Ctx = { orgId: string; actor: Actor }` where `Actor = { type: "user" | "api_key"; id: string; label: string; scopes: string[] }`

- [ ] **Step 1: Write the failing tests**

`api/src/lib/http/problem.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { problem, validationProblem, notFound } from "./problem";

describe("problem responses", () => {
  it("uses the problem+json content type", async () => {
    const res = problem(403, "forbidden", "Forbidden");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    await expect(res.json()).resolves.toMatchObject({
      type: "https://ams.dev/errors/forbidden",
      title: "Forbidden",
      status: 403,
    });
  });

  it("maps zod issues to a field error list", async () => {
    const schema = z.object({ name: z.string().min(1) });
    const parsed = schema.safeParse({ name: "" });
    const res = validationProblem(parsed.error!);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors).toEqual([
      { field: "name", message: expect.any(String) },
    ]);
  });

  it("reports the missing resource by name", async () => {
    const body = await notFound("asset").json();
    expect(body.title).toBe("Asset not found");
  });
});
```

`api/src/lib/http/pagination.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePagination, parseSort } from "./pagination";

const url = (qs: string) => new URL(`http://x/api/v1/assets${qs}`);

describe("parsePagination", () => {
  it("defaults to page 1, 50 per page", () => {
    expect(parsePagination(url(""))).toEqual({ page: 1, perPage: 50, offset: 0 });
  });

  it("computes the offset", () => {
    expect(parsePagination(url("?page=3&per_page=20")).offset).toBe(40);
  });

  it("caps per_page at 200", () => {
    expect(parsePagination(url("?per_page=5000")).perPage).toBe(200);
  });

  it("rejects nonsense values by falling back to the default", () => {
    expect(parsePagination(url("?page=-4&per_page=abc"))).toEqual({
      page: 1, perPage: 50, offset: 0,
    });
  });
});

describe("parseSort", () => {
  const allowed = ["name", "created_at"] as const;

  it("reads a descending sort from the leading dash", () => {
    expect(parseSort(url("?sort=-created_at"), allowed, "name")).toEqual({
      column: "created_at", direction: "DESC",
    });
  });

  it("ignores a column that is not allowlisted", () => {
    expect(parseSort(url("?sort=password_hash"), allowed, "name")).toEqual({
      column: "name", direction: "ASC",
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd api && npx vitest run src/lib/http`
Expected: FAIL — `Cannot find module './problem'`.

- [ ] **Step 3: Implement**

`api/src/lib/http/problem.ts`:

```ts
import type { ZodError } from "zod";

const BASE = "https://ams.dev/errors/";

export function problem(
  status: number,
  type: string,
  title: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({ type: BASE + type, title, status, ...extra }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

export function validationProblem(error: ZodError): Response {
  return problem(422, "validation", "Validation failed", {
    errors: error.issues.map((i) => ({
      field: i.path.join(".") || "_",
      message: i.message,
    })),
  });
}

export function notFound(resource: string): Response {
  const title = resource.charAt(0).toUpperCase() + resource.slice(1) + " not found";
  return problem(404, "not-found", title);
}

export const unauthorized = () =>
  problem(401, "unauthorized", "Authentication required");

export const forbidden = (detail?: string) =>
  problem(403, "forbidden", "Forbidden", detail ? { detail } : {});

export const conflict = (detail: string) =>
  problem(409, "conflict", "Conflict", { detail });
```

`api/src/lib/http/pagination.ts`:

```ts
export interface Pagination {
  page: number;
  perPage: number;
  offset: number;
}

const int = (raw: string | null, fallback: number, min: number, max: number) => {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < min) return fallback;
  return Math.min(n, max);
};

export function parsePagination(url: URL): Pagination {
  const page = int(url.searchParams.get("page"), 1, 1, 1_000_000);
  const perPage = int(url.searchParams.get("per_page"), 50, 1, 200);
  return { page, perPage, offset: (page - 1) * perPage };
}

export interface Sort {
  column: string;
  direction: "ASC" | "DESC";
}

export function parseSort(
  url: URL,
  allowed: readonly string[],
  fallback: string,
): Sort {
  const raw = url.searchParams.get("sort") ?? "";
  const direction = raw.startsWith("-") ? "DESC" : "ASC";
  const column = raw.replace(/^-/, "");
  return allowed.includes(column)
    ? { column, direction }
    : { column: fallback, direction: "ASC" };
}

export function paginated<T>(
  data: T[],
  { page, perPage }: Pagination,
  total: number,
): Response {
  return Response.json({
    data,
    meta: {
      page,
      per_page: perPage,
      total,
      total_pages: Math.max(1, Math.ceil(total / perPage)),
    },
  });
}
```

`api/src/lib/http/handler.ts`:

```ts
import { problem } from "./problem";

export interface Actor {
  type: "user" | "api_key" | "system";
  id: string;
  label: string;
  scopes: string[];
}

export interface Ctx {
  orgId: string;
  actor: Actor;
}

/** Wraps a handler so an unexpected throw becomes a 500 problem document. */
export function safe<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(err);
      return problem(500, "internal", "Internal server error");
    }
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd api && npx vitest run src/lib/http`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/http
git commit -m "feat: problem+json errors, pagination and sort parsing"
```

---

### Task 4: Session auth for the dashboard, API-key auth for the public API

**Files:**
- Create: `api/src/lib/auth/password.ts`, `api/src/lib/auth/session.ts`, `api/src/lib/auth/apikey.ts`, `api/src/lib/auth/guard.ts`
- Create: `api/src/app/api/admin/auth/login/route.ts`, `api/src/app/api/admin/auth/logout/route.ts`, `api/src/app/api/admin/auth/me/route.ts`
- Create: `api/src/app/api/admin/api-keys/route.ts`, `api/src/app/api/admin/api-keys/[id]/route.ts`
- Test: `api/src/lib/auth/auth.test.ts`, `api/src/lib/auth/apikey.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `pool`, `problem` helpers.
- Produces:
  - `hashPassword(plain): Promise<string>`, `verifyPassword(plain, hash): Promise<boolean>` (scrypt)
  - `createSession(userId, orgId): Promise<string>`, `readSession(req): Promise<Ctx | null>`
  - `mintApiKey(orgId, name, scopes): Promise<{ id, plaintext }>` — plaintext shown once
  - `readApiKey(req): Promise<Ctx | null>`
  - `requireAuth(req, scope): Promise<Ctx | Response>` — accepts either mechanism, checks scope, enforces the rate limit

- [ ] **Step 1: Write the failing tests**

`api/src/lib/auth/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash))
      .resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });

  it("produces a different hash each time (salted)", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
});
```

`api/src/lib/auth/apikey.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { mintApiKey, readApiKey } from "./apikey";

const orgId = randomUUID();

beforeAll(async () => {
  await pool.query(
    "INSERT INTO organizations (id, name, slug) VALUES ($1,'Key Org',$2)",
    [orgId, `key-org-${orgId.slice(0, 8)}`],
  );
});

const withKey = (key: string) =>
  new Request("http://x/api/v1/assets", {
    headers: { authorization: `Bearer ${key}` },
  });

describe("api keys", () => {
  it("returns the plaintext exactly once and stores only a hash", async () => {
    const { id, plaintext } = await mintApiKey(orgId, "CI", ["assets:read"]);
    expect(plaintext).toMatch(/^ams_live_[A-Za-z0-9_-]{32,}$/);
    const { rows } = await pool.query("SELECT key_hash FROM api_keys WHERE id=$1", [id]);
    expect(rows[0].key_hash).not.toContain(plaintext);
  });

  it("authenticates a valid key and carries its scopes", async () => {
    const { plaintext } = await mintApiKey(orgId, "Reader", ["assets:read"]);
    const ctx = await readApiKey(withKey(plaintext));
    expect(ctx).toMatchObject({ orgId, actor: { type: "api_key", scopes: ["assets:read"] } });
  });

  it("rejects an unknown key", async () => {
    await expect(readApiKey(withKey("ams_live_nope"))).resolves.toBeNull();
  });

  it("rejects a revoked key", async () => {
    const { id, plaintext } = await mintApiKey(orgId, "Old", ["assets:read"]);
    await pool.query("UPDATE api_keys SET revoked_at = now() WHERE id=$1", [id]);
    await expect(readApiKey(withKey(plaintext))).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd api && npx vitest run src/lib/auth`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement password and session handling**

`api/src/lib/auth/password.ts`:

```ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  pw: string, salt: Buffer, len: number,
) => Promise<Buffer>;

const KEYLEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(plain, salt, KEYLEN);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !keyB64) return false;
  const salt = Buffer.from(saltB64, "base64url");
  const expected = Buffer.from(keyB64, "base64url");
  const actual = await scryptAsync(plain, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

`api/src/lib/auth/session.ts`:

```ts
import { randomBytes } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";

const COOKIE = "ams_session";
const TTL_DAYS = 7;

export async function createSession(userId: string, orgId: string): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO sessions (id, org_id, user_id, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
    [id, orgId, userId, String(TTL_DAYS)],
  );
  return id;
}

export function sessionCookie(id: string): string {
  const maxAge = TTL_DAYS * 86_400;
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${COOKIE}=${id}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`;
}

export const clearSessionCookie = () =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function readSession(req: Request): Promise<Ctx | null> {
  const id = readCookie(req, COOKIE);
  if (!id) return null;
  const { rows } = await pool.query(
    `SELECT s.org_id, u.id AS user_id, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now()`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  // A dashboard user's effective scopes derive from their role.
  const scopes =
    row.role === "viewer"
      ? ["assets:read", "reports:read"]
      : row.role === "admin"
        ? ["assets:read", "assets:write", "reports:read", "admin"]
        : ["assets:read", "assets:write", "reports:read"];
  return {
    orgId: row.org_id,
    actor: { type: "user", id: row.user_id, label: row.name, scopes },
  };
}

export async function destroySession(req: Request): Promise<void> {
  const id = readCookie(req, COOKIE);
  if (id) await pool.query("DELETE FROM sessions WHERE id = $1", [id]);
}
```

- [ ] **Step 4: Implement API keys and the guard**

`api/src/lib/auth/apikey.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function mintApiKey(
  orgId: string,
  name: string,
  scopes: string[],
): Promise<{ id: string; prefix: string; plaintext: string }> {
  const secret = randomBytes(24).toString("base64url");
  const prefix = `ams_live_${randomBytes(4).toString("hex")}`;
  const plaintext = `${prefix}.${secret}`;
  const { rows } = await pool.query(
    `INSERT INTO api_keys (org_id, name, prefix, key_hash, scopes)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [orgId, name, prefix, sha256(plaintext), scopes],
  );
  return { id: rows[0].id, prefix, plaintext };
}

export async function readApiKey(req: Request): Promise<Ctx | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("ams_live_")) return null;

  const prefix = token.split(".")[0];
  const { rows } = await pool.query(
    `SELECT id, org_id, name, key_hash, scopes
       FROM api_keys
      WHERE prefix = $1 AND revoked_at IS NULL`,
    [prefix],
  );
  const row = rows[0];
  if (!row) return null;

  const a = Buffer.from(sha256(token));
  const b = Buffer.from(row.key_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  await pool.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [row.id]);
  return {
    orgId: row.org_id,
    actor: { type: "api_key", id: row.id, label: row.name, scopes: row.scopes },
  };
}

const LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR ?? 1000);

export async function checkRateLimit(
  ctx: Ctx,
): Promise<{ ok: boolean; remaining: number; resetAt: Date }> {
  if (ctx.actor.type !== "api_key") {
    return { ok: true, remaining: LIMIT, resetAt: new Date(Date.now() + 3_600_000) };
  }
  await pool.query(
    "DELETE FROM rate_limit_events WHERE occurred_at < now() - interval '1 hour'",
  );
  const { rows } = await pool.query(
    `SELECT count(*)::int AS used FROM rate_limit_events
      WHERE api_key_id = $1 AND occurred_at > now() - interval '1 hour'`,
    [ctx.actor.id],
  );
  const used = rows[0].used as number;
  const resetAt = new Date(Date.now() + 3_600_000);
  if (used >= LIMIT) return { ok: false, remaining: 0, resetAt };
  await pool.query(
    "INSERT INTO rate_limit_events (api_key_id, org_id) VALUES ($1, $2)",
    [ctx.actor.id, ctx.orgId],
  );
  return { ok: true, remaining: LIMIT - used - 1, resetAt };
}
```

`api/src/lib/auth/guard.ts`:

```ts
import { readSession } from "./session";
import { readApiKey, checkRateLimit } from "./apikey";
import { unauthorized, forbidden, problem } from "../http/problem";
import type { Ctx } from "../http/handler";

export type Scope = "assets:read" | "assets:write" | "reports:read" | "admin";

/** Returns a Ctx, or a Response to return immediately. */
export async function requireAuth(
  req: Request,
  scope: Scope,
): Promise<Ctx | Response> {
  const ctx = (await readApiKey(req)) ?? (await readSession(req));
  if (!ctx) return unauthorized();

  if (!ctx.actor.scopes.includes(scope) && !ctx.actor.scopes.includes("admin")) {
    return forbidden(`This credential lacks the "${scope}" scope.`);
  }

  const limit = await checkRateLimit(ctx);
  if (!limit.ok) {
    const res = problem(429, "rate-limited", "Rate limit exceeded", {
      detail: "1000 requests per hour per API key.",
    });
    res.headers.set("Retry-After", "3600");
    res.headers.set("X-RateLimit-Remaining", "0");
    return res;
  }
  return ctx;
}

export const isResponse = (v: unknown): v is Response => v instanceof Response;
```

- [ ] **Step 5: Implement the auth route handlers**

`api/src/app/api/admin/auth/login/route.ts`:

```ts
import { z } from "zod";
import { pool } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, sessionCookie } from "@/lib/auth/session";
import { validationProblem, unauthorized } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export const POST = safe(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const { rows } = await pool.query(
    `SELECT id, org_id, name, role, password_hash
       FROM users WHERE lower(email) = lower($1)`,
    [parsed.data.email],
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    return unauthorized();
  }

  const sid = await createSession(user.id, user.org_id);
  return Response.json(
    { id: user.id, name: user.name, role: user.role, org_id: user.org_id },
    { headers: { "set-cookie": sessionCookie(sid) } },
  );
});
```

`api/src/app/api/admin/auth/logout/route.ts`:

```ts
import { destroySession, clearSessionCookie } from "@/lib/auth/session";
import { safe } from "@/lib/http/handler";

export const POST = safe(async (req: Request) => {
  await destroySession(req);
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": clearSessionCookie() },
  });
});
```

`api/src/app/api/admin/auth/me/route.ts`:

```ts
import { readSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

export const GET = safe(async (req: Request) => {
  const ctx = await readSession(req);
  if (!ctx) return unauthorized();
  return Response.json({
    org_id: ctx.orgId,
    user: { id: ctx.actor.id, name: ctx.actor.label, scopes: ctx.actor.scopes },
  });
});
```

`api/src/app/api/admin/api-keys/route.ts`:

```ts
import { z } from "zod";
import { withTenant } from "@/lib/db";
import { mintApiKey } from "@/lib/auth/apikey";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

const SCOPES = ["assets:read", "assets:write", "reports:read", "admin"] as const;
const Body = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(SCOPES)).min(1),
});

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const rows = await withTenant(ctx.orgId, async (c) =>
    (await c.query(
      `SELECT id, name, prefix, scopes, last_used_at, revoked_at, created_at
         FROM api_keys ORDER BY created_at DESC`,
    )).rows,
  );
  return Response.json({ data: rows });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const key = await mintApiKey(ctx.orgId, parsed.data.name, parsed.data.scopes);
  // `key` is the only time the plaintext is ever available.
  return Response.json(
    { id: key.id, name: parsed.data.name, prefix: key.prefix, key: key.plaintext },
    { status: 201 },
  );
});
```

`api/src/app/api/admin/api-keys/[id]/route.ts`:

```ts
import { withTenant } from "@/lib/db";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

export const DELETE = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const { id } = await params;

  const rows = await withTenant(ctx.orgId, async (c) =>
    (await c.query(
      "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id",
      [id],
    )).rows,
  );
  if (rows.length === 0) return notFound("api key");
  return new Response(null, { status: 204 });
});
```

- [ ] **Step 6: Run the tests**

Run: `cd api && npx vitest run src/lib/auth`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/auth api/src/app/api/admin
git commit -m "feat: session auth for dashboard and scoped rate-limited api keys"
```

---
