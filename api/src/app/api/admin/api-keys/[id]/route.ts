import { withTenant } from "@/lib/db";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

export const DELETE = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const { id } = await params;

  const rows = await withTenant(ctx.orgId, async (c) =>
    (await c.query(
      "UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id",
      [id],
    )).rows,
  );
  if (rows.length === 0) return notFound("API key");
  return new Response(null, { status: 204 });
});
