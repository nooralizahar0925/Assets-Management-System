# Assets Management System

Multi-tenant asset register: what an organisation owns, where it is, who has it,
and what it is worth. Rented to companies, so every tenant's data is isolated in
the database by row-level security rather than by application code remembering
to filter.

This is the short path to a running system. The full documentation is in
[`docs/`](docs/) — see the table at the bottom.

## Getting started

You need Docker and Node 22.

```bash
cp .env.example .env              # then set APP_ENCRYPTION_KEY
cp api/.env.example api/.env      # local development only; Docker uses compose
docker compose up -d db minio     # Postgres and object storage
cd api
npm install
npm run migrate                   # schema, roles and the permission catalogue
npm run seed                      # an organisation you can sign in to
```

The database is published on **5442**, not 5432, because a machine with
PostgreSQL already installed is listening on 5432 — connections then reach that
one instead of the container, and the failure looks like a wrong password rather
than a wrong server. Change `DB_PORT` if 5442 is taken too.

The seed prints four sign-in addresses and their shared password. It is
idempotent — running it twice does nothing the second time — and it refuses to
run against `NODE_ENV=production` unless `SEED_PASSWORD` is set, so a
well-known password cannot reach a real deployment by accident.

Then start the two halves:

```bash
cd api && npm run dev             # http://localhost:4000
cd web && npm run dev             # http://localhost:5173
```

Or run everything in containers with `docker compose up --build`, which serves
the web app on <http://localhost:3000>.

Both the Vite dev server and the container's nginx proxy `/api` to the API, so
the browser only ever talks to one origin. That is deliberate: cross-origin
would need CORS on the API and would fail its CSRF origin check on every write.
`VITE_API_BASE_URL` stays empty unless the API genuinely lives on another host.

### Signing in

The seed creates one account per built-in role:

| Account | Role | What they can do |
| --- | --- | --- |
| `admin@demo.local` | Administrator | Everything, including roles, people and settings |
| `manager@demo.local` | Manager | The register, reports and scheduling; not settings |
| `technician@demo.local` | Technician | Update assets, issue and receive them, print labels |
| `viewer@demo.local` | Viewer | Read the register and run reports |

Signing in as each is the quickest way to see the authorisation model: the
interface only offers what that role's permissions actually allow, and the API
enforces the same list independently.

To confirm a seeded database really works end to end:

```bash
cd api && npm run seed:check      # signs in as all four and reads the dashboard
```

## Layout

| Path | What lives there |
| --- | --- |
| `api/` | Next.js route handlers, domain logic, migrations, background jobs |
| `web/` | React SPA (Vite, react-router, Tailwind) |
| `docs/` | Architecture, database, deployment, operations, development, the user guide |
| `docs/superpowers/plans/` | The spec and the phase-by-phase implementation plan |
| `CONTRIBUTING.md` | Branching, commit format, and how release notes are generated |

## Documentation

| Document | For |
| --- | --- |
| [Architecture](docs/architecture.md) | How the pieces fit, and how tenants are kept apart |
| [Database](docs/database.md) | Schema, the rules that hold everywhere, migrations |
| [Deployment](docs/deployment.md) | Environment variables, deploy order, rollback |
| [Operations](docs/operations.md) | Diagnosing a problem, routine work, rotating secrets |
| [Platform console](docs/platform.md) | Renting this to companies: customers, plans, limits, suspension |
| [Development](docs/development.md) | Local setup, how tests are written here, conventions |
| [User guide](docs/user-guide.md) | The in-app help centre as one printable document |
| [Accepted risks](docs/accepted-risks.md) | Known trade-offs and why they were accepted |
| [Restore runbook](docs/runbooks/restore.md) | Restoring from a backup, and the trap in it |
| [Release runbook](docs/runbooks/release.md) | Cutting and publishing a release |

## Tests

```bash
cd api && npm test                # needs the test database: docker compose -f docker-compose.test.yml up -d
cd web && npm test
```

Both workspaces also have `npm run typecheck` and `npm run build`. All three
matter: each has caught failures the other two missed.

There is also a smoke suite that drives a real browser against a running stack:

```bash
docker compose up -d --build
cd e2e && npm install && npx playwright install chromium && npm test
```

It is deliberately shallow — one path through the product. Everything it can
catch is something no unit test can: a web build pointing at the wrong API, a
cookie the browser refuses because `APP_BASE_URL` disagrees with how the page is
served, an nginx that does not proxy `/api`, a migration that did not run. Point
it at the dev servers instead with `BASE_URL=http://localhost:5173 npm test`.
