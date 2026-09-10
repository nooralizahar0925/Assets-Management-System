import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { query, withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { hashPassword } from "../auth/password";

/**
 * Inviting somebody, and their accepting.
 *
 * The person who will use the account chooses its password. An administrator
 * who types a colleague's password knows it, and then has to send it somewhere
 * - which is how a password ends up in a chat message that outlives the job.
 *
 * The token exists in one email and nowhere else: only its hash is stored, as
 * with an API key. Losing the email means asking for another invitation, not
 * recovering the old one.
 */

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Matches the 72 hours the email template promises. */
const TTL_HOURS = 72;

export class EmailTakenError extends Error {}
export class InvitationInvalidError extends Error {}

export const InviteInput = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  role_id: z.string().uuid(),
});
export type InviteInput = z.infer<typeof InviteInput>;

export interface Invitation {
  id: string;
  email: string;
  name: string;
  role_id: string;
  role_name: string | null;
  expires_at: string;
  created_at: string;
}

export interface CreatedInvitation extends Invitation {
  /** Returned once, for the link in the email. Never stored. */
  token: string;
}

/**
 * Creates or replaces an invitation.
 *
 * Replaces, because re-inviting somebody who has lost the email must not leave
 * two live tokens with only one of them known to anybody.
 */
export async function inviteUser(
  ctx: Ctx,
  raw: InviteInput,
): Promise<CreatedInvitation> {
  const input = InviteInput.parse(raw);
  const token = randomBytes(32).toString("base64url");

  // users_email_idx is unique across the whole deployment, not per tenant:
  // sign-in resolves an address to one account before it knows the
  // organisation. An address already in use anywhere cannot be invited, and
  // saying so plainly is better than a constraint violation at acceptance.
  const existing = await query<{ n: string }>(
    "SELECT count(*) AS n FROM auth_lookup_user_by_email($1)", [input.email],
  );
  if (Number(existing[0].n) > 0) {
    throw new EmailTakenError(
      `${input.email} already has an account. If they should be in this `
      + "organisation instead, they need to be removed from the other one "
      + "first - one address is one person.",
    );
  }

  return withTenant(ctx.orgId, async (c) => {
    const role = (await c.query<{ name: string }>(
      "SELECT name FROM roles WHERE id = $1", [input.role_id],
    )).rows[0];
    if (!role) {
      throw new InvitationInvalidError(
        "No such role in this organisation. Somebody invited to a role that "
        + "does not exist would hold no permissions at all.",
      );
    }

    const { rows } = await c.query<Invitation>(
      `INSERT INTO user_invitations
         (org_id, email, name, role_id, token_hash, expires_at, invited_by)
       VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' hours')::interval, $7)
       ON CONFLICT (org_id, lower(email)) WHERE accepted_at IS NULL
       DO UPDATE SET
         name = EXCLUDED.name,
         role_id = EXCLUDED.role_id,
         token_hash = EXCLUDED.token_hash,
         expires_at = EXCLUDED.expires_at,
         invited_by = EXCLUDED.invited_by,
         created_at = now()
       RETURNING id, email, name, role_id, expires_at, created_at`,
      [
        ctx.orgId, input.email, input.name, input.role_id, sha256(token),
        String(TTL_HOURS), ctx.actor.type === "user" ? ctx.actor.id : null,
      ],
    );

    return { ...rows[0], role_name: role.name, token };
  });
}

/** Invitations still waiting to be accepted, newest first. */
export const listInvitations = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Invitation>(
      `SELECT i.id, i.email, i.name, i.role_id, r.name AS role_name,
              i.expires_at, i.created_at
         FROM user_invitations i
         LEFT JOIN roles r ON r.id = i.role_id
        WHERE i.accepted_at IS NULL
        ORDER BY i.created_at DESC`,
    )).rows,
  );

export const revokeInvitation = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query(
      "DELETE FROM user_invitations WHERE id = $1 AND accepted_at IS NULL", [id],
    )).rowCount === 1,
  );

/** Pending invitations count towards a plan's user limit. */
export const pendingInvitationCount = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    Number((await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM user_invitations
        WHERE accepted_at IS NULL AND expires_at > now()`,
    )).rows[0].n),
  );

export interface AcceptedInvitation {
  userId: string;
  orgId: string;
  email: string;
}

/**
 * Turns an invitation into an account.
 *
 * Runs before any tenant is known - the person holding the link has no session
 * - so the lookup goes through a SECURITY DEFINER function, exactly as sign-in
 * does. Expiry and "already accepted" give the same answer as a wrong token:
 * this endpoint is public, and three different answers would let somebody
 * probe which invitations exist.
 */
export async function acceptInvitation(
  token: string,
  password: string,
): Promise<AcceptedInvitation> {
  const rows = await query<{
    id: string; org_id: string; email: string; name: string;
    role_id: string; expired: boolean;
  }>("SELECT * FROM auth_lookup_invitation($1)", [sha256(token)]);

  const invitation = rows[0];
  if (!invitation || invitation.expired) {
    throw new InvitationInvalidError(
      "This invitation is not valid any more. It may have been used already, "
      + "or it may have expired - ask whoever invited you to send another.",
    );
  }

  const passwordHash = await hashPassword(password);

  return withTenant(invitation.org_id, async (c) => {
    const { rows: created } = await c.query<{ id: string }>(
      `INSERT INTO users (org_id, email, password_hash, name, role_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        invitation.org_id, invitation.email, passwordHash,
        invitation.name, invitation.role_id,
      ],
    );

    // Marked used in the same transaction as the account it created, so a
    // token cannot make two accounts if two people click at once.
    await c.query(
      "UPDATE user_invitations SET accepted_at = now() WHERE id = $1",
      [invitation.id],
    );

    return {
      userId: created[0].id,
      orgId: invitation.org_id,
      email: invitation.email,
    };
  });
}
