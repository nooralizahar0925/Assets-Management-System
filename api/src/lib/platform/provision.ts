import { randomBytes } from "node:crypto";
import { z } from "zod";
import { withPlatform } from "./db";
import { recordPlatformAction } from "./audit";
import type { PlatformActor } from "./auth";
import { hashPassword } from "../auth/password";
import { forgetSuspension } from "../auth/suspension";
import { DEFAULT_NOTIFICATION_RULES } from "../notify/rules";
import { SYSTEM_ROLES } from "../auth/permissions";

/**
 * Creating, suspending and removing a customer.
 *
 * "Creating a customer" means creating something somebody can sign in to and
 * use: an organisation, its roles and their grants, its notification rules,
 * and one administrator who holds a role that grants something. A row with a
 * name in it is not a provisioned customer, and every step here exists because
 * leaving it out produces an account whose first impression is a screen that
 * says no.
 *
 * The whole thing runs in one transaction, which is what makes "leaves nothing
 * behind when a step fails" true without a compensating delete to get wrong.
 */

export class SlugTakenError extends Error {}
export class SlugMismatchError extends Error {}

export const ProvisionInput = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/, {
    message: "Lower case, digits and hyphens: it appears in URLs.",
  }),
  adminName: z.string().min(1).max(200),
  adminEmail: z.string().email(),
  planCode: z.string().nullable().default(null),
  trialDays: z.number().int().min(0).max(365).nullable().default(null),
  notes: z.string().max(2000).default(""),
});
export type ProvisionInput = z.input<typeof ProvisionInput>;

export interface Provisioned {
  orgId: string;
  slug: string;
  adminEmail: string;
  /** Returned once, to be handed over. Only a hash is stored. */
  password: string;
}

/** Readable, and long enough that its readability does not matter. */
const generatePassword = () => randomBytes(15).toString("base64url");

