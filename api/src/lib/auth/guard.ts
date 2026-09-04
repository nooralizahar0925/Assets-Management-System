import { readSession } from "./session";
import { readApiKey, checkRateLimit } from "./apikey";
import { unauthorized, forbidden, problem } from "../http/problem";
import type { Ctx } from "../http/handler";
import type { PermissionKey } from "./permissions";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface AuthOptions {
  /**
   * The location the request concerns, when it concerns one. `null` means the
   * target explicitly has no location; omit the field entirely when the request
   * is not about a located thing at all.
   */
  locationId?: string | null;
}

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

export const hasPermission = (ctx: Ctx, permission: PermissionKey): boolean =>
  ctx.actor.permissions.includes(permission);

/**
 * Whether `ctx` may act on something at `locationId`.
 *
 * An unscoped actor may act anywhere. A scoped one may act only within their
 * branches - and not on an asset with no location, because treating "unplaced"
 * as permitted would make it a hole in every scope.
 */
export function withinLocationScope(ctx: Ctx, locationId: string | null): boolean {
  if (ctx.actor.locationScope === null) return true;
  if (locationId === null) return false;
  return ctx.actor.locationScope.includes(locationId);
}

/** Returns a Ctx, or a Response to return immediately. */
export async function requireAuth(
  req: Request,
  permission: PermissionKey,
  opts: AuthOptions = {},
): Promise<Ctx | Response> {
  const ctx = (await readApiKey(req)) ?? (await readSession(req));
  if (!ctx) return unauthorized();

  const crossOrigin = assertSameOrigin(req, ctx);
  if (crossOrigin) return crossOrigin;

  if (!hasPermission(ctx, permission)) {
    return forbidden(`This credential lacks the "${permission}" permission.`);
  }

  if ("locationId" in opts && !withinLocationScope(ctx, opts.locationId ?? null)) {
    return branchForbidden();
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

/**
 * The clause a list query composes into its WHERE to honour branch scope.
 *
 * This is deliberately the only way branch filtering is expressed, so there is
 * one place to audit and one place to fix. `column` is a caller-supplied SQL
 * identifier and is never derived from request input.
 *
 * `placeholder` is the parameter number the caller has reached, so the clause
 * composes into a larger query without colliding with its other parameters.
 */
export function locationScopeClause(
  ctx: Ctx,
  column: string,
  placeholder = 1,
): { sql: string; params: unknown[] } {
  if (ctx.actor.locationScope === null) return { sql: "TRUE", params: [] };
  return {
    sql: `${column} = ANY($${placeholder}::uuid[])`,
    params: [ctx.actor.locationScope],
  };
}

/**
 * The refusal for an asset outside the caller's branches.
 *
 * requireAuth raises this when a handler knows the location up front. A handler
 * that only learns it by loading the row - reading one asset by id, say - calls
 * withinLocationScope after the fetch and returns this, so both paths give the
 * caller the same answer.
 */
export const branchForbidden = (): Response =>
  forbidden(
    "Your access is limited to specific branches, and this asset is not in " +
      "one of them.",
  );

export const isResponse = (v: unknown): v is Response => v instanceof Response;
