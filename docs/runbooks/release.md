# Runbook: cutting a release

The changelog is generated from commits. That is why the Conventional Commits
rule is not cosmetic: a `feat:` prefix on a bug fix produces a wrong release
note for real users, and a missing `release-note:` trailer means a change
nobody is ever told about.

## Before tagging

```bash
cd api
npm run release -- --from v1.4.0        # preview, writes nothing
```

Read what it prints. Two things to check:

1. **The warning about missing notes.** It lists every `feat` or `fix` commit
   with no `release-note:` trailer. Each one is a change a user will notice and
   has not been told about. Either the commit should not have been a `feat`, or
   the note is missing — fix it before tagging, because after the tag the
   history is public.
2. **The version it picked.** A breaking change bumps the major, a feature the
   minor, anything else the patch. If that is wrong, the commit types are wrong.

## Tagging

```bash
git tag -a v1.5.0 -m "Release 1.5.0"
git push origin v1.5.0
```

The `Release` workflow then generates the changelog, builds both images with
their provenance baked in, and publishes the GitHub release.

## Publishing the in-app notes

The "What's new" panel reads from the deployed database, which the release
workflow cannot reach and should not be given credentials for. Publish from a
machine that can:

```bash
cd api
npm run release -- --from v1.4.0 --version 1.5.0 --publish --title "Scanning and labels"
```

`--publish` is separate from `--write` on purpose. Writing the changelog is a
file change in a pull request; publishing writes to a customer-facing table in
production, and the two should not be one keystroke.

Give it a real title. "Release 1.5.0" is what it defaults to and tells nobody
anything; "Scanning and labels" is what somebody will actually recognise.

## Deploying

1. Roll out the API image first. It is backwards compatible with the previous
   web build; the reverse is not guaranteed.
2. Run migrations: `npm run migrate:prod`.
3. Check `GET /api/health`. It answers 503 while the schema is behind the code,
   so it will tell you if step 2 was missed.
4. Check `GET /api/version` reports the version you just tagged. If it says
   `unknown`, the image was built without its build arguments and provenance is
   lost for that deploy.
5. Roll out the web image.

## If a release has to be pulled

Redeploy the previous image tag. Migrations are additive by constraint — a
column is added, backfilled and only dropped a release later — so the previous
build runs against the newer schema. That is the whole reason for the rule.

A release published to the in-app notes can be corrected by publishing the same
version again: `publishRelease` replaces rather than duplicates.
