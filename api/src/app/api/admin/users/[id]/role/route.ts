import { z } from "zod";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { assignRole, LastAdministratorError } from "@/lib/domain/roles";
import { validationProblem, conflict } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

const Body = z.object({
  role_id: z.string().uuid(),
  // Empty means organisation-wide. Absent means the same, so a caller that
  // does not know about branches cannot accidentally narrow someone.
  location_ids: z.array(z.string().uuid()).default([]),
});

export const PUT = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "users:write");
  if (isResponse(ctx)) return ctx;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    const result = await assignRole(
      ctx, (await params).id, parsed.data.role_id, parsed.data.location_ids,
    );
    return Response.json(result);
  } catch (err) {
    if (err instanceof LastAdministratorError) return conflict(err.message);
    throw err;
  }
});
