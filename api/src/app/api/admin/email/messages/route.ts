import { requireAuth, isResponse } from "@/lib/auth/guard";
import { safe } from "@/lib/http/handler";
import { listMessages } from "@/lib/email/outbox";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;

  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 100, 500);
  // Metadata only - the bodies can quote asset data and are not needed to see
  // whether delivery is working.
  return Response.json({ data: await listMessages(ctx, limit) });
});
