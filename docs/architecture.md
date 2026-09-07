# Architecture

Four processes: a Postgres database, a Next.js API, a static React application,
and MinIO for files. Nothing else is required to run the whole product.

```
   browser ──► web (nginx, static)
      │
      └──────► api (Next.js route handlers) ──► postgres
                        │
                        └──────────────────────► minio (attachments, backups)
```

The web build is static files. It holds no secrets and makes no decisions that
matter — every rule the product enforces is enforced by the API, and the UI only
decides what to *offer*. That distinction is the reason the interface can be
generous with what it shows and the API can still be strict.

## Tenant isolation

Every organisation's data lives in the same tables, separated by `org_id` and
**enforced by Postgres**, not by application code.

Each tenant table has `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`,
with a policy comparing `org_id` to `current_setting('app.org_id')::uuid`. The
application connects as `ams_app`, which does **not** own the tables, so the
policies apply to it — a table owner bypasses RLS by default, which is exactly
the trap this avoids.

Handlers never write `WHERE org_id = …`. They call:

```ts
withTenant(ctx.orgId, async (client) => { /* queries */ });
```

`withTenant` takes a connection, sets `app.org_id` for that transaction, runs the
work, and resets it. A query that forgets a tenant filter returns nothing rather
than another customer's data, because there is no filter to forget.

This is the single most important property of the system. A test walks
`pg_class` and `pg_policy` and fails the build if any tenant table is missing
RLS, its FORCE flag, or its policy — because the failure mode of this design is
silent, and a table added without protection looks exactly like one with it.

Two connections exist deliberately:

| Connection | Role | Used for |
|---|---|---|
| `DATABASE_URL` | `ams_app` | everything a request does |
| `MIGRATION_DATABASE_URL` | `ams` (owner) | migrations, bootstrap, backups |

The owner connection is not reachable from a request handler.

## Authorisation

Three layers, each answering a different question.

1. **Authentication** — who is this? A session cookie for people, a bearer API
   key for machines.
2. **Permissions** — may they do this? Permissions are defined in code
   (`src/lib/auth/permissions.ts`); roles are rows owned by the tenant, so a
   customer builds and names their own. `requireAuth(req, "assets:write")` is the
   gate on every handler.
3. **Branch scope** — may they do it *here*? A role can be limited to particular
   locations; handlers check `withinLocationScope` before acting, and list
   queries apply the scope themselves so a scoped user's totals match their rows.

`admin` is a published *API-key scope*, not a permission. Nothing in the codebase
should ever ask `can("admin")`.

## Request shape

Every handler is wrapped in `safe()`, which catches, logs with a request id, and
returns an RFC 9457 problem document. Every failure the API can return is listed
in `src/lib/http/catalog.ts`, and a test scans the source for `problem(...)`
calls to prove the catalogue is neither incomplete nor stale.

`X-Request-Id` is echoed if supplied and generated otherwise, carried through the
request in an `AsyncLocalStorage`, and included in every log line — so one line
in a support email identifies one request in the logs.

## Background work

A single runner (`src/lib/jobs/runner.ts`) sweeps on a timer: overdue
assignments, expiring warranties and licences, maintenance falling due, the email
outbox, queued webhook deliveries, and the month-end depreciation snapshot. Each
sweep is idempotent and records what it did, because the alternative — a job that
must run exactly once — is a job that eventually does not.

## Notifications and webhooks

One entry point, `dispatch(ctx, event, context)`, does both: it queues webhook
deliveries for subscribers and emails for whoever the notification rules name. It
never throws, because a failed notification must not roll back the business
action that caused it.

Webhook deliveries are signed (`sha256=` HMAC over the exact bytes sent), carry a
stable id across retries, and are retried after 1, 5 and 30 minutes before being
abandoned.

## What is deliberately not here

- **No message queue.** The job runner and the outbox tables do the work a queue
  would, at a scale where a queue is another thing to operate.
- **No cache layer.** The dashboard is one round trip; reports are seconds. A
  cache would add staleness before it added speed.
- **No microservices.** Two deployables, one database, one transaction boundary.

Each of these is a decision that can be revisited when a real measurement asks
for it, not before.
