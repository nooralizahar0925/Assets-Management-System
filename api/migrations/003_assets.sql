CREATE TYPE asset_status AS ENUM
  ('available', 'in_use', 'maintenance', 'retired', 'lost');

CREATE TABLE assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_tag     text NOT NULL,
  name          text NOT NULL,
  description   text,
  category_id   uuid REFERENCES categories(id) ON DELETE SET NULL,
  serial_no     text,
  status        asset_status NOT NULL DEFAULT 'available',
  location_id   uuid REFERENCES locations(id) ON DELETE SET NULL,
  assignee_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  purchase_date date,
  purchase_cost numeric(14,2),
  currency      char(3) NOT NULL DEFAULT 'IDR',
  custom        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE UNIQUE INDEX assets_org_tag_idx ON assets (org_id, asset_tag)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX assets_org_serial_idx ON assets (org_id, serial_no)
  WHERE serial_no IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX assets_org_status_idx   ON assets (org_id, status);
CREATE INDEX assets_org_category_idx ON assets (org_id, category_id);
CREATE INDEX assets_org_location_idx ON assets (org_id, location_id);
CREATE INDEX assets_custom_gin_idx   ON assets USING gin (custom jsonb_path_ops);
CREATE INDEX assets_search_idx ON assets
  USING gin ((name || ' ' || coalesce(serial_no, '') || ' ' || asset_tag) gin_trgm_ops);

CREATE TYPE assignee_type AS ENUM ('user', 'location', 'external');

CREATE TABLE assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id       uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  assignee_type  assignee_type NOT NULL,
  assignee_id    uuid,
  assignee_label text,
  location_id    uuid REFERENCES locations(id) ON DELETE SET NULL,
  checked_out_at timestamptz NOT NULL DEFAULT now(),
  checked_out_by uuid REFERENCES users(id) ON DELETE SET NULL,
  due_at         timestamptz,
  checked_in_at  timestamptz,
  checked_in_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  checkout_note  text,
  checkin_note   text,
  condition      text
);
CREATE INDEX assignments_asset_idx ON assignments (asset_id, checked_out_at DESC);
-- At most one open assignment per asset.
CREATE UNIQUE INDEX assignments_one_open_idx ON assignments (asset_id)
  WHERE checked_in_at IS NULL;

CREATE TABLE audit_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id   uuid REFERENCES assets(id) ON DELETE CASCADE,
  actor_type text NOT NULL,                -- 'user' | 'api_key' | 'system'
  actor_id   uuid,
  actor_label text,
  event      text NOT NULL,                -- 'asset.created', 'asset.checked_out', ...
  changes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_asset_idx ON audit_events (asset_id, created_at DESC);
CREATE INDEX audit_org_time_idx ON audit_events (org_id, created_at DESC);

CREATE TABLE import_jobs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  filename   text NOT NULL,
  status     text NOT NULL DEFAULT 'pending',
  dry_run    boolean NOT NULL DEFAULT true,
  total      integer NOT NULL DEFAULT 0,
  created    integer NOT NULL DEFAULT 0,
  updated    integer NOT NULL DEFAULT 0,
  errors     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhooks (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url     text NOT NULL,
  secret  text NOT NULL,
  events  text[] NOT NULL DEFAULT '{}',
  active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  key        text NOT NULL,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  response   jsonb NOT NULL,
  status     integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key)
);

CREATE TABLE rate_limit_events (
  api_key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_limit_lookup_idx ON rate_limit_events (api_key_id, occurred_at DESC);
