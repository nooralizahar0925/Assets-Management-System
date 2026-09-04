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
