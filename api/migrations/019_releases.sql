-- Release notes, and who has read them.
--
-- Releases are the product's, not a tenant's: every customer sees the same
-- list, so this table carries no org_id and no row-level security. It is
-- written by the release pipeline through the owner connection; the
-- application only reads it.

CREATE TABLE releases (
  version     text PRIMARY KEY,
  title       text NOT NULL,
  released_at date NOT NULL,
  -- [{ type: 'feature' | 'fix' | 'improvement', summary: '...' }]
  -- Written for the person using the system, not from commit subjects.
  entries     jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX releases_recent_idx ON releases (released_at DESC);

GRANT SELECT ON releases TO ams_app;

-- Which releases a person has read. Per person, not per organisation: one
-- colleague clearing the indicator must not clear it for everyone.
CREATE TABLE user_release_seen (
  org_id   uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version  text NOT NULL REFERENCES releases(version) ON DELETE CASCADE,
  seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version)
);

CREATE INDEX user_release_seen_org_idx ON user_release_seen (org_id);

ALTER TABLE user_release_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_release_seen FORCE ROW LEVEL SECURITY;
CREATE POLICY user_release_seen_tenant ON user_release_seen
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_release_seen TO ams_app;
