-- Stock-take: counting what is actually at a location against what the
-- register believes is there.
--
-- A session, not a scan list. The difference is `expected_ids`, captured when
-- counting begins: without it, an asset legitimately moved to another site
-- halfway through the count reads as missing, and the whole exercise produces
-- a list of false alarms nobody trusts.

CREATE TYPE stocktake_status AS ENUM ('open', 'closed', 'abandoned');

CREATE TABLE stocktake_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- A location can be removed while its historical counts stay readable.
  location_id  uuid REFERENCES locations(id) ON DELETE SET NULL,
  name         text NOT NULL,
  status       stocktake_status NOT NULL DEFAULT 'open',
  opened_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  expected_ids uuid[] NOT NULL DEFAULT '{}'
);

CREATE INDEX stocktake_sessions_org_idx
  ON stocktake_sessions (org_id, opened_at DESC);

CREATE TABLE stocktake_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
  -- Null when the scanned tag matched nothing. The row is kept anyway: an
  -- unreadable or foreign label is evidence, and silently dropping the scan
  -- would leave the counter believing it registered.
  asset_id    uuid REFERENCES assets(id) ON DELETE CASCADE,
  scanned_tag text NOT NULL,
  counted_at  timestamptz NOT NULL DEFAULT now(),
  counted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- One line per asset per session. A rescan is reported, not recorded twice.
  UNIQUE (session_id, asset_id)
);

CREATE INDEX stocktake_lines_session_idx ON stocktake_lines (session_id);

-- Row-level security, exactly as 004_rls.sql establishes it. The anti-drift
-- test in db.rls.test.ts fails if any of the three parts is missing.
ALTER TABLE stocktake_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocktake_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY stocktake_sessions_tenant ON stocktake_sessions
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);

ALTER TABLE stocktake_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stocktake_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY stocktake_lines_tenant ON stocktake_lines
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON stocktake_sessions TO ams_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON stocktake_lines TO ams_app;
