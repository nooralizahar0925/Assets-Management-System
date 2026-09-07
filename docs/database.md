# The database

PostgreSQL 16. Twenty-one migrations in `api/migrations`, applied in filename order
by `npm run migrate`, each recorded in `schema_migrations` so the runner is
idempotent.

## The shape of it

```
organizations ─┬─ users ──── roles ──── role_permissions ──── permissions
               │     └────── user_location_scopes
               ├─ locations (self-referencing tree)
               ├─ categories (field_schema jsonb)
               ├─ assets ─┬─ assignments
               │          ├─ audit_events
               │          ├─ attachments
               │          ├─ asset_book_values     (depreciation snapshots)
               │          └─ maintenance_schedules ── maintenance_services
               ├─ stocktake_sessions ── stocktake_counts
               ├─ notification_rules, email_messages, email_providers
               ├─ webhooks ── webhook_deliveries
               ├─ saved_reports, report_schedules
               ├─ idempotency_keys
               └─ releases
```

`organizations` is the root of every cascade: `DELETE FROM organizations` removes
a tenant completely, which is what offboarding one means.

## Rules that hold everywhere

**Every tenant table has `org_id`**, RLS enabled *and* forced, and a policy on
`current_setting('app.org_id')::uuid`. A test walks `pg_class` and `pg_policy` to
prove it, because a table added without protection looks identical to one with
it until the day it leaks.

**Money is `numeric(14,2)`**, never a float. It arrives from the driver as a
string, and that is what the API publishes — the write side takes a number, which
is an asymmetry worth knowing and documented in the developer portal.

**Timestamps are `timestamptz`**, stored in UTC. A date with no time — a purchase
date, a warranty expiry — is a `date`, because it has no time of day anywhere in
the world.

**Nothing is hard-deleted except a tenant.** Assets carry `deleted_at` and every
query filters on it. `audit_events` has no delete path at all: it is the record
that makes the register usable as evidence.

## Custom fields

`categories.field_schema` is JSONB describing the extra fields assets in that
category carry; `assets.custom` is JSONB holding the values. Validation happens
in the domain layer against the schema, so an unknown key or a wrong type is a
422 rather than a row nobody can interpret later.

The trade is deliberate: a table per category would be typed by the database and
unusable by a customer who cannot run DDL. JSONB is checked at the edge instead,
and the check is tested.

## Migrations are additive

Add a column, backfill it, switch the code to it, and drop the old one **a
release later**. Never all four in one migration.

This is what makes a rollback survivable: redeploying the previous image runs
against the newer schema.

Migration 021 is the cycle finishing: `users.role` and the `user_role` enum were
added in 001, superseded by `role_id` in 008, written-but-never-read since, and
dropped once nothing depended on them. A column nothing reads is not harmless —
the next person to see it writes to it, and then two places disagree about what
a user is.

## Indexes worth knowing about

- `assets (org_id, asset_tag)` unique — tags are per tenant, allocated by
  sequence when not supplied.
- `assets (org_id, lower(serial_no))` — the search people actually run.
- A trigram index on `assets.name` for partial-name search.
- `users (lower(email))` unique globally, and per organisation — sign-in resolves
  an address to one account before knowing the tenant.
- `webhook_deliveries (status, next_attempt_at)` — the sweep's only query.

## Connections

| Variable | Role | Owns tables | Used by |
|---|---|---|---|
| `DATABASE_URL` | `ams_app` | no | every request |
| `MIGRATION_DATABASE_URL` | `ams` | yes | migrate, seed, backup, restore |

`ams_app` deliberately does not own the tables, so RLS applies to it. Migration
004 creates the role with no password; the runner sets it from `APP_DB_PASSWORD`,
so the credential is never a literal in a file.

## Backups

`npm run backup` uses `pg_dump` through the owner connection and writes to
object storage. **Restore is the tested half** — see
[the restore runbook](runbooks/restore.md), which documents the trap found by
running a real drill: `--no-privileges` strips the GRANTs, and a restored
database answers `SELECT 1` before failing on the first sequence.
