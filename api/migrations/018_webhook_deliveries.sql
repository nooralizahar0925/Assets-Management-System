-- The webhook delivery queue.
--
-- The webhooks table has existed since 003; nothing ever delivered to it.
-- Deliveries are queued rather than sent inline because a customer's endpoint
-- being slow or down must not slow down or fail the request that triggered it -
-- checking an asset out should not wait on somebody else's server.

CREATE TABLE webhook_deliveries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  webhook_id   uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event        text NOT NULL,
  payload      jsonb NOT NULL,
  -- pending | delivered | failed
  status       text NOT NULL DEFAULT 'pending',
  attempts     integer NOT NULL DEFAULT 0,
  -- When the next attempt becomes eligible. Backoff is a time, not a sleep:
  -- the worker is a sweep, and holding a connection open to wait would tie up
  -- the pool for a customer's outage.
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status  integer,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX webhook_deliveries_pending_idx
  ON webhook_deliveries (org_id, next_attempt_at)
  WHERE status = 'pending';

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_tenant ON webhook_deliveries
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_deliveries TO ams_app;
