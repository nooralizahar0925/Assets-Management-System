import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { getActiveProviders } from "../domain/emailProviders";
import { buildProvider } from "./providers";
import { getTemplate, render } from "./templates";
import { readAttachmentBody } from "../domain/attachments";
import type { EmailAttachment } from "./types";

const MAX_ATTEMPTS = 5;
/** 1 min, 5 min, 15 min, 1 h, 6 h — long enough to outlast a provider incident. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 360];

export interface EnqueueInput {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  templateKey?: string;
  event?: string;
  attachments?: { filename: string; object_key: string; content_type: string }[];
  scheduledFor?: string;
}

export async function enqueue(ctx: Ctx, input: EnqueueInput): Promise<string> {
  return withTenant(ctx.orgId, async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO email_messages
         (org_id, to_addresses, cc_addresses, subject, html_body, text_body,
          template_key, event, attachments, scheduled_for)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, coalesce($10::timestamptz, now()))
       RETURNING id`,
      [
        ctx.orgId, input.to, input.cc ?? [], input.subject, input.html, input.text,
        input.templateKey ?? null, input.event ?? null,
        JSON.stringify(input.attachments ?? []), input.scheduledFor ?? null,
      ],
    )).rows[0].id,
  );
}

export async function enqueueTemplated(
  ctx: Ctx,
  templateKey: string,
  to: string[],
  vars: Record<string, unknown>,
  opts: { cc?: string[]; event?: string; attachments?: EnqueueInput["attachments"];
          scheduledFor?: string } = {},
): Promise<string> {
  const rendered = render(await getTemplate(ctx, templateKey), vars);
  return enqueue(ctx, {
    to, cc: opts.cc, ...rendered, templateKey,
    event: opts.event ?? templateKey,
    attachments: opts.attachments, scheduledFor: opts.scheduledFor,
  });
}

interface QueuedMessage {
  id: string;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string;
  html_body: string;
  text_body: string;
  attachments: { filename: string; object_key: string; content_type: string }[];
  attempts: number;
}

/**
 * Claims due messages and sends them, walking providers by priority so a failing
 * primary degrades to a backup instead of dropping the notification.
 */
export async function processOutbox(
  ctx: Ctx,
  limit = 25,
): Promise<{ sent: number; failed: number }> {
  // SKIP LOCKED lets several workers run without sending the same message twice.
  const claimed = await withTenant(ctx.orgId, async (c) =>
    (await c.query<QueuedMessage>(
      `UPDATE email_messages SET status = 'sending'
        WHERE id IN (
          SELECT id FROM email_messages
           WHERE status = 'queued' AND scheduled_for <= now()
           ORDER BY scheduled_for
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING id, to_addresses, cc_addresses, subject, html_body,
                  text_body, attachments, attempts`,
      [limit],
    )).rows,
  );
  if (claimed.length === 0) return { sent: 0, failed: 0 };

  const providers = await getActiveProviders(ctx);
  let sent = 0;
  let failed = 0;

  for (const message of claimed) {
    if (providers.length === 0) {
      await defer(ctx, message, "No active email provider is configured.");
      failed++;
      continue;
    }

    const attachments: EmailAttachment[] = await Promise.all(
      message.attachments.map(async (a) => ({
        filename: a.filename,
        contentType: a.content_type,
        content: await readAttachmentBody(a.object_key),
      })),
    );

    let lastError = "";
    let delivered = false;

    for (const stored of providers) {
      try {
        const provider = buildProvider(stored.type, stored.config, {
          email: stored.from_email,
          name: stored.from_name ?? undefined,
        });
        const { providerMessageId } = await provider.send({
          to: message.to_addresses,
          cc: message.cc_addresses.length ? message.cc_addresses : undefined,
          subject: message.subject,
          html: message.html_body,
          text: message.text_body,
          from: { email: stored.from_email, name: stored.from_name ?? undefined },
          replyTo: stored.reply_to ?? undefined,
          attachments: attachments.length ? attachments : undefined,
        });

        await withTenant(ctx.orgId, (c) =>
          c.query(
            `UPDATE email_messages SET
               status = 'sent', sent_at = now(), provider_id = $2,
               provider_message_id = $3, attempts = attempts + 1, last_error = NULL
             WHERE id = $1`,
            [message.id, stored.id, providerMessageId],
          ),
        );
        await withTenant(ctx.orgId, (c) =>
          c.query("UPDATE email_providers SET last_error = NULL WHERE id = $1", [stored.id]),
        );
        delivered = true;
        sent++;
        break;
      } catch (err) {
        lastError = (err as Error).message;
        await withTenant(ctx.orgId, (c) =>
          c.query("UPDATE email_providers SET last_error = $2 WHERE id = $1",
            [stored.id, lastError]),
        );
      }
    }

    if (!delivered) {
      await defer(ctx, message, lastError);
      failed++;
    }
  }

  return { sent, failed };
}

/** Re-queue with backoff, or give up once the attempt budget is spent. */
async function defer(ctx: Ctx, message: QueuedMessage, error: string): Promise<void> {
  const attempts = message.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];

  await withTenant(ctx.orgId, (c) =>
    c.query(
      `UPDATE email_messages SET
         status = $2,
         attempts = $3,
         last_error = $4,
         scheduled_for = now() + ($5 || ' minutes')::interval
       WHERE id = $1`,
      [message.id, exhausted ? "failed" : "queued", attempts, error, String(wait)],
    ),
  );
}

export const listMessages = (ctx: Ctx, limit = 100) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query(
      `SELECT m.id, m.to_addresses, m.subject, m.status, m.attempts, m.last_error,
              m.template_key, m.event, m.sent_at, m.created_at, p.name AS provider_name
         FROM email_messages m
         LEFT JOIN email_providers p ON p.id = m.provider_id
        ORDER BY m.created_at DESC
        LIMIT $1`,
      [limit],
    )).rows,
  );
