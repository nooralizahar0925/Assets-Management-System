import { z } from "zod";
import { readSession } from "@/lib/auth/session";
import { unauthorized, validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { markSeen } from "@/lib/domain/releases";

const Body = z.object({ version: z.string().min(1).max(40) });

/**
 * Records that this person has read up to a release.
 *
 * Guarded by having a session rather than by a permission: reading the release
 * notes is not a privilege, and every role should be able to clear their own
 * indicator.
 */
export const POST = safe(async (req: Request) => {
  const ctx = await readSession(req);
  if (!ctx) return unauthorized();

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  await markSeen(ctx, parsed.data.version);
  return new Response(null, { status: 204 });
});
