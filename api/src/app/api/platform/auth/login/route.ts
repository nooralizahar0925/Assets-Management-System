import { z } from "zod";
import { withPlatform } from "@/lib/platform/db";
import {
  verifyPassword, needsRehash, hashPassword, DUMMY_HASH_PROMISE,
} from "@/lib/auth/password";
import {
  checkLoginThrottle, recordFailedLogin, clearFailedLogins, clientAddress,
} from "@/lib/auth/loginThrottle";
import { createPlatformSession, platformCookie } from "@/lib/platform/auth";
import { recordPlatformAction } from "@/lib/platform/audit";
import { validationProblem, unauthorized, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

interface AdminRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  disabled_at: string | null;
}

/**
 * Signing in to the platform console.
 *
 * Shares the tenant sign-in's throttle deliberately: these are the most
 * privileged accounts in the deployment, and a second throttle would be a
 * second thing to get wrong. It shares nothing else - different table,
 * different session, different cookie.
 */
export const POST = safe(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const { email, password } = parsed.data;
  const ip = clientAddress(req);

  const throttle = await checkLoginThrottle(email, ip);
  if (throttle.blocked) {
    // problem() takes no headers - its fourth argument goes into the document
    // body - so Retry-After is set on the response, as the tenant route does.
    const res = problem(429, "rate-limited", "Too many sign-in attempts", {
      detail: "Too many failed sign-in attempts. Try again shortly.",
    });
    res.headers.set("Retry-After", String(throttle.retryAfterSeconds));
    return res;
  }

  const admin = await withPlatform(async (c) =>
    (await c.query<AdminRow>(
      `SELECT id, email, name, password_hash, disabled_at
         FROM platform_admins WHERE lower(email) = lower($1)`,
      [email],
    )).rows[0],
  );

  // The same work whether or not the address exists, so the response time does
  // not answer a question the response deliberately refuses to.
  const ok = admin
    ? await verifyPassword(password, admin.password_hash)
    : await DUMMY_HASH_PROMISE.then((hash) => verifyPassword(password, hash));

  if (!admin || !ok || admin.disabled_at) {
    await recordFailedLogin(email, ip);
    // One answer for a wrong password, an unknown address and a disabled
    // account. Three answers would be an enumeration oracle for the accounts
    // that can read every tenant in the database.
    return unauthorized();
  }

  await clearFailedLogins(email);

  if (needsRehash(admin.password_hash)) {
    const upgraded = await hashPassword(password);
    await withPlatform((c) =>
      c.query("UPDATE platform_admins SET password_hash = $1 WHERE id = $2",
        [upgraded, admin.id]),
    );
  }

  await withPlatform((c) =>
    c.query("UPDATE platform_admins SET last_login_at = now() WHERE id = $1",
      [admin.id]),
  );

  const sid = await createPlatformSession(admin.id);
  await recordPlatformAction(
    { id: admin.id, email: admin.email, name: admin.name },
    "platform.signed_in",
    { ip },
  );

  return Response.json(
    { id: admin.id, email: admin.email, name: admin.name },
    { headers: { "set-cookie": platformCookie(sid) } },
  );
});
