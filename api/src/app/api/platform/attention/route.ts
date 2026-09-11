import { requirePlatform } from "@/lib/platform/auth";
import { needsAttention } from "@/lib/platform/attention";
import { safe } from "@/lib/http/handler";

export const GET = safe(async (req: Request) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  // No paging. If this list is ever long enough to need it, that is itself
  // the thing to deal with rather than a scrollbar.
  return Response.json({ data: await needsAttention() });
});
