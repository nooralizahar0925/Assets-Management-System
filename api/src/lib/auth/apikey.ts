import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { query, withTenant } from "../db";
import type { Ctx } from "../http/handler";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Mints a key for a tenant. The plaintext is returned exactly once and never
 * stored; only its SHA-256 is persisted, so a database leak yields no usable key.
 */
export async function mintApiKey(
  orgId: string,
  name: string,
  scopes: string[],
): Promise<{ id: string; prefix: string; plaintext: string }> {
  const secret = randomBytes(24).toString("base64url");
  const prefix = `ams_live_${randomBytes(4).toString("hex")}`;
  const plaintext = `${prefix}.${secret}`;
  const id = await withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO api_keys (org_id, name, prefix, key_hash, scopes)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orgId, name, prefix, sha256(plaintext), scopes],
    );
    return rows[0].id;
  });
  return { id, prefix, plaintext };
}

interface KeyRow {
  id: string;
  org_id: string;
  name: string;
  key_hash: string;
  scopes: string[];
}

export async function readApiKey(req: Request): Promise<Ctx | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token.startsWith("ams_live_")) return null;

  const prefix = token.split(".")[0];
  // Pre-tenant lookup: the org is not known until the key resolves. See
  // migration 006 for why this is a SECURITY DEFINER function and not a grant.
  const rows = await query<KeyRow>("SELECT * FROM auth_lookup_api_key($1)", [prefix]);
  const row = rows[0];
  if (!row) return null;

  const a = Buffer.from(sha256(token));
  const b = Buffer.from(row.key_hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // The org is known from here on, so the write goes through the tenant guard.
  await withTenant(row.org_id, (c) =>
    c.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [row.id]),
  );

  return {
    orgId: row.org_id,
    actor: { type: "api_key", id: row.id, label: row.name, scopes: row.scopes },
  };
}

const LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR ?? 1000);

export async function checkRateLimit(
  ctx: Ctx,
): Promise<{ ok: boolean; remaining: number; resetAt: Date }> {
  const resetAt = new Date(Date.now() + 3_600_000);
  if (ctx.actor.type !== "api_key") {
    return { ok: true, remaining: LIMIT, resetAt };
  }

  return withTenant(ctx.orgId, async (c) => {
    // Count and insert in one statement. Counting and then inserting across two
    // statements under READ COMMITTED lets N concurrent requests all read the
    // same total and all insert, so the limit only holds when it is not being
    // tested - which is exactly backwards.
    //
    // The sweep of expired rows is NOT done here: it was a full DELETE on a hot
    // table on every authenticated request. It belongs in the scheduler
    // (purgeRateLimitEvents, wired up in Task 15).
    const { rows } = await c.query<{ used: number }>(
      `WITH used AS (
         SELECT count(*)::int AS n
           FROM rate_limit_events
          WHERE api_key_id = $1
            AND occurred_at > now() - interval '1 hour'
       ), inserted AS (
         INSERT INTO rate_limit_events (api_key_id, org_id)
         SELECT $1, $2 FROM used WHERE used.n < $3
         RETURNING 1
       )
       SELECT used.n AS used FROM used`,
      [ctx.actor.id, ctx.orgId, LIMIT],
    );

    const used = rows[0].used;
    if (used >= LIMIT) return { ok: false, remaining: 0, resetAt };
    return { ok: true, remaining: LIMIT - used - 1, resetAt };
  });
}

/**
 * Removes rate-limit events outside the window. Called by the scheduler
 * (Task 15), not by request handlers - sweeping on every request meant a full
 * DELETE on a hot table, and the lock contention that comes with it, once per
 * authenticated call.
 */
export async function purgeRateLimitEvents(): Promise<number> {
  const rows = await query<{ id: string }>(
    `DELETE FROM rate_limit_events
      WHERE occurred_at < now() - interval '1 hour'
      RETURNING api_key_id AS id`,
  );
  return rows.length;
}
