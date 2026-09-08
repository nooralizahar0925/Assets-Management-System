import { randomBytes } from "node:crypto";
import { withPlatform } from "./db";
import { unauthorized } from "../http/problem";

/**
 * Signing in to the console.
 *
 * Deliberately a mirror of src/lib/auth/session.ts rather than a reuse of it:
 * same shape, different table, different cookie, shorter life. Sharing the
 * machinery would mean one bug, or one careless change, could make a tenant
 * session valid here - and that is the single thing this plane exists to make
 * impossible.
 */

const COOKIE = "ams_platform";

/**
 * Eight hours, against a tenant session's seven days.
 *
 * This session can create and destroy whole organisations. An unattended
 * browser should stop being able to by the end of the working day.
 */
const TTL_HOURS = 8;

export interface PlatformActor {
  id: string;
  email: string;
  name: string;
}

export async function createPlatformSession(adminId: string): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  await withPlatform((c) =>
    c.query(
      `INSERT INTO platform_sessions (id, admin_id, expires_at)
       VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
      [id, adminId, String(TTL_HOURS)],
    ),
  );
  return id;
}

export const endPlatformSession = (id: string) =>
  withPlatform((c) => c.query("DELETE FROM platform_sessions WHERE id = $1", [id]));

/**
 * Whether to mark the cookie Secure.
 *
 * What decides this is whether the deployment is served over TLS, which
 * APP_BASE_URL states directly - not NODE_ENV, which a staging environment
 * may not set and which would then serve this cookie in clear.
 */
const isHttps = () => (process.env.APP_BASE_URL ?? "").startsWith("https:");

export function platformCookie(id: string): string {
  const secure = isHttps() ? " Secure;" : "";
  // Strict, not Lax: nothing links into the console from anywhere else, so
  // there is no navigation worth preserving and no reason to send this cookie
  // on a cross-site request at all.
  return `${COOKIE}=${id}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${TTL_HOURS * 3600}`;
}

/** The same attributes, or the browser keeps the cookie it was told to drop. */
export function clearPlatformCookie(): string {
  const secure = isHttps() ? " Secure;" : "";
  return `${COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=0`;
}

export function readPlatformCookie(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === COOKIE) return rest.join("=") || null;
  }
  return null;
}

/**
 * The operator behind this request, or a 401.
 *
 * Reads only its own cookie, so a tenant session - however valid - is simply
 * absent as far as this is concerned. Disabled operators are refused at the
 * query, so disabling somebody ends their access now rather than whenever
 * their session happens to lapse.
 */
export async function requirePlatform(
  req: Request,
): Promise<PlatformActor | Response> {
  const sid = readPlatformCookie(req);
  if (!sid) return unauthorized();

  const actor = await withPlatform(async (c) =>
    (await c.query<PlatformActor>(
      `SELECT a.id, a.email, a.name
         FROM platform_sessions s
         JOIN platform_admins a ON a.id = s.admin_id
        WHERE s.id = $1
          AND s.expires_at > now()
          AND a.disabled_at IS NULL`,
      [sid],
    )).rows[0],
  );

  return actor ?? unauthorized();
}
