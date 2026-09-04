# Contributing

How change is tracked in this repository, from a work-in-progress branch through to a
release note a customer reads in the "What's new" panel.

## Branching

`main` is always releasable. Nothing is committed directly to it.

| Branch | Purpose | Merges into |
|---|---|---|
| `main` | Released, tagged history | — |
| `feat/<short-name>` | A new capability | `main` |
| `fix/<short-name>` | A bug fix | `main` |
| `chore/<short-name>` | Dependencies, tooling, refactors with no user-visible effect | `main` |
| `docs/<short-name>` | Documentation only | `main` |
| `hotfix/<short-name>` | An urgent fix branched from the release tag, not from `main` | `main` **and** the release tag |

Branches are short-lived and merged with `--no-ff`, so each feature keeps an identifiable
merge commit in `main`.

```bash
git switch -c feat/asset-import main
# ... work, committing as you go ...
git switch main && git merge --no-ff feat/asset-import
git branch -d feat/asset-import
```

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). This is not
cosmetic: `api/scripts/changelog.ts` parses these messages to decide the next version
number and to write the release notes users see. A `feat:` prefix on a bug fix produces a
wrong release note for a real customer.

```
<type>(<optional scope>): <subject in the imperative, lower case, no full stop>

<optional body — technical detail for other developers>

release-note: <one or two plain sentences a customer would understand>
```

### Types

| Type | Meaning | Version bump | Appears in release notes |
|---|---|---|---|
| `feat` | A new user-visible capability | MINOR | Yes, as a feature |
| `fix` | A bug fix | PATCH | Yes, as a fix |
| `perf` | A performance improvement | PATCH | Yes, if a `release-note:` is present |
| `docs` | Documentation only | PATCH | No |
| `test` | Tests only | PATCH | No |
| `refactor` | Internal restructuring, no behaviour change | PATCH | No |
| `chore` | Tooling, dependencies, build | PATCH | No |
| `ci` | Pipeline configuration | PATCH | No |

A `!` after the type/scope, or a `BREAKING CHANGE:` footer, forces a MAJOR bump.

### The `release-note:` trailer is what users read

The changelog generator takes two different things from one commit:

- the **subject** becomes the developer-facing line in `CHANGELOG.md`;
- the **`release-note:` trailer** becomes the customer-facing entry in the in-app
  "What's new" panel.

A commit with no `release-note:` trailer never reaches a customer. That is the right
outcome for a chore, and a bug for a `feat` — so CI fails a `feat` or `fix` commit that
is missing one. Write the trailer as something a non-technical customer would understand:
no file names, no table names, no jargon.

```
feat(assets): add qr code scanning

Uses @zxing/browser for the camera path and a keyboard-wedge listener for HID
scanners, both behind the ScanModal component.

release-note: Scan a QR code with your phone camera to open an asset instantly.
```

```
fix(email): stop duplicate overdue reminders

release-note: Overdue reminders no longer send twice on the same day.
```

```
chore(deps): bump vite to 6.0.7
```
(no trailer — internal, so no customer ever sees it)

A breaking change:

```
feat(api)!: rename asset.tag to asset.asset_tag

release-note: The asset tag field is now called asset_tag in API responses.

BREAKING CHANGE: `tag` is now `asset_tag` on every /api/v1/assets response.
```

Trailers are ordinary git trailers, so `git commit -m "..." -m "release-note: ..."` and
`git interpret-trailers` both work.

**All trailers must sit in one unbroken final block.** Git only parses the last paragraph
of a message as trailers, so a blank line between `release-note:` and a following
`Co-Authored-By:` makes the release note invisible to the generator. The
`commit-msg` hook rejects this, but only if the hook is enabled. Verify with:

```bash
git log -1 --pretty='%(trailers:key=release-note,valueonly)'
```

Empty output on a `feat` or `fix` commit means the note will not reach a customer.

### Enforcement

`.githooks/commit-msg` rejects a message that is not a Conventional Commit. Enable the
hooks once per clone:

```bash
git config core.hooksPath .githooks
```

To bypass deliberately (rare, e.g. a merge commit): `git commit --no-verify`.

## Versioning

The product version in `VERSION` is [SemVer](https://semver.org/) and is bumped by the
changelog generator from the commits since the last tag — never by hand.

The **public API** version is separate. `/api/v1` request and response shapes are
additive-only once published; a breaking change ships as `/api/v2` served alongside `v1`,
and `v1` is only retired after an announced deprecation window.

## Releasing

```bash
npm run changelog -- --from v0.1.0 --to HEAD   # updates CHANGELOG.md, computes the bump
git commit -am "chore(release): v0.2.0"
git tag -a v0.2.0 -m "v0.2.0"
git push origin main --follow-tags
```

Tagging triggers `.github/workflows/release.yml`, which builds the images and publishes
the release row that the in-app "What's new" panel reads.

## Accepted risks

Security findings we have decided not to fix yet are recorded in
[docs/accepted-risks.md](docs/accepted-risks.md), with the reasoning and what
would change the decision. A finding that is not written down there has not been
accepted, only forgotten. Review it at each release and whenever a dependency
audit changes.

## Migrations and rollback

Migrations are forward-only and additive within a release: add the new column, backfill
it, switch the code to it, and drop the old one in a *later* release. That way the
previous image still runs against the new schema, so a rollback is a redeploy of the
previous tag with no database work.
