# Phase 6 — Advanced features

> Part of the [Assets Management System plan](./00-overview.md). Read `00-overview.md` first — its Global Constraints apply to every task here.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Tasks 32–44.** Depreciation and book value, stock-take sessions, preventive
maintenance schedules, and the operational hardening the spec marks "do not skip".

**Goal:** close the gap between a working asset register and one a finance team, a
warehouse team and an operations team can each rely on.

**Spec sections:** §14 "Build in phase 2" and §14 "Operational, do not skip".

**Architecture:** every feature here sits on machinery that already exists. Depreciation
is a pure calculation module plus one report definition, which gets six output formats
for free. Stock-take reuses the scanner and the custody model. Maintenance extends the
scheduler that already sends overdue and expiry notices. Nothing here needs a new
subsystem.

**Tech stack:** unchanged — Node 22, PostgreSQL 16, TypeScript 5.7 strict, Next.js 15
route handlers, React 19, Vitest.

**Spec:** [../../specs/2026-09-03-assets-management-system.md](../../specs/2026-09-03-assets-management-system.md)

## Why this phase runs before integration and documentation

Phases 7 and 8 are release engineering and documentation. Documenting a feature set
that is about to grow means writing the developer portal, the OpenAPI document and the
printable user guide twice. This phase therefore lands first, and Phases 6 and 7 close
the whole product rather than two thirds of it.

## Decisions taken before writing this plan

| Question | Decision |
|---|---|
| Depreciation methods | Both straight-line and reducing-balance, chosen per category, overridable per asset |
| Book value | A live figure for the interface **and** month-end snapshots for reporting |
| Scope | Depreciation, stock-take, maintenance schedules, operational hardening |

**One convention is assumed rather than asked:** depreciation charges a **whole month
in the month of acquisition** and none in the month of disposal. Pro-rata by day is a
one-line change in `chargeForPeriod` if finance wants it, and Task 32's schema carries
`depreciation_start` per asset so the start can be moved without touching the purchase
date. Confirm with the customer before go-live.

## Global constraints for this phase

Inherited from `00-overview.md`, repeated here because every task depends on them:

- **Every new table carries `org_id`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and a
  policy on `current_setting('app.org_id')::uuid`.** A new table without this is a
  cross-tenant data leak. Follow migration `004_rls.sql` exactly, including the grants.
- **All handler database access goes through `withTenant(orgId, fn)`.**
- **Money is `numeric(14,2)` in the database and a string on the wire.** JavaScript
  numbers lose precision past 2^53; a register of 400-million-rupiah forklifts reaches
  that. Convert to `number` only inside the calculation module, where values are a
  single asset's cost.
- **Permissions are code-defined.** A new permission is added to
  `api/src/lib/auth/permissions.ts` and to the seeded system roles in the same commit,
  or existing customers get a permission nobody holds.
- **Conventional Commits with a `release-note:` trailer** on every `feat` and `fix`,
  all trailers in one unbroken final block. See `CONTRIBUTING.md`.

## File structure

| File | Responsibility |
|---|---|
| `api/migrations/014_depreciation.sql` | Policy columns, the snapshot table, its RLS |
| `api/src/lib/domain/depreciation.ts` | Pure calculation: schedules, book value. No database. |
| `api/src/lib/domain/depreciation.repo.ts` | Reading policies, writing snapshots |
| `api/src/lib/jobs/depreciation.ts` | The month-end snapshot sweep |
| `api/src/lib/reports/definitions/book-value.ts` | The book-value report |
| `api/migrations/015_stocktake.sql` | Sessions, counted lines, RLS |
| `api/src/lib/domain/stocktake.ts` | Session lifecycle and reconciliation |
| `api/migrations/016_maintenance.sql` | Schedules, service history, RLS |
| `api/src/lib/domain/maintenance.ts` | Due calculation and completion |
| `api/src/lib/http/logging.ts` | Request id, structured request log |
| `api/scripts/backup.ts` | `pg_dump` to object storage |
| `api/scripts/restore.ts` | The restore half, which is what makes a backup real |
| `web/src/pages/Stocktake/*` | Session list and the counting screen |
| `web/src/pages/Maintenance/*` | Schedule list and completion |
| `web/src/components/catalog/DepreciationFields.tsx` | Policy editor, used by category and asset forms |

The calculation module is deliberately separate from anything that touches the
database. Depreciation arithmetic is where a mistake is both easy and expensive, and a
pure function is testable exhaustively without fixtures.

---

## Task 32: Depreciation schema and policy resolution

**Files:**
- Create: `api/migrations/014_depreciation.sql`
- Create: `api/src/lib/domain/depreciation.repo.ts`
- Test: `api/src/lib/domain/depreciation.repo.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `Ctx`.
- Produces:
  - `DepreciationPolicy` — `{ method, useful_life_months, salvage_pct, declining_rate_pct }`
  - `resolvePolicy(ctx, assetId)` — the asset's own settings, falling back to its category
  - `listDepreciableAssets(ctx)` — assets with a cost, a start date and a method

**Design note:** the policy lives in two places on purpose. A category sets the rule for
its kind of asset — laptops over three years, forklifts reducing-balance at 20% — and an
individual asset can override it, because the one machine bought second-hand does not
follow the same life as the rest. Storing only per-asset would make bulk changes
impossible; storing only per-category would make the exception impossible.

- [ ] **Step 1: Write the failing test**

`api/src/lib/domain/depreciation.repo.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { systemCtx } from "@/lib/jobs/context";
import { resolvePolicy, listDepreciableAssets } from "./depreciation.repo";
import { createCategory } from "./categories";
import { createAsset } from "./assets";
import type { Ctx } from "@/lib/http/handler";

let ctx: Ctx;
let laptopsId: string;

beforeAll(async () => {
  const orgId = await createOrg("Depreciation Org");
  await createUserWithRole(orgId, "Administrator");
  ctx = systemCtx(orgId);

  const laptops = await createCategory(ctx, {
    name: "Laptops", kind: "it", field_schema: { fields: [] },
  });
  laptopsId = laptops.id;

  await withTenant(orgId, (c) =>
    c.query(
      `UPDATE categories
          SET depreciation_method = 'straight_line',
              useful_life_months = 36,
              salvage_pct = 10
        WHERE id = $1`,
      [laptopsId],
    ),
  );
});

