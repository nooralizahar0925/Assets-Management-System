import { readSession } from "./session";
import { readApiKey, checkRateLimit } from "./apikey";
import { unauthorized, forbidden, problem } from "../http/problem";
import type { Ctx } from "../http/handler";

export type Scope = "assets:read" | "assets:write" | "reports:read" | "admin";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Cross-origin write protection for cookie-authenticated requests.
 *
 * A session cookie is an ambient credential: the browser attaches it to any
 * request to this origin, including one a third-party page caused. An API key
 * is not - it has to be set deliberately by the caller - so key-authenticated
 * requests are exempt.
 *
 * SameSite=Lax already blocks the cookie on cross-site POST, so this is defence
 * in depth rather than the only barrier. It is an origin check rather than a
 * CSRF token because there is no server-rendered form to embed a token in: the
 * SPA is static and talks JSON, so comparing Origin against APP_BASE_URL costs
 * nothing and needs no state. A browser will not let a page forge Origin.
 *
 * Requests with no Origin header at all are allowed: non-browser clients
 * (curl, a server-side integration) do not send one, and they are not subject
 * to CSRF in the first place. Every browser sends Origin on an unsafe method.
 */
export function assertSameOrigin(req: Request, ctx: Ctx): Response | null {
  if (ctx.actor.type !== "user") return null;
  if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return null;

  const origin = req.headers.get("origin");
  if (!origin) return null;

  const allowed = process.env.APP_BASE_URL;
  const permitted = new Set<string>();
  if (allowed) {
    try {
      permitted.add(new URL(allowed).origin);
    } catch {
      // A malformed APP_BASE_URL should not silently permit every origin.
    }
  }
  // The API's own origin, for a same-origin deployment behind one host.
  try {
    permitted.add(new URL(req.url).origin);
  } catch {
    // Ignore: req.url is always absolute in a route handler.
  }

  if (permitted.has(origin)) return null;

  return forbidden(
    "Cross-origin request refused. Session-authenticated writes must come " +
      "from the application origin; use an API key for server-to-server calls.",
  );
}

/** Returns a Ctx, or a Response to return immediately. */
export async function requireAuth(
  req: Request,
  scope: Scope,
): Promise<Ctx | Response> {
  const ctx = (await readApiKey(req)) ?? (await readSession(req));
  if (!ctx) return unauthorized();

  const crossOrigin = assertSameOrigin(req, ctx);
  if (crossOrigin) return crossOrigin;

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
