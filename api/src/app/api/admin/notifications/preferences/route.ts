import { z } from "zod";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { withTenant } from "@/lib/db";
import { NOTIFICATION_EVENTS } from "@/lib/notify/rules";

const Body = z.object({
  event: z.enum(NOTIFICATION_EVENTS),
  email_enabled: z.boolean(),
});

/**
 * A person's own notification preferences.
 *
 * Deliberately not behind settings:write: muting your own overdue reminders is
 * not an administrative act, and requiring an admin to do it for you would make
 * the setting useless. Every caller reads and writes only their own rows.
 */
export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const rows = await withTenant(ctx.orgId, async (c) =>
    (await c.query<{ event: string; email_enabled: boolean }>(
      "SELECT event, email_enabled FROM notification_prefs WHERE user_id = $1",
      [ctx.actor.id],
    )).rows,
  );

  // Absence of a row means opted in, so the response states every event
  // explicitly rather than making the client infer the default.
  const set = new Map(rows.map((r) => [r.event, r.email_enabled]));
  return Response.json({
    data: NOTIFICATION_EVENTS.map((event) => ({
      event, email_enabled: set.get(event) ?? true,
    })),
  });
});

export const PUT = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  await withTenant(ctx.orgId, (c) =>
    c.query(
      `INSERT INTO notification_prefs (user_id, org_id, event, email_enabled)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, event) DO UPDATE SET email_enabled = excluded.email_enabled`,
      [ctx.actor.id, ctx.orgId, parsed.data.event, parsed.data.email_enabled],
    ),
  );
  return Response.json(parsed.data);
});
