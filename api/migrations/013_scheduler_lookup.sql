-- The scheduler has to enumerate every organisation before it can act on any of
-- them, which is a cross-tenant read - the same shape as authentication, and it
-- hits the same wall: there is no app.org_id to set until an organisation has
-- been chosen.
--
-- Same remedy as migration 006, for the same reasons. One narrow SECURITY
-- DEFINER function, pinned search_path, EXECUTE revoked from PUBLIC, so
-- ams_app keeps FORCE ROW LEVEL SECURITY on every table with no exception and
-- the cross-tenant surface stays a short list of reviewable functions.
--
-- It returns identity only. No tenant data crosses this boundary: the caller
-- gets an id and a name, then re-enters withTenant to do anything with them.
CREATE FUNCTION scheduler_list_organizations()
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT o.id, o.name FROM organizations o ORDER BY o.created_at;
$fn$;

REVOKE ALL ON FUNCTION scheduler_list_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduler_list_organizations() TO ams_app;
