import type { Ctx } from "../http/handler";
import { enqueueTemplated } from "../email/outbox";
import { rulesFor } from "./rules";
import { resolveRecipients, type EventContext } from "./recipients";
import { logError } from "../http/logger";
import { queueDelivery } from "../domain/webhooks";

const baseUrl = () => process.env.APP_BASE_URL ?? "http://localhost:3000";

/**
 * The single entry point for every notification in the system.
 *
 * Never throws. A failed notification must not roll back the business action
 * that caused it - an asset that was checked out stays checked out even if the
 * email could not be queued.
 */
export async function dispatch(
  ctx: Ctx,
  event: string,
  context: EventContext,
): Promise<{ queued: number }> {
  let queued = 0;

  // Webhooks are subscribed directly by the integrator rather than through a
  // notification rule: a rule decides who inside the organisation is told,
  // which is a different question from which external system wants the feed.
  // Queued first so an email failure below cannot swallow the delivery.
  try {
    await queueDelivery(ctx, event, {
      asset_id: context.assetId ?? null,
      ...(context.asset ? { asset: context.asset } : {}),
    });
  } catch (err) {
    logError(`webhook queue: ${event}`, err);
  }

  try {
    const rules = await rulesFor(ctx, event, "email");
    if (rules.length === 0) return { queued: 0 };

    for (const rule of rules) {
      const recipients = await resolveRecipients(
        ctx, rule.recipient_spec, context, event,
      );
      for (const recipient of recipients) {
        await enqueueTemplated(
          ctx,
          rule.template_key,
          [recipient.email],
          {
            ...context,
            recipient,
            links: {
              asset: context.assetId
                ? `${baseUrl()}/assets/${context.assetId}` : baseUrl(),
              import: context.importId
                ? `${baseUrl()}/import/${context.importId}` : baseUrl(),
              report: `${baseUrl()}/reports`,
              whats_new: `${baseUrl()}/whats-new`,
            },
          },
          { event },
        );
        queued++;
      }
    }
  } catch (err) {
    logError(`notification dispatch: ${event}`, err);
  }
  return { queued };
}
