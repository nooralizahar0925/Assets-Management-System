import { z } from "zod";
import { withTenant } from "../db";
import { PERMISSIONS, isPermissionKey, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";

export class SystemRoleError extends Error {}
export class RoleInUseError extends Error {}
export class LastAdministratorError extends Error {}
export class DuplicateRoleError extends Error {}

const PermissionList = z
  .array(z.string().refine(isPermissionKey, "unknown permission"))
  .min(1);

export const RoleInput = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(400).optional(),
  permissions: PermissionList,
});

export const RolePatch = RoleInput.partial();

export interface Role {
  id: string;
  name: string;
  description: string;
  is_system: boolean;
  permissions: PermissionKey[];
  user_count: number;
}

/**
 * Guards the organisation against losing its last administrator.
 *
 * Counts the people who would still hold a role granting `roles:write` after
 * the change. If that reaches zero, one careless edit has left nobody able to
 * undo it, and only a database operator could recover the account.
 *
 * Note this counts people, not API keys. A key with the admin scope can still
 * call the API, but a key is not somebody who can be asked to fix things, so it
 * does not count as cover.
 */
async function assertNotLastAdministrator(
  ctx: Ctx,
  change:
    | { kind: "role"; roleId: string; keepsRolesWrite: boolean }
    | { kind: "assign"; userId: string; toRoleId: string },
): Promise<void> {
  await withTenant(ctx.orgId, async (c) => {
    if (change.kind === "assign") {
      // If the destination role grants roles:write, nobody is losing anything.
      const { rows: dest } = await c.query(
        `SELECT 1 FROM role_permissions
          WHERE role_id = $1 AND permission_key = 'roles:write'`,
        [change.toRoleId],
      );
      if (dest.length > 0) return;
    } else if (change.keepsRolesWrite) {
      return;
    }

    const excludedRole = change.kind === "role" ? change.roleId : null;
    const excludedUser = change.kind === "assign" ? change.userId : null;

    const { rows } = await c.query<{ n: string }>(
      `SELECT count(DISTINCT u.id) AS n
         FROM users u
         JOIN role_permissions rp ON rp.role_id = u.role_id
        WHERE u.org_id = $1
          AND rp.permission_key = 'roles:write'
          AND ($2::uuid IS NULL OR u.role_id <> $2)
          AND ($3::uuid IS NULL OR u.id <> $3)`,
      [ctx.orgId, excludedRole, excludedUser],
    );

    if (Number(rows[0].n) === 0) {
      throw new LastAdministratorError(
        "This would leave nobody able to manage roles. Give another person a " +
          "role that includes 'Manage roles' first.",
      );
    }
  });
}

export async function listRoles(ctx: Ctx): Promise<Role[]> {
  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<Role>(
      `SELECT r.id, r.name, r.description, r.is_system,
              coalesce(array_agg(rp.permission_key)
                       FILTER (WHERE rp.permission_key IS NOT NULL), '{}') AS permissions,
              (SELECT count(*) FROM users u WHERE u.role_id = r.id)::int AS user_count
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        GROUP BY r.id
        ORDER BY r.is_system DESC, lower(r.name)`,
    );
    return rows;
  });
}

export async function createRole(
  ctx: Ctx,
  input: z.infer<typeof RoleInput>,
): Promise<Role> {
  const parsed = RoleInput.parse(input);
  return withTenant(ctx.orgId, async (c) => {
    let roleId: string;
    try {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO roles (org_id, name, description)
         VALUES ($1, $2, $3) RETURNING id`,
        [ctx.orgId, parsed.name, parsed.description ?? ""],
      );
      roleId = rows[0].id;
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new DuplicateRoleError(`A role called "${parsed.name}" already exists.`);
      }
      throw err;
    }

    await c.query(
      `INSERT INTO role_permissions (org_id, role_id, permission_key)
       SELECT $1, $2, unnest($3::text[])`,
      [ctx.orgId, roleId, parsed.permissions],
    );

    return {
      id: roleId,
      name: parsed.name,
      description: parsed.description ?? "",
      is_system: false,
      permissions: parsed.permissions as PermissionKey[],
      user_count: 0,
    };
  });
}

export async function updateRole(
  ctx: Ctx,
  id: string,
  patch: z.infer<typeof RolePatch>,
): Promise<Role> {
  const parsed = RolePatch.parse(patch);

  if (parsed.permissions) {
    await assertNotLastAdministrator(ctx, {
      kind: "role",
      roleId: id,
      keepsRolesWrite: parsed.permissions.includes("roles:write"),
    });
  }

  await withTenant(ctx.orgId, async (c) => {
    if (parsed.name !== undefined || parsed.description !== undefined) {
      try {
        await c.query(
          `UPDATE roles
              SET name = coalesce($2, name),
                  description = coalesce($3, description)
            WHERE id = $1`,
          [id, parsed.name ?? null, parsed.description ?? null],
        );
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          throw new DuplicateRoleError(
            `A role called "${parsed.name}" already exists.`,
          );
        }
        throw err;
      }
    }
    if (parsed.permissions) {
      // Replace, not merge: the editor sends the complete set, and merging
      // would make unticking a box do nothing.
      await c.query("DELETE FROM role_permissions WHERE role_id = $1", [id]);
      await c.query(
        `INSERT INTO role_permissions (org_id, role_id, permission_key)
         SELECT $1, $2, unnest($3::text[])`,
        [ctx.orgId, id, parsed.permissions],
      );
    }
  });

  const role = (await listRoles(ctx)).find((r) => r.id === id);
  if (!role) throw new Error(`role ${id} vanished during update`);
  return role;
}

export async function deleteRole(ctx: Ctx, id: string): Promise<boolean> {
  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<{ is_system: boolean; holders: string }>(
      `SELECT r.is_system,
              (SELECT count(*) FROM users u WHERE u.role_id = r.id) AS holders
         FROM roles r WHERE r.id = $1`,
      [id],
    );
    const role = rows[0];
    if (!role) return false;

    if (role.is_system) {
      throw new SystemRoleError("The roles the product ships with cannot be deleted.");
    }
    if (Number(role.holders) > 0) {
      throw new RoleInUseError(
        `${role.holders} people still hold this role. Move them to another role first.`,
      );
    }

    await c.query("DELETE FROM roles WHERE id = $1", [id]);
    return true;
  });
}

export async function assignRole(
  ctx: Ctx,
  userId: string,
  roleId: string,
  locationIds: string[],
): Promise<{ userId: string; roleId: string; locationIds: string[] }> {
  await assertNotLastAdministrator(ctx, { kind: "assign", userId, toRoleId: roleId });

  return withTenant(ctx.orgId, async (c) => {
    await c.query("UPDATE users SET role_id = $2 WHERE id = $1", [userId, roleId]);
    await c.query("DELETE FROM user_location_scopes WHERE user_id = $1", [userId]);
    if (locationIds.length > 0) {
      await c.query(
        `INSERT INTO user_location_scopes (org_id, user_id, location_id)
         SELECT $1, $2, unnest($3::uuid[])`,
        [ctx.orgId, userId, locationIds],
      );
    }
    return { userId, roleId, locationIds };
  });
}

/** The vocabulary, grouped, for the role editor. */
export const permissionCatalogue = () => {
  const groups = new Map<string, (typeof PERMISSIONS)[number][]>();
  for (const p of PERMISSIONS) {
    const list = groups.get(p.group) ?? [];
    list.push(p);
    groups.set(p.group, list);
  }
  return [...groups.entries()].map(([group, permissions]) => ({ group, permissions }));
};