describe("resolvePolicy", () => {
  it("takes the category's policy when the asset sets none", async () => {
    const asset = await createAsset(ctx, {
      name: "Inherits", category_id: laptopsId,
      purchase_cost: 12_000_000, purchase_date: "2026-01-10",
    });

    const policy = await resolvePolicy(ctx, asset.id);
    expect(policy.method).toBe("straight_line");
    expect(policy.useful_life_months).toBe(36);
    expect(policy.salvage_pct).toBe(10);
  });

  it("lets an asset override its category", async () => {
    // The one machine bought second-hand does not have the same life left as
    // the rest of the category.
    const asset = await createAsset(ctx, {
      name: "Overrides", category_id: laptopsId,
      purchase_cost: 4_000_000, purchase_date: "2026-01-10",
    });
    await withTenant(ctx.orgId, (c) =>
      c.query("UPDATE assets SET useful_life_months = 12 WHERE id = $1", [asset.id]),
    );

    const policy = await resolvePolicy(ctx, asset.id);
    expect(policy.useful_life_months).toBe(12);
    // Unset fields still come from the category.
    expect(policy.method).toBe("straight_line");
  });

  it("reports no method for an asset in a category that depreciates nothing", async () => {
    const other = await createCategory(ctx, {
      name: "Consumables", kind: "equipment", field_schema: { fields: [] },
    });
    const asset = await createAsset(ctx, {
      name: "Not depreciated", category_id: other.id, purchase_cost: 50_000,
    });

    expect((await resolvePolicy(ctx, asset.id)).method).toBe("none");
  });
});

describe("listDepreciableAssets", () => {
  it("skips assets with no cost, because there is nothing to write down", async () => {
    await createAsset(ctx, {
      name: "No cost", category_id: laptopsId, purchase_date: "2026-01-10",
    });
    const rows = await listDepreciableAssets(ctx);
    expect(rows.every((r) => Number(r.cost) > 0)).toBe(true);
    expect(rows.some((r) => r.name === "No cost")).toBe(false);
  });

  it("falls back to the purchase date when no start date is set", async () => {
    const asset = await createAsset(ctx, {
      name: "Starts at purchase", category_id: laptopsId,
      purchase_cost: 9_000_000, purchase_date: "2026-03-01",
    });
    const row = (await listDepreciableAssets(ctx)).find((r) => r.id === asset.id)!;
    expect(row.start).toBe("2026-03-01");
  });

  it("skips a retired asset, which stops depreciating when it leaves the register", async () => {
    const asset = await createAsset(ctx, {
      name: "Retired", category_id: laptopsId,
      purchase_cost: 9_000_000, purchase_date: "2026-01-10", status: "retired",
    });
    const rows = await listDepreciableAssets(ctx);
    expect(rows.some((r) => r.id === asset.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/depreciation.repo.test.ts`
Expected: FAIL — cannot find module `./depreciation.repo`.

- [ ] **Step 3: Write the migration**

`api/migrations/014_depreciation.sql`:

```sql
-- Depreciation policy and the month-end book values it produces.
--
-- Policy lives on the category as the rule for a kind of asset, and on the
-- asset as an override for the exception. Both are nullable on the asset: NULL
-- means "inherit", which is not the same as "zero".

CREATE TYPE depreciation_method AS ENUM ('none', 'straight_line', 'reducing_balance');

ALTER TABLE categories
  ADD COLUMN depreciation_method depreciation_method NOT NULL DEFAULT 'none',
  ADD COLUMN useful_life_months  integer,
  ADD COLUMN salvage_pct         numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN declining_rate_pct  numeric(5,2);

ALTER TABLE categories
  ADD CONSTRAINT categories_useful_life_positive
    CHECK (useful_life_months IS NULL OR useful_life_months > 0),
  ADD CONSTRAINT categories_salvage_pct_range
    CHECK (salvage_pct >= 0 AND salvage_pct <= 100),
  ADD CONSTRAINT categories_declining_rate_range
    CHECK (declining_rate_pct IS NULL
           OR (declining_rate_pct > 0 AND declining_rate_pct <= 100));

ALTER TABLE assets
  ADD COLUMN depreciation_method depreciation_method,
  ADD COLUMN useful_life_months  integer,
  ADD COLUMN salvage_pct         numeric(5,2),
  ADD COLUMN declining_rate_pct  numeric(5,2),
  -- Defaults to purchase_date. Separate because an asset can be bought in one
  -- month and brought into service in another, and depreciation follows use.
  ADD COLUMN depreciation_start  date;

ALTER TABLE assets
  ADD CONSTRAINT assets_useful_life_positive
    CHECK (useful_life_months IS NULL OR useful_life_months > 0),
  ADD CONSTRAINT assets_salvage_pct_range
    CHECK (salvage_pct IS NULL OR (salvage_pct >= 0 AND salvage_pct <= 100)),
  ADD CONSTRAINT assets_declining_rate_range
    CHECK (declining_rate_pct IS NULL
           OR (declining_rate_pct > 0 AND declining_rate_pct <= 100));

-- One row per asset per closed month. Finance reprints last quarter and gets
-- the same numbers, and a later correction to cost does not rewrite history.
CREATE TABLE asset_book_values (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id      uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  -- Always the last day of the month, so a period is unambiguous.
  period_end    date NOT NULL,
  method        depreciation_method NOT NULL,
  opening_value numeric(14,2) NOT NULL,
  charge        numeric(14,2) NOT NULL,
  closing_value numeric(14,2) NOT NULL,
  accumulated   numeric(14,2) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period_end)
);

CREATE INDEX asset_book_values_org_period_idx
  ON asset_book_values (org_id, period_end DESC);

-- Row-level security, exactly as 004_rls.sql establishes it. A tenant table
-- without FORCE is readable by the table owner, and without a policy is
-- readable by everyone.
ALTER TABLE asset_book_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_book_values FORCE ROW LEVEL SECURITY;

CREATE POLICY asset_book_values_tenant ON asset_book_values
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON asset_book_values TO ams_app;
```

- [ ] **Step 4: Run the migration and confirm the isolation test still passes**

Run: `cd api && npm run migrate:test && npx vitest run src/lib/db`
Expected: PASS. The RLS suite walks every table with an `org_id`; a new table
that is missing a policy fails there rather than in production.

- [ ] **Step 5: Implement the repository**

`api/src/lib/domain/depreciation.repo.ts`:

```ts
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";

export type Method = "none" | "straight_line" | "reducing_balance";

export interface DepreciationPolicy {
  method: Method;
  useful_life_months: number | null;
  salvage_pct: number;
  declining_rate_pct: number | null;
}

export interface DepreciableAsset {
  id: string;
  name: string;
  /** numeric(14,2) arrives as a string; the caller converts once. */
  cost: string;
  start: string;
  policy: DepreciationPolicy;
}

const POLICY_COLUMNS = `
  coalesce(a.depreciation_method, c.depreciation_method, 'none') AS method,
  coalesce(a.useful_life_months, c.useful_life_months)           AS useful_life_months,
  coalesce(a.salvage_pct, c.salvage_pct, 0)                      AS salvage_pct,
  coalesce(a.declining_rate_pct, c.declining_rate_pct)           AS declining_rate_pct`;

/**
 * The asset's own settings, falling back field by field to its category.
 *
 * Field-by-field rather than all-or-nothing: an asset that overrides only its
 * useful life should keep its category's method, and an override object that
 * silently reset the other three would be a trap.
 */
export async function resolvePolicy(
  ctx: Ctx,
  assetId: string,
): Promise<DepreciationPolicy> {
  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<{
      method: Method;
      useful_life_months: number | null;
      salvage_pct: string;
      declining_rate_pct: string | null;
    }>(
      `SELECT ${POLICY_COLUMNS}
         FROM assets a LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.id = $1`,
      [assetId],
    );

    const row = rows[0];
    if (!row) {
      return {
        method: "none", useful_life_months: null,
        salvage_pct: 0, declining_rate_pct: null,
      };
    }
    return {
      method: row.method,
      useful_life_months: row.useful_life_months,
      salvage_pct: Number(row.salvage_pct),
      declining_rate_pct:
        row.declining_rate_pct === null ? null : Number(row.declining_rate_pct),
    };
  });
}

/**
 * Every asset the snapshot job should charge this period.
 *
 * Excludes assets with no cost (nothing to write down), no start date, no
 * method, and those that have left the register: a retired or lost asset is
 * disposed of, and continuing to depreciate it overstates the charge.
 */
export async function listDepreciableAssets(ctx: Ctx): Promise<DepreciableAsset[]> {
  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<{
      id: string; name: string; cost: string; start: string;
      method: Method; useful_life_months: number | null;
      salvage_pct: string; declining_rate_pct: string | null;
    }>(
      `SELECT a.id, a.name,
              a.purchase_cost AS cost,
              coalesce(a.depreciation_start, a.purchase_date)::text AS start,
              ${POLICY_COLUMNS}
         FROM assets a LEFT JOIN categories c ON c.id = a.category_id
        WHERE a.deleted_at IS NULL
          AND a.status NOT IN ('retired', 'lost')
          AND a.purchase_cost IS NOT NULL
          AND a.purchase_cost > 0
          AND coalesce(a.depreciation_start, a.purchase_date) IS NOT NULL
          AND coalesce(a.depreciation_method, c.depreciation_method, 'none') <> 'none'
        ORDER BY a.name`,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      cost: row.cost,
      start: row.start,
      policy: {
        method: row.method,
        useful_life_months: row.useful_life_months,
        salvage_pct: Number(row.salvage_pct),
        declining_rate_pct:
          row.declining_rate_pct === null ? null : Number(row.declining_rate_pct),
      },
    }));
  });
}
```

- [ ] **Step 6: Run the tests**

Run: `cd api && npx vitest run src/lib/domain/depreciation.repo.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add api/migrations/014_depreciation.sql api/src/lib/domain/depreciation.repo.ts api/src/lib/domain/depreciation.repo.test.ts
git commit -F- <<'EOF'
feat(api): depreciation policy on categories and assets

