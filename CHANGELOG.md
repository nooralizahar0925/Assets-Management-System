# Changelog

All notable changes to the Assets Management System are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

From Task 36 onward this file is **generated** from Conventional Commit messages by
`npm run changelog` — do not hand-edit released sections. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for how to write a commit that produces a correct
release note.

The product version (this file) is independent of the public API version. `/api/v1` is
additive-only; a breaking API change ships as `/api/v2` alongside it.

## 1.0.0 - 2026-09-12

First release. The asset register with custody and full history, spreadsheet
import, QR and barcode labels with camera scanning, stock-takes, maintenance
schedules, depreciation, the report catalogue, a documented public `/api/v1`
with keys and signed webhooks, a searchable help centre, and the platform
console for renting the whole thing to companies.

Three changes below reached this release without a `release-note:` trailer and
are recorded here by hand, since the commits were already public by the time the
release tool pointed them out:

- **An OpenAPI 3.1 document**, generated from the running server rather than
  maintained beside it, which is what the developer portal renders.
- **A health check that fails when the schema is behind the code**, so a deploy
  that skipped its migrations says so instead of failing later and elsewhere.
- **A request id on every response and one structured log line per request**, so
  a customer quoting an id identifies their exact request in the logs.

Four further commits carry no note because they should not have been typed
`fix` at all: they changed CI and a restore drill, and no user sees them.

### Features

- **platform:** add the plan editor to the console (84f72ea)
- the console opens on what needs deciding (844851c)
- manage one customer - plan, features, limits, contract and access (79744fe)
- **web:** the platform console - sign-in, the customer list, and taking one on (cbe2fd9)
- sell features, enforce what was sold, and stop offering the rest (c5bea07)
- invite a colleague (4352583)
- **api:** hold a customer to the limits their plan sets (d276ca7)
- **api:** provision, suspend and remove a customer organisation (165d2db)
- **api:** features, plans, and what each customer is entitled to (85cfe0b)
- **api:** platform sign-in, its audit trail and the bootstrap account (28e0d10)
- **api:** the platform plane's schema, role and connection (cb1e4ec)
- close the three remaining gaps (5850704)
- project documentation, a testable seed and a smoke suite (c7242c0)
- **web:** searchable help centre and the generated user guide (7bf1e00)
- **web:** first-run tour, contextual help, empty states and onboarding (1b628ad)
- **web:** recipes in four languages, webhooks, changelog and a webhook screen (fd1124c)
- **web:** a public developer portal rendered from the live contract (f9f2093)
- **api:** an error catalogue that cannot go stale (9034f30)
- **web:** what's new panel with an unread indicator (b102501)
- **api:** version endpoint, build provenance and release notes (e22992f)
- **api:** a generated OpenAPI 3.1 document (aa066f6)
- **api:** outbound webhooks with signed, retrying delivery (10dd5d4)
- **api:** idempotent writes on asset creation and check-out (8d84107)
- **api:** backups with a restore the tests actually perform (26afe4c)
- **api:** a health check that fails when the schema is behind (748873e)
- **api:** request ids and one structured log line per request (beb56fc)
- maintenance API and screens (9d223ae)
- **api:** recurring maintenance schedules (3928125)
- **web:** stock-take screens (450ef53)
- **api:** stock-take endpoints (e1a023c)
- **api:** stock-take sessions (a3d6a4d)
- **web:** depreciation settings on categories and assets (983f791)
- **api:** accept depreciation settings on categories and assets (0934a12)
- book-value report and written-down value on the dashboard (0cdce33)
- **api:** month-end book value snapshots (c29f139)
- **api:** straight-line and reducing-balance depreciation (02c8af6)
- **api:** depreciation policy on categories and assets (1cf4ac1)
- **api:** seed an organisation you can actually sign in to (3c61668)
- **web:** roles editor for tenant-defined roles and permissions (a64ee82)
- **web:** category field editor, locations, people and API key pages (7f598fb)
- **api:** list organisation members with their email and role (34481dc)
- **web:** email provider, template and notification settings (2f65cb8)
- **web:** report gallery, viewer with charts, exports and scheduling (04c95bc)
- **web:** four-step import wizard with column mapping and dry-run preview (61aa69a)
- **web:** dashboard with clickable kpi tiles, charts and activity feed (826d16d)
- **web:** camera and hardware scanner support with tag lookup (aaab67f)
- **web:** add check-out and check-in dialogs (365eb6a)
- **web:** asset create and edit form with dynamic custom fields (8e5ce07)
- **web:** asset detail with history timeline and attachments (6dfa2ea)
- **web:** asset register with search, filters, sorting and bulk actions (fa20f58)
- **web:** frontend foundation - template adaptation, api client, auth, routing (eb05608)
- qr and code 128 labels, tag lookup and print-ready label sheets (4105452)
- scheduled report delivery, closing phase 3 (1a44c17)
- scheduled jobs for overdue, expiry and maintenance due (4e97fda)
- notification rules with capability-based recipient resolution (2724d1b)
- email templates, outbox worker and provider failover (9eb4948)
- encrypted secrets and six email provider adapters (9c11485)
- xlsx, pdf and svg/png report renderers with saved reports (3a6588a)
- report engine with nine definitions, chart specs, json and csv output (15510c4)
- dashboard summary aggregates in a single query (4c60ae9)
- file attachments on s3-compatible storage with type and size limits (c9917f2)
- csv and xlsx import with column mapping and dry-run preview (a48cfda)
- audit trail endpoint, location tree and assignable users (10b517b)
- check-out and check-in with guarded status transitions (025b649)
- asset search, filtering, sorting and pagination (7c35bda)
- asset registry with tag generation, custom fields and audit events (8b0a16f)
- categories with validated per-category custom field schemas (0090f77)
- **api:** role management endpoints (b15b0a7)
- **auth:** resolve permissions per request, with optional branch scope (261db51)
- **auth:** company-defined roles over a fixed permission vocabulary (307f77d)
- session auth for dashboard and scoped rate-limited api keys (ca75db8)
- problem+json errors, pagination and sort parsing (ea7b485)
- database schema with row-level security tenant isolation (083c379)
- docker stack with postgres and health-checked api service (58dcc80)

