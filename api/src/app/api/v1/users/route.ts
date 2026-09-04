import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { listAssignableUsers } from "@/lib/domain/users";

export const GET = safe(async (req: Request) => {
  // assets:read rather than users:read: this is the check-out picker, and a
  // technician who can issue an asset must be able to choose who to issue it to.
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listAssignableUsers(ctx) });
});
