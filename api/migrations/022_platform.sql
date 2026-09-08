-- The platform layer: whoever rents this system to companies.
--
-- Deliberately not a role inside a tenant. A platform administrator is not a
-- user of any organisation, and a tenant user must have no path to becoming
-- one: `users` is row-level secured per organisation, so putting a "can see
-- everything" flag on it would make the most dangerous privilege in the system
-- a column the tenant application writes to.
--
-- These tables therefore sit outside the tenant model entirely, like
-- login_attempts, and ams_app is refused every one of them. The application
-- that serves customers cannot read a platform administrator's password hash,
-- cannot mint a platform session, and cannot see the audit trail of what the
-- operator did.

CREATE TABLE platform_admins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL,
  -- Disabled rather than deleted: the audit trail references them, and a
  -- former operator's actions must stay attributable.
  disabled_at   timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX platform_admins_email_idx ON platform_admins (lower(email));

CREATE TABLE platform_sessions (
  id         text PRIMARY KEY,
  admin_id   uuid NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  -- Shorter than a tenant session on purpose. This one can create and destroy
  -- whole organisations; an unattended browser should stop being able to.
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_sessions_admin_idx ON platform_sessions (admin_id);
CREATE INDEX platform_sessions_expiry_idx ON platform_sessions (expires_at);

-- Every action the operator takes against a customer's data, recorded where the
-- customer's own audit trail cannot reach and the operator cannot edit.
CREATE TABLE platform_audit (
  id         bigserial PRIMARY KEY,
  admin_id   uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  admin_email text NOT NULL,
  action     text NOT NULL,
  org_id     uuid,
  org_slug   text,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_audit_time_idx ON platform_audit (occurred_at DESC);

-- Suspension: a customer who has stopped paying, or an organisation being
-- wound down. Their data is untouched and their people simply cannot sign in,
-- which is reversible - unlike deleting the tenant.
ALTER TABLE organizations ADD COLUMN suspended_at timestamptz;

-- A note for the operator's own benefit: why it was suspended, who to call.
ALTER TABLE organizations ADD COLUMN notes text;

-- The tenant application must not see any of this.
REVOKE ALL ON platform_admins   FROM ams_app;
REVOKE ALL ON platform_sessions FROM ams_app;
REVOKE ALL ON platform_audit    FROM ams_app;
REVOKE ALL ON SEQUENCE platform_audit_id_seq FROM ams_app;

-- The platform role.
--
-- Separate login, separate connection string, and BYPASSRLS because reading
-- across tenants is the entire job. It is created with no password for the
-- same reason ams_app is: the credential comes from the environment, never
-- from a file in the repository.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ams_platform') THEN
    CREATE ROLE ams_platform LOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO ams_platform;

-- Narrow on purpose. The console lists organisations and provisions new ones;
-- it has no reason to read an asset, an attachment or an audit event, and a
-- grant it does not hold is a mistake it cannot make.
GRANT SELECT, INSERT, UPDATE, DELETE ON organizations TO ams_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_admins TO ams_platform;
GRANT SELECT, INSERT, DELETE          ON platform_sessions TO ams_platform;
GRANT SELECT, INSERT                  ON platform_audit TO ams_platform;
GRANT USAGE, SELECT ON SEQUENCE platform_audit_id_seq TO ams_platform;

-- Provisioning a new customer writes their roles, their permissions and their
-- first administrator.
GRANT SELECT, INSERT, UPDATE ON users TO ams_platform;
GRANT SELECT, INSERT, UPDATE ON roles TO ams_platform;
GRANT SELECT, INSERT         ON role_permissions TO ams_platform;
GRANT SELECT                 ON permissions TO ams_platform;
GRANT SELECT, INSERT         ON notification_rules TO ams_platform;
GRANT EXECUTE ON FUNCTION seed_system_roles(uuid) TO ams_platform;

-- Counting what a customer holds is what makes the list worth looking at.
GRANT SELECT ON assets TO ams_platform;
GRANT SELECT ON sessions TO ams_platform;
