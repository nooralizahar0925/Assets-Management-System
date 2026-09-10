-- Inviting a colleague.
--
-- Until now nothing in this system could create a user except provisioning,
-- which makes exactly one administrator. Every organisation was permanently a
-- one-person organisation, and the onboarding checklist told people to invite
-- colleagues using a screen that could only list the ones already there.
--
-- An invitation rather than a created account: the person choosing the password
-- should be the person who will use it. An administrator who types a colleague's
-- password knows it, and now has to send it somewhere.

CREATE TABLE user_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       text NOT NULL,
  name        text NOT NULL,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  -- Only the hash. The token itself exists in one email and nowhere else, in
  -- exactly the way an API key does.
  token_hash  text NOT NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  -- Kept when the inviter leaves: "who let them in" has to have an answer.
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The lookup on acceptance, which happens before any tenant is known.
CREATE UNIQUE INDEX user_invitations_token_idx ON user_invitations (token_hash);

-- One open invitation per address per organisation. Re-inviting somebody
-- replaces their invitation rather than leaving two live tokens, only one of
-- which anybody knows about.
CREATE UNIQUE INDEX user_invitations_pending_idx
  ON user_invitations (org_id, lower(email))
  WHERE accepted_at IS NULL;

CREATE INDEX user_invitations_org_idx ON user_invitations (org_id);

ALTER TABLE user_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_invitations
  USING (org_id = current_setting('app.org_id', true)::uuid);

-- Accepting an invitation happens before the tenant is known - the person
-- holding the link has no session and no organisation yet - so the lookup is
-- SECURITY DEFINER with a pinned search_path, exactly as sign-in is.
CREATE FUNCTION auth_lookup_invitation(p_token_hash text)
RETURNS TABLE (
  id uuid, org_id uuid, email text, name text, role_id uuid, expired boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $fn$
  SELECT i.id, i.org_id, i.email, i.name, i.role_id,
         (i.expires_at <= now()) AS expired
    FROM user_invitations i
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL;
$fn$;

REVOKE ALL ON FUNCTION auth_lookup_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_lookup_invitation(text) TO ams_app;

-- The console counts pending invitations against a plan's user limit, so
-- inviting twenty people onto a plan that allows ten is refused at the invite
-- rather than at the tenth acceptance.
GRANT SELECT ON user_invitations TO ams_platform;
