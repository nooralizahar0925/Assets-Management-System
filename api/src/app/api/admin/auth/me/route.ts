import { readSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

export const GET = safe(async (req: Request) => {
  const ctx = await readSession(req);
  if (!ctx) return unauthorized();
  return Response.json({
    org_id: ctx.orgId,
    user: {
      id: ctx.actor.id,
      name: ctx.actor.label,
      // The dashboard decides what to render from these, so they are the
      // fine-grained permissions rather than the coarse published scopes.
      permissions: ctx.actor.permissions,
      // null means organisation-wide; a list means this person only sees and
      // acts on those branches.
      location_scope: ctx.actor.locationScope,
      // Kept for compatibility with anything reading the old shape.
      scopes: ctx.actor.scopes,
    },
  });
});
