import { readSession } from "./session";
import { readApiKey, checkRateLimit } from "./apikey";
import { unauthorized, forbidden, problem } from "../http/problem";
import type { Ctx } from "../http/handler";

export type Scope = "assets:read" | "assets:write" | "reports:read" | "admin";

/** Returns a Ctx, or a Response to return immediately. */
export async function requireAuth(
  req: Request,
  scope: Scope,
): Promise<Ctx | Response> {
  const ctx = (await readApiKey(req)) ?? (await readSession(req));
  if (!ctx) return unauthorized();

  if (!ctx.actor.scopes.includes(scope) && !ctx.actor.scopes.includes("admin")) {
    return forbidden(`This credential lacks the "${scope}" scope.`);
  }

  const limit = await checkRateLimit(ctx);
  if (!limit.ok) {
    const perHour = process.env.RATE_LIMIT_PER_HOUR ?? "1000";
    const res = problem(429, "rate-limited", "Rate limit exceeded", {
      detail: `${perHour} requests per hour per API key.`,
    });
    res.headers.set("Retry-After", "3600");
    res.headers.set("X-RateLimit-Remaining", "0");
    return res;
  }
  return ctx;
}

export const isResponse = (v: unknown): v is Response => v instanceof Response;
