-- A system role must survive a careless DELETE, but not outlive its
-- organisation.
--
-- The original trigger refused every delete of a system role, including the
-- cascade from `DELETE FROM organizations`. That made removing a tenant
-- impossible, and broke the seed's own rollback: the path that exists so a
-- half-seeded organisation is discarded rather than left behind threw, and
-- left behind exactly the half-seeded organisation it was written to prevent.
--
-- During a cascade the parent row is already gone by the time this fires, so
-- "is the organisation still there?" separates a careless delete of one role
-- from the deliberate removal of the whole tenant.
CREATE OR REPLACE FUNCTION forbid_system_role_delete() RETURNS trigger AS $fn$
BEGIN
  IF OLD.is_system
     AND EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RAISE EXCEPTION 'cannot delete the system role "%"', OLD.name
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN OLD;
END $fn$ LANGUAGE plpgsql;
