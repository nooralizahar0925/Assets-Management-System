# Runbook: restoring from backup

The one procedure nobody wants to read for the first time under pressure.

**Last drill:** 2026-09-07, automated — `api/src/lib/backup/backup.test.ts` takes a
backup, deletes an asset, restores it, and checks the register and its custody
history came back. It runs with the rest of the suite.

---

## What is backed up, and where

`npm run backup` takes a `pg_dump --format=custom` archive of the whole database
and uploads it to the `ams-backups` bucket under a sortable key
(`2026-09-07T02-00-00Z.dump`). It then prunes to the newest `BACKUP_KEEP`
archives, 14 by default.

Retention counts **backups, not days**. A system that has been down for a
fortnight still has its last good archive; an age-based rule would have deleted
it exactly when it was needed.

The dump uses `MIGRATION_DATABASE_URL` — the owner connection. It refuses to run
without it. A dump taken as `ams_app` would be quietly incomplete, because that
role cannot read every table, and an incomplete backup is worse than none: it
looks like success.

Attachments live in a **separate** bucket and are not covered by this. Restoring
the database brings back the rows that reference a file; the file itself comes
from the object store's own replication.

## Taking one by hand

```bash
cd api
npm run backup            # development
npm run backup:prod       # inside the container
```

In Docker: `docker compose exec api npm run backup:prod`.

## Restoring

**Read this before typing anything.** A restore overwrites the target database
completely. The archive replaces every table it contains.

```bash
cd api
npm run restore -- --list                      # what exists
npm run restore -- --key <key> --into <url> --yes
```

The target is given explicitly rather than read from the environment. A script
that picks its own target from whatever happens to be set is one command away
from overwriting production with staging.

### The order of operations

1. **Stop the writers.** Scale the `api` and `jobs` containers to zero. A restore
   running while the application writes leaves a database that matches neither
   the archive nor the live data.
2. **Confirm which archive.** `--list` shows sizes; a suspiciously small one is a
   failed dump that uploaded anyway.
3. **Restore into a scratch database first** if there is any doubt. Point
   `--into` at an empty database and look at it before touching the real one.
4. **Restore.** `pg_restore --clean --if-exists` drops and recreates as it goes.
5. **Run migrations.** `npm run migrate`. The archive carries the schema as it
   was; if the code has moved on, it needs the newer migrations.

   Note that migrations will **not** repair missing grants. The archive includes
   privileges precisely so it does not have to: a dump taken with
   `--no-privileges` restores every row and no GRANT, and the application then
   fails on its first write with `permission denied for sequence`. Re-running
   migrations does not fix it, because they are already recorded as applied.
   The drill test asserts the grants came back for exactly this reason.
6. **Check health.** `GET /api/health` returns 503 while the schema is behind the
   code, so it will tell you if step 5 was missed.
7. **Start the writers again.**

### What to check afterwards

- Sign in. Session rows are in the archive, but a restore to a point before an
  account existed means that account does not exist any more.
- Open an asset with custody history — the drill test checks exactly this,
  because rows without their history is not a restore anyone would accept.
- `GET /api/health` reports `migrations.current: true`.

## If the restore fails halfway

`--clean --if-exists` means the target is now neither the old contents nor the
new. Do not retry against the same database hoping it settles. Restore into a
fresh, empty database instead, then repoint the application at it.

## Scheduling

Nightly, from the `jobs` container or a scheduler that can reach the database
and the object store. The backup is deliberately not part of the in-process job
sweep: a task that shells out to `pg_dump` and uploads hundreds of megabytes has
no business sharing a process with request handling.