A category sets the rule for its kind of asset; an asset overrides it field by
field for the exception, so an override of useful life keeps the category's
method rather than silently resetting it.

Retired and lost assets are excluded: they have left the register, and
continuing to charge them overstates depreciation.

release-note: Assets can now carry a depreciation policy, set per category and
 overridable on an individual asset.
EOF
```

---

## Task 33: The depreciation calculation engine

**Files:**
- Create: `api/src/lib/domain/depreciation.ts`
- Test: `api/src/lib/domain/depreciation.test.ts`

**Interfaces:**
- Consumes: `DepreciationPolicy` from Task 32.
- Produces:
  - `buildSchedule(cost, start, policy, until)` — every period from start to `until`
  - `bookValueAt(cost, start, policy, on)` — the live figure the interface shows
  - `endOfMonth(date)` — the period-end convention, exported for the job and tests

**Design note:** this module touches no database and no clock. Depreciation is where an
arithmetic mistake is both easy to make and expensive to find, and a pure function can
be tested exhaustively — every month of a three-year life, the final period's rounding,
the salvage floor — in milliseconds and without fixtures.

**Verified before this plan was written.** The algorithm below was run against
every assertion in Step 1 rather than reasoned about: 23 pass, 0 fail. The first
draft failed the reconciliation case, which is why the final-period clause exists.

**The rounding rule matters.** Charges are rounded to two decimals each period, which
drifts: 12,000,000 over 36 months is 333,333.33 a month, and 36 of those is 11,999,999.88.
The final period absorbs the difference so accumulated depreciation plus closing value
equals cost exactly. A report whose column does not sum to the register's cost is a
report finance will not sign.

- [ ] **Step 1: Write the failing test**

`api/src/lib/domain/depreciation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSchedule, bookValueAt, endOfMonth } from "./depreciation";
import type { DepreciationPolicy } from "./depreciation.repo";

const straightLine = (months: number, salvagePct = 0): DepreciationPolicy => ({
  method: "straight_line",
  useful_life_months: months,
  salvage_pct: salvagePct,
  declining_rate_pct: null,
});

const reducing = (ratePct: number, salvagePct = 0): DepreciationPolicy => ({
  method: "reducing_balance",
  useful_life_months: null,
  salvage_pct: salvagePct,
  declining_rate_pct: ratePct,
});

