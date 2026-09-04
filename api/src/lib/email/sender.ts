import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { getActiveProviders } from "../domain/emailProviders";
import { buildProvider } from "./providers";

/**
 * Sends immediately through one named provider and records the outcome. This is the
 * only path that bypasses the outbox, because its whole purpose is to tell an admin
 * whether the credentials they just typed actually work.
 */
export async function sendTestEmail(
  ctx: Ctx,
  providerId: string,
  to: string,
): Promise<{ ok: boolean; error?: string }> {
  const stored = (await getActiveProviders(ctx)).find((p) => p.id === providerId);
  if (!stored) return { ok: false, error: "Provider not found or inactive." };

  try {
    const provider = buildProvider(stored.type, stored.config, {
      email: stored.from_email,
      name: stored.from_name ?? undefined,
    });
    await provider.send({
      to: [to],
      subject: `Test email from ${stored.name}`,
      html:
        "<p>This is a test message from your Asset Management System.</p>" +
        `<p>Provider: <strong>${stored.name}</strong> (${stored.type})</p>`,
      text:
        "This is a test message from your Asset Management System. " +
        `Provider: ${stored.name} (${stored.type})`,
      from: { email: stored.from_email, name: stored.from_name ?? undefined },
      replyTo: stored.reply_to ?? undefined,
    });

    await withTenant(ctx.orgId, (c) =>
      c.query(
        "UPDATE email_providers SET verified_at = now(), last_error = NULL WHERE id = $1",
        [providerId],
      ),
    );
    return { ok: true };
  } catch (err) {
    const error = (err as Error).message;
    await withTenant(ctx.orgId, (c) =>
      c.query("UPDATE email_providers SET last_error = $2 WHERE id = $1",
        [providerId, error]),
    );
    return { ok: false, error };
  }
}
