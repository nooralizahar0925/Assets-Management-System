import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { listMembers } from "@/lib/domain/users";
import {
  inviteUser, listInvitations, InviteInput,
  EmailTakenError, InvitationInvalidError,
} from "@/lib/domain/invitations";
import { assertWithinLimit } from "@/lib/entitlements";
import { enqueueTemplated } from "@/lib/email/outbox";
import { logError } from "@/lib/http/logger";
import { validationProblem, problem, conflict } from "@/lib/http/problem";

export const GET = safe(async (req: Request) => {
  // users:read, not assets:read: this carries email addresses and roles, which
  // the check-out picker at /api/v1/users deliberately withholds.
  const ctx = await requireAuth(req, "users:read");
  if (isResponse(ctx)) return ctx;

  // Invitations travel with the members. The People page has to show somebody
  // who has been invited and not yet accepted, or an administrator invites
  // them twice and wonders why nothing happened the first time.
  return Response.json({
    data: await listMembers(ctx),
    invitations: await listInvitations(ctx),
  });
});

const baseUrl = () => (process.env.APP_BASE_URL ?? "http://localhost:3000")
  .replace(/\/$/, "");

/**
 * Invites somebody to this organisation.
 *
 * An invitation rather than an account with a password an administrator
 * chooses: the person who will use the account should be the one who knows its
 * password, or it ends up in a chat message that outlives the job.
 */
export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "users:write");
  if (isResponse(ctx)) return ctx;

  const parsed = InviteInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  // Pending invitations count too, so twenty invitations onto a plan that
  // allows ten are refused now rather than one at a time, at acceptance, to
  // people who have done nothing wrong.
  const capped = await assertWithinLimit(ctx, "max_users");
  if (capped) return capped;

  try {
    const invitation = await inviteUser(ctx, parsed.data);

    // The link carries the only copy of the token. If the email cannot be
    // queued the invitation is still valid, so the failure is logged rather
    // than thrown - and the response says whether it went.
    let emailed = true;
    try {
      await enqueueTemplated(ctx, "user.invite", [invitation.email], {
        actor: { name: ctx.actor.label },
        recipient: { name: invitation.name, role: invitation.role_name },
        links: { invite: `${baseUrl()}/accept-invitation/${invitation.token}` },
      }, { event: "user.invite" });
    } catch (err) {
      logError("invitation email", err);
      emailed = false;
    }

    // The token is not returned. It belongs in the email, and putting it in a
    // response would let anybody who can invite also impersonate the invitee.
    return Response.json({
      id: invitation.id,
      email: invitation.email,
      name: invitation.name,
      role_name: invitation.role_name,
      expires_at: invitation.expires_at,
      emailed,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof EmailTakenError) return conflict(err.message);
    if (err instanceof InvitationInvalidError) {
      return problem(422, "validation", "Validation failed", { detail: err.message });
    }
    throw err;
  }
});
