# Assets Management System — Specification

**Date:** 2026-09-03
**Status:** Approved for planning
**Plan:** `docs/superpowers/plans/2026-09-03-ams/` — one file per phase, start at `00-overview.md`

---

## 1. Product summary

A multi-tenant asset management system that tracks three families of assets in one
registry — IT assets, physical equipment/plant inventory, and digital media — with a
public REST API so client organizations can integrate their own systems.

The differentiator is **one registry, three domains**. Most tools force a choice: an
IT-only CMDB, or a plant-only CMMS, or a DAM. Organizations run all three and end up
with three spreadsheets. A shared core (identity, status, custody, location, audit)
with per-category field schemas covers all three without three products.

---

## 2. Decisions taken (2026-09-03)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Architecture | Vite SPA (`web`) + Next.js API-only (`api`) + Postgres (`db`), three Docker services | The supplied TailAdmin template is Vite/React-Router; keeping it intact avoids a port. An API-only Next.js service makes the public API first-class rather than a side door off a UI app. |
| 2 | Tenancy | Multi-tenant from day one; `org_id` on every table, enforced by Postgres Row-Level Security | Retrofitting tenancy is a rewrite. RLS makes isolation a database guarantee, not an application convention — a missing `WHERE org_id` cannot leak data. |
| 3 | Asset model | Core columns + per-category JSONB `custom` field, GIN-indexed, schema-validated server-side | The three domains share ~12 fields and diverge on ~10 each. JSONB lets a client add "Refrigerant Type" without a migration; server-side schema validation keeps the data honest. |
| 4 | Auth | httpOnly session cookies for the SPA; hashed, scoped, rate-limited API keys for the public API | No third-party dependency, works fully offline in Docker, and API keys are what integrators actually expect for server-to-server. |

---

## 3. Personas and use cases

### Persona A — IT Asset Manager (Rina, 400-seat company)
- **UC-A1 Onboard a laptop.** Receives 30 laptops, imports the vendor's CSV, maps
  columns once, dry-runs to catch 3 duplicate serials, commits. 27 assets created.
- **UC-A2 Issue to a new hire.** Searches serial, checks out to the employee with an
  expected return date. Asset status flips `available → in_use`.
- **UC-A3 Offboarding.** Filters `assignee = leaver`, sees 4 assets, checks each back
  in with a condition note.
- **UC-A4 Warranty sweep.** Report "warranty expiring in 90 days" reads
  `custom->>'warranty_end'`.
- **UC-A5 Integration.** The HR system calls `POST /api/v1/assets/{id}/checkin` via API
  key when an employee is terminated.

### Persona B — Plant/Maintenance Supervisor (Budi, manufacturing site)
- **UC-B1 Register a generator.** Category `Plant Equipment`, custom fields
  `hours_run`, `next_service_at`, `manufacturer`.
- **UC-B2 Move between sites.** Reassigns location; audit trail records who, when, from,
  to.
- **UC-B3 Maintenance note.** Logs a note against the asset; it appears in the history
  timeline with the author.
- **UC-B4 Downtime view.** Dashboard tile "assets in maintenance" with drill-through.
- **UC-B5 Telemetry integration.** SCADA pushes `hours_run` nightly via
  `PATCH /api/v1/assets/{id}`.

### Persona C — Media/Brand Librarian (Sari, agency)
- **UC-C1 Register a licensed video.** Custom fields `file_uri`, `license_expiry`,
  `rights_holder`.
- **UC-C2 Loan to a client.** Checks out to an external party with a return date.
- **UC-C3 License expiry alert.** Report "licenses expiring this month".

### Persona D — Integrator / Client Developer
- **UC-D1** Mints a scoped API key (`assets:read`) in the dashboard.
- **UC-D2** Reads the OpenAPI document at `/api/v1/openapi.json` and generates a client.
- **UC-D3** Paginates the full asset list with cursor-free `page`/`per_page` and a stable
  `sort`.
- **UC-D4** Subscribes a webhook to `asset.checked_out` so their ticketing system reacts
  in real time instead of polling.
- **UC-D5** Receives `429` with `Retry-After` when exceeding 1000 req/hr and backs off.

### Persona E — Auditor / Finance
- **UC-E1** Exports the full register to Excel at quarter end.
- **UC-E2** Reads an asset's complete chronological history — every status change,
  custody change and field edit, with actor and timestamp.
- **UC-E3** Report "assets by category and status" for depreciation input.

---

## 4. Domain model

### 4.1 Entities

