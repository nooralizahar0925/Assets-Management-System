-- Preventive maintenance: service every N days, or every N running hours.
--
-- Until now `maintenance.due` fired from the `next_service_at` custom field,
-- which holds one date and cannot express recurrence: servicing an asset left
-- the field pointing at a date in the past until somebody edited it by hand.
--
-- Running hours are a tenant-defined custom field whose key differs per
-- organisation (`hours_run` in the spec, `hours` elsewhere), so the schedule
-- carries its own reading rather than guessing which key to read. A telemetry
-- feed - spec UC-B5 - updates it the same way a person does.

CREATE TABLE maintenance_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id       uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  description    text NOT NULL,

  -- One or both. A schedule with neither would never come due.
  every_days     integer,
  every_hours    integer,

  next_due_at    date,
  next_due_hours integer,
  current_hours  integer,

  last_service_at date,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT maintenance_schedules_has_interval
    CHECK (every_days IS NOT NULL OR every_hours IS NOT NULL),
  CONSTRAINT maintenance_schedules_intervals_positive
    CHECK ((every_days IS NULL OR every_days > 0)
       AND (every_hours IS NULL OR every_hours > 0))
);

CREATE INDEX maintenance_schedules_due_idx
  ON maintenance_schedules (org_id, next_due_at) WHERE active;

CREATE TABLE maintenance_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The history outlives the schedule: deleting a schedule must not erase the
  -- record that the work was done.
  schedule_id uuid REFERENCES maintenance_schedules(id) ON DELETE SET NULL,
  asset_id    uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  serviced_at date NOT NULL,
  hours       integer,
  note        text,
  cost        numeric(14,2),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX maintenance_events_asset_idx
  ON maintenance_events (asset_id, serviced_at DESC);

-- Row-level security, exactly as 004_rls.sql establishes it. The anti-drift
-- test in db.rls.test.ts fails if any of the three parts is missing.
ALTER TABLE maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY maintenance_schedules_tenant ON maintenance_schedules
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);

ALTER TABLE maintenance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_events FORCE ROW LEVEL SECURITY;
CREATE POLICY maintenance_events_tenant ON maintenance_events
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_schedules TO ams_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON maintenance_events TO ams_app;
