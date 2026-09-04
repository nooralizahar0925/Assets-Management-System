import { requireAuth, isResponse } from "@/lib/auth/guard";
import {
  updateRole, deleteRole, RolePatch,
  SystemRoleError, RoleInUseError, LastAdministratorError, DuplicateRoleError,
} from "@/lib/domain/roles";
import { validationProblem, notFound, conflict, forbidden } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

type Params = { params: Promise<{ id: string }> };

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "roles:write");
  if (isResponse(ctx)) return ctx;

  const parsed = RolePatch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    return Response.json(await updateRole(ctx, (await params).id, parsed.data));
  } catch (err) {
    if (err instanceof LastAdministratorError) return conflict(err.message);
    if (err instanceof DuplicateRoleError) return conflict(err.message);
    throw err;
  }
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "roles:write");
  if (isResponse(ctx)) return ctx;

  try {
    const deleted = await deleteRole(ctx, (await params).id);
    return deleted ? new Response(null, { status: 204 }) : notFound("role");
  } catch (err) {
    if (err instanceof SystemRoleError) return forbidden(err.message);
    if (err instanceof RoleInUseError) return conflict(err.message);
    throw err;
  }
});
