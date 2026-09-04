import { problem } from "./problem";

export interface Actor {
  type: "user" | "api_key" | "system";
  id: string;
  label: string;
  scopes: string[];
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
      console.error(err);
      return problem(500, "internal", "Internal server error");
    }
  };
}
