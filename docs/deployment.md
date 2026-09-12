# Deployment

Two images and a database. `docker compose up` runs the whole thing; a real
deployment is the same images with real secrets and a managed Postgres.

## Environment

Everything is read from the environment. There is no configuration file to
forget to copy.

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | the application connection, as `ams_app` |
| `MIGRATION_DATABASE_URL` | yes | the owner connection, for migrations and backups |
| `PLATFORM_DATABASE_URL` | yes | the platform console's connection, as `ams_platform` |
| `APP_DB_PASSWORD` | yes | the password the migration runner sets on `ams_app` |
| `PLATFORM_DB_PASSWORD` | yes | the password the migration runner sets on `ams_platform` |
| `SESSION_SECRET` | yes | signs session cookies; 32 random bytes |
| `APP_ENCRYPTION_KEY` | yes | 64 hex characters. Encrypts stored provider credentials |
| `APP_BASE_URL` | yes | the public URL. Decides cookie security, CORS, and every link in an email or a QR label |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | yes | attachments and backups |
| `VITE_API_BASE_URL` | no | leave empty. The web server proxies `/api`, so both halves share an origin |
| `RATE_LIMIT_PER_HOUR` | no | per API key. Default 1000 |
| `JOB_INTERVAL_MS` | no | how often the background sweep runs. Default 15 minutes |
| `EXPIRY_WINDOW_DAYS` | no | how far ahead to warn about warranties and licences. Default 90 |
| `SEED_PASSWORD` | no | required before the seed will run with `NODE_ENV=production` |

Three of these deserve a warning:

- **`APP_ENCRYPTION_KEY` cannot be rotated casually.** Every stored email
  provider credential is encrypted with it; changing it makes them unreadable
  and they have to be re-entered.
- **`APP_BASE_URL` decides cookie flags.** An `https://` value marks session
  cookies secure. Set it to `http://` in production and sessions travel in
  clear; get it wrong the other way in development and sign-in silently fails.
- **`VITE_API_BASE_URL` is baked in at build time**, not read at runtime. It is a
  static build; there is no server to read an environment variable later.

## First deployment

```bash
docker compose up -d db minio
docker compose run --rm api npm run migrate     # schema, roles, permissions
docker compose run --rm api npm run seed        # only for a demo environment
docker compose up -d
docker compose exec api npm run platform:admin --   --email you@example.com --name "Your Name"   # your own console account
```

The last command prints a password once and never again. Without it there is no
way into the platform console, and so no way to create a customer — see
[docs/platform.md](platform.md).

`npm run migrate` also reconciles the permission catalogue and every
organisation's system roles and notification rules with the code, so adding a
permission is a deploy rather than a hand-written migration.

## Deploying a new version

Order matters, and only in one direction:

1. **Roll out the API image first.** It is backwards compatible with the previous
   web build; the reverse is not guaranteed.
2. **Run migrations**: `npm run migrate:prod`.
3. **Check `GET /api/health`.** It answers 503 while the schema is behind the
   code, so it tells you if step 2 was missed.
4. **Check `GET /api/version`** reports what you just deployed. `unknown` means
   the image was built without its build arguments and that deploy has no
   provenance.
5. **Roll out the web image.**

To pull a release: redeploy the previous image tag. Migrations are additive by
constraint, so the older build runs against the newer schema. That rule is the
whole reason a rollback is a deploy rather than an incident.

## Health and readiness

- `GET /api/health` — checks the database *and* that the applied migrations
  match the code. 503 means do not send traffic here.
- `GET /api/version` — version, git sha, build time, and the latest applied
  migration. This is the first thing to quote in any support conversation.

## Backups

`npm run backup` writes a `pg_dump` to object storage through the owner
connection. Schedule it outside the application.

A backup nobody has restored is not a backup. The
[restore runbook](runbooks/restore.md) has the drill, including the trap it
found: `pg_dump --no-privileges` strips the GRANTs, so the restored database
answers `SELECT 1` and then fails on the first sequence it touches.

## Rate limits and abuse

Rate limiting is per API key, so one noisy integration cannot exhaust another's
budget. Sign-in attempts are throttled per address and per IP with a separate
counter that is deliberately not tenant-scoped — the attacker has not told us
which tenant they are yet.