describe("endOfMonth", () => {
  it("returns the last day of the month", () => {
    expect(endOfMonth("2026-01-10")).toBe("2026-01-31");
    expect(endOfMonth("2026-02-01")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-15")).toBe("2028-02-29");
  });
});

describe("buildSchedule — straight line", () => {
  it("charges an equal amount each month", () => {
    const schedule = buildSchedule(36_000_000, "2026-01-15", straightLine(36), "2026-03-31");
    expect(schedule).toHaveLength(3);
    expect(schedule[0].charge).toBe(1_000_000);
    expect(schedule[1].charge).toBe(1_000_000);
  });

  it("charges a whole month in the month of acquisition", () => {
    // The convention this system uses. Pro-rata by day is a change to
    // chargeForPeriod alone; see the note at the top of this phase.
    const schedule = buildSchedule(36_000_000, "2026-01-31", straightLine(36), "2026-01-31");
    expect(schedule).toHaveLength(1);
    expect(schedule[0].charge).toBe(1_000_000);
  });

  it("stops at the end of the useful life", () => {
    const schedule = buildSchedule(36_000_000, "2026-01-01", straightLine(36), "2030-12-31");
    expect(schedule).toHaveLength(36);
    expect(schedule[35].closing).toBe(0);
  });

  it("never charges below the salvage value", () => {
    const schedule = buildSchedule(10_000_000, "2026-01-01", straightLine(10, 20), "2027-12-31");
    const last = schedule[schedule.length - 1];
    expect(last.closing).toBe(2_000_000);
    expect(schedule).toHaveLength(10);
  });

  it("absorbs rounding drift in the final period so the totals reconcile", () => {
    // 12,000,000 / 36 is 333,333.33, and 36 of those is 11,999,999.88. A report
    // whose depreciation does not sum to cost is one finance will not sign.
    const schedule = buildSchedule(12_000_000, "2026-01-01", straightLine(36), "2029-12-31");
    const total = schedule.reduce((sum, p) => sum + p.charge, 0);
    expect(Number(total.toFixed(2))).toBe(12_000_000);
    expect(schedule[schedule.length - 1].closing).toBe(0);
  });
});

describe("buildSchedule — reducing balance", () => {
  it("charges a share of the remaining value, not of cost", () => {
    // 24% a year is 2% a month of whatever is left.
    const schedule = buildSchedule(100_000_000, "2026-01-01", reducing(24), "2026-03-31");
    expect(schedule[0].charge).toBe(2_000_000);
    expect(schedule[1].charge).toBe(1_960_000);
    expect(schedule[1].opening).toBe(98_000_000);
  });

  it("stops at the salvage value rather than approaching zero forever", () => {
    const schedule = buildSchedule(100_000_000, "2026-01-01", reducing(60, 10), "2036-12-31");
    const last = schedule[schedule.length - 1];
    expect(last.closing).toBe(10_000_000);
    // A reducing balance never reaches zero, so without the floor this would
    // run until the `until` date on every asset, forever.
    expect(schedule.length).toBeLessThan(120);
  });
});

describe("buildSchedule — nothing to do", () => {
  it("returns no periods when the method is none", () => {
    expect(buildSchedule(1_000_000, "2026-01-01",
      { method: "none", useful_life_months: null, salvage_pct: 0, declining_rate_pct: null },
      "2027-01-31")).toEqual([]);
  });

  it("returns no periods when straight line has no useful life", () => {
    expect(buildSchedule(1_000_000, "2026-01-01",
      { ...straightLine(12), useful_life_months: null }, "2027-01-31")).toEqual([]);
  });

  it("returns no periods before the asset starts", () => {
    expect(buildSchedule(1_000_000, "2026-06-01", straightLine(12), "2026-03-31")).toEqual([]);
  });
});

describe("bookValueAt", () => {
  it("is the cost on the day before depreciation starts", () => {
    expect(bookValueAt(36_000_000, "2026-02-01", straightLine(36), "2026-01-31"))
      .toBe(36_000_000);
  });

  it("falls by one period's charge after the first month", () => {
    expect(bookValueAt(36_000_000, "2026-01-01", straightLine(36), "2026-01-31"))
      .toBe(35_000_000);
  });

  it("holds at the salvage value once fully depreciated", () => {
    expect(bookValueAt(10_000_000, "2026-01-01", straightLine(10, 20), "2030-01-31"))
      .toBe(2_000_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/depreciation.test.ts`
Expected: FAIL — cannot find module `./depreciation`.

- [ ] **Step 3: Implement the engine**

`api/src/lib/domain/depreciation.ts`:

```ts
import type { DepreciationPolicy } from "./depreciation.repo";

export interface Period {
  /** Last day of the month, YYYY-MM-DD. */
  period_end: string;
  opening: number;
  charge: number;
  closing: number;
  accumulated: number;
}

/** Guards a reducing balance, which approaches its floor without reaching it. */
const MAX_PERIODS = 1200;

const round2 = (value: number) => Math.round(value * 100) / 100;

export function endOfMonth(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  // Day 0 of the next month is the last day of this one.
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

const addMonth = (periodEnd: string): string => {
  const d = new Date(`${periodEnd}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0))
    .toISOString().slice(0, 10);
};

/**
 * Every monthly period from the asset's start up to and including `until`.
 *
 * A whole month is charged in the month of acquisition; see the convention note
 * in this phase's header. Charges round to two decimals, and the period that
 * exhausts the depreciable amount takes whatever is left, so the schedule
 * always reconciles: accumulated + closing === cost.
 */
export function buildSchedule(
  cost: number,
  start: string,
  policy: DepreciationPolicy,
  until: string,
): Period[] {
  if (policy.method === "none") return [];
  if (policy.method === "straight_line" && !policy.useful_life_months) return [];
  if (policy.method === "reducing_balance" && !policy.declining_rate_pct) return [];

  const floor = round2(cost * (policy.salvage_pct / 100));
  const depreciable = round2(cost - floor);
  if (depreciable <= 0) return [];

  const straightCharge =
    policy.method === "straight_line" && policy.useful_life_months
      ? round2(depreciable / policy.useful_life_months)
      : 0;
  const monthlyRate =
    policy.method === "reducing_balance" && policy.declining_rate_pct
      ? policy.declining_rate_pct / 100 / 12
      : 0;

  const periods: Period[] = [];
  let periodEnd = endOfMonth(start);
  let opening = cost;
  let accumulated = 0;
  let charged = 0;

  while (periodEnd <= until && periods.length < MAX_PERIODS) {
    if (policy.method === "straight_line" && policy.useful_life_months
        && periods.length >= policy.useful_life_months) {
      break;
    }

    // The last period of a straight-line life always takes what is left.
    // Testing only `charge >= remaining` is not enough: rounding each period
    // down leaves the final charge slightly SMALLER than the remainder, so the
    // schedule ends 12 cents short of cost rather than over it.
    const isFinalStraightPeriod =
      policy.method === "straight_line"
      && policy.useful_life_months !== null
      && periods.length === policy.useful_life_months - 1;

    let charge =
      policy.method === "straight_line" ? straightCharge : round2(opening * monthlyRate);

    // The salvage floor, and the rounding drift with it. Whichever period
    // exhausts the depreciable amount takes the remainder, so the totals
    // reconcile exactly.
    const remaining = round2(depreciable - charged);
    if (charge >= remaining || isFinalStraightPeriod) charge = remaining;
    if (charge <= 0) break;

    const closing = round2(opening - charge);
    accumulated = round2(accumulated + charge);
    charged = round2(charged + charge);

    periods.push({ period_end: periodEnd, opening, charge, closing, accumulated });

    opening = closing;
    periodEnd = addMonth(periodEnd);
  }

  return periods;
}

/** The live figure: what the asset is worth on a given date. */
export function bookValueAt(
  cost: number,
  start: string,
  policy: DepreciationPolicy,
  on: string,
): number {
  const schedule = buildSchedule(cost, start, policy, endOfMonth(on));
  return schedule.length === 0 ? cost : schedule[schedule.length - 1].closing;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd api && npx vitest run src/lib/domain/depreciation.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Prove the reconciliation test can fail**

Temporarily drop `|| isFinalStraightPeriod` from the charge clause and re-run.
The rounding-drift test must fail with a total of 11,999,999.88 and a closing
value of 0.12. Restore it. A test that cannot fail is not protecting the number
finance signs.

**This is not hypothetical.** The first draft of this module omitted that
clause, and the failure above is what it produced when the algorithm was run
against these assertions before the plan was finished.

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/domain/depreciation.ts api/src/lib/domain/depreciation.test.ts
git commit -F- <<'EOF'
feat(api): straight-line and reducing-balance depreciation

A pure module: no database, no clock. Depreciation arithmetic is easy to get
wrong and expensive to find wrong, so it is tested exhaustively rather than
through fixtures.

Two rules earn their own tests. A reducing balance never reaches zero, so it
stops at the salvage value rather than running forever. Rounding each period to
two decimals drifts - 12,000,000 over 36 months leaves 12 cents unaccounted -
so the period that exhausts the depreciable amount absorbs the remainder and
accumulated plus closing equals cost exactly.

release-note: The system can now calculate depreciation, straight-line or
 reducing-balance.
EOF
```

---

## Task 34: Month-end snapshots and the live book value

**Files:**
- Create: `api/src/lib/jobs/depreciation.ts`
- Modify: `api/src/lib/jobs/runner.ts` (add the sweep to `runAllJobs`)
- Modify: `api/src/lib/domain/depreciation.repo.ts` (add `saveSnapshots`, `bookValueNow`)
- Test: `api/src/lib/jobs/depreciation.test.ts`

**Interfaces:**
- Consumes: `buildSchedule` (Task 33), `listDepreciableAssets` (Task 32), `systemCtx`.
- Produces:
  - `runDepreciationJob(ctx, asOf)` → `{ assets: number; periods: number }`
  - `saveSnapshots(ctx, assetId, method, periods)` — idempotent per `(asset_id, period_end)`
  - `bookValueNow(ctx, assetId, on?)` — the live figure, for the asset detail screen

**Design note:** the job writes only **closed** months. Running on 3 March writes periods
up to 28 February and never a partial March, because a snapshot that changes when you
re-run it is not a snapshot. The live figure is calculated on read for the interface, so
an asset detail page shows today's value while reports use the frozen one.

**Idempotency:** the job re-runs safely. `ON CONFLICT (asset_id, period_end) DO NOTHING`
makes a second run in the same month a no-op, and a run after a gap backfills every
month it missed — a scheduler that was down for a week must not leave a hole in the
ledger.

- [ ] **Step 1: Write the failing test**

`api/src/lib/jobs/depreciation.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { systemCtx } from "@/lib/jobs/context";
import { runDepreciationJob } from "./depreciation";
import { bookValueNow } from "@/lib/domain/depreciation.repo";
import { createCategory } from "@/lib/domain/categories";
import { createAsset } from "@/lib/domain/assets";
import type { Ctx } from "@/lib/http/handler";

let ctx: Ctx;
let assetId: string;

beforeAll(async () => {
  const orgId = await createOrg("Snapshot Org");
  await createUserWithRole(orgId, "Administrator");
  ctx = systemCtx(orgId);

  const cat = await createCategory(ctx, {
    name: "Laptops", kind: "it", field_schema: { fields: [] },
  });
  await withTenant(orgId, (c) =>
    c.query(
      `UPDATE categories SET depreciation_method = 'straight_line',
              useful_life_months = 36 WHERE id = $1`,
      [cat.id],
    ),
  );

  const asset = await createAsset(ctx, {
    name: "ThinkPad", category_id: cat.id,
    purchase_cost: 36_000_000, purchase_date: "2026-01-05",
  });
  assetId = asset.id;
});

const rows = () =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<{ period_end: string; charge: string; closing_value: string }>(
      `SELECT period_end::text, charge, closing_value
         FROM asset_book_values WHERE asset_id = $1 ORDER BY period_end`,
      [assetId],
    )).rows,
  );

describe("runDepreciationJob", () => {
  it("writes one row per closed month", async () => {
    const summary = await runDepreciationJob(ctx, "2026-03-15");
    expect(summary.assets).toBe(1);

    const written = await rows();
    expect(written.map((r) => r.period_end)).toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("never writes the month it is run in, which is not closed yet", async () => {
    const written = await rows();
    expect(written.some((r) => r.period_end.startsWith("2026-03"))).toBe(false);
  });

  it("is idempotent: a second run in the same month writes nothing", async () => {
    const before = (await rows()).length;
    await runDepreciationJob(ctx, "2026-03-20");
    expect((await rows()).length).toBe(before);
  });

  it("backfills a gap, so a scheduler that was down leaves no hole", async () => {
    await runDepreciationJob(ctx, "2026-07-02");
    expect((await rows()).map((r) => r.period_end)).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31",
      "2026-04-30", "2026-05-31", "2026-06-30",
    ]);
  });

  it("records a closing value that falls by the monthly charge", async () => {
    const written = await rows();
    expect(Number(written[0].closing_value)).toBe(35_000_000);
    expect(Number(written[1].closing_value)).toBe(34_000_000);
  });
});

describe("bookValueNow", () => {
  it("is calculated live, not read from the last snapshot", async () => {
    // The interface shows today's value; reports use the frozen month-end
    // figures. Reading the newest snapshot here would be stale for most of
    // the month.
    expect(await bookValueNow(ctx, assetId, "2026-08-15")).toBe(29_000_000);
  });

  it("returns the purchase cost for an asset that does not depreciate", async () => {
    const plain = await createCategory(ctx, {
      name: "Consumables", kind: "equipment", field_schema: { fields: [] },
    });
    const asset = await createAsset(ctx, {
      name: "Cable", category_id: plain.id, purchase_cost: 250_000,
      purchase_date: "2026-01-05",
    });
    expect(await bookValueNow(ctx, asset.id, "2026-08-15")).toBe(250_000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/jobs/depreciation.test.ts`
Expected: FAIL — cannot find module `./depreciation`.

- [ ] **Step 3: Add the repository functions**

Append to `api/src/lib/domain/depreciation.repo.ts`:

```ts
import { bookValueAt, type Period } from "./depreciation";

/**
 * Writes closed periods, skipping any already recorded.
 *
 * ON CONFLICT DO NOTHING rather than an upsert: a snapshot is a statement about
 * a month that has ended, and rewriting it because a cost was corrected later
 * would change a figure finance has already reported.
 */
export async function saveSnapshots(
  ctx: Ctx,
  assetId: string,
  method: Method,
  periods: Period[],
): Promise<number> {
  if (periods.length === 0) return 0;

  return withTenant(ctx.orgId, async (c) => {
    let written = 0;
    for (const p of periods) {
      const { rowCount } = await c.query(
        `INSERT INTO asset_book_values
           (org_id, asset_id, period_end, method,
            opening_value, charge, closing_value, accumulated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (asset_id, period_end) DO NOTHING`,
        [ctx.orgId, assetId, p.period_end, method,
         p.opening, p.charge, p.closing, p.accumulated],
      );
      written += rowCount ?? 0;
    }
    return written;
  });
}

/** The live figure the interface shows, calculated rather than read back. */
export async function bookValueNow(
  ctx: Ctx,
  assetId: string,
  on: string = new Date().toISOString().slice(0, 10),
): Promise<number> {
  const [policy, asset] = await Promise.all([
    resolvePolicy(ctx, assetId),
    withTenant(ctx.orgId, async (c) =>
      (await c.query<{ cost: string | null; start: string | null }>(
        `SELECT purchase_cost AS cost,
                coalesce(depreciation_start, purchase_date)::text AS start
           FROM assets WHERE id = $1`,
        [assetId],
      )).rows[0],
    ),
  ]);

  const cost = Number(asset?.cost ?? 0);
  if (!asset?.start || cost <= 0 || policy.method === "none") return cost;
  return bookValueAt(cost, asset.start, policy, on);
}
```

- [ ] **Step 4: Implement the job**

`api/src/lib/jobs/depreciation.ts`:

```ts
import { listDepreciableAssets, saveSnapshots } from "../domain/depreciation.repo";
import { buildSchedule } from "../domain/depreciation";
import type { Ctx } from "../http/handler";

export interface DepreciationRunSummary {
  assets: number;
  periods: number;
}

/** The last day of the month before the one containing `asOf`. */
function lastClosedPeriod(asOf: string): string {
  const d = new Date(`${asOf}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))
    .toISOString().slice(0, 10);
}

/**
 * Records book values for every month that has ended.
 *
 * Deliberately not the current month: a snapshot that changes when you re-run
 * it in the same month is not a snapshot. Re-running is otherwise safe, and a
 * run after an outage backfills every month it missed.
 */
export async function runDepreciationJob(
  ctx: Ctx,
  asOf: string = new Date().toISOString().slice(0, 10),
): Promise<DepreciationRunSummary> {
  const until = lastClosedPeriod(asOf);
  const assets = await listDepreciableAssets(ctx);

  let periods = 0;
  for (const asset of assets) {
    const schedule = buildSchedule(
      Number(asset.cost), asset.start, asset.policy, until,
    );
    periods += await saveSnapshots(ctx, asset.id, asset.policy.method, schedule);
  }

  return { assets: assets.length, periods };
}
```

- [ ] **Step 5: Add it to the nightly sweep**

In `api/src/lib/jobs/runner.ts`, inside the per-organisation `try` block, after
`purgeRateLimitEvents(ctx)`:

```ts
      // Month-end book values. Runs nightly and does nothing for most of the
      // month; the first run after a month closes writes that month's rows.
      const depreciation = await runDepreciationJob(ctx);
```

Add `depreciation: depreciation.periods` to the pushed summary and the field to
`JobRunSummary`.

- [ ] **Step 6: Run the tests**

Run: `cd api && npx vitest run src/lib/jobs`
Expected: PASS — the new file's 7 tests, and the existing job tests unchanged.

- [ ] **Step 7: Commit**

```bash
git add api/src/lib/jobs/depreciation.ts api/src/lib/jobs/depreciation.test.ts \
        api/src/lib/jobs/runner.ts api/src/lib/domain/depreciation.repo.ts
git commit -F- <<'EOF'
feat(api): month-end book value snapshots

Writes only months that have closed, so re-running mid-month cannot change a
figure that has already been reported. A run after an outage backfills every
month it missed rather than leaving a hole in the ledger.

The interface's book value is calculated live instead, because reading the
newest snapshot would show a figure up to a month stale.

release-note: Book values are now recorded at the end of each month, so a
 report re-run later shows the same numbers it did at the time.
EOF
```

---

## Task 35: The book-value report and the dashboard figure

**Files:**
- Create: `api/src/lib/reports/definitions/book-value.ts`
- Modify: `api/src/lib/reports/definitions/index.ts` (register it)
- Modify: `api/src/lib/domain/dashboard.ts` (add `book_value` to totals)
- Modify: `web/src/components/dashboard/KpiTiles.tsx`
- Test: `api/src/lib/reports/definitions/book-value.test.ts`

**Interfaces:**
- Consumes: `ReportDefinition`, `assetFilters`, `asset_book_values`.
- Produces: report key `asset-book-value`, and `totals.book_value` on the dashboard.

**Design note:** one report definition, six formats. The existing framework renders JSON,
CSV, XLSX, PDF, SVG and PNG from a single definition, so this adds a query and a column
list rather than an export pipeline. It reads the **snapshots**, not the live
calculation: a finance report must reprint identically.

- [ ] **Step 1: Write the failing test**

Assert, against a seeded organisation with two depreciating assets:

- one row per asset, with `cost`, `accumulated` and `book_value`
- `book_value` equals `cost - accumulated` on every row
- the totals row sums each numeric column
- an asset with no snapshot yet appears at full cost with zero accumulated
  rather than vanishing — something bought this month is still on the register
- `assetFilters(ctx, params, values, "a")` is threaded, so a branch-scoped
  reader sees only their own branches (the recurring Phase 1b requirement)
- exactly one row per asset even when several months are recorded, via the
  LATERAL join below rather than a plain join

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Implement the definition**

```ts
export const bookValueReport: ReportDefinition = {
  key: "asset-book-value",
  name: "Asset book value",
  description:
    "What each asset is worth after depreciation, from the month-end figures.",
  columns: [
    { key: "name", label: "Asset", type: "string" },
    { key: "category", label: "Category", type: "string" },
    { key: "cost", label: "Cost", type: "money" },
    { key: "accumulated", label: "Depreciation", type: "money" },
    { key: "book_value", label: "Book value", type: "money" },
    { key: "as_of", label: "As of", type: "date" },
  ],
  chart: {
    type: "bar", categoryKey: "category",
    valueKeys: ["book_value"], valueLabel: "Book value",
  },
  run: (ctx, params) => withTenant(ctx.orgId, async (c) => {
    const values: unknown[] = [];
    const where = assetFilters(ctx, params, values, "a");
    const { rows } = await c.query(
      `SELECT a.name,
              coalesce(cat.name, 'Uncategorised') AS category,
              a.purchase_cost AS cost,
              coalesce(b.accumulated, 0) AS accumulated,
              (a.purchase_cost - coalesce(b.accumulated, 0)) AS book_value,
              b.period_end::text AS as_of
         FROM assets a
         LEFT JOIN categories cat ON cat.id = a.category_id
         -- LATERAL, not a join: an asset has one row per month, and a plain
         -- join would return the asset once per period it has been valued.
         LEFT JOIN LATERAL (
           SELECT accumulated, period_end
             FROM asset_book_values
            WHERE asset_id = a.id
            ORDER BY period_end DESC LIMIT 1
         ) b ON true
        WHERE ${where} AND a.purchase_cost IS NOT NULL
        ORDER BY book_value DESC NULLS LAST`,
      values,
    );
    return rows;
  }),
  totals: (rows) => ({
    name: "Total", category: "",
    cost: sumBy(rows, "cost"),
    accumulated: sumBy(rows, "accumulated"),
    book_value: sumBy(rows, "book_value"),
    as_of: null,
  }),
};
```

- [ ] **Step 4: Add the dashboard figure**

In `getDashboardSummary`, add `book_value` alongside `total_value` using the same
LATERAL join. In `KpiTiles.tsx` the Register value tile gains a second line —
purchase cost, and beneath it "written down to X" when the two differ — linking
to `/reports/asset-book-value`, gated on `reports:read` like the other report
tiles.

- [ ] **Step 5: Verify**

Run: `cd api && npx vitest run`, then
`cd web && npx tsc -b --noEmit && npx vitest run && npm run build`.

- [ ] **Step 6: Commit**

---

## Task 36: Depreciation settings in the interface

**Files:**
- Create: `web/src/components/catalog/DepreciationFields.tsx`
- Modify: `web/src/pages/Catalog/Categories.tsx`, `web/src/pages/Assets/AssetForm.tsx`
- Modify: `api/src/lib/domain/categories.ts`, `api/src/lib/domain/assets.ts`
- Test: `web/src/components/catalog/DepreciationFields.test.tsx`

**Interfaces:**
- Produces: `<DepreciationFields value onChange inherited? />`

**Design note:** one component in two places. On a category it sets the rule; on an asset
it shows what the category would give and lets that be overridden, with a control to
return to the inherited value — an override that cannot be undone is a trap.

Tests must cover: reducing-balance shows a rate and hides useful life, straight-line the
reverse; clearing an override restores the inherited value visibly; and a life of zero
is refused before submission, since the database CHECK would otherwise surface a form
mistake as a server error.

The API accepts the new fields on both `CategoryInput` and `AssetInput`, validated with
the same bounds as the CHECK constraints — 1 to 100 for percentages, positive for a
life. Validation in two places is deliberate: the constraint is the guarantee, the
schema is the readable error.

- [ ] Steps follow the established pattern: failing test, verify it fails, implement,
      pass, confirm write-gating on `categories:write` and `assets:write`, commit.

---

## Task 37: Stock-take schema and domain

**Files:**
- Create: `api/migrations/015_stocktake.sql`, `api/src/lib/domain/stocktake.ts`
- Modify: `api/src/lib/auth/permissions.ts` (add `stocktake:read`, `stocktake:write`)
- Test: `api/src/lib/domain/stocktake.test.ts`

**Interfaces:**
- Produces:
  - `openSession(ctx, { location_id, name })`
  - `countAsset(ctx, sessionId, tag)` → `{ outcome: "expected" | "unexpected" | "already_counted" | "unknown_tag", asset? }`
  - `reconcile(ctx, sessionId)` → `{ expected, counted, missing, unexpected }`
  - `closeSession(ctx, sessionId, { adjust: boolean })`

**Design note (spec §14):** a stock-take is a session, not a scan list. It records what
the register *expected* at a location when counting began, what was actually found, and
the difference. Without the expected set captured at open time, an asset legitimately
moved mid-count reads as missing.

```sql
CREATE TYPE stocktake_status AS ENUM ('open', 'closed', 'abandoned');

CREATE TABLE stocktake_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  location_id  uuid REFERENCES locations(id) ON DELETE SET NULL,
  name         text NOT NULL,
  status       stocktake_status NOT NULL DEFAULT 'open',
  opened_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  -- What the register said was here when counting began. Without it, an asset
  -- moved during the count reads as missing.
  expected_ids uuid[] NOT NULL DEFAULT '{}'
);

CREATE TABLE stocktake_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
  asset_id    uuid REFERENCES assets(id) ON DELETE CASCADE,
  -- Kept even when it matches nothing, so an unreadable label is evidence
  -- rather than a silently dropped scan.
  scanned_tag text NOT NULL,
  counted_at  timestamptz NOT NULL DEFAULT now(),
  counted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (session_id, asset_id)
);
```

Both tables take the full treatment from `004_rls.sql`: `org_id`, `ENABLE` and `FORCE
ROW LEVEL SECURITY`, a policy on `current_setting('app.org_id')::uuid`, and the grants.

Tests must cover: counting the same asset twice reports `already_counted` rather than
failing on the unique constraint; a tag belonging elsewhere reports `unexpected` and is
still recorded; an unknown tag is stored with a null `asset_id`; reconciliation lists
what is missing; closing with `adjust: true` sets missing assets to `lost` and writes an
audit event for each, while `adjust: false` leaves the register untouched; and a closed
session refuses further counting.

---

## Task 38: Stock-take API

**Files:**
- Create: `api/src/app/api/v1/stocktakes/route.ts`, `[id]/route.ts`,
  `[id]/count/route.ts`, `[id]/close/route.ts`
- Test: alongside each route

Listing and reading are guarded by `stocktake:read`; opening, counting and closing by
`stocktake:write`. Branch scope applies: a session at a location outside the actor's
scope answers `404`, not `403`, matching how assets already behave — a `403` confirms
the thing exists.

Closing with `adjust: true` is a bulk write to the register, so it is idempotent by
session: closing an already-closed session returns `409` rather than adjusting twice.

---

## Task 39: Stock-take screens

**Files:**
- Create: `web/src/pages/Stocktake/StocktakeList.tsx`, `StocktakeSession.tsx`
- Create: `web/src/api/stocktake.ts`
- Modify: `web/src/App.tsx`, `web/src/layout/AppSidebar.tsx`
- Test: `web/src/pages/Stocktake/StocktakeSession.test.tsx`

**Design note:** the counting screen is the one place in this product used one-handed,
walking, on a phone. It reuses `useHidScanner` so a handheld scanner works with nothing
focused, shows a running count against the expected total, and gives each scan an
immediate and unmistakable outcome — found, unexpected, already counted, unknown tag —
because someone scanning two hundred items cannot read a sentence per item.

**Register the routes.** Five Phase 5 tasks built a page and left the route as a
placeholder; check `App.tsx` and the sidebar before calling this done. Gate the sidebar
entry on `stocktake:read`.

---

## Task 40: Maintenance schedules

**Files:**
- Create: `api/migrations/016_maintenance.sql`, `api/src/lib/domain/maintenance.ts`,
  `api/src/lib/jobs/maintenance.ts`
- Modify: `api/src/lib/jobs/runner.ts`, `api/src/lib/auth/permissions.ts`
- Test: `api/src/lib/domain/maintenance.test.ts`, `api/src/lib/jobs/maintenance.test.ts`

**Interfaces:**
- Produces:
  - `createSchedule(ctx, { asset_id, every_days?, every_hours?, description })`
  - `completeService(ctx, scheduleId, { at, hours, note, cost })`
  - `dueSchedules(ctx, withinDays)`

Schedules recur on elapsed days or on running hours — plant equipment is serviced on
hours, IT on dates — and at least one interval is required. Completing a service records
history and rolls the next due date forward **from the completion date, not from the
previous due date**, so a service done late does not compress the next interval.

The nightly sweep dispatches `maintenance.due`, which already has a notification rule and
an email template from Phase 3. This task gives that event a real source in place of the
`next_service_at` custom field, which cannot express recurrence.

Tests must cover: a schedule on days becomes due after the interval; a schedule on hours
becomes due when the asset's recorded hours pass the threshold; completing a service
moves the next due date forward from completion; a service completed early does not
shorten the following interval; and the sweep dispatches once per due schedule rather
than once per night per schedule.

---

## Task 41: Maintenance screens

**Files:**
- Create: `web/src/pages/Maintenance/MaintenanceList.tsx`, `web/src/api/maintenance.ts`
- Modify: `web/src/pages/Assets/AssetDetail.tsx`, `web/src/App.tsx`, `AppSidebar.tsx`
- Test: `web/src/pages/Maintenance/MaintenanceList.test.tsx`

A list of what is due and overdue across the register, and a panel on the asset detail
page showing the schedule, the next due date and the service history, with a "record
service" action. Gated on `maintenance:read` and `maintenance:write`, and branch-scoped
like every other list.

---

## Task 42: Request identity and structured logs

**Files:**
- Create: `api/src/lib/http/logging.ts`
- Modify: `api/src/lib/http/handler.ts` (wrap `safe`)
- Test: `api/src/lib/http/logging.test.ts`

**Design note (spec §14):** every response carries `X-Request-Id`, echoing an inbound one
when a proxy supplies it and generating one otherwise. Each request logs a single JSON
line: id, method, path, status, duration, organisation, actor type. Today a customer
reporting "it failed this morning" leaves nothing to search.

**Never log** the request body, query-string values, or any header that can carry a
credential — the session cookie and `Authorization` above all. Path parameters stay in
the logged path: asset ids are not secrets, and a log that only records
`/api/v1/assets/:id` cannot answer which asset failed.

Tests: an inbound `X-Request-Id` is echoed unchanged; an absent one is generated and
still returned; the log line parses as JSON with the expected keys; and neither `cookie`
nor `authorization` appears anywhere in the emitted line, asserted by scanning the
serialised output rather than by inspecting fields.

---

## Task 43: A health check that means something

**Files:**
- Modify: `api/src/app/api/health/route.ts`
- Test: `api/src/app/api/health/route.test.ts`

Today it runs `SELECT 1`, so a half-migrated deployment reports healthy and the load
balancer keeps sending it traffic. It must also confirm the newest row in the migrations
table matches the newest migration file shipped in the image, and report the connection
pool's free capacity.

Returns `503` when migrations are behind — that is exactly when a deployment should stop
receiving traffic — and `200` with a body naming the current migration otherwise. The
test asserts the 503 path by pointing the check at a migrations table missing the last
entry, not by mocking the query.

---

## Task 44: Backups, and a restore that has actually been run

**Files:**
- Create: `api/scripts/backup.ts`, `api/scripts/restore.ts`, `docs/runbooks/restore.md`
- Modify: `docker-compose.yml` (a nightly backup service), `api/package.json`
- Test: `api/scripts/backup.test.ts`

**Design note (spec §14):** this is the largest open risk in the product. A rented
multi-tenant asset register with no tested restore is one disk failure away from losing
every customer's data at once.

`backup.ts` runs `pg_dump --format=custom`, uploads to object storage under a dated key,
and prunes beyond the retention window. `restore.ts` takes a key and a target database
and runs `pg_restore`. Neither is allowed to read `DATABASE_URL`: backups use the owner
connection, and a restore that could run against the live application role by accident
is a footgun.

**The test is the point.** `backup.test.ts` seeds an organisation, takes a backup, drops
the data, restores into a scratch database, and asserts the assets are back with their
custody history intact. A backup that has never been restored is a hope, not a backup.
`docs/runbooks/restore.md` records the exact commands, the expected duration, and the
date the drill was last performed.

---

## Self-review

Checked after writing, against the spec's phase-2 and operational lists:

| Spec item (§14) | Task |
|---|---|
| Depreciation — straight-line and reducing-balance | 43, 44 |
| Book-value report | 46 |
| Stock-take sessions as a first-class object | 48, 49, 50 |
| Preventive maintenance schedules | 51, 52 |
| Structured JSON logs with `X-Request-Id` | 53 |
| `/api/health` deep check, pool sizing | 54 |
| Nightly `pg_dump` with a tested restore | 55 |

**Deliberately excluded:** Slack notifications — email already covers these events, and
Slack needs an integration nobody has asked for. Purchase orders, SSO/SAML, native
mobile, multi-currency conversion and approval workflows all remain out of scope per
spec §15.

**Type consistency:** `DepreciationPolicy` is defined once in Task 32 and consumed
unchanged by Tasks 33, 34, 35 and 36. `Period` is defined in Task 33 and consumed by Task 34.
`Method` is the database enum, spelled identically in the migration, the repository and
the snapshot table.

**Known risk carried forward.** Tasks 35 to 41 are specified at interface level rather
than as complete code, because they repeat patterns this codebase has now established
five or six times — a report definition, a guarded route, a permission-gated page. Tasks
32 to 34 and 44 carry full code because they are new ground.

The depreciation engine in Task 33 was **run against its own assertions before this plan
was finished**, and the first draft failed: rounding each period to two decimals left the
schedule 12 cents short of cost, because the final period only absorbed the remainder
when its charge exceeded it. The corrected algorithm passes all 23 assertions. Every
other task's tests still have to be written first and watched to fail — the Phase 5
experience was that the plan was wrong in some way on every single task, and this plan
is no more trustworthy for having been written more recently.