export async function provisionOrg(
  actor: PlatformActor,
  raw: ProvisionInput,
): Promise<Provisioned> {
  const input = ProvisionInput.parse(raw);
  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  const orgId = await withPlatform(async (c) => {
    const taken = await c.query(
      "SELECT 1 FROM organizations WHERE slug = $1", [input.slug],
    );
    if (taken.rowCount) {
      throw new SlugTakenError(
        `The slug "${input.slug}" is already in use. It appears in URLs, so it `
        + "has to be unique across every customer.",
      );
    }

    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO organizations
         (name, slug, plan_code, contract_starts, trial_ends_at, notes)
       VALUES ($1, $2, $3, current_date,
               CASE WHEN $4::int IS NULL THEN NULL
                    ELSE current_date + $4::int END,
               $5)
       RETURNING id`,
      [input.name, input.slug, input.planCode, input.trialDays, input.notes],
    );
    const id = rows[0].id;

    // The same function the migration runner calls for every existing
    // organisation, so a customer created here is indistinguishable from one
    // that has been here since the beginning.
    await c.query("SELECT seed_system_roles($1)", [id]);

    // seed_system_roles creates the roles and nothing else - the grants are
    // applied in TypeScript, by seedRolesForOrg, because the permission list
    // lives in code. Calling only the function produced an administrator who
    // held no permissions at all and was refused by every screen.
    for (const [name, role] of Object.entries(SYSTEM_ROLES)) {
      const found = (await c.query<{ id: string }>(
        "SELECT id FROM roles WHERE org_id = $1 AND lower(name) = lower($2)",
        [id, name],
      )).rows[0];
      if (!found) continue;

      for (const key of role.permissions) {
        await c.query(
          `INSERT INTO role_permissions (org_id, role_id, permission_key)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [id, found.id, key],
        );
      }
    }

    const administrator = (await c.query<{ id: string }>(
      "SELECT id FROM roles WHERE org_id = $1 AND lower(name) = 'administrator'",
      [id],
    )).rows[0];

    if (!administrator) {
      throw new Error(
        "seed_system_roles produced no Administrator role. The first user "
        + "would hold no permissions and every screen would refuse them.",
      );
    }

    await c.query(
      `INSERT INTO users (org_id, email, password_hash, name, role_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, input.adminEmail, passwordHash, input.adminName, administrator.id],
    );

    for (const rule of DEFAULT_NOTIFICATION_RULES) {
      await c.query(
        `INSERT INTO notification_rules
           (org_id, event, channel, template_key, recipient_spec, active)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (org_id, event, channel, template_key) DO NOTHING`,
        [
          id, rule.event, rule.channel ?? "email", rule.template_key,
          JSON.stringify(rule.recipient_spec), rule.active ?? true,
        ],
      );
    }

    return id;
  });

  await recordPlatformAction(actor, "org.provisioned", {
    orgId, orgSlug: input.slug,
    name: input.name, plan_code: input.planCode, admin_email: input.adminEmail,
  });

  return { orgId, slug: input.slug, adminEmail: input.adminEmail, password };
}

/**
 * Stops a customer's people signing in, without touching their data.
 *
 * Reversible, which is the entire difference between this and removing them.
 * The reason is recorded because the question "why is this one suspended" is
 * always asked later, by somebody who was not in the conversation.
 */
export async function suspendOrg(
  actor: PlatformActor,
  orgId: string,
  reason: string,
): Promise<boolean> {
  const slug = await withPlatform(async (c) =>
    (await c.query<{ slug: string }>(
      `UPDATE organizations SET suspended_at = now()
        WHERE id = $1 AND suspended_at IS NULL
        RETURNING slug`,
      [orgId],
    )).rows[0]?.slug,
  );
  if (!slug) return false;

  // The guard caches this for a few seconds. Clearing it here means the
  // operator sees the effect immediately rather than wondering whether the
  // button worked.
  forgetSuspension(orgId);
  await recordPlatformAction(actor, "org.suspended", { orgId, orgSlug: slug, reason });
  return true;
}

export async function resumeOrg(
  actor: PlatformActor,
  orgId: string,
): Promise<boolean> {
  const slug = await withPlatform(async (c) =>
    (await c.query<{ slug: string }>(
      `UPDATE organizations SET suspended_at = NULL
        WHERE id = $1 AND suspended_at IS NOT NULL
        RETURNING slug`,
      [orgId],
    )).rows[0]?.slug,
  );
  if (!slug) return false;

  forgetSuspension(orgId);
  await recordPlatformAction(actor, "org.resumed", { orgId, orgSlug: slug });
  return true;
}

/**
 * Removes a customer completely.
 *
 * Every tenant table cascades from organizations, so this really does remove
 * everything: their assets, their history, their people. There is no undo, and
 * the typed slug is the whole safety mechanism - which is why it is compared
 * here rather than trusted from a confirmation dialog that a script could skip.
 *
 * The audit row is written first and outlives the organisation on purpose:
 * "where did that customer go" has to have an answer.
 */
export async function deleteOrg(
  actor: PlatformActor,
  orgId: string,
  confirmSlug: string,
): Promise<boolean> {
  const org = await withPlatform(async (c) =>
    (await c.query<{ slug: string; name: string }>(
      "SELECT slug, name FROM organizations WHERE id = $1", [orgId],
    )).rows[0],
  );
  if (!org) return false;

  if (org.slug !== confirmSlug) {
    throw new SlugMismatchError(
      `That is not this organisation's slug. Type "${org.slug}" exactly to `
      + "confirm - everything belonging to this customer is removed and there "
      + "is no undo.",
    );
  }

  await recordPlatformAction(actor, "org.deleted", {
    orgId, orgSlug: org.slug, name: org.name,
  });

  return withPlatform(async (c) => {
    const { rowCount } = await c.query(
      "DELETE FROM organizations WHERE id = $1", [orgId],
    );
    return rowCount === 1;
  });
}