```
organizations (id, name, slug, created_at)
users         (id, org_id, email, password_hash, name, role, created_at)
sessions      (id, org_id, user_id, expires_at)
api_keys      (id, org_id, name, prefix, key_hash, scopes[], last_used_at, revoked_at)
locations     (id, org_id, name, parent_id, address)        -- self-referencing tree
categories    (id, org_id, name, kind, field_schema jsonb)  -- kind: it|equipment|media
assets        (id, org_id, asset_tag, name, category_id, serial_no, status,
               location_id, assignee_id, purchase_date, purchase_cost, currency,
               custom jsonb, created_at, updated_at, deleted_at)
assignments   (id, org_id, asset_id, assignee_type, assignee_id, location_id,
               checked_out_at, checked_out_by, due_at, checked_in_at, checked_in_by,
               checkout_note, checkin_note, condition)
audit_events  (id, org_id, asset_id, actor_type, actor_id, event, changes jsonb,
               note, created_at)
webhooks      (id, org_id, url, secret, events[], active)
import_jobs   (id, org_id, filename, status, total, created, updated, errors jsonb)
attachments   (id, org_id, asset_id, assignment_id, kind, object_key, filename,
               content_type, size_bytes, uploaded_by)

-- Email & notifications (§9)
email_providers      (id, org_id, name, type, from_email, from_name, reply_to,
                      priority, active, config jsonb /* secrets encrypted */,
                      verified_at, last_error)
email_templates      (id, org_id, key, subject, html_body, text_body)
email_messages       (id, org_id, provider_id, to_addresses[], cc[], subject,
                      html_body, text_body, attachments jsonb, template_key,
                      status, attempts, last_error, scheduled_for, sent_at)
notification_rules   (id, org_id, event, channel, template_key,
                      recipient_spec jsonb, active)
notification_prefs   (user_id, event, email_enabled)

-- Reporting (§8)
saved_reports    (id, org_id, name, report_key, params jsonb, created_by)
report_schedules (id, org_id, saved_report_id, format, cadence, day_of_week,
                  day_of_month, hour_utc, recipients jsonb, active, last_run_at)

-- Rental-ready, unused in MVP (§12)
parties      (id, org_id, kind, relation, name, email, phone,
              billing_address, tax_id)
reservations (id, org_id, asset_id, party_id, period tstzrange, state,
              assignment_id)
```

### 4.2 Asset status lifecycle

```
                ┌──────────────┐
                │  available   │◄────────────┐
                └──────┬───────┘             │
        checkout       │                     │ checkin
                       ▼                     │
                ┌──────────────┐             │
                │   in_use     │─────────────┘
                └──────┬───────┘
                       │ send to service
                       ▼
                ┌──────────────┐
                │ maintenance  │──► available
                └──────┬───────┘
                       ▼
        ┌──────────────┴───────────────┐
        ▼                              ▼
  ┌───────────┐                 ┌────────────┐
  │  retired  │                 │  lost      │
  └───────────┘                 └────────────┘
```

Terminal states (`retired`, `lost`) reject checkout. Transitions are enforced in the
service layer and every transition writes an `audit_events` row.

### 4.3 Category field schemas (seeded defaults)

| Category | kind | Custom fields |
|---|---|---|
| IT Equipment | `it` | `ip_address` (string), `mac_address` (string), `os` (string), `warranty_end` (date), `supplier` (string) |
| Plant Equipment | `equipment` | `manufacturer` (string), `model` (string), `hours_run` (number), `next_service_at` (date), `capacity` (string) |
| Digital Media | `media` | `file_uri` (string), `format` (string), `license_expiry` (date), `rights_holder` (string), `resolution` (string) |

`field_schema` shape:

```json
{
  "fields": [
    { "key": "warranty_end", "label": "Warranty End", "type": "date", "required": false },
    { "key": "hours_run", "label": "Hours Run", "type": "number", "required": false },
    { "key": "os", "label": "Operating System", "type": "enum",
      "options": ["Windows 11", "macOS", "Ubuntu"], "required": false }
  ]
}
```

Supported `type` values: `string`, `number`, `date`, `boolean`, `enum`.

### 4.4 Tenant isolation

Every tenant table has `org_id uuid not null` and:

```sql
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON assets
  USING (org_id = current_setting('app.org_id')::uuid);
```

The API opens each request's transaction with `SET LOCAL app.org_id = $1`, derived from
the session or API key. The application role is **not** the table owner, so RLS cannot be
bypassed by a forgotten predicate.

---

## 5. Public API

