import { z } from "zod";
import { requirePlatform } from "@/lib/platform/auth";
import { suspendOrg, resumeOrg } from "@/lib/platform/provision";
import { validationProblem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

type Params = { params: Promise<{ id: string }> };

const Body = z.object({
  // Required, and never defaulted: "why is this one suspended" is always asked
  // later, by somebody who was not in the conversation.
  reason: z.string().min(3).max(500),
});

export const POST = safe(async (req: Request, { params }: Params) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const done = await suspendOrg(actor, (await params).id, parsed.data.reason);
  return done ? new Response(null, { status: 204 }) : notFound("organisation");
});

/** Lifting a suspension needs no reason: the reason is that it is over. */
export const DELETE = safe(async (req: Request, { params }: Params) => {
  const actor = await requirePlatform(req);
  if (actor instanceof Response) return actor;

  const done = await resumeOrg(actor, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("organisation");
});
