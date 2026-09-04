-- Roles a company defines for itself, replacing the fixed user_role enum.
--
-- Permissions are code-defined reference data: identical for every tenant, and
-- meaningless unless a handler checks them, so this table carries no org_id and
-- no row-level security. It exists so role_permissions can hold a foreign key,
-- which is what stops a role keeping a grant to a permission that was removed.
CREATE TABLE permissions (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  description text NOT NULL,
  "group"     text NOT NULL
);
GRANT SELECT ON permissions TO ams_app;

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  -- Seeded roles. Editable and renameable, but not deletable: deleting the role
  -- every user holds would lock the organisation out of itself.
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Unique per organisation, not globally: two companies may both have "Auditor".
CREATE UNIQUE INDEX roles_org_name_idx ON roles (org_id, lower(name));

CREATE TABLE role_permissions (
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(key) ON UPDATE CASCADE,
  PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX role_permissions_org_idx ON role_permissions (org_id);

-- One role per user, decided 2026-09-04: resolution is a single join and
-- "what can this person do?" has exactly one answer.
ALTER TABLE users ADD COLUMN role_id uuid REFERENCES roles(id) ON DELETE RESTRICT;
CREATE INDEX users_role_idx ON users (role_id);

-- Optional branch scoping. No rows for a user means organisation-wide, which is
-- the common case - an administrator or a finance viewer has no natural branch.
-- Scoping lives on the user rather than the role so that one "Technician" role
-- serves every site, each person narrowed to their own.
CREATE TABLE user_location_scopes (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, location_id)
);
CREATE INDEX user_location_scopes_org_idx ON user_location_scopes (org_id);

CREATE TRIGGER roles_touch BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- A system role must survive a careless DELETE, including one issued straight
-- against the database rather than through the API.
CREATE OR REPLACE FUNCTION forbid_system_role_delete() RETURNS trigger AS $fn$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'cannot delete the system role "%"', OLD.name
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END $fn$ LANGUAGE plpgsql;

CREATE TRIGGER roles_no_delete_system BEFORE DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION forbid_system_role_delete();

-- Tenant isolation, exactly as every other tenant table.
DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['roles', 'role_permissions', 'user_location_scopes'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $do$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON roles, role_permissions, user_location_scopes TO ams_app;

-- Seeds the system roles for one organisation. Used by the backfill, by the
-- sign-up path, and by the test fixture, so every organisation sees the same
-- world. Idempotent: re-running adds nothing and changes no customisation.
CREATE OR REPLACE FUNCTION seed_system_roles(p_org_id uuid) RETURNS void AS $fn$
  INSERT INTO roles (org_id, name, description, is_system)
  SELECT p_org_id, r.name, r.description, true
    FROM (VALUES
      ('Administrator', 'Full access, including people, roles, keys and settings.'),
      ('Manager',       'Runs the register day to day: assets, categories, locations, imports and reports.'),
      ('Technician',    'Works with the assets themselves: updates them, moves them, issues and receives them.'),
      ('Viewer',        'Reads the register and runs reports. Changes nothing.')
    ) AS r(name, description)
  ON CONFLICT DO NOTHING;
$fn$ LANGUAGE sql;
