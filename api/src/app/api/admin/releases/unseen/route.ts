import { readSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { countUnseen } from "@/lib/domain/releases";

/** How many releases this person has not read - the dot in the sidebar. */
export const GET = safe(async (req: Request) => {
  const ctx = await readSession(req);
  if (!ctx) return unauthorized();

  return Response.json({ unseen: await countUnseen(ctx) });
});
