import { readSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

export const GET = safe(async (req: Request) => {
  const ctx = await readSession(req);
  if (!ctx) return unauthorized();
  return Response.json({
    org_id: ctx.orgId,
    user: { id: ctx.actor.id, name: ctx.actor.label, scopes: ctx.actor.scopes },
  });
});
