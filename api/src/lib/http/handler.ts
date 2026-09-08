import { problem } from "./problem";
import {
  resolveRequestId, runWithRequestContext, logRequest, withRequestId,
} from "./logging";
import type { PermissionKey } from "../auth/permissions";
import { logError } from "./logger";

export interface Actor {
  type: "user" | "api_key" | "system";
  id: string;
  label: string;
  /** The published API scopes, kept for the v1 contract and for display. */
  scopes: string[];
  /** The resolved fine-grained permissions this actor holds. */
  permissions: PermissionKey[];
  /** Branch restriction. null means organisation-wide. */
  locationScope: string[] | null;
}

export interface Ctx {
  orgId: string;
  actor: Actor;
}

/**
 * Wraps a handler so an unexpected throw becomes a 500 problem document, and
 * every request leaves one structured line behind.
 *
 * The log happens here rather than in each route because a route that forgot
 * it would be invisible - and the requests worth tracing are exactly the ones
 * nobody remembered to instrument.
 */
export function safe<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const req = args[0] instanceof Request ? args[0] : undefined;
    const requestId = resolveRequestId(req);
    const started = Date.now();

    // The path without its query string: an asset id is not a secret, but what
    // somebody searched for is tenant data.
    const path = req ? new URL(req.url).pathname : "";
    const method = req?.method ?? "";

    return runWithRequestContext(requestId, async () => {
      let response: Response;
      try {
        response = await fn(...args);
      } catch (err) {
        // Redacted: a pg error's detail field quotes the offending row.
        logError("unhandled", err);
        response = problem(500, "internal", "Internal server error");
      }

      logRequest({
        requestId, method, path,
        status: response.status,
        durationMs: Date.now() - started,
      });
      return withRequestId(response, requestId);
    });
  };
}
