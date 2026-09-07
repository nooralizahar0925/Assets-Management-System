import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";

/**
 * Outbound webhooks: telling somebody else's system what happened here.
 *
 * Deliveries are queued and swept, never sent inline. A customer's endpoint
 * being slow or down must not slow down or fail the request that triggered it -
 * checking an asset out should not wait on their server.
 */

/** The events an integrator may subscribe to. Adding one is a public change. */
export const WEBHOOK_EVENTS = [
  "asset.created",
  "asset.updated",
  "asset.deleted",
  "asset.checked_out",
  "asset.checked_in",
  "asset.overdue",
  "maintenance.due",
  "import.completed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WebhookInput = z.object({
  url: z.string().url().refine((u) => u.startsWith("https://") || u.startsWith("http://"), {
    message: "Only http and https endpoints are supported.",
  }),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  active: z.boolean().default(true),
});
export type WebhookInput = z.input<typeof WebhookInput>;

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
  /** Only ever returned when the webhook is created. */
  secret?: string;
}

/**
 * `sha256=<hex>` over the exact bytes sent.
 *
 * The receiver recomputes this to know the payload came from us and was not
 * altered. Signing the serialised body rather than the object matters: two
 * JSON encodings of the same object differ, and the receiver only has the
 * bytes.
 */
export function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Constant-time, so a receiver's own check cannot be turned into an oracle. */
export function verifySignature(
  secret: string, body: string, signature: string,
): boolean {
  const expected = Buffer.from(signPayload(secret, body));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const listWebhooks = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Webhook>(
      // The secret is never listed: it is shown once, at creation, and after
      // that only the receiver and the database need it.
      `SELECT id, url, events, active, created_at
         FROM webhooks ORDER BY created_at DESC`,
    )).rows,
  );

export async function createWebhook(
  ctx: Ctx,
  raw: WebhookInput,
): Promise<Webhook> {
  const input = WebhookInput.parse(raw);
  const secret = `whsec_${randomBytes(24).toString("hex")}`;

  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<Webhook>(
      `INSERT INTO webhooks (org_id, url, secret, events, active)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, url, events, active, created_at`,
      [ctx.orgId, input.url, secret, input.events, input.active],
    );
    // Returned exactly once. There is no endpoint that will show it again.
    return { ...rows[0], secret };
  });
}

export const deleteWebhook = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query("DELETE FROM webhooks WHERE id = $1", [id])).rowCount === 1,
  );

/** Queues one delivery per subscribed endpoint. */
export async function queueDelivery(
  ctx: Ctx,
  event: string,
  payload: Record<string, unknown>,
): Promise<number> {
  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `SELECT id FROM webhooks WHERE active AND $1 = ANY(events)`,
      [event],
    );

    for (const hook of rows) {
      await c.query(
        `INSERT INTO webhook_deliveries (org_id, webhook_id, event, payload)
         VALUES ($1, $2, $3, $4)`,
        [ctx.orgId, hook.id, event, JSON.stringify(payload)],
      );
    }
    return rows.length;
  });
}

/** Attempts, in minutes: a receiver restarting should not need three retries. */
const BACKOFF_MINUTES = [1, 5, 30];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;

interface PendingDelivery {
  id: string;
  webhook_id: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
  url: string;
  secret: string;
}

/**
 * Sends what is due and reschedules what fails.
 *
 * A failure is rescheduled with a growing delay rather than retried
 * immediately: an endpoint that just refused a request is unlikely to accept
 * the same one a millisecond later, and hammering it is how an integration
 * partner ends up blocking us.
 */
export async function deliverPending(
  ctx: Ctx,
  limit = 50,
): Promise<{ delivered: number; failed: number }> {
  const due = await withTenant(ctx.orgId, async (c) =>
    (await c.query<PendingDelivery>(
      `SELECT d.id, d.webhook_id, d.event, d.payload, d.attempts, w.url, w.secret
         FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id
        WHERE d.status = 'pending' AND d.next_attempt_at <= now()
        ORDER BY d.created_at
        LIMIT $1`,
      [limit],
    )).rows,
  );

  let delivered = 0;
  let failed = 0;

  for (const item of due) {
    const body = JSON.stringify({
      event: item.event,
      delivered_at: new Date().toISOString(),
      data: item.payload,
    });

    let status = 0;
    let error: string | null = null;

    try {
      const res = await fetch(item.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ams-event": item.event,
          "x-ams-signature": signPayload(item.secret, body),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.status;
      if (!res.ok) error = `Endpoint answered ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const attempts = item.attempts + 1;
    const succeeded = status >= 200 && status < 300;

    if (succeeded) delivered += 1;
    else failed += 1;

    await withTenant(ctx.orgId, async (c) => {
      if (succeeded) {
        await c.query(
          `UPDATE webhook_deliveries
              SET status = 'delivered', attempts = $2, last_status = $3,
                  delivered_at = now(), last_error = NULL
            WHERE id = $1`,
          [item.id, attempts, status],
        );
        return;
      }

      const exhausted = attempts >= MAX_ATTEMPTS;
      const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];

      await c.query(
        `UPDATE webhook_deliveries
            SET status = $2, attempts = $3, last_status = $4, last_error = $5,
                next_attempt_at = now() + ($6 || ' minutes')::interval
          WHERE id = $1`,
        [
          item.id,
          exhausted ? "failed" : "pending",
          attempts,
          status || null,
          error,
          String(wait),
        ],
      );
    });
  }

  return { delivered, failed };
}
