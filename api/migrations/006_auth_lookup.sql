-- Authentication is the one operation that cannot run inside withTenant: the
-- tenant is not known until the credential has been resolved. Rather than give
-- ams_app a cross-tenant grant on the credential tables, or a second role that
-- bypasses RLS, the three lookups below are SECURITY DEFINER functions owned by
-- the schema owner.
--
-- Why this is the safe shape:
--   * ams_app keeps FORCE ROW LEVEL SECURITY on every table, with no exception.
--   * The whole cross-tenant surface of the system is these three functions,
--     which are reviewable in one place, rather than a table-level GRANT whose
--     blast radius grows with every column added later.
--   * Each takes an unguessable secret (a session id, a key prefix) or an email
--     and returns at most one row with only the columns authentication needs.
--     None of them accepts an org id, so none can be used to enumerate a tenant.
--   * search_path is pinned, without which a SECURITY DEFINER function is a
--     privilege-escalation vector.
--
-- Once these return, the caller has an org id and everything else - including
-- creating the session row and recording rate-limit events - goes through
-- withTenant like all other database access.

-- Resolve a session cookie to its user. Expired sessions resolve to nothing.
CREATE FUNCTION auth_lookup_session(p_session_id text)
RETURNS TABLE (org_id uuid, user_id uuid, name text, role user_role)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT s.org_id, u.id, u.name, u.role
    FROM sessions s
    JOIN users u ON u.id = s.user_id
   WHERE s.id = p_session_id
     AND s.expires_at > now();
$fn$;

-- Resolve an API key prefix to its stored hash. The caller compares the hash in
-- constant time; this function deliberately does no comparison of its own, so a
-- timing difference here cannot leak whether a prefix exists.
CREATE FUNCTION auth_lookup_api_key(p_prefix text)
RETURNS TABLE (id uuid, org_id uuid, name text, key_hash text, scopes text[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT k.id, k.org_id, k.name, k.key_hash, k.scopes
    FROM api_keys k
   WHERE k.prefix = p_prefix
     AND k.revoked_at IS NULL;
$fn$;

-- Resolve a login email to its user. Returns the password hash so the caller can
-- verify it in constant time; email is globally unique (users_email_idx), so a
-- login form needs no tenant selector.
CREATE FUNCTION auth_lookup_user_by_email(p_email text)
RETURNS TABLE (id uuid, org_id uuid, name text, role user_role, password_hash text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT u.id, u.org_id, u.name, u.role, u.password_hash
    FROM users u
   WHERE lower(u.email) = lower(p_email);
$fn$;

-- PUBLIC must not keep the default EXECUTE on a SECURITY DEFINER function.
REVOKE ALL ON FUNCTION auth_lookup_session(text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_lookup_api_key(text)         FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_lookup_user_by_email(text)   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_lookup_session(text)       TO ams_app;
GRANT EXECUTE ON FUNCTION auth_lookup_api_key(text)       TO ams_app;
GRANT EXECUTE ON FUNCTION auth_lookup_user_by_email(text) TO ams_app;
