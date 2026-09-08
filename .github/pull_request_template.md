## What changed

<!-- One paragraph. What does this do, and why now? -->

## Release note

<!--
Every feat and fix needs a `release-note:` trailer on the commit. CI enforces
it. Paste the note here so a reviewer can judge it as a user would read it:

  release-note: Scan a QR code to open an asset instantly.

If you cannot write a sentence a customer would care about, the commit is
probably `chore` rather than `feat`.
-->

## Checklist

- [ ] Tests, typecheck and build all run — each catches what the others miss
- [ ] New tenant tables have `org_id`, `FORCE ROW LEVEL SECURITY` and a policy
- [ ] Write actions are gated on the permission the API enforces
- [ ] A new permission is added to the seeded system roles in the same commit
- [ ] Migrations are additive: add, backfill, switch, drop a release later
- [ ] Any accepted risk is recorded in `docs/accepted-risks.md`
