import { readSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { effectiveEntitlements } from "@/lib/platform/plans";

export const GET = safe(async (req: Request) => {
  const ctx = await readSession(req);
  if (!ctx) return unauthorized();

  // What this organisation has bought, so the interface can stop offering what
  // it does not. Hiding is courtesy; the API refusing is the enforcement, and
  // both exist - a UI-only gate is not a gate.
  const { features, limits } = await effectiveEntitlements(ctx.orgId);

  return Response.json({
    org_id: ctx.orgId,
    features,
    limits,
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
