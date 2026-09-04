import { createHash } from "node:crypto";
import { query } from "../db";

/**
 * Throttling for the sign-in endpoint.
 *
 * requireAuth's limiter covers API keys only, and login runs before there is
 * any credential to key a limit to - so without this, /api/admin/auth/login
 * accepts unlimited password guesses. Two independent counters:
 *
 *   * by email - the one that matters. An attacker targeting a known account
 *     cannot change this key, whatever else they control.
 *   * by client address - broad cover for spraying across many accounts. It is
 *     only as trustworthy as the proxy in front of the app, since a client can
 *     put anything in X-Forwarded-For, which is precisely why the email counter
 *     carries the real weight.
 */
const WINDOW_MINUTES = 15;
const MAX_PER_EMAIL = 10;
const MAX_PER_IP = 50;

const emailKey = (email: string) =>
  `email:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;

const ipKey = (ip: string) => `ip:${ip}`;

/** Best-effort client address. Only meaningful behind a proxy that sets it. */
export function clientAddress(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export interface ThrottleVerdict {
  blocked: boolean;
  retryAfterSeconds: number;
}

export async function checkLoginThrottle(
  email: string,
  ip: string,
): Promise<ThrottleVerdict> {
  const rows = await query<{ key: string; hits: string }>(
    `SELECT key, count(*) AS hits
       FROM login_attempts
      WHERE key = ANY($1::text[])
        AND occurred_at > now() - ($2 || ' minutes')::interval
      GROUP BY key`,
    [[emailKey(email), ipKey(ip)], String(WINDOW_MINUTES)],
  );

  const hitsFor = (key: string) =>
    Number(rows.find((r) => r.key === key)?.hits ?? 0);

  const blocked =
    hitsFor(emailKey(email)) >= MAX_PER_EMAIL || hitsFor(ipKey(ip)) >= MAX_PER_IP;

  return { blocked, retryAfterSeconds: WINDOW_MINUTES * 60 };
}

export async function recordFailedLogin(email: string, ip: string): Promise<void> {
  await query(
    `INSERT INTO login_attempts (key) VALUES ($1), ($2)`,
    [emailKey(email), ipKey(ip)],
  );
}

/**
 * Clears the email counter after a success, so someone who mistypes their
 * password four times and then gets it right is not left near the limit. The
 * address counter is left alone: one valid login should not reset a spray.
 */
export async function clearFailedLogins(email: string): Promise<void> {
  await query("DELETE FROM login_attempts WHERE key = $1", [emailKey(email)]);
}

/** Housekeeping, for the scheduler in Task 15. */
export async function purgeOldLoginAttempts(): Promise<void> {
  await query(
    `DELETE FROM login_attempts
      WHERE occurred_at < now() - ($1 || ' minutes')::interval`,
    [String(WINDOW_MINUTES * 4)],
  );
}
