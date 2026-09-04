-- Numbered 011 rather than the plan's 006: that number, and every one up to
-- 010, was taken by the auth-lookup, login-throttle, roles and report
-- migrations from phases 1, 1b and 3.

CREATE TABLE email_providers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL,
  from_email  text NOT NULL,
  from_name   text,
  reply_to    text,
  priority    integer NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- secret values encrypted
  verified_at timestamptz,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_providers_type_chk CHECK (
    type IN ('smtp', 'sendgrid', 'ses', 'postmark', 'mailgun', 'resend')),
  UNIQUE (org_id, name)
);
CREATE INDEX email_providers_order_idx
  ON email_providers (org_id, active, priority);

CREATE TABLE email_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key        text NOT NULL,
  subject    text NOT NULL,
  html_body  text NOT NULL,
  text_body  text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

CREATE TABLE email_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider_id   uuid REFERENCES email_providers(id) ON DELETE SET NULL,
  to_addresses  text[] NOT NULL,
  cc_addresses  text[] NOT NULL DEFAULT '{}',
  subject       text NOT NULL,
  html_body     text NOT NULL,
  text_body     text NOT NULL,
  attachments   jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{filename, object_key, content_type}]
  template_key  text,
  event         text,
  status        text NOT NULL DEFAULT 'queued',
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  provider_message_id text,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_messages_status_chk CHECK (
    status IN ('queued', 'sending', 'sent', 'failed', 'cancelled'))
);
-- The worker's claim query: due, not terminal, oldest first.
CREATE INDEX email_messages_due_idx
  ON email_messages (status, scheduled_for)
  WHERE status IN ('queued', 'sending');
CREATE INDEX email_messages_org_idx ON email_messages (org_id, created_at DESC);

DO $do$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_providers', 'email_templates', 'email_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (org_id = current_setting(''app.org_id'')::uuid)
         WITH CHECK (org_id = current_setting(''app.org_id'')::uuid)', t);
  END LOOP;
END $do$;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON email_providers, email_templates, email_messages TO ams_app;
