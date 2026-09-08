import { safe } from "@/lib/http/handler";
import { requirePlatform } from "@/lib/platform/auth";

export const GET = safe(async (req: Request) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;
  return Response.json(actor);
});
