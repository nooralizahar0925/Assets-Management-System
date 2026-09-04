-- Application role: least privilege, NOT the table owner, so RLS always applies.
--
-- Deliberately created with NO password. The password is set out of band by
-- scripts/migrate.ts from APP_DB_PASSWORD, because a literal here would be a
-- credential committed to the repository - and one that silently outranks the
-- APP_DB_PASSWORD the operator thinks they configured. Holding this role's
-- credentials defeats row-level security entirely: the holder can call
-- set_config('app.org_id', ...) for any tenant they like.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ams_app') THEN
    CREATE ROLE ams_app LOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO ams_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ams_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ams_app;

-- GRANT ON ALL TABLES is indiscriminate, so take back what the application has
-- no business doing. Deleting an organization cascades to every user, asset,
-- assignment and audit event in the tenant; rewriting schema_migrations would
-- let a bug re-run or skip a migration. Neither is reachable from a handler
-- today, and neither should be reachable from the one written next year.
REVOKE INSERT, UPDATE, DELETE ON organizations FROM ams_app;
REVOKE ALL ON schema_migrations FROM ams_app;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','sessions','api_keys','locations','categories','assets',
    'assignments','audit_events','import_jobs','webhooks',
    'idempotency_keys','rate_limit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $$;

-- The policies above use the THROWING form of current_setting deliberately.
-- With the missing_ok form a handler that forgets withTenant returns an empty
-- result set - an empty asset register indistinguishable from a legitimately
-- empty tenant. With this form it raises, and somebody fixes the handler.
-- Both forms fail closed; only this one fails loudly.

-- organizations is readable only for the caller's own row.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY own_org ON organizations
  USING (id = current_setting('app.org_id')::uuid);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER assets_touch BEFORE UPDATE ON assets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
