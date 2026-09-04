import { z } from "zod";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { sendTestEmail } from "@/lib/email/sender";

const Body = z.object({ to: z.string().email() });

export const POST = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  // Deliberately 200 with an ok flag rather than an error status: "your
  // credentials are wrong" is a successful answer to "are my credentials right?"
  const result = await sendTestEmail(ctx, (await params).id, parsed.data.to);
  return Response.json(result);
});
