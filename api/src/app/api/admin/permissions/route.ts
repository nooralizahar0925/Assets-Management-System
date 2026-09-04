import { requireAuth, isResponse } from "@/lib/auth/guard";
import { permissionCatalogue } from "@/lib/domain/roles";
import { safe } from "@/lib/http/handler";

// The vocabulary is the same for every tenant, but it still requires a
// credential: it describes the product's internals and there is no reason to
// serve it to an anonymous caller.
export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "roles:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: permissionCatalogue() });
});
