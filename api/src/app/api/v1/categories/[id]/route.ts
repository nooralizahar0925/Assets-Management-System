import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { getCategory, updateCategory, CategoryInput } from "@/lib/domain/categories";

type Params = { params: Promise<{ id: string }> };

export const GET = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "categories:read");
  if (isResponse(ctx)) return ctx;
  const category = await getCategory(ctx, (await params).id);
  return category ? Response.json(category) : notFound("category");
});

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "categories:write");
  if (isResponse(ctx)) return ctx;
  const parsed = CategoryInput.partial().safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  const updated = await updateCategory(ctx, (await params).id, parsed.data);
  return updated ? Response.json(updated) : notFound("category");
});
