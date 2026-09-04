import { problem } from "./problem";
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

/** Wraps a handler so an unexpected throw becomes a 500 problem document. */
export function safe<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      // Redacted: a pg error's detail field quotes the offending row.
      logError("unhandled", err);
      return problem(500, "internal", "Internal server error");
    }
  };
}
