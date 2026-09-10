import { z } from "zod";
import { safe } from "@/lib/http/handler";
import { acceptInvitation, InvitationInvalidError } from "@/lib/domain/invitations";
import { createSession, sessionCookie } from "@/lib/auth/session";
import {
  checkLoginThrottle, recordFailedLogin, clientAddress,
} from "@/lib/auth/loginThrottle";
import { validationProblem, problem } from "@/lib/http/problem";

const Body = z.object({
  token: z.string().min(20),
  // The same floor sign-in enforces. Somebody choosing their password for the
  // first time is exactly who should not be allowed a weak one.
  password: z.string().min(8).max(200),
});

/**
 * Turns an invitation into an account, and signs them straight in.
 *
 * Public: whoever holds the link has no session and no organisation yet. The
 * token is the credential, so the same throttle that protects sign-in protects
 * this - a public endpoint that takes a guessable secret and is not rate
 * limited is a way to enumerate tokens at leisure.
 */
export const POST = safe(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const ip = clientAddress(req);
  // Keyed by address, since there is no email to key on until the token
  // resolves - and by then a guess has already cost a database lookup.
  const throttle = await checkLoginThrottle(`invite:${ip}`, ip);
  if (throttle.blocked) {
    const res = problem(429, "rate-limited", "Too many attempts", {
      detail: "Too many attempts. Try again shortly.",
    });
    res.headers.set("Retry-After", String(throttle.retryAfterSeconds));
    return res;
  }

  try {
    const { userId, orgId, email } = await acceptInvitation(
      parsed.data.token, parsed.data.password,
    );

    // Signed in immediately. Making somebody who has just chosen a password
    // type it again on the next screen is a pointless way to greet them.
    const sid = await createSession(userId, orgId);
    return Response.json(
      { id: userId, email, org_id: orgId },
      { headers: { "set-cookie": sessionCookie(sid) } },
    );
  } catch (err) {
    if (err instanceof InvitationInvalidError) {
      await recordFailedLogin(`invite:${ip}`, ip);
      return problem(410, "invitation-invalid", "Invitation is no longer valid", {
        detail: err.message,
      });
    }
    throw err;
  }
});
