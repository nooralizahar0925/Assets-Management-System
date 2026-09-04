# Assets Management System Implementation Plan — Overview

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Start here, then open the phase file for the task you are on.** The Global Constraints below are part of every task's requirements.

**Goal:** Build a multi-tenant asset management system covering IT assets, plant equipment and digital media, with QR/barcode identification, a documented public REST API, a dashboard built on the supplied TailAdmin template, and a schema prepared for a future rental business.

**Architecture:** Three Docker services — `web` (Vite + React 19 SPA, the TailAdmin template), `api` (Next.js 15 App Router, route handlers only, no React), `db` (PostgreSQL 16). Tenant isolation is enforced by Postgres Row-Level Security: every request opens a transaction that sets `app.org_id`, and the application role is not the table owner, so a forgotten `WHERE` clause cannot leak data. Assets use a shared core table plus a per-category JSONB `custom` column validated server-side against the category's field schema.

**Tech Stack:** Node 22, PostgreSQL 16, TypeScript 5.7 (strict), Next.js 15, React 19, Vite 6, react-router 7, Tailwind CSS v4, `pg`, Zod, Vitest, Playwright.
Feature libraries: bwip-js (QR/Code 128), @zxing/browser (camera scanning), papaparse (CSV), exceljs (XLSX), pdfmake (PDF), d3-scale + d3-shape + d3-array (server-side chart geometry → SVG), @resvg/resvg-js (SVG → PNG), nodemailer (SMTP), MinIO/S3 (attachments), ApexCharts (dashboard charts, already in the template), Scalar (API reference), driver.js (product tour).
Every one of these is pure JavaScript or ships a prebuilt binary — the Docker image needs no native build toolchain.

**Spec:** `docs/superpowers/specs/2026-09-03-assets-management-system.md` — read it alongside this plan. Every task argues from a numbered section of that spec.

---

## Phase files

| Phase | File | Tasks | Deliverable |
|---|---|---|---|
| 1 — Foundation | [`01-foundation.md`](./01-foundation.md) | 1–4 | Docker stack, schema with RLS, session auth, scoped API keys |
| 1b — Authorization | [`01b-authorization.md`](./01b-authorization.md) | 4a–4c | Company-defined roles over a fixed permission vocabulary, optional branch scoping |
| 2 — Core registry | [`02-core-registry.md`](./02-core-registry.md) | 5–9 | Categories with custom field schemas, asset CRUD, search/filter, check-in/out, audit trail |
| 3 — Data & delivery | [`03-data-and-delivery.md`](./03-data-and-delivery.md) | 10–18 | Import/export, attachments, multi-provider email, notification rules, scheduled jobs, dashboard, multi-format report engine, scheduled reports |
| 4 — Identification | [`04-identification.md`](./04-identification.md) | 19–20 | QR/Code128 generation, label sheets, tag lookup |
| 5 — Frontend | [`05-frontend.md`](./05-frontend.md) | 21–32 | The full dashboard on the TailAdmin template, including scanning, report builder, email settings and "What's new" |
| 6 — Integration & release | [`06-integration-and-release.md`](./06-integration-and-release.md) | 33–36 | Webhooks, idempotency, OpenAPI document, versioning and the release pipeline |
| 7 — Docs & enablement | [`07-docs-enablement.md`](./07-docs-enablement.md) | 37–42 | Developer portal, in-app tour, help centre, project docs, seed data, E2E smoke suite |

Phases run in order. Within a phase, tasks run in order. Each task ends with a
committable, independently testable deliverable.

**Phase 8 — Rental** is deliberately *not* planned here. Spec §13 records what the MVP
schema prepares for it (assignment `kind`, `parties`, range-typed `reservations` with a
no-double-book exclusion constraint, currency-explicit money) so that phase adds tables
and UI rather than migrating live data.

---

## Global Constraints

Every task's requirements implicitly include this section.

