import { withTenant } from "../db";
import { problem } from "./problem";
import type { Ctx } from "./handler";

/**
 * Makes a retried write safe to repeat.
 *
 * Integrators retry: a network timeout on POST /assets tells the caller
 * nothing about whether the asset was created. Without this they retry and get
 * two, with no way to tell which is real. The first response is stored against
 * the caller's key and replayed, so a retry gets the original answer.
 *
 * Keys are scoped to the organisation because the caller chooses them: two
 * tenants will both use "1" eventually, and one must never receive the other's
 * response.
 */

/** Long enough for any sane retry, short enough not to hoard responses. */
const WINDOW_HOURS = 24;

/** A key is an identifier, not a payload. */
const MAX_KEY_LENGTH = 255;

interface StoredResponse {
  status: number;
  response: unknown;
}

export async function withIdempotency(
  req: Request,
  ctx: Ctx,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = req.headers.get("idempotency-key");
  if (!key) return handler();

  if (key.length > MAX_KEY_LENGTH) {
    return problem(422, "validation", "Validation failed", {
      detail: `Idempotency-Key must be ${MAX_KEY_LENGTH} characters or fewer.`,
    });
  }

  const stored = await withTenant(ctx.orgId, async (c) =>
    (await c.query<StoredResponse>(
      `SELECT status, response FROM idempotency_keys
        WHERE org_id = $1 AND key = $2
          AND created_at > now() - ($3 || ' hours')::interval`,
      [ctx.orgId, key, String(WINDOW_HOURS)],
    )).rows[0],
  );

  if (stored) {
    return Response.json(stored.response, {
      status: stored.status,
      // So a client can tell this was not fresh work - useful when reconciling
      // what actually happened during an outage.
      headers: { "idempotent-replay": "true" },
    });
  }

  const response = await handler();

  // Only a success is remembered. Storing a 500 would make a transient outage
  // permanent for that key: the caller would retry and be handed the same
  // failure forever, with no way to ask again.
  if (response.status >= 200 && response.status < 300) {
    const body = await response.clone().json().catch(() => null);
    await withTenant(ctx.orgId, (c) =>
      c.query(
        `INSERT INTO idempotency_keys (org_id, key, status, response)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, key) DO UPDATE
           SET status = EXCLUDED.status,
               response = EXCLUDED.response,
               created_at = now()`,
        [ctx.orgId, key, response.status, JSON.stringify(body)],
      ),
    );
  }

  return response;
}
