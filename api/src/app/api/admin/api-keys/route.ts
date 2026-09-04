import { z } from "zod";
import { withTenant } from "@/lib/db";
import { mintApiKey } from "@/lib/auth/apikey";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

const SCOPES = ["assets:read", "assets:write", "reports:read", "admin"] as const;
const Body = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(SCOPES)).min(1),
});

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const rows = await withTenant(ctx.orgId, async (c) =>
    (await c.query(
      `SELECT id, name, prefix, scopes, last_used_at, revoked_at, created_at
         FROM api_keys ORDER BY created_at DESC`,
    )).rows,
  );
  return Response.json({ data: rows });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const key = await mintApiKey(ctx.orgId, parsed.data.name, parsed.data.scopes);
  // `key.plaintext` is the only time the plaintext is ever available.
  return Response.json(
    { id: key.id, name: parsed.data.name, prefix: key.prefix, key: key.plaintext },
    { status: 201 },
  );
});