Base: `https://<host>/api/v1`. Auth: `Authorization: Bearer ams_live_<random>`.
The SPA uses the same handlers under `/api/admin/*` with cookie auth.

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/assets` | `assets:read` | List + search + filter + paginate |
| POST | `/assets` | `assets:write` | Create |
| GET | `/assets/{id}` | `assets:read` | Read one |
| PATCH | `/assets/{id}` | `assets:write` | Partial update |
| DELETE | `/assets/{id}` | `assets:write` | Soft delete |
| POST | `/assets/{id}/checkout` | `assets:write` | Assign to user or location |
| POST | `/assets/{id}/checkin` | `assets:write` | Return |
| POST | `/assets/{id}/notes` | `assets:write` | Maintenance note |
| GET | `/assets/{id}/history` | `assets:read` | Chronological audit trail |
| GET | `/categories` | `assets:read` | List with field schemas |
| POST | `/categories` | `admin` | Create |
| GET | `/locations` | `assets:read` | Location tree |
| GET | `/users` | `assets:read` | Assignable people |
| POST | `/imports` | `assets:write` | CSV/XLSX upload, `dry_run=true` supported |
| GET | `/imports/{id}` | `assets:read` | Import job result + per-row errors |
| GET | `/exports/assets.csv` | `assets:read` | Streaming CSV of current filter |
| GET | `/exports/assets.xlsx` | `assets:read` | Excel workbook |
| GET | `/dashboard/summary` | `assets:read` | Counts, statuses, recent activity |
| GET | `/reports/{key}` | `reports:read` | Named report, `?format=json\|csv` |
| GET/POST/DELETE | `/webhooks` | `admin` | Manage subscriptions |
| GET | `/openapi.json` | none | Machine-readable spec |

### 5.1 Conventions

- **Errors:** RFC 7807 problem+json.
  ```json
  { "type": "https://ams.dev/errors/validation",
    "title": "Validation failed", "status": 422,
    "errors": [{ "field": "serial_no", "message": "already exists" }] }
  ```
- **Pagination:** `?page=1&per_page=50` (max 200), response envelope
  `{ "data": [...], "meta": { "page", "per_page", "total", "total_pages" } }`.
- **Sorting:** `?sort=-created_at` (leading `-` = descending), allowlisted columns only.
- **Idempotency:** `POST` accepts `Idempotency-Key`; a repeat within 24h returns the
  original response instead of creating a duplicate.
- **Rate limiting:** 1000 req/hour per key, sliding window in Postgres.
  Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`; `429` +
  `Retry-After` on breach.
- **Versioning:** path-versioned (`/v1`). Additive changes only within a version.
- **Webhooks:** POST with `X-AMS-Signature: sha256=<hmac>` over the raw body; retried
  with exponential backoff 3 times.

---

## 6. Frontend

Built on the supplied TailAdmin template (`Dashboard Template/`), reusing:

| Template asset | Reused for |
|---|---|
| `layout/AppLayout`, `AppSidebar`, `AppHeader` | App shell, nav rewritten for AMS |
| `components/ui/table` | Asset register table |
| `components/ui/badge` | Status pills (`available`=success, `in_use`=info, `maintenance`=warning, `retired`/`lost`=error) |
| `components/ui/modal` + `hooks/useModal` | Check-out / check-in dialogs |
| `components/form/*` (Input, Select, MultiSelect, date-picker, Label) | Asset form, filters |
| `components/common/ComponentCard`, `PageBreadCrumb`, `PageMeta` | Page chrome |
| `components/ecommerce/EcommerceMetrics` | Pattern for the KPI tiles |
| `react-apexcharts` | Dashboard charts |
| `react-dropzone` | Import upload |
| `context/ThemeContext`, `SidebarContext` | Kept as-is |

Removed: ecommerce demo pages, Calendar, UiElements showcase, Charts demo pages, jvectormap, swiper, fullcalendar, react-dnd.

### Routes

```
/                     Dashboard
/assets               Register (search, filters, table, bulk actions)
/assets/new           Create
/assets/:id           Detail — overview | history | assignments tabs
/assets/:id/edit      Edit
/categories           Categories + custom field schema editor
/locations            Location tree
/import               Upload → column map → dry-run preview → commit
/reports              Report gallery + export
/settings/api-keys    Mint / revoke keys, view usage
/settings/webhooks    Subscriptions
/signin               Auth (template page, wired to real API)
```

---

## 7. QR code & barcode

Every asset carries a unique-per-org `asset_tag` (default format `AMS-000123`, editable).
That tag is the payload for both symbologies, so a printed label works with a phone
camera and with a warehouse scanner.

### 7.1 Symbologies

| Use | Symbology | Payload | Why |
|---|---|---|---|
| Phone / camera scan | QR (`qrcode`) | `https://<host>/a/<asset_tag>` | A deep link — anyone scanning with a plain phone camera lands on the asset page, no app needed. Signed-out scanners get the sign-in page and are returned after login. |
| Warehouse / USB scanner | Code 128 (`code128`) | `<asset_tag>` | Bare tag: a HID scanner types it into the focused field exactly as a human would. |

Generated server-side with **bwip-js** (pure JS, no native dependencies, supports both).

