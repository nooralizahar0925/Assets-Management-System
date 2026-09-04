-- Numbered 010 rather than the plan's 008: 006 through 009 were taken by the
-- auth lookup functions, the login throttle, roles, and the role-aware auth
-- lookups from phases 1 and 1b.

CREATE TABLE saved_reports (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  report_key text NOT NULL,
  params     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);
CREATE INDEX saved_reports_org_idx ON saved_reports (org_id);

CREATE TABLE report_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  saved_report_id uuid NOT NULL REFERENCES saved_reports(id) ON DELETE CASCADE,
  format          text NOT NULL DEFAULT 'pdf',
  cadence         text NOT NULL DEFAULT 'weekly',
  day_of_week     integer,          -- 0=Sunday .. 6=Saturday, weekly only
  day_of_month    integer,          -- 1..28, monthly only
  hour_utc        integer NOT NULL DEFAULT 8,
  recipients      jsonb NOT NULL DEFAULT '[]'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  last_run_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_schedules_format_chk CHECK (format IN ('csv','xlsx','pdf','png')),
  CONSTRAINT report_schedules_cadence_chk CHECK (cadence IN ('daily','weekly','monthly')),
  CONSTRAINT report_schedules_hour_chk CHECK (hour_utc BETWEEN 0 AND 23),
  CONSTRAINT report_schedules_dow_chk
    CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  -- Capped at 28 so a monthly schedule fires in February too.
  CONSTRAINT report_schedules_dom_chk
    CHECK (day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28)
);
CREATE INDEX report_schedules_active_idx ON report_schedules (active, hour_utc);

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['saved_reports', 'report_schedules'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $do$;

GRANT SELECT, INSERT, UPDATE, DELETE ON saved_reports, report_schedules TO ams_app;
