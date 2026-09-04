import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, conflict } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listCategories, createCategory, CategoryInput } from "@/lib/domain/categories";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "categories:read");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listCategories(ctx) });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "categories:write");
  if (isResponse(ctx)) return ctx;
  const parsed = CategoryInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  try {
    return Response.json(await createCategory(ctx, parsed.data), { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return conflict("A category with that name already exists.");
    }
    throw err;
  }
});
