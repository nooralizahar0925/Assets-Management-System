# Changelog

All notable changes to the Assets Management System are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

From Task 36 onward this file is **generated** from Conventional Commit messages by
`npm run changelog` — do not hand-edit released sections. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for how to write a commit that produces a correct
release note.

The product version (this file) is independent of the public API version. `/api/v1` is
additive-only; a breaking API change ships as `/api/v2` alongside it.

## [Unreleased]

### Added
- Docker stack (`db`, `api`, `web`, `minio`) with a health-checked API service.
- Database schema with row-level security tenant isolation, including the
  rental-ready tables and the no-double-book exclusion constraint.
- RFC 7807 `problem+json` errors, pagination and allowlisted sort parsing.
- Session authentication for the dashboard and scoped, rate-limited API keys.
- Company-defined roles over a fixed 22-permission vocabulary, one role per
  user, with optional per-branch scoping and role management endpoints.

### Security
- Sign-in is rate limited per email and per client address, and spends the same
  time on an unknown address as a known one.
- Passwords use scrypt at OWASP's cost floor, with the parameters stored in the
  hash so they can be raised without a forced reset.
- The production image no longer ships development dependencies, and error logs
  no longer record database row contents.

[Unreleased]: https://example.invalid/ams/compare/v0.1.0...HEAD
