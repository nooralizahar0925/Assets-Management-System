import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { isPermissionKey } from "../auth/permissions";

/**
 * Who a rule notifies.
 *
 * The plan keyed this on the old fixed role names. Phase 1b made roles tenant
 * data a customer can rename, so a rule saying "everyone with the admin role"
 * breaks the day somebody renames it. Two stable alternatives replace it:
 *
 *   * `permissions` - "everyone who can do X". Survives renames entirely, and
 *     says what the rule actually means: an overdue chase goes to people who
 *     manage assets, not to people with a particular job title.
 *   * `role_ids` - a specific role by id, for a customer who really does mean
 *     "the Night Shift role". Ids survive renames too.
 */
export const RecipientSpec = z.object({
  permissions: z.array(z.string().refine(isPermissionKey, "unknown permission")).optional(),
  role_ids: z.array(z.string().uuid()).optional(),
  user_ids: z.array(z.string().uuid()).optional(),
  emails: z.array(z.string().email()).optional(),
  assignee: z.boolean().optional(),
  actor: z.boolean().optional(),
});
export type RecipientSpec = z.infer<typeof RecipientSpec>;

export interface Recipient {
  email: string;
  name: string;
  user_id: string | null;
}

export interface EventContext {
  assigneeId?: string | null;
  actorId?: string | null;
  [key: string]: unknown;
}

/**
 * Turns a rule's recipient spec into concrete addresses. Deduplicated by email,
 * and filtered by each user's per-event preference - a literal address is never
 * filtered, because nobody has a preference row for an external contact.
 */
export async function resolveRecipients(
  ctx: Ctx,
  spec: RecipientSpec,
  context: EventContext,
  event?: string,
): Promise<Recipient[]> {
  const userIds = new Set<string>(spec.user_ids ?? []);
  if (spec.assignee && context.assigneeId) userIds.add(context.assigneeId);
  if (spec.actor && context.actorId) userIds.add(context.actorId);

  const users = await withTenant(ctx.orgId, async (c) => {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (spec.permissions?.length) {
      params.push(spec.permissions);
      clauses.push(
        `u.role_id IN (SELECT rp.role_id FROM role_permissions rp
                        WHERE rp.permission_key = ANY($${params.length}::text[]))`,
      );
    }
    if (spec.role_ids?.length) {
      params.push(spec.role_ids);
      clauses.push(`u.role_id = ANY($${params.length}::uuid[])`);
    }
    if (userIds.size) {
      params.push([...userIds]);
      clauses.push(`u.id = ANY($${params.length}::uuid[])`);
    }
    if (clauses.length === 0) return [];

    // A user opts out per event; absence of a row means opted in.
    const prefFilter = event
      ? `AND NOT EXISTS (
           SELECT 1 FROM notification_prefs p
            WHERE p.user_id = u.id AND p.event = $${params.push(event)}
              AND p.email_enabled = false)`
      : "";

    return (await c.query<Recipient>(
      `SELECT u.email, u.name, u.id AS user_id
         FROM users u
        WHERE (${clauses.join(" OR ")}) ${prefFilter}`,
      params,
    )).rows;
  });

  const byEmail = new Map<string, Recipient>();
  for (const user of users) byEmail.set(user.email.toLowerCase(), user);
  for (const address of spec.emails ?? []) {
    const key = address.toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, { email: address, name: address, user_id: null });
    }
  }
  return [...byEmail.values()];
}
