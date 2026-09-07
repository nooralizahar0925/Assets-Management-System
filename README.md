# Assets Management System

Multi-tenant asset register: what an organisation owns, where it is, who has it,
and what it is worth. Rented to companies, so every tenant's data is isolated in
the database by row-level security rather than by application code remembering
to filter.

Full project documentation arrives with Task 42; this is the short path to a
running system.

## Getting started

You need Docker and Node 22.

```bash
docker compose up -d db minio     # Postgres and object storage
cd api
npm install
npm run migrate                   # schema, roles and the permission catalogue
npm run seed                      # an organisation you can sign in to
```

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
| `docs/superpowers/plans/` | The spec and the phase-by-phase implementation plan |
| `docs/accepted-risks.md` | Known trade-offs and why they were accepted |
| `CONTRIBUTING.md` | Branching, commit format, and how release notes are generated |

## Tests

```bash
cd api && npm test                # needs the test database: docker compose -f docker-compose.test.yml up -d
cd web && npm test
```

Both workspaces also have `npm run typecheck` and `npm run build`. All three
matter: each has caught failures the other two missed.
