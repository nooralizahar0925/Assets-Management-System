-- Failed sign-in attempts, for throttling.
--
-- This table deliberately has no org_id and no row-level security. Login is a
-- pre-tenant operation - the tenant is not known until the credential resolves
-- - so there is no org to scope a policy to. It holds no tenant data: only a
-- SHA-256 of the lowercased email (never the address itself) or a client
-- address, and a timestamp.
CREATE TABLE login_attempts (
  id          bigserial PRIMARY KEY,
  -- 'email:<sha256 hex>' or 'ip:<address>'. Prefixed so one index serves both
  -- and the two thresholds cannot collide with each other.
  key         text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX login_attempts_key_time_idx
  ON login_attempts (key, occurred_at DESC);

GRANT SELECT, INSERT, DELETE ON login_attempts TO ams_app;
GRANT USAGE, SELECT ON SEQUENCE login_attempts_id_seq TO ams_app;
