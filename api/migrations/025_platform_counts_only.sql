-- Narrow the console's reach over the register to counting.
--
-- Migration 022 granted SELECT on the whole of `assets` and `sessions` because
-- the list of customers is worth nothing without "how many", and counting
-- needs a grant. But the grant it took was far wider than the counting: it also
-- let the platform role read every asset name, serial number, purchase price
-- and location in every customer's register, and every session's IP address.
--
-- Nothing in the code ever did. That is the problem: "the console only shows
-- counts" was a property of the queries above, which anybody could change
-- without noticing what it cost, rather than a property of the database, which
-- nobody can change by accident.
--
-- Column grants are the right size of hole, as they were for attachments in
-- 024. `count(*)` and `max(created_at)` still work; `SELECT *` no longer does.
-- Asserted in src/lib/platform/db.test.ts.
--
-- REVOKE first: a column grant does not narrow a table-wide one, it sits
-- beside it, and the wider of the two is what applies.

REVOKE SELECT ON assets   FROM ams_platform;
REVOKE SELECT ON sessions FROM ams_platform;

-- deleted_at because a soft-deleted asset is not one the customer holds, and
-- the count they are measured against must agree with the one they can see.
GRANT SELECT (org_id, deleted_at) ON assets TO ams_platform;

-- created_at is the last-signed-in date the attention list calls "dormant".
GRANT SELECT (org_id, created_at) ON sessions TO ams_platform;