### Fixes

- **web:** the checklist item that could not be completed (cf0c8de)
- **web:** dates people can read, formatted in one place (744fb8b)
- **ci:** pass the seed password into the container, not just to the runner (cb73ab0)
- **ci:** give the smoke stack a seed password (5fddc52)
- the containerised deployment was broken for every deep link (ff28f83)
- the restore drill hard-coded an address only one setup could reach (5b09da9)
- **ci:** the object storage image CI used had been withdrawn (bb966b6)
- **web:** make the header search actually search (0df2d50)
- links that led nowhere, and the emails that carried them (29ef827)
- **api:** events that were subscribable and never fired (9d47025)
- serve the API under the web origin so signing in works (d42a007)
- **api:** return job_id from the import endpoint, not jobId (4d0a4bf)
- make the containerised api actually reachable (a15ef6a)
- close out the deferred phase 1 review findings (1d2e8cd)
- address phase 1 review findings (2e6046b)

### Other

- tick the plan steps that were done and never marked (57d2d6f)
- move every published port off the numbers other projects use (6fe6190)
- the platform console, and a seed that shows it doing something (70de722)
- back the Phase 9 code out of the branch, keeping the plan (63bb708)
- plan Phase 9, the platform console (a3c796d)
- the migration count moved with migration 021 (0087258)
- pipeline, changelog generation and the release runbook (aa712dc)
- renumber the plan so file order matches build order (996843f)
- plan Phase 8 — depreciation, stock-take, maintenance, operations (0397a50)
- **web:** strip the TailAdmin template from the product (0e0877f)
- **hooks:** reject a release note git will not parse as a trailer (d7772e3)
- ignore the typescript incremental build cache (0a21c87)
- record accepted risks and make the test suite run unconfigured (4ec5356)
- record phase 1b and the security fixes in the changelog (593b66f)
- plan phase 1b, company-defined roles and permissions (dad8717)
- plan phase 7, documentation and enablement (5479818)
- record phase 1 in the unreleased changelog (55a7826)
- note that git trailers must form one unbroken final block (c2c85ee)
- **repo:** establish version control conventions (d79892d)

## [Unreleased]

### Added
- Docker stack (`db`, `api`, `web`, `minio`) with a health-checked API service.
- Database schema with row-level security tenant isolation, including the
  rental-ready tables and the no-double-book exclusion constraint.
- RFC 7807 `problem+json` errors, pagination and allowlisted sort parsing.
- Session authentication for the dashboard and scoped, rate-limited API keys.
- Company-defined roles over a fixed 22-permission vocabulary, one role per
  user, with optional per-branch scoping and role management endpoints.

### Security
- Sign-in is rate limited per email and per client address, and spends the same
  time on an unknown address as a known one.
- Passwords use scrypt at OWASP's cost floor, with the parameters stored in the
  hash so they can be raised without a forced reset.
- The production image no longer ships development dependencies, and error logs
  no longer record database row contents.

[Unreleased]: https://example.invalid/ams/compare/v0.1.0...HEAD
