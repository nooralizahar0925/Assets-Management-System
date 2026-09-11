import { withPlatform } from "./db";

/**
 * What a customer currently holds, for the console.
 *
 * Read over the platform connection, which holds SELECT on exactly these and
 * nothing else: counts and sizes, never the contents. The operator needs to
 * know that a customer is near their cap; they have no business reading the
 * register to find out.
 *
 * Counted the same way the limits are enforced - live assets only - so the
 * number the console shows is the number that decides whether the next write
 * is refused. Two different counts for the same question is how an operator
 * comes to distrust the screen.
 */

export interface Usage {
  assets: number;
  users: number;
  pending_invitations: number;
  storage_mb: number;
}

export async function orgUsage(orgId: string): Promise<Usage> {
  return withPlatform(async (c) => {
    const row = (await c.query<{
      assets: string; users: string; pending_invitations: string; storage_bytes: string;
    }>(
      `SELECT
         (SELECT count(*) FROM assets
           WHERE org_id = $1 AND deleted_at IS NULL) AS assets,
         (SELECT count(*) FROM users WHERE org_id = $1) AS users,
         (SELECT count(*) FROM user_invitations
           WHERE org_id = $1 AND accepted_at IS NULL AND expires_at > now())
           AS pending_invitations,
         (SELECT coalesce(sum(size_bytes), 0) FROM attachments
           WHERE org_id = $1) AS storage_bytes`,
      [orgId],
    )).rows[0];

    return {
      assets: Number(row.assets),
      users: Number(row.users),
      pending_invitations: Number(row.pending_invitations),
      // Rounded up: a customer 1.2 MB into a 1 MB allowance is over it, and
      // rounding down would show them inside a limit they have passed.
      storage_mb: Math.ceil(Number(row.storage_bytes) / 1_048_576),
    };
  });
}
