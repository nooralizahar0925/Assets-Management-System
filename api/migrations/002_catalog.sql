CREATE TABLE locations (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name      text NOT NULL,
  parent_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  address   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locations_org_idx ON locations (org_id);

CREATE TYPE category_kind AS ENUM ('it', 'equipment', 'media');

CREATE TABLE categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         category_kind NOT NULL,
  field_schema jsonb NOT NULL DEFAULT '{"fields": []}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
