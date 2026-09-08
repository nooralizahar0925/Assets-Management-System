import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * One structured line per request, and an id that survives the proxy.
 *
 * Without this, "it failed this morning" is unanswerable: there is nothing to
 * search and no way to connect what a customer saw to what the server did.
 */

interface RequestStore {
  requestId: string;
  orgId?: string;
  actorType?: string;
}

const storage = new AsyncLocalStorage<RequestStore>();

/**
 * A proxy-supplied id is echoed so one trace spans the whole hop, but it is
 * attacker-controlled: a newline would forge extra log lines, and a megabyte
 * of text would bloat every entry. Anything that is not a short, plain token
 * is replaced rather than sanitised, so the log never carries a value this
 * process did not vouch for.
 */
const SAFE_ID = /^[A-Za-z0-9._~-]{1,64}$/;

export function resolveRequestId(req?: Request): string {
  const inbound = req?.headers.get("x-request-id");
  return inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
}

/** Records who the request turned out to be, once a handler knows. */
export function setRequestActor(actor: { orgId?: string; actorType?: string }): void {
  const store = storage.getStore();
  if (!store) return;
  if (actor.orgId) store.orgId = actor.orgId;
  if (actor.actorType) store.actorType = actor.actorType;
}

export const currentRequestId = (): string | undefined =>
  storage.getStore()?.requestId;

export function runWithRequestContext<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

export interface RequestLogEntry {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

/**
 * Writes the line.
 *
 * The path is logged with its parameters - an asset id is not a secret, and a
 * log that only records `/api/v1/assets/:id` cannot answer which asset failed.
 * The query string is not: it carries search terms, which are tenant data.
 * Headers are never logged at all, so no cookie or key can leak through one.
 */
export function logRequest(entry: RequestLogEntry): void {
  const store = storage.getStore();
  console.log(JSON.stringify({
    level: "info",
    request_id: entry.requestId,
    method: entry.method,
    path: entry.path,
    status: entry.status,
    duration_ms: entry.durationMs,
    org_id: store?.orgId,
    actor_type: store?.actorType,
  }));
}

/** Adds the id to a response, copying it when its headers are immutable. */
export function withRequestId(res: Response, requestId: string): Response {
  try {
    res.headers.set("x-request-id", requestId);
    return res;
  } catch {
    const headers = new Headers(res.headers);
    headers.set("x-request-id", requestId);
    return new Response(res.body, {
      status: res.status, statusText: res.statusText, headers,
    });
  }
}
