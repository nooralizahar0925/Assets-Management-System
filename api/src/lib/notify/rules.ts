import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { RecipientSpec } from "./recipients";

export const NOTIFICATION_EVENTS = [
  "asset.checked_out", "asset.checked_in", "asset.overdue",
  "warranty.expiring", "licence.expiring", "maintenance.due",
  "import.completed", "report.scheduled",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const RuleInput = z.object({
  event: z.enum(NOTIFICATION_EVENTS),
  channel: z.enum(["email", "webhook"]).default("email"),
  template_key: z.string().min(1),
  recipient_spec: RecipientSpec,
  active: z.boolean().default(true),
});
export type RuleInput = z.infer<typeof RuleInput>;

export interface Rule {
  id: string;
  event: NotificationEvent;
  channel: "email" | "webhook";
  template_key: string;
  recipient_spec: RecipientSpec;
  active: boolean;
}

const SELECT = `
  SELECT id, event, channel, template_key, recipient_spec, active
    FROM notification_rules`;

export const listRules = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Rule>(`${SELECT} ORDER BY event, channel`)).rows,
  );

export const rulesFor = (ctx: Ctx, event: string, channel = "email") =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Rule>(
      `${SELECT} WHERE event = $1 AND channel = $2 AND active = true`,
      [event, channel],
    )).rows,
  );

export const createRule = (ctx: Ctx, input: RuleInput) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Rule>(
      `INSERT INTO notification_rules
         (org_id, event, channel, template_key, recipient_spec, active)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_id, event, channel, template_key) DO UPDATE SET
         recipient_spec = excluded.recipient_spec,
         active = excluded.active
       RETURNING id, event, channel, template_key, recipient_spec, active`,
      [
        ctx.orgId, input.event, input.channel, input.template_key,
        JSON.stringify(input.recipient_spec), input.active,
      ],
    )).rows[0],
  );

export const updateRule = (ctx: Ctx, id: string, patch: Partial<RuleInput>) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Rule>(
      `UPDATE notification_rules SET
         template_key   = coalesce($2, template_key),
         recipient_spec = coalesce($3, recipient_spec),
         active         = coalesce($4, active)
       WHERE id = $1
       RETURNING id, event, channel, template_key, recipient_spec, active`,
      [
        id, patch.template_key ?? null,
        patch.recipient_spec ? JSON.stringify(patch.recipient_spec) : null,
        patch.active ?? null,
      ],
    )).rows[0] ?? null,
  );

export const deleteRule = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query("DELETE FROM notification_rules WHERE id = $1 RETURNING id", [id]))
      .rows.length > 0,
  );

/**
 * The defaults from spec 9.4, expressed as capabilities rather than job titles.
 *
 * "Everyone who can manage assets" survives a customer renaming or replacing
 * their roles; "everyone with the Manager role" does not. The one place a role
 * is named is the technician default for maintenance, and even there the seed
 * resolves the name to an id once, so a later rename keeps working.
 */
/** Exported so provisioning writes the same rules the seeder does. */
export const DEFAULT_NOTIFICATION_RULES: RuleInput[] = [
  { event: "asset.checked_out", channel: "email", template_key: "asset.checked_out",
    recipient_spec: { assignee: true }, active: true },
  { event: "asset.checked_in", channel: "email", template_key: "asset.checked_in",
    recipient_spec: { actor: true }, active: true },
  { event: "asset.overdue", channel: "email", template_key: "asset.overdue",
    recipient_spec: { assignee: true, permissions: ["assets:delete"] }, active: true },
  { event: "warranty.expiring", channel: "email", template_key: "warranty.expiring",
    recipient_spec: { permissions: ["assets:delete"] }, active: true },
  { event: "licence.expiring", channel: "email", template_key: "licence.expiring",
    recipient_spec: { permissions: ["assets:delete"] }, active: true },
  { event: "maintenance.due", channel: "email", template_key: "maintenance.due",
    recipient_spec: { permissions: ["custody:write"] }, active: true },
  { event: "import.completed", channel: "email", template_key: "import.completed",
    recipient_spec: { actor: true }, active: true },
  { event: "report.scheduled", channel: "email", template_key: "report.scheduled",
    recipient_spec: {}, active: true },
];

/** Idempotent - safe on every org creation and on upgrade. */
export async function seedDefaultRules(ctx: Ctx): Promise<void> {
  for (const rule of DEFAULT_NOTIFICATION_RULES) await createRule(ctx, rule);
}

/**
 * The same defaults, written with the owner connection.
 *
 * Role seeding runs after every migration, holding an owner client and no
 * tenant context, and that is where these belong: an organisation without
 * rules sends no mail at all, so a customer who never opens the notifications
 * screen silently receives no overdue reminder, no maintenance warning and no
 * import summary. Seeding on every deploy also repairs the organisations
 * created before anything called this.
 */
export async function seedDefaultRulesWithClient(
  client: { query: (text: string, values: unknown[]) => Promise<unknown> },
  orgId: string,
): Promise<void> {
  for (const rule of DEFAULT_NOTIFICATION_RULES) {
    await client.query(
      `INSERT INTO notification_rules
         (org_id, event, channel, template_key, recipient_spec, active)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_id, event, channel, template_key) DO NOTHING`,
      [
        orgId, rule.event, rule.channel ?? "email", rule.template_key,
        JSON.stringify(rule.recipient_spec), rule.active ?? true,
      ],
    );
  }
}
