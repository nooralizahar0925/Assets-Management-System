# Development

## Getting a system running

You need Docker and Node 22.

```bash
cp .env.example .env              # then set APP_ENCRYPTION_KEY
docker compose up -d db minio
cd api && npm install && npm run migrate && npm run seed
cd ../web && npm install
```

Then `npm run dev` in each of `api` (port 4000) and `web` (port 5173). The seed
prints four sign-in addresses and a shared password.

The database is published on **5442**, not 5432. A machine with PostgreSQL
already installed is listening on 5432, and connections reach *that* server
instead of the container — which fails as a password error and looks like a
wrong credential rather than a wrong server. This cost an afternoon once.

## The test suites

```bash
cd api  && npm test          # 852 tests, real Postgres on 5433
cd web  && npm test          # 339 tests, jsdom
```

The API tests are **integration tests against a real database**, not mocks. RLS,
triggers, cascades and constraints are most of what this system is; a mocked
database tests none of it. The throwaway database is created by
`npm run migrate:test`.

Three commands, always, before claiming anything works:

```bash
npx tsc -b --noEmit     # types
npx vitest run          # behaviour
npm run build           # what actually ships
```

Each catches what the others miss. Read the exit code directly — piping through
`grep` hides it.

## How tests are written here

**Write the test first and watch it fail for the reason you predicted.** A test
that passes the moment it is written has proved nothing. Several times the
predicted failure was wrong and the code was fine — which is itself the finding.

**Red-green every guard.** If a test claims to stop something, break the code and
see it stop. Guards that never failed have shipped broken more than once here.

**Verify wiring through a real path.** Unit tests drive stubs and pass while
nothing calls the code. Every anti-drift guard in this repo exists because
something was tested and still not reached: the depreciation runner, the request
log, idempotency, webhooks, and the import-completed email all passed their unit
tests while unreachable.

Several tests read the source to prove documentation matches code:

| Guard | Fails when |
|---|---|
| `catalog.test.ts` | a `problem()` slug is undocumented, or documented and unreachable |
| `webhooks.events.test.ts` | a published event has no dispatch site |
| `topics.test.ts` | a route has no help topic, or a topic has no route |
| `tourSteps.test.ts` | a tour step points at an element nothing renders |
| `App.links.test.ts` | an internal link points at no route |
| `build-user-guide.test.ts` | `docs/user-guide.md` is stale |
| the RLS suite | a tenant table lacks RLS, FORCE, or a policy |

These are not ceremony. Each one was written after the thing it checks had
already gone wrong silently.

## Conventions

- **TypeScript strict**, `noUnusedLocals`. The web app targets ES2020 — no
  `Array.prototype.at`.
- **Comments explain why, not what.** If the code says what it does, the comment
  says why it does it that way, or what breaks if it changes.
- **British English** in user-facing copy.
- **Conventional Commits**, with a `release-note:` trailer on anything a customer
  would notice. If you cannot write a sentence a customer would care about, the
  type is probably wrong. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Where things live

```
api/src/app/api/…      route handlers, one file per endpoint
api/src/lib/domain/…   the actual behaviour; handlers stay thin
api/src/lib/http/…     auth guard, problem documents, idempotency, logging
api/src/lib/jobs/…     the background sweeps
api/migrations/…       numbered SQL, applied in order
web/src/pages/…        one directory per area
web/src/components/…   shared UI
web/src/content/…      help topics, articles, API recipes — data, not markup
```

A handler that contains business logic is in the wrong place: it belongs in
`domain`, where it can be tested without constructing a `Request`.

## Regenerating things

```bash
cd web && npm run docs:guide     # docs/user-guide.md from the help articles
cd api && npm run release -- --from v1.4.0   # preview the changelog
```

Both are checked by tests, so a stale generated file fails the build rather than
being noticed months later by a customer.