### 7.2 Endpoints

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/assets/{id}/label.png?symbology=qr\|code128&scale=3` | `assets:read` | Single label image |
| GET | `/assets/{id}/label.svg?symbology=qr\|code128` | `assets:read` | Vector, for print |
| POST | `/labels/sheet` | `assets:read` | Body `{ asset_ids[], symbology, template }` → print-ready HTML label sheet |
| GET | `/assets/lookup?tag=AMS-000123` | `assets:read` | Resolve a scanned tag to an asset — the endpoint every scanner flow calls |

`/a/<asset_tag>` is an SPA route that calls `lookup` and redirects to `/assets/:id`.

### 7.3 Scanning in the UI

Two input paths, both landing on the same handler:

1. **Camera scan** — `@zxing/browser` `BrowserMultiFormatReader` bound to a `<video>` in a
   modal. Reads QR and Code 128. Requires HTTPS or localhost.
2. **HID scanner** — a hardware barcode scanner is a keyboard. A global listener detects
   the signature burst (>3 characters arriving <50 ms apart, terminated by `Enter`) and
   routes the payload to lookup without any field being focused. This is what warehouse
   and plant staff will actually use, and it needs no permissions.

Scan is available in three contexts: global (jump to asset), check-out flow (scan asset,
then scan or pick assignee), and stock-take (scan a run of assets, each one marked seen,
then reconcile against the expected register for that location).

### 7.4 Label templates

Print sheets render as HTML with `@page` CSS at exact physical sizes:
Avery 5160 (30-up, 2.625"×1"), Avery 5163 (10-up, 4"×2"), and a 50 mm × 25 mm thermal
label for Zebra/Brother direct-print. Each label shows the symbol, the asset tag, the
asset name (truncated) and the org name.

---

## 8. Reporting

### 8.1 Report catalogue (MVP)

| Key | Report | Shape | Default visual |
|---|---|---|---|
| `assets-by-status` | Count and value by status | grouped | donut |
| `assets-by-category` | Count and value by category | grouped | horizontal bar |
| `assets-by-location` | Register per site, with sub-totals | grouped | horizontal bar |
| `assignments-active` | Everything currently checked out, with age and overdue flag | tabular | table only |
| `assignments-overdue` | Past `due_at`, not returned, ordered by days late | tabular | table only |
| `expiring` | Warranty/licence expiring in N days (`?days=90`) | tabular | table + count tile |
| `utilisation` | Days in `in_use` ÷ days owned, per asset and per category | grouped | horizontal bar |
| `audit-activity` | Events per day over a window | time series | line |
| `acquisition-value` | Purchase value acquired per month | time series | column |

Every report accepts the same query parameters — `from`, `to`, `category_id`,
`location_id`, `status`, plus report-specific ones — so a filter set carries across
formats and across the UI/API boundary unchanged.

### 8.2 Output formats

One report definition, five renderings. `GET /api/v1/reports/{key}?format=…`

| `format` | Content type | Built with | Use |
|---|---|---|---|
| `json` (default) | `application/json` | — | The dashboard, and integrators |
| `csv` | `text/csv` | streamed, no library | Spreadsheet import, large exports |
| `xlsx` | `…spreadsheetml.sheet` | **exceljs** | Formatted workbook: a Summary sheet with the totals, a Data sheet with a frozen header row, auto-filter, typed columns (dates as dates, money as currency), and column widths sized to content |
| `pdf` | `application/pdf` | **pdfmake** | Print-ready: org name and logo, report title, the filter set stated in words, the chart, the table, page numbers, generated-at footer |
| `svg` / `png` | `image/svg+xml`, `image/png` | **d3-scale** + **d3-shape** → SVG, **resvg-js** → PNG | The chart alone, for embedding in someone else's deck or an email body |

**Why this toolchain:** every piece is pure JavaScript or a prebuilt binary — no
`node-canvas`, no headless Chrome, no native build step in the Docker image. Charts are
generated as SVG with d3's scale/shape primitives (which compute geometry without
touching the DOM), embedded directly into PDFs by pdfmake's SVG node, and rasterised to
PNG only when a caller explicitly asks for one.

### 8.3 Charts

Chart definitions live with the report, not the renderer, so the dashboard (ApexCharts,
client-side) and the PDF/PNG (d3 → SVG, server-side) draw the *same* chart from the same
spec: type, series, category axis, value axis, format, palette. A chart added to a report
appears in every channel at once.

Palette: one accessible categorical set shared by the SPA and the server renderer,
defined once and exported to both, so a PDF matches the screen it was printed from.

### 8.4 Saved and scheduled reports

- **Saved reports** — a name plus a report key and its filter set, per organisation.
  Appears in the report gallery and is addressable via the API.
- **Scheduled reports** — a saved report, a cadence (daily / weekly on a weekday /
  monthly on a day-of-month), a format, and a recipient list. Delivered by email as an
  attachment through the notification system in §9. This is how "the ops manager gets
  the overdue list every Monday at 8am" happens without anyone logging in.

---

## 9. Email and notifications

### 9.1 Multiple configurable providers

Email configuration is per organisation and **plural**: an organisation registers one or
more providers, each with a priority, and the sender walks them in order until one
accepts the message. A misconfigured or rate-limited primary provider degrades to a
backup instead of silently dropping notifications.

Supported provider types, all behind one `EmailProvider` interface:

| Type | Transport | Typical use |
|---|---|---|
| `smtp` | Nodemailer SMTP | Corporate Exchange/Postfix, self-hosted, or any provider's SMTP endpoint |
| `sendgrid` | REST v3 | High volume |
| `ses` | AWS SES v2 REST | Already on AWS |
| `postmark` | REST | Transactional deliverability |
| `mailgun` | REST | Regional (EU/US) routing |
| `resend` | REST | Simple modern default |

Each provider row holds: display name, type, `from_email`, `from_name`, optional
`reply_to`, priority, active flag, a `config` JSONB of type-specific settings, and
verification state. **Secrets in `config` are encrypted at rest** with AES-256-GCM under
`APP_ENCRYPTION_KEY`, and the API never returns them — reads come back with secret keys
masked (`sk_live_••••4f2a`).

Each provider has a **Send test email** action that delivers a known message and records
the outcome, so configuration is verified at setup rather than discovered broken during
an incident.

### 9.2 Outbox, not fire-and-forget

Every message is written to an `email_messages` outbox row first, then dispatched by a
worker. This gives retries with exponential backoff, a visible failure state, a
per-organisation send log for support questions ("did the overdue notice go out?"), and
protection against a provider outage losing notifications entirely. Failed sends fall
through to the next provider by priority before being marked failed.

### 9.3 Templates

Notification bodies are templates stored per organisation, seeded with sensible defaults
and editable in the UI. Each has a subject line, an HTML body and a plain-text body, and
renders with a small, safe variable substitution (`{{asset.name}}`, `{{assignee.name}}`,
`{{due_at | date}}`) — no arbitrary code execution in a template.

Seeded templates: asset assigned, asset returned, asset overdue, warranty expiring,
licence expiring, maintenance due, import completed, scheduled report, welcome / invite,
password reset.

### 9.4 Notification rules

A rule binds an **event** to **recipients** and a **template**:

| Event | Fires when | Default recipients |
|---|---|---|
| `asset.checked_out` | An asset is issued | the assignee |
| `asset.checked_in` | An asset is returned | the person who issued it |
| `asset.overdue` | Daily job finds `due_at` past | assignee + asset managers |
| `warranty.expiring` | Daily job, N days out | asset managers |
| `licence.expiring` | Daily job, N days out | asset managers |
| `maintenance.due` | Daily job on `next_service_at` | maintenance role |
| `import.completed` | An import job finishes | the user who started it |
| `report.scheduled` | A schedule fires | the schedule's recipient list |

Recipients resolve from: a role (`all admins`), specific users, the asset's assignee, or
literal addresses. Each user additionally has per-event notification preferences and a
single unsubscribe path for non-critical categories.

### 9.5 Channels beyond email

The rule engine dispatches to a channel, and email is the first channel implemented.
`webhook` (§5) is the second, sharing the same rule table. A future `slack` channel is
another row, not another system.

---

---

## 10. Documentation & enablement (final phase)

Built **after** all functional work is done and stable, so nothing documented goes stale
mid-build. Three deliverables, all shipped inside the product.

### 10.1 Developer portal — `/developers` (public, no auth)

The frontend for the public API. Client developers land here to integrate.

| Page | Content |
|---|---|
| Overview | What the API does, base URL, the three-step path to a first call |
| Authentication | Minting a key, `Bearer` header, scopes table, key rotation & revocation |
| Reference | Every endpoint from the OpenAPI document — params, request/response schemas, all error codes. Rendered from `/api/v1/openapi.json` with Scalar (`@scalar/api-reference`) so the reference can never drift from the implementation. |
| Try it | In-browser request runner: paste a key, fire a real call against the live API, see the response. Sandbox org available. |
| Recipes | Copy-paste snippets in cURL, JavaScript (fetch), Python (requests) and PHP for the eight most common flows: list assets, create, update custom fields, check out, check in, read history, bulk import, resolve a scanned tag |
| Pagination, sorting, filtering | Conventions with worked examples |
| Rate limits & idempotency | Headers, `429` handling, retry guidance with backoff code |
| Webhooks | Event catalogue, payload shapes, HMAC signature verification snippet in three languages |
| Errors | Full problem+json catalogue: every `type` URI, when it fires, how to fix it |
| Changelog | Versioning policy and dated entries |

### 10.2 In-app tutorial — dashboard user guide

For the people using the dashboard, not the API.

- **First-run guided tour.** A driver.js walkthrough that fires once per user, stepping
  through sidebar → register → filters → asset detail → check-out → scan → import.
  Dismissible, replayable from Help.
- **Per-page help.** A `?` button in each page header opens a contextual panel explaining
  that screen's controls and the concepts behind them (what a category field schema is,
  what each status means, what a dry-run import does).
- **Help centre** at `/help` — searchable articles with screenshots, organised by task:
  Getting started, Managing assets, Check-in/check-out, Scanning & labels,
  Importing & exporting, Categories & custom fields, Reports, Users & roles, API keys.
- **Empty states that teach.** Every empty table offers the next action ("Import your
  first assets" / "Create a category") rather than a blank grid.
- **Role-based onboarding checklists.** An admin's first-week checklist differs from a
  technician's.

### 10.3 Project documentation — `docs/`

`README.md` (quickstart in under five minutes), `docs/architecture.md` (services, data
flow, RLS model, diagrams), `docs/database.md` (schema reference and ERD),
`docs/deployment.md` (env vars, compose vs production, backups, migrations),
`docs/operations.md` (runbook: restore, rotate secrets, diagnose a slow query),
`docs/development.md` (local setup, test strategy, conventions),
`docs/user-guide.md` (the help-centre content as one printable document),
`CONTRIBUTING.md`, and an OpenAPI document published as a release artifact.

---

## 11. Versioning and release management

Once this is live, every change has two audiences: the team that needs to know what
shipped and be able to roll it back, and the users who need to know what changed in the
product they use every day. Both are designed in, not added later.

### 11.1 Versioning scheme

**Semantic versioning** on the product as a whole: `MAJOR.MINOR.PATCH`.

| Bump | When | Example |
|---|---|---|
| PATCH | Bug fix, no behaviour change for a correct client | `1.4.2 → 1.4.3` |
| MINOR | New feature, additive API change, new optional field | `1.4.3 → 1.5.0` |
| MAJOR | Breaking change to the public API or a required migration users must act on | `1.5.0 → 2.0.0` |

The **public API version (`/api/v1`) is independent of the product version** and moves
far more slowly. v1 only ever gains optional fields and new endpoints. A breaking change
means `/api/v2` served alongside v1, with v1 given a published deprecation window — never
a silent change to a shape an integrator already depends on.

### 11.2 Git workflow

- `main` is always deployable. Every commit on it has passed CI.
- Work happens on `feat/<slug>`, `fix/<slug>`, `chore/<slug>` branches, merged by pull
  request with at least one review and green CI.
- **Conventional Commits** are mandatory (already a global constraint) because the
  changelog is generated from them, not hand-written: `feat:` → Features, `fix:` →
  Bug fixes, `perf:` → Performance, `docs:`/`chore:`/`refactor:`/`test:` → not shown to
  users but kept in the technical changelog. A `!` suffix or `BREAKING CHANGE:` footer
  forces a MAJOR bump.
- A release is an annotated, signed git tag `v1.5.0` on `main`.
- Hotfixes branch from the release tag, not from `main`, and are cherry-picked forward.

### 11.3 What ships with a release

| Artifact | Where |
|---|---|
| Git tag `vX.Y.Z` | The repository |
| `CHANGELOG.md` | Generated from commits since the previous tag, grouped by type |
| Docker images tagged `X.Y.Z` and `latest` | Registry — never deploy `latest` to production; pin the exact version so a rollback is a redeploy of the previous tag |
| Migration head recorded | `schema_migrations` — the deployed code and schema version are checked against each other at boot |
| Release notes row | `releases` table, published to the in-app "What's new" |
| OpenAPI document | Published as a release asset so integrators can diff versions |

### 11.4 Build provenance — `GET /api/version`

Public, unauthenticated, and the first thing anyone checks when something looks wrong:

```json
{
  "version": "1.5.0",
  "git_sha": "3f9a1c2",
  "built_at": "2026-09-03T09:41:00Z",
  "api_version": "v1",
  "migration_head": "014_report_schedules.sql",
  "environment": "production"
}
```

Baked in at image build time via build args, never read from a mutable file at runtime.
The SPA displays the version in the sidebar footer, so a support conversation starts with
a known build rather than a guess.

### 11.5 User-facing release notes — "What's new"

Users of an asset system notice when a screen changes and are unsettled when nobody told
them. So releases are surfaced in the product:

- A `releases` table holds version, release date, a title, and entries typed
  `feature | improvement | fix | breaking`, each with a plain-language summary written
  for users rather than the commit subject. Entries can link to a help-centre article.
- **What's new** lives at `/whats-new` and as a panel from the sidebar. A dot marks the
  sidebar item when a user has unseen releases; `user_release_seen` records the highest
  version each user has acknowledged.
- Optionally announced by email through the notification system (§9) — a
  `product.release` event with a template, off by default per user.
- The developer portal (§10.1) carries the **API changelog**: only entries tagged as
  affecting the public API, so integrators are not made to read UI copy changes.

Writing the user-facing summary is part of the pull request, not an afterthought at
release time: a PR that changes user-visible behaviour carries a `release-note:` line in
its description, and CI fails the PR if a `feat:` or `fix:` commit has none.

### 11.6 Migrations, rollback and support windows

- Migrations are **forward-only and additive within a release**: add a column, backfill,
  start writing, and only drop the old column in a *later* release. That way the previous
  image still runs against the new schema, which is what makes a rollback a redeploy
  rather than a database restore.
- Every migration is tested against a copy of production-shaped data before release.
- A tested restore procedure is documented in `docs/operations.md` and exercised
  quarterly — an untested backup is not a backup.
- Deployment is: migrate → deploy new image → verify `/api/version` and `/api/health` →
  announce. Rollback is: redeploy the previous image tag (the schema is compatible by
  construction).

---

## 12. Global constraints

- Node.js 22 LTS; PostgreSQL 16; TypeScript 5.7 strict.
- React 19, Tailwind CSS v4, Vite 6, react-router 7 (template's existing versions — do
  not upgrade).
- Next.js 15 App Router, route handlers only, no React rendering in the `api` service.
- Everything runs via `docker compose up` with no host-installed dependencies beyond
  Docker.
- All tenant tables carry `org_id` and have RLS enabled.
- All money stored as `numeric(14,2)` with an explicit `currency` char(3).
- All timestamps `timestamptz`, stored UTC.
- Public API paths are `/api/v1/*` and never change shape within v1.
- Test-first: every task writes a failing test before implementation.

---

## 13. Rental readiness (future phase — prepared for now, not built now)

A rental/hire business is planned. Rental is not in the MVP, but four of its
requirements are **structurally expensive to retrofit**, so the MVP schema and code
accommodate them from the start. The rest is deliberately deferred.

### 13.1 What a rental system actually adds

| Concern | MVP today | Rental needs |
|---|---|---|
| Custody | One open assignment, "who has it now" | Bookings in the **future**, a calendar, availability search |
| Counterparty | `assignee` = internal user, location, or a free-text label | Real customer records with contact, billing address, credit terms |
| Money | `purchase_cost` only | Rate cards (hourly/daily/weekly/monthly), deposits, minimum hire period, late fees, tax |
| Paper | Audit trail | Quotes, hire contracts, delivery notes, invoices, payments |
| Condition | A `condition` string on check-in | Before/after inspection with photos, damage assessment, damage charges |
| Availability | `status = available` (a point in time) | "Free between 12–19 Oct" (a time range), no double-booking |

### 13.2 The four decisions taken now

**1. Assignments are already the rental primitive.** `assignments` has `due_at`,
`assignee_type: external`, `assignee_label`, `checkout_note`/`checkin_note` and
`condition`. Rental adds columns to this table rather than a parallel one. The MVP
migration therefore includes, unused but present:

```sql
CREATE TYPE assignment_kind AS ENUM ('internal', 'rental');
ALTER TABLE assignments
  ADD COLUMN kind assignment_kind NOT NULL DEFAULT 'internal',
  ADD COLUMN party_id uuid,          -- FK added when parties ships
  ADD COLUMN rate_snapshot jsonb,    -- the agreed price, frozen at booking
  ADD COLUMN charge_total numeric(14,2),
  ADD COLUMN currency char(3);
```

The MVP never writes these. Their presence means the rental phase adds a foreign key,
not a data migration of live custody records.

**2. A `parties` table from day one, not a free-text assignee.** An external assignee is
already a real thing in the MVP (UC-C2: media loaned to a client). Modelling it as a
row now — rather than a string — is the difference between "add a rate card to a
customer" and "backfill 4,000 free-text names into customer records".

```sql
CREATE TABLE parties (
  id uuid PRIMARY KEY, org_id uuid NOT NULL,
  kind text NOT NULL,            -- 'person' | 'company'
  relation text NOT NULL,        -- 'employee' | 'customer' | 'supplier'
  name text NOT NULL, email text, phone text,
  billing_address text, tax_id text, notes text
);
```

MVP uses `parties` for external assignees only; employees stay in `users`. The rental
phase adds `relation = 'customer'` rows and billing fields already present.

**3. Reservations are range-typed with a database-enforced no-double-book rule.** This is
the single most important preparation, because getting it wrong produces
double-bookings that no amount of application code reliably prevents. The MVP enables
the extension and creates the table; nothing writes to it yet.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  party_id uuid REFERENCES parties(id),
  period tstzrange NOT NULL,
  state text NOT NULL DEFAULT 'held',   -- held | confirmed | collected | returned | cancelled
  assignment_id uuid REFERENCES assignments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Two live reservations for one asset can never overlap in time.
  EXCLUDE USING gist (
    asset_id WITH =,
    period WITH &&
  ) WHERE (state IN ('held', 'confirmed', 'collected'))
);
```

Availability then becomes one query — `NOT EXISTS (overlapping reservation)` — rather
than an application-level scan.

**4. Money is range-safe and currency-explicit everywhere.** Already a global
constraint: `numeric(14,2)` plus `currency char(3)`, never a float, never an implicit
single currency. Rental pricing, deposits and invoices inherit this unchanged.

### 13.3 What rental will add later (Phase 8+, not planned here)

Rate cards (`rate_cards`, `rate_lines` keyed by asset or category with hourly/daily/
weekly/monthly tiers and a minimum period), quotes and hire contracts, deposits and
payment-gateway integration, invoicing and payments, tax rules, damage assessment with
photo evidence, delivery/collection scheduling and routing, a customer self-service
booking portal (reusing the public API with a customer-scoped token type), and
utilisation/revenue reporting per asset.

### 13.4 Things the MVP should do anyway because rental will need them

These are good for asset management on their own merits, and each is a rental
prerequisite — building them once, now, is strictly cheaper:

| Capability | Why it earns its place in the MVP | Rental payoff |
|---|---|---|
| **File attachments** (photos, receipts, manuals) via S3-compatible MinIO | Condition evidence at check-in, warranty documents, equipment manuals | Before/after inspection photos are the entire basis of a damage claim |
| **Overdue detection** on `due_at` with a daily job | "Who has kept a laptop past its return date" — a real IT problem | Late fees and collection chasing |
| **Webhooks** (already in scope) | Client integrations | Booking confirmations, payment events |
| **Utilisation metric** (days in `in_use` ÷ days owned) | Tells you which assets are idle capital | Directly the rental revenue model |

Attachments and overdue detection are therefore **added to the MVP scope** as Tasks 12
and 13.

---

## 14. Additional recommendations

Beyond the requested feature set, these materially change how good the product is.
Each is marked with when to build it.

**Build in MVP (already planned):**
- Soft delete plus an immutable audit trail — asset data is evidence; never hard-delete.
- Idempotency keys on writes — integrators retry, and a retried `POST` must not create
  a second asset.
- Dry-run imports — a bulk import that cannot be previewed will eventually destroy a
  register.
- Saved views — a filter combination a user returns to daily should be one click, not
  six dropdowns.
- Bulk actions on the register (bulk status change, bulk location move, bulk label print).

**Build in phase 2 (post-MVP, high value):**
- **Preventive maintenance schedules.** For plant equipment this is the whole point:
  service every N hours or N days, with due/overdue surfacing on the dashboard. The
  `custom.hours_run` and `custom.next_service_at` fields already carry the data.
- **Depreciation** (straight-line and reducing-balance) with a book-value report —
  finance will ask for this within a quarter of go-live.
- **Email/Slack notifications** on overdue, warranty expiry, and licence expiry.
- **Stock-take sessions** as a first-class object (start a count for a location, scan,
  reconcile, sign off) rather than an ad-hoc scan list.
- **Granular permissions** — the four roles will not survive contact with a real
  organisation; move to per-resource permissions when they break.

**Operational, do not skip:**
- Nightly `pg_dump` to object storage with a documented, *tested* restore.
- Structured JSON request logs with a request id echoed in an `X-Request-Id` header.
- A `/api/health` deep check (database, migrations current) for the load balancer.
- Database connection limits sized to the pool; a runaway import must not exhaust them.

---

## 15. Out of scope for MVP

Depreciation schedules, purchase orders and procurement, native mobile app, SSO/SAML,
email/Slack notifications, file attachments beyond a media URI, multi-currency
conversion, approval workflows, and scheduled preventive-maintenance planning. All are
natural phase-2 items and the schema leaves room for each.

Explicitly **in** scope (raised 2026-09-03): QR and barcode generation, printing and
scanning (§7); the developer portal, in-app tutorial and complete documentation (§9),
sequenced as the final phase.

---

## 16. Build sequence

The plan is split one file per phase under
`docs/superpowers/plans/2026-09-03-ams/`.

| Phase | File | Tasks | Deliverable |
|---|---|---|---|
| — | `00-overview.md` | — | Header, global constraints, file structure, task index |
| 1 — Foundation | `01-foundation.md` | 1–4 | Docker stack, schema with RLS (incl. rental-ready columns), session auth, scoped API keys |
| 2 — Core registry | `02-core-registry.md` | 5–9 | Categories with custom field schemas, asset CRUD, search/filter, check-in/out, audit trail |
| 3 — Data & delivery | `03-data-and-delivery.md` | 10–18 | Import/export, attachments, multi-provider email, notification rules, scheduled jobs, dashboard, the multi-format report engine, scheduled reports |
| 4 — Identification | `04-identification.md` | 19–20 | QR/Code128 generation, label sheets, tag lookup |
| 5 — Frontend | `05-frontend.md` | 21–32 | The full dashboard on the TailAdmin template, including scanning, report builder, email settings and "What's new" |
| 6 — Integration & release | `06-integration-and-release.md` | 33–36 | Webhooks, idempotency, OpenAPI document, versioning/CI/release pipeline |
| 7 — Docs & enablement | `07-docs-enablement.md` | 37–42 | Developer portal, in-app tour, help centre, project docs, seed data, E2E smoke suite |
| 8 — Rental (future) | not planned here | — | Built on the primitives prepared in §12 |
