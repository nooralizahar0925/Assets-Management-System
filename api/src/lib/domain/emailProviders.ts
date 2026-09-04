import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { sealConfig, openConfig, maskConfig } from "../crypto/secrets";
import {
  PROVIDER_TYPES, CONFIG_SCHEMAS, SECRET_KEYS, type ProviderType,
} from "../email/providers";

export class UnknownProviderTypeError extends Error {}
export class DuplicateProviderError extends Error {}
export class InvalidProviderConfigError extends Error {}

export const ProviderInput = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(PROVIDER_TYPES),
  from_email: z.string().email(),
  from_name: z.string().max(120).nullish(),
  reply_to: z.string().email().nullish(),
  priority: z.number().int().min(1).max(1000).default(100),
  active: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
});
export type ProviderInput = z.infer<typeof ProviderInput>;

export const ProviderPatch = ProviderInput.partial();

export interface EmailProviderRow {
  id: string;
  name: string;
  type: ProviderType;
  from_email: string;
  from_name: string | null;
  reply_to: string | null;
  priority: number;
  active: boolean;
  config: Record<string, unknown>;
  verified_at: string | null;
  last_error: string | null;
  created_at: string;
}

/** Validates a config against its provider's schema before it is sealed. */
function validateConfig(
  type: ProviderType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const schema = CONFIG_SCHEMAS[type];
  if (!schema) throw new UnknownProviderTypeError(`unknown email provider type: ${type}`);
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new InvalidProviderConfigError(
      `${type} config is invalid: ${issue.path.join(".")} ${issue.message}`,
    );
  }
  return parsed.data as Record<string, unknown>;
}

/**
 * Providers as the API returns them: secrets masked, never decrypted past this
 * boundary. Spec 9.1 - a credential that goes in must not come back out.
 */
export const listProviders = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<EmailProviderRow>(
      `SELECT id, name, type, from_email, from_name, reply_to, priority, active,
              config, verified_at, last_error, created_at
         FROM email_providers ORDER BY priority, lower(name)`,
    );
    return rows.map((row) => ({
      ...row,
      config: maskConfig(row.config, SECRET_KEYS[row.type] ?? []),
    }));
  });

/**
 * The providers the sender should try, best first.
 *
 * Secrets are decrypted here because this is the one place that needs them - a
 * send about to happen - and the result never leaves the server.
 */
export const getActiveProviders = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<EmailProviderRow>(
      `SELECT id, name, type, from_email, from_name, reply_to, priority, active,
              config, verified_at, last_error, created_at
         FROM email_providers
        WHERE active = true
        ORDER BY priority, lower(name)`,
    );
    return rows.map((row) => ({
      ...row,
      config: openConfig(row.config, SECRET_KEYS[row.type] ?? []),
    }));
  });

export async function createProvider(
  ctx: Ctx,
  input: ProviderInput,
): Promise<EmailProviderRow> {
  const parsed = ProviderInput.parse(input);
  const config = validateConfig(parsed.type, parsed.config);
  const sealed = sealConfig(config, SECRET_KEYS[parsed.type] ?? []);

  return withTenant(ctx.orgId, async (c) => {
    try {
      const { rows } = await c.query<EmailProviderRow>(
        `INSERT INTO email_providers
           (org_id, name, type, from_email, from_name, reply_to, priority, active, config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, name, type, from_email, from_name, reply_to, priority, active,
                   config, verified_at, last_error, created_at`,
        [
          ctx.orgId, parsed.name, parsed.type, parsed.from_email,
          parsed.from_name ?? null, parsed.reply_to ?? null,
          parsed.priority, parsed.active, JSON.stringify(sealed),
        ],
      );
      const row = rows[0];
      return { ...row, config: maskConfig(row.config, SECRET_KEYS[row.type] ?? []) };
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new DuplicateProviderError(
          `An email provider called "${parsed.name}" already exists.`,
        );
      }
      throw err;
    }
  });
}

export async function updateProvider(
  ctx: Ctx,
  id: string,
  patch: z.infer<typeof ProviderPatch>,
): Promise<EmailProviderRow | null> {
  const parsed = ProviderPatch.parse(patch);

  const existing = await withTenant(ctx.orgId, async (c) =>
    (await c.query<EmailProviderRow>(
      "SELECT id, type, config FROM email_providers WHERE id = $1", [id],
    )).rows[0] ?? null,
  );
  if (!existing) return null;

  const type = (parsed.type ?? existing.type) as ProviderType;

  // A config patch replaces the whole object, because a partial merge over
  // encrypted values would seal an already-sealed secret.
  let sealed: Record<string, unknown> | null = null;
  if (parsed.config) {
    sealed = sealConfig(validateConfig(type, parsed.config), SECRET_KEYS[type] ?? []);
  }

  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<EmailProviderRow>(
      `UPDATE email_providers SET
         name       = coalesce($2, name),
         type       = coalesce($3, type),
         from_email = coalesce($4, from_email),
         from_name  = coalesce($5, from_name),
         reply_to   = coalesce($6, reply_to),
         priority   = coalesce($7, priority),
         active     = coalesce($8, active),
         config     = coalesce($9, config)
       WHERE id = $1
       RETURNING id, name, type, from_email, from_name, reply_to, priority, active,
                 config, verified_at, last_error, created_at`,
      [
        id, parsed.name ?? null, parsed.type ?? null, parsed.from_email ?? null,
        parsed.from_name ?? null, parsed.reply_to ?? null,
        parsed.priority ?? null, parsed.active ?? null,
        sealed ? JSON.stringify(sealed) : null,
      ],
    );
    const row = rows[0];
    if (!row) return null;
    return { ...row, config: maskConfig(row.config, SECRET_KEYS[row.type] ?? []) };
  });
}

export const deleteProvider = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query("DELETE FROM email_providers WHERE id = $1 RETURNING id", [id]))
      .rows.length > 0,
  );

export const recordProviderResult = (
  ctx: Ctx,
  id: string,
  outcome: { ok: true } | { ok: false; error: string },
) =>
  withTenant(ctx.orgId, (c) =>
    c.query(
      outcome.ok
        ? `UPDATE email_providers SET verified_at = now(), last_error = NULL WHERE id = $1`
        : `UPDATE email_providers SET last_error = $2 WHERE id = $1`,
      outcome.ok ? [id] : [id, outcome.error],
    ),
  );
