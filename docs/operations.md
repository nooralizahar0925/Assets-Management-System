# Operations

What to do when something is wrong, and the routine work that stops it being
wrong later.

The two long-form procedures have their own runbooks:

- [Restoring from a backup](runbooks/restore.md)
- [Cutting a release](runbooks/release.md)

## First moves, whatever the symptom

```bash
curl -s https://your-host/api/health   | jq
curl -s https://your-host/api/version  | jq
```

`health` reports the database *and* whether the applied migrations match the
running code. `version` reports the build, its git sha, and the latest migration.
Between them they answer "is it up?", "is it the version I think?" and "did the
migration run?" — which is most incidents.

Every response carries `X-Request-Id`. If a customer can quote one, it identifies
their exact request in the logs:

```bash
docker compose logs api | grep '"request_id":"<the id>"'
```

Logs are JSON, one object per line, with the method, path, status, duration,
organisation and actor type. They never contain a password, a key, or a row of
tenant data.

## "Nobody can sign in"

In order of likelihood:

1. **`APP_BASE_URL` is `http://` on an HTTPS deployment**, or the reverse. It
   decides whether session cookies are marked secure. Wrong either way and the
   browser silently discards the cookie: sign-in appears to succeed and the next
   request is anonymous.
2. **The web build is talking to the wrong API.** `VITE_API_BASE_URL` is baked in
   at build time; the normal answer is empty, with the web server proxying
   `/api` so both halves share an origin. Check the browser's network tab for
   requests going somewhere unexpected.
3. **The database is not the one you think.** A locally installed PostgreSQL on
   5432 shadows the container's published port, and the failure reads as a wrong
   password.
4. **Login throttling.** Repeated failures lock an address and an IP for a
   period. `login_attempts` shows it; it clears itself.

## "The dashboard is empty" or "a report is wrong"

Almost always branch scope. A role limited to particular locations sees only
those locations everywhere — the register, search, reports and the dashboard's
totals. That is deliberate: an organisation-wide total shown to somebody who can
only see one site summarises nothing they can act on, and leaks how much the rest
of the company holds.

Check the person's role and its location scope under Settings → People before
looking anywhere else.

## "Emails are not arriving"

1. **Is a provider configured?** Settings → Email. Nothing is sent until one is,
   and this is the usual answer.
2. **Send a test message.** A provider that accepts its settings and then rejects
   the mail is the common failure, and only the test finds it.
3. **Is there a rule?** Settings → Notifications. Every organisation is seeded
   with the defaults on migrate, but a rule can be turned off.
4. **Has the recipient opted out?** People can disable individual notifications
   for themselves.
5. **Look at the outbox.** `email_messages` holds status and the last error.

## "A webhook subscriber is not receiving anything"

`webhook_deliveries` carries a row per attempt with `status`, `attempts`,
`last_status` and `last_error`.

Deliveries are retried after 1, 5 and 30 minutes and then abandoned — four
attempts. A receiver that answers slowly gets the same event again with the same
delivery `id`, which is what receivers de-duplicate on.

If nothing was ever queued, the subscription does not include that event.

## "The background jobs are not running"

One runner sweeps every `JOB_INTERVAL_MS` (15 minutes by default): overdue
assignments, expiring warranties and licences, maintenance due, the email
outbox, webhook deliveries, and the month-end depreciation snapshot.

Every sweep logs what it did. If the log is silent, the API process is not
running the runner — check that the container is the API image and not a
one-off command.

Sweeps are idempotent, so running one late or twice is safe.

## Routine work

| When | What |
|---|---|
| Daily | `npm run backup`, scheduled outside the application |
| Every release | The [release runbook](runbooks/release.md) |
| Quarterly | **A restore drill.** A backup nobody has restored is not a backup |
| Quarterly | `npm audit --omit=dev`, and review [accepted risks](accepted-risks.md) |
| On staff change | Revoke their API keys as well as their account |

## Rotating secrets

- **`SESSION_SECRET`** — rotating signs everybody out. That is the entire
  consequence; do it whenever it is warranted.
- **`APP_DB_PASSWORD`** — set the new value and run `npm run migrate`, which
  applies it to `ams_app`.
- **`APP_ENCRYPTION_KEY`** — **do not rotate casually.** Every stored email
  provider credential is encrypted with it and becomes unreadable. The
  credentials must be re-entered afterwards.
- **An API key** — mint the replacement, move the integration, confirm it works,
  then revoke the old one. Revocation takes effect on the next request.

## Removing a tenant

```sql
DELETE FROM organizations WHERE slug = '<slug>';
```

Every tenant table cascades from it. Take a backup first: there is no undo, and
this is the one delete in the system that is genuinely permanent.
