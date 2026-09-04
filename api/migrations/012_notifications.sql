-- Numbered 012 rather than the plan's 007: that number was taken by the login
-- throttle in phase 1.

CREATE TABLE notification_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event          text NOT NULL,
  channel        text NOT NULL DEFAULT 'email',
  template_key   text NOT NULL,
  recipient_spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_rules_channel_chk CHECK (channel IN ('email', 'webhook')),
  UNIQUE (org_id, event, channel, template_key)
);
CREATE INDEX notification_rules_lookup_idx
  ON notification_rules (org_id, event, active);

CREATE TABLE notification_prefs (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event         text NOT NULL,
  email_enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, event)
);

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['notification_rules', 'notification_prefs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $do$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON notification_rules, notification_prefs TO ams_app;
