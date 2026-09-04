-- Supersedes auth_lookup_session from 006. The signature changes because
-- user_role is being retired: the session lookup now returns role_id, and
-- permissions are resolved from it per request rather than derived from an enum.
--
-- The same reasoning as 006 applies: authentication happens before the tenant
-- is known, so these are SECURITY DEFINER with a pinned search_path and EXECUTE
-- revoked from PUBLIC.
DROP FUNCTION IF EXISTS auth_lookup_session(text);

CREATE FUNCTION auth_lookup_session(p_session_id text)
RETURNS TABLE (org_id uuid, user_id uuid, name text, role_id uuid, role_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT s.org_id, u.id, u.name, u.role_id, r.name
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN roles r ON r.id = u.role_id
   WHERE s.id = p_session_id
     AND s.expires_at > now();
$fn$;

REVOKE ALL ON FUNCTION auth_lookup_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_session(text) TO ams_app;

-- Resolving a user's permissions is also pre-tenant: readSession needs them
-- before it can build the Ctx that withTenant is keyed on.
CREATE FUNCTION auth_lookup_permissions(p_user_id uuid)
RETURNS TABLE (permission_key text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT rp.permission_key
    FROM users u
    JOIN role_permissions rp ON rp.role_id = u.role_id
   WHERE u.id = p_user_id;
$fn$;

CREATE FUNCTION auth_lookup_location_scope(p_user_id uuid)
RETURNS TABLE (location_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT s.location_id FROM user_location_scopes s WHERE s.user_id = p_user_id;
$fn$;

REVOKE ALL ON FUNCTION auth_lookup_permissions(uuid)    FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_lookup_location_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_permissions(uuid)    TO ams_app;
GRANT EXECUTE ON FUNCTION auth_lookup_location_scope(uuid) TO ams_app;
