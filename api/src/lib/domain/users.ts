import { withTenant } from "../db";
import type { Ctx } from "../http/handler";

export interface AssignableUser {
  id: string;
  name: string;
  assigned_count: number;
}

/**
 * The people an asset can be checked out to.
 *
 * Deliberately a picker, not the administrative user list: it returns names and
 * how much each already holds, and no email or role. Anyone who can check an
 * asset out needs this, including a technician who holds no users:read - and
 * colleagues' names are not sensitive within an organisation, while the
 * administrative list is a separate endpoint behind users:read.
 */
export const listAssignableUsers = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<AssignableUser>(
      `SELECT u.id, u.name,
              count(a.id) FILTER (WHERE a.deleted_at IS NULL)::int AS assigned_count
         FROM users u
         LEFT JOIN assets a ON a.assignee_id = u.id
        GROUP BY u.id
        ORDER BY u.name`,
    )).rows,
  );

export interface OrgMember {
  id: string;
  name: string;
  email: string;
  role_id: string | null;
  role_name: string | null;
  /** Empty means organisation-wide. */
  location_ids: string[];
  assigned_count: number;
}

/**
 * The administrator's view of the people in an organisation: who they are, what
 * role they hold and which branches they are limited to. Separate from
 * listAssignableUsers, which is the check-out picker and deliberately exposes
 * neither email addresses nor roles to everyone who can issue an asset.
 */
export const listMembers = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<OrgMember>(
      `SELECT u.id, u.name, u.email,
              u.role_id, r.name AS role_name,
              coalesce(array_agg(DISTINCT s.location_id)
                       FILTER (WHERE s.location_id IS NOT NULL), '{}') AS location_ids,
              count(DISTINCT a.id) FILTER (WHERE a.deleted_at IS NULL)::int
                AS assigned_count
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         LEFT JOIN user_location_scopes s ON s.user_id = u.id
         LEFT JOIN assets a ON a.assignee_id = u.id
        GROUP BY u.id, r.name
        ORDER BY lower(u.name)`,
    )).rows,
  );
