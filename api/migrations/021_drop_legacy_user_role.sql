-- The last step of the role migration: drop, a release after the switch.
--
-- Migration 008 added roles as rows and `users.role_id`. Since then the enum
-- column has been written but never read - permissions resolve from role_id
-- alone. Keeping it was the additive-migration constraint doing its job: add,
-- backfill, switch, drop later. This is later.
--
-- A last backfill first, so a row that somehow reached here without a role_id
-- is not silently left with no permissions at all. Every deploy has run the
-- same backfill from seed-permissions, so this should find nothing; it costs
-- one query to be certain rather than hopeful.
UPDATE users u
   SET role_id = r.id
  FROM roles r
 WHERE u.role_id IS NULL
   AND r.org_id = u.org_id
   AND lower(r.name) = CASE u.role
                         WHEN 'admin'      THEN 'administrator'
                         WHEN 'manager'    THEN 'manager'
                         WHEN 'technician' THEN 'technician'
                         ELSE 'viewer'
                       END;

-- The sign-in lookup still publishes the enum in its return type. It is a
-- SECURITY DEFINER function, so it is replaced rather than altered: the
-- signature changes, which means dropping and recreating it with the same
-- pinned search_path and the same grants.
DROP FUNCTION IF EXISTS auth_lookup_user_by_email(text);

CREATE FUNCTION auth_lookup_user_by_email(p_email text)
RETURNS TABLE (id uuid, org_id uuid, name text, password_hash text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT u.id, u.org_id, u.name, u.password_hash
    FROM users u
   WHERE lower(u.email) = lower(p_email);
$fn$;

REVOKE ALL ON FUNCTION auth_lookup_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_user_by_email(text) TO ams_app;

ALTER TABLE users DROP COLUMN role;

-- The type has no other user. Dropping it is what makes the column
-- unrecoverable by accident, which is the point of doing this deliberately.
DROP TYPE user_role;
