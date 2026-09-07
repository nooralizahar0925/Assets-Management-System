import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { listMembers } from "@/lib/domain/users";

export const GET = safe(async (req: Request) => {
  // users:read, not assets:read: this carries email addresses and roles, which
  // the check-out picker at /api/v1/users deliberately withholds.
  const ctx = await requireAuth(req, "users:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listMembers(ctx) });
});
