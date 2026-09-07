import type { Client } from "pg";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/lib/auth/permissions";
import { seedDefaultRulesWithClient } from "../src/lib/notify/rules";

/**
 * Reconciles the permissions table and every organisation's system roles with
 * the code.
 *
 * Idempotent, and run by migrate.ts after the migrations, so adding a
 * permission in code is picked up by the next deploy rather than needing a
 * hand-written migration each time. PERMISSIONS is the source of truth; the
 * table exists only so role_permissions can carry a foreign key.
 */
export async function seedPermissions(client: Client): Promise<void> {
  for (const p of PERMISSIONS) {
    await client.query(
      `INSERT INTO permissions (key, label, description, "group")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE
         SET label = EXCLUDED.label,
             description = EXCLUDED.description,
             "group" = EXCLUDED."group"`,
      [p.key, p.label, p.description, p.group],
    );
  }

  const { rows: orgs } = await client.query<{ id: string }>(
    "SELECT id FROM organizations",
  );

  for (const org of orgs) {
    await seedRolesForOrg(client, org.id);
  }
}

/**
 * Gives one organisation the system roles and their grants, then backfills any
 * user still without a role_id from the legacy enum column.
 */
export async function seedRolesForOrg(client: Client, orgId: string): Promise<void> {
  await client.query("SELECT seed_system_roles($1)", [orgId]);

  // An organisation with no notification rules sends no mail whatever happens.
  await seedDefaultRulesWithClient(client, orgId);

  for (const [name, role] of Object.entries(SYSTEM_ROLES)) {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM roles WHERE org_id = $1 AND lower(name) = lower($2)",
      [orgId, name],
    );
    const roleId = rows[0]?.id;
    if (!roleId) continue;

    // A system role's grants track the code. A customer who wants different
    // grants makes their own role; that is what custom roles are for.
    await client.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
    for (const key of role.permissions) {
      await client.query(
        `INSERT INTO role_permissions (org_id, role_id, permission_key)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [orgId, roleId, key],
      );
    }
  }

  // Backfill: give every user without a role_id the role matching the enum
  // column they already carry. users.role stays for one release, per the
  // additive-migration constraint - add, backfill, switch, drop later.
  await client.query(
    `UPDATE users u
        SET role_id = r.id
       FROM roles r
      WHERE u.org_id = $1
        AND r.org_id = $1
        AND u.role_id IS NULL
        AND lower(r.name) = CASE u.role
                              WHEN 'admin'      THEN 'administrator'
                              WHEN 'manager'    THEN 'manager'
                              WHEN 'technician' THEN 'technician'
                              ELSE 'viewer'
                            END`,
    [orgId],
  );
}
