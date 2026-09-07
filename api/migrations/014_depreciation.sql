-- Depreciation policy, and the month-end book values it produces.
--
-- Policy lives in two places on purpose. A category sets the rule for its kind
-- of asset - laptops over three years, forklifts reducing-balance at 20% - and
-- an individual asset overrides it for the exception, because the one machine
-- bought second-hand does not have the same life left as the rest.
--
-- Every override column on assets is nullable, and NULL means "inherit", which
-- is not the same as "zero". Resolution is field by field: overriding a useful
-- life must not silently reset the method alongside it.

CREATE TYPE depreciation_method AS ENUM ('none', 'straight_line', 'reducing_balance');

ALTER TABLE categories
  ADD COLUMN depreciation_method depreciation_method NOT NULL DEFAULT 'none',
  ADD COLUMN useful_life_months  integer,
  ADD COLUMN salvage_pct         numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN declining_rate_pct  numeric(5,2);

ALTER TABLE categories
  ADD CONSTRAINT categories_useful_life_positive
    CHECK (useful_life_months IS NULL OR useful_life_months > 0),
  ADD CONSTRAINT categories_salvage_pct_range
    CHECK (salvage_pct >= 0 AND salvage_pct <= 100),
  ADD CONSTRAINT categories_declining_rate_range
    CHECK (declining_rate_pct IS NULL
           OR (declining_rate_pct > 0 AND declining_rate_pct <= 100));

ALTER TABLE assets
  ADD COLUMN depreciation_method depreciation_method,
  ADD COLUMN useful_life_months  integer,
  ADD COLUMN salvage_pct         numeric(5,2),
  ADD COLUMN declining_rate_pct  numeric(5,2),
  -- Defaults to purchase_date. Kept separate because an asset can be bought in
  -- one month and brought into service in another, and depreciation follows
  -- use rather than purchase.
  ADD COLUMN depreciation_start  date;

ALTER TABLE assets
  ADD CONSTRAINT assets_useful_life_positive
    CHECK (useful_life_months IS NULL OR useful_life_months > 0),
  ADD CONSTRAINT assets_salvage_pct_range
    CHECK (salvage_pct IS NULL OR (salvage_pct >= 0 AND salvage_pct <= 100)),
  ADD CONSTRAINT assets_declining_rate_range
    CHECK (declining_rate_pct IS NULL
           OR (declining_rate_pct > 0 AND declining_rate_pct <= 100));

-- One row per asset per closed month. Finance reprints last quarter and gets
-- the same numbers, and a correction to cost made later does not rewrite a
-- figure that has already been reported.
CREATE TABLE asset_book_values (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id      uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  -- Always the last day of the month, so a period is unambiguous.
  period_end    date NOT NULL,
  method        depreciation_method NOT NULL,
  opening_value numeric(14,2) NOT NULL,
  charge        numeric(14,2) NOT NULL,
  closing_value numeric(14,2) NOT NULL,
  accumulated   numeric(14,2) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, period_end)
);

CREATE INDEX asset_book_values_org_period_idx
  ON asset_book_values (org_id, period_end DESC);

-- Row-level security, exactly as 004_rls.sql establishes it. Without FORCE the
-- table owner bypasses the policy; without a policy every tenant sees every
-- row. Both halves are required.
ALTER TABLE asset_book_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_book_values FORCE ROW LEVEL SECURITY;

CREATE POLICY asset_book_values_tenant ON asset_book_values
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON asset_book_values TO ams_app;
