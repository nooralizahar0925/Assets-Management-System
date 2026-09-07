import { z } from "zod";
import { query } from "@/lib/db";
import {
  verifyPassword,
  needsRehash,
  hashPassword,
  DUMMY_HASH_PROMISE,
} from "@/lib/auth/password";
import { createSession, sessionCookie } from "@/lib/auth/session";
import {
  checkLoginThrottle,
  recordFailedLogin,
  clearFailedLogins,
  clientAddress,
} from "@/lib/auth/loginThrottle";
import { withTenant } from "@/lib/db";
import { validationProblem, unauthorized, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

interface UserRow {
  id: string;
  org_id: string;
  name: string;
  role: string;
  password_hash: string;
}

export const POST = safe(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const { email, password } = parsed.data;
  const ip = clientAddress(req);

  const throttle = await checkLoginThrottle(email, ip);
  if (throttle.blocked) {
    const res = problem(429, "rate-limited", "Too many sign-in attempts", {
      detail: "Too many failed sign-in attempts. Try again shortly.",
    });
    res.headers.set("Retry-After", String(throttle.retryAfterSeconds));
    return res;
  }

  // Pre-tenant lookup - the org is not known until the email resolves.
  const rows = await query<UserRow>(
    "SELECT * FROM auth_lookup_user_by_email($1)",
    [email],
  );
  const user = rows[0];

  // An unknown address must cost the same as a known one. Without this, the
  // response time alone answers "is this address registered?" - and because
  // email is globally unique, that answer is tenant-independent.
  const hashToCheck = user ? user.password_hash : await DUMMY_HASH_PROMISE;
  const passwordOk = await verifyPassword(password, hashToCheck);

  if (!user || !passwordOk) {
    await recordFailedLogin(email, ip);
    return unauthorized();
  }

  await clearFailedLogins(email);

  // Upgrade the stored hash opportunistically, now that the plaintext is in
  // hand and known good. This is the whole reason the cost parameters live in
  // the hash rather than being assumed.
  if (needsRehash(user.password_hash)) {
    const upgraded = await hashPassword(password);
    await withTenant(user.org_id, (c) =>
      c.query("UPDATE users SET password_hash = $1 WHERE id = $2", [
        upgraded,
        user.id,
      ]),
    );
  }

  const sid = await createSession(user.id, user.org_id);
  return Response.json(
    { id: user.id, name: user.name, org_id: user.org_id },
    { headers: { "set-cookie": sessionCookie(sid) } },
  );
});