- Node.js 22 LTS. PostgreSQL 16. TypeScript 5.7, `strict: true`.
- React 19, Tailwind CSS v4, Vite 6, react-router 7 — the template's existing versions. **Do not upgrade them.**
- Next.js 15 App Router, route handlers only. No React rendering in the `api` service.
- Everything runs via `docker compose up`; no host-installed dependency beyond Docker.
- Every tenant table has `org_id uuid not null`, `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, and policy `USING (org_id = current_setting('app.org_id')::uuid) WITH CHECK (same)`.
- All database access from request handlers goes through `withTenant(orgId, fn)`. Never use the raw pool in a handler.
- Money is `numeric(14,2)` with an explicit `currency char(3)`. Never a float, never an implicit single currency.
- All timestamps are `timestamptz` stored in UTC.
- Public API lives at `/api/v1/*`; the SPA calls `/api/admin/*`. v1 request/response shapes are additive-only once published.
- Errors are RFC 7807 `application/problem+json`, built with the helpers in `lib/http/problem.ts`. Never return a bare string error.
- Asset status enum: `available | in_use | maintenance | retired | lost`.
- API scopes: `assets:read`, `assets:write`, `reports:read`, `admin`. These are the
  published v1 contract and do not change; internally each expands to permissions
  from the fixed vocabulary in `lib/auth/permissions.ts` (Phase 1b).
- Roles are tenant data a company defines for itself; permissions are code-defined
  and fixed. One role per user, optionally narrowed to specific locations.
  Authorization is always `requireAuth(req, permission, { locationId })` — never a
  role-name comparison.
- SQL is parameterised. The only values ever interpolated into a query string are `sort.column` and `sort.direction`, and only after passing through `parseSort`'s allowlist.
- Secrets at rest (email provider credentials, webhook secrets) are encrypted with AES-256-GCM under `APP_ENCRYPTION_KEY` and never returned by the API — reads come back masked.
- Every outbound email goes through the `email_messages` outbox. Nothing calls a provider SDK directly from a request handler.
- A report is defined once and rendered to JSON, CSV, XLSX, PDF and SVG/PNG by shared renderers. Never write a format-specific query.
- Test-first: every task writes a failing test, runs it to see it fail, implements, re-runs, commits.
- Commit messages use Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`) — the changelog is generated from them, so a wrong prefix is a wrong release note. A `!` suffix or `BREAKING CHANGE:` footer forces a MAJOR bump.
- Product version is SemVer and independent of the public API version. `/api/v1` is additive-only; a breaking change means `/api/v2` alongside it.
- Migrations are forward-only and additive within a release (add → backfill → switch; drop in a *later* release) so the previous image still runs against the new schema and a rollback is a redeploy.

---

## File Structure

```
AssetsManagementSystem/
├── docker-compose.yml            web + api + db + minio
├── docker-compose.test.yml       throwaway postgres on :5433 for tests
├── .env.example
├── api/
│   ├── Dockerfile
│   ├── package.json
│   ├── next.config.ts
│   ├── vitest.config.ts
│   ├── migrations/               NNN_*.sql, applied in filename order
│   ├── scripts/
│   │   ├── migrate.ts            migration runner
│   │   ├── seed.ts               demo org, categories, locations, assets
│   │   ├── jobs.ts               scheduler entrypoint (overdue, expiry, schedules)
│   │   └── changelog.ts          commits since last tag -> CHANGELOG.md + releases
│   └── src/
│       ├── app/api/
│       │   ├── health/           liveness + deep check
│       │   ├── v1/               public API (API keys or session)
│       │   └── admin/            SPA-only endpoints (session cookie)
│       ├── lib/
│       │   ├── db.ts             pool, query(), withTenant()
│       │   ├── auth/             password.ts, session.ts, apikey.ts, guard.ts
│       │   ├── http/             problem.ts, pagination.ts, handler.ts, idempotency.ts
│       │   ├── domain/           assets, assignments, audit, categories, locations,
│       │   │                     dashboard, labels, imports, attachments,
│       │   │                     webhooks, releases
│       │   ├── email/            providers/(smtp|sendgrid|ses|postmark|mailgun|
│       │   │                     resend).ts, sender.ts, templates.ts, outbox.ts
│       │   ├── notify/           rules.ts, recipients.ts, dispatch.ts
│       │   ├── reports/          definitions/, engine.ts, charts.ts,
│       │   │                     renderers/(json|csv|xlsx|pdf|svg).ts, schedules.ts
│       │   ├── crypto/           secrets.ts (AES-256-GCM encrypt/decrypt/mask)
│       │   ├── validation/       customFields.ts
│       │   └── openapi/          document.ts
│       └── test/setup.ts
└── web/                          the TailAdmin template, adapted in place
    └── src/
        ├── api/                  client.ts + one module per resource
        ├── components/
        │   ├── assets/           table, filters, form, StatusBadge, history timeline
        │   ├── scan/             ScanModal, useHidScanner, useCameraScanner
        │   ├── dashboard/        KPI tiles, charts
        │   ├── labels/           label sheet preview
        │   └── help/             tour, contextual help panel
        ├── context/              AuthContext (+ template's Theme/Sidebar)
        └── pages/                Assets, AssetDetail, Import, Reports,
                                  Categories, Locations, Settings (email providers,
                                  templates, notification rules, API keys),
                                  WhatsNew, Help, Developers
```

### Decomposition rules for this codebase

- One domain module per aggregate (`assets.ts`, `assignments.ts`), exporting Zod input
  schemas, row types, and functions taking `(ctx, ...)`. Route handlers stay thin:
  authenticate, parse, delegate, map errors to problem documents.
- Route handlers never contain SQL. Domain modules never construct a `Response`.
- Keep a file under roughly 300 lines. `assets.ts` is the one exception and is allowed
  ~400; if it grows past that, split the list/query builder into `assets.query.ts`.
- Frontend: one component per file; a page composes components and owns data fetching.

---

## Task index

| # | Task | Phase |
|---|---|---|
| 1 | Docker stack, Postgres, health-checked API | 1 |
| 2 | Database schema with row-level security | 1 |
| 3 | HTTP conventions — problem+json, pagination, guard | 1 |
| 4 | Session auth and scoped API keys | 1 |
| 4a | Permission vocabulary, roles schema, seeded system roles | 1b |
| 4b | Permission resolution, branch scope, rewritten guard | 1b |
| 4c | Role management API | 1b |
| 5 | Categories with validated custom field schemas | 2 |
| 6 | Asset creation and reads, tag generation, audit events | 2 |
| 7 | Search, filter, sort and pagination | 2 |
| 8 | Check-out and check-in with status transitions | 2 |
| 9 | Audit trail endpoint, locations, assignable users | 2 |
| 10 | CSV/Excel import with dry-run | 3 |
| 11 | File attachments on MinIO | 3 |
| 12 | Encrypted secrets and the multi-provider email sender | 3 |
| 13 | Email templates, outbox worker and provider failover | 3 |
| 14 | Notification rules and recipient resolution | 3 |
| 15 | Scheduled jobs — overdue, expiry, maintenance due | 3 |
| 16 | Dashboard aggregates | 3 |
| 17 | Report engine — definitions, JSON/CSV, chart specs | 3 |
| 18 | Report renderers — XLSX, PDF, SVG/PNG, saved & scheduled reports | 3 |
| 19 | QR and Code 128 label generation | 4 |
| 20 | Tag lookup and label sheets | 4 |
| 21 | Frontend foundation — template adaptation, API client, auth | 5 |
| 22 | Asset register page | 5 |
| 23 | Asset detail with history timeline | 5 |
| 24 | Asset create/edit form with dynamic custom fields | 5 |
| 25 | Check-out / check-in dialogs | 5 |
| 26 | Scanning — camera and HID | 5 |
| 27 | Dashboard page | 5 |
| 28 | Import wizard and export | 5 |
| 29 | Report gallery, viewer and scheduling UI | 5 |
| 30 | Settings — email providers, templates, notification rules | 5 |
| 31 | Categories, locations, users and API-key pages | 5 |
| 32 | "What's new" release-notes panel | 5 |
| 33 | Idempotency and webhooks | 6 |
| 34 | OpenAPI document | 6 |
| 35 | Version endpoint, build provenance and release-notes API | 6 |
| 36 | CI pipeline, changelog generation and the release runbook | 6 |
| 37 | Error catalogue endpoint with an anti-drift test | 7 |
| 38 | Developer portal — shell, reference, overview, auth, conventions | 7 |
| 39 | Recipes in four languages, webhooks, errors, changelog | 7 |
| 40 | First-run tour, contextual help, empty states, onboarding checklists | 7 |
| 41 | Help centre and the generated printable user guide | 7 |
| 42 | Project documentation, seed data and E2E smoke suite | 7 |
