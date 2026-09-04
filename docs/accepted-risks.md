# Accepted risks

Security findings we have decided not to fix yet, with the reasoning and what
would change our mind. A finding that is not written down here has not been
accepted — it has been forgotten.

Review this file at each release, and whenever a dependency audit changes.

---

## `postcss` advisories reachable through Next.js 15

**Status:** accepted
**Since:** 2026-09-04
**Severity as reported:** 1 high, 1 moderate (`npm audit --omit=dev`)

`npm audit` reports four `postcss` advisories — an XSS via unescaped `</style>`
in stringify output, and three variants of arbitrary `.map` file disclosure via
an attacker-controlled `sourceMappingURL`. `postcss` reaches the production
dependency tree only as a transitive dependency of `next`.

**Why we are not fixing it now**

- Every advisory concerns *processing CSS*. The `api` service is Next.js App
  Router route handlers only, with no React rendering and no stylesheets — a
  Global Constraint in `docs/superpowers/plans/2026-09-03-ams/00-overview.md`.
  There is no code path in which it processes attacker-supplied CSS.
- The only fix `npm audit fix --force` offers is `next@16`, a major upgrade.
  The same Global Constraints pin Next.js 15, and the frontend pins React 19,
  Vite 6 and Tailwind v4 to the template's versions.
- Taking a major framework upgrade to remediate a class of vulnerability the
  service cannot reach is a poor trade at this stage of the build.

**What would change this**

- The `api` service starts rendering CSS or serving source maps for any reason.
- A `postcss` fix ships in a patch release Next 15 can take, at which point this
  becomes a routine bump.
- We upgrade to Next 16 for unrelated reasons — take the fix then.
- An advisory appears that is reachable from route handlers rather than from CSS
  processing.

**Related work already done.** The larger exposure here was `api/Dockerfile`
copying the full dev dependency tree into the runtime image, which shipped
`vitest`, `vite` and `esbuild` — including a critical `vitest` advisory — to
production. That is fixed: a `prod-deps` stage runs `npm ci --omit=dev`, and the
audit against what actually ships dropped from 7 findings including 1 critical
to these 2.

---

## Branch scope is enforced in the application, not by row-level security

**Status:** accepted by design
**Since:** 2026-09-04

Tenant isolation is enforced by Postgres row-level security. Branch scoping —
limiting a person to particular locations — is enforced in the domain layer
through a single choke point, `locationScopeClause`.

**Why**

- A tenant leak crosses *customers*; a branch leak crosses *departments inside
  one customer*, who already know of each other.
- Branch scope varies per user, not per connection, so RLS would mean setting
  and resetting a second GUC on every `withTenant` call and adding a clause to
  every policy.
- Customers routinely want partial cross-branch visibility, which a blanket
  policy fights.

**What would change this.** If branch scoping becomes a contractual or
regulatory boundary rather than a convenience, move it into RLS. The reasoning
is recorded in full at the top of
`docs/superpowers/plans/2026-09-03-ams/01b-authorization.md`.

---

## The last-administrator guard counts people, not API keys

**Status:** accepted by design
**Since:** 2026-09-04

`assertNotLastAdministrator` in `api/src/lib/domain/roles.ts` prevents a change
that would leave nobody holding a role granting `roles:write`. It counts users.
An API key with the `admin` scope can still call the API, but does not count as
cover.

**Why.** A key is not somebody who can be asked to fix things. An organisation
whose only remaining administrator is a credential in a CI system is locked out
of its own dashboard in every practical sense.

**Consequence to document.** The help centre article on users and roles should
say that an API key is not a substitute for an administrator.
