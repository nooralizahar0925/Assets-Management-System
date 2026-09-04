CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE user_role AS ENUM ('admin', 'manager', 'technician', 'viewer');

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         text NOT NULL,
  password_hash text NOT NULL,
  name          text NOT NULL,
  role          user_role NOT NULL DEFAULT 'viewer',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness per tenant; login looks up with lower(email).
CREATE UNIQUE INDEX users_org_email_idx ON users (org_id, lower(email));
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

CREATE TABLE sessions (
  id         text PRIMARY KEY,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL UNIQUE,
  key_hash     text NOT NULL,
  scopes       text[] NOT NULL DEFAULT '{}',
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_org_idx ON api_keys (org_id);
