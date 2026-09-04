-- Spec §11. Nothing in the MVP writes to any of this. It exists now because
-- retrofitting custody-as-a-time-range onto live assignment data is a migration
-- nobody wants to run, and because a free-text external assignee cannot become a
-- customer record without backfilling by hand.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A counterparty that is not an employee: an external borrower today, a rental
-- customer later. MVP writes these only for `assignee_type = 'external'`.
CREATE TABLE parties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'company',   -- 'person' | 'company'
  relation        text NOT NULL DEFAULT 'customer',  -- 'employee'|'customer'|'supplier'
  name            text NOT NULL,
  email           text,
  phone           text,
  billing_address text,
  tax_id          text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parties_kind_chk CHECK (kind IN ('person', 'company')),
  CONSTRAINT parties_relation_chk
    CHECK (relation IN ('employee', 'customer', 'supplier'))
);
CREATE INDEX parties_org_idx ON parties (org_id, relation);

CREATE TYPE assignment_kind AS ENUM ('internal', 'rental');

ALTER TABLE assignments
  ADD COLUMN kind          assignment_kind NOT NULL DEFAULT 'internal',
  ADD COLUMN party_id      uuid REFERENCES parties(id) ON DELETE SET NULL,
  ADD COLUMN rate_snapshot jsonb,                 -- price agreed, frozen at booking
  ADD COLUMN charge_total  numeric(14,2),
  ADD COLUMN currency      char(3);

-- Future bookings. The exclusion constraint is the point: Postgres itself refuses
-- to store two live reservations that overlap in time for one asset, which no
-- amount of application code does reliably under concurrency.
CREATE TABLE reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id      uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  party_id      uuid REFERENCES parties(id) ON DELETE SET NULL,
  period        tstzrange NOT NULL,
  state         text NOT NULL DEFAULT 'held',
  assignment_id uuid REFERENCES assignments(id) ON DELETE SET NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservations_state_chk CHECK (
    state IN ('held', 'confirmed', 'collected', 'returned', 'cancelled')),
  CONSTRAINT reservations_no_double_book EXCLUDE USING gist (
    asset_id WITH =,
    period   WITH &&
  ) WHERE (state IN ('held', 'confirmed', 'collected'))
);
CREATE INDEX reservations_period_idx ON reservations USING gist (period);
CREATE INDEX reservations_org_asset_idx ON reservations (org_id, asset_id);

-- Attachments (Task 11) — photos, receipts, manuals. Rental condition evidence
-- lands here too.
CREATE TABLE attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id      uuid REFERENCES assets(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES assignments(id) ON DELETE CASCADE,
  kind          text NOT NULL DEFAULT 'file',  -- 'file'|'photo'|'condition_in'|'condition_out'
  object_key    text NOT NULL,
  filename      text NOT NULL,
  content_type  text NOT NULL,
  size_bytes    bigint NOT NULL,
  uploaded_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_asset_idx ON attachments (asset_id, created_at DESC);

-- Extend the tenant policy set to the tables added above.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['parties', 'reservations', 'attachments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON parties, reservations, attachments TO ams_app;
