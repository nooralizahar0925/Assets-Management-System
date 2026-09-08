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

-- ---------------------------------------------------------------------------
-- What is sold, and to whom.
-- ---------------------------------------------------------------------------

CREATE TABLE plans (
  code           text PRIMARY KEY,
  name           text NOT NULL,
  description    text NOT NULL DEFAULT '',
  -- Minor units, integer: 250000 is Rp 250,000. Never a float, for the same
  -- reason an asset's value is not one.
  price_minor    bigint NOT NULL DEFAULT 0,
  currency       char(3) NOT NULL DEFAULT 'IDR',
  billing_cycle  text NOT NULL DEFAULT 'monthly'
                   CHECK (billing_cycle IN ('monthly', 'yearly', 'once')),
  features       text[] NOT NULL DEFAULT '{}',
  -- {"max_assets": 500, "max_users": 10}. A key that is absent means
  -- unlimited; null is never used, so "absent" has exactly one meaning.
  limits         jsonb NOT NULL DEFAULT '{}'::jsonb,
  active         boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE organizations
  ADD COLUMN plan_code       text REFERENCES plans(code),
  ADD COLUMN contract_starts date,
  ADD COLUMN renews_on       date,
  ADD COLUMN trial_ends_at   date,
  -- What this customer actually pays, when it differs from the plan's price.
  ADD COLUMN price_minor     bigint,
  ADD COLUMN limit_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

-- One row per deliberate exception. `enabled` false is as meaningful as true:
-- it withdraws a feature the plan grants, without moving the customer off the
-- plan they pay for.
CREATE TABLE org_entitlements (
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled     boolean NOT NULL,
  note        text NOT NULL DEFAULT '',
  set_by      uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  set_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, feature_key)
);

-- org_entitlements carries org_id and is read by the tenant application, so it
-- is a tenant table like any other and the RLS guard will demand exactly this.
-- `plans` has no org_id: it is a global catalogue, like `permissions`, and the
-- guard passes over it for that reason rather than by an exception list.
ALTER TABLE org_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON org_entitlements
  USING (org_id = current_setting('app.org_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON plans TO ams_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON org_entitlements TO ams_platform;

-- The tenant application reads what it is allowed to do, and nothing else. It
-- has no business with a price, a contract date, or another tenant - and
-- GRANT ON ALL TABLES from migration 004 would have given it all three, so
-- the write privileges are taken back explicitly.
GRANT SELECT ON plans TO ams_app;
REVOKE INSERT, UPDATE, DELETE ON plans FROM ams_app;
REVOKE INSERT, UPDATE, DELETE ON org_entitlements FROM ams_app;
