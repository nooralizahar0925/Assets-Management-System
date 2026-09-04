import { requireAuth, isResponse } from "@/lib/auth/guard";
import {
  listRoles, createRole, RoleInput, DuplicateRoleError,
} from "@/lib/domain/roles";
import { validationProblem, conflict } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "roles:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listRoles(ctx) });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "roles:write");
  if (isResponse(ctx)) return ctx;

  const parsed = RoleInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    return Response.json(await createRole(ctx, parsed.data), { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateRoleError) return conflict(err.message);
    throw err;
  }
});
