import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { revokeInvitation } from "@/lib/domain/invitations";
import { notFound } from "@/lib/http/problem";

type Params = { params: Promise<{ id: string }> };

/**
 * Withdraws an invitation before it is used.
 *
 * The token in the email stops working immediately, which is the point: an
 * invitation sent to the wrong address is a credential in a stranger's inbox.
 */
export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "users:write");
  if (isResponse(ctx)) return ctx;

  const revoked = await revokeInvitation(ctx, (await params).id);
  return revoked ? new Response(null, { status: 204 }) : notFound("invitation");
});
