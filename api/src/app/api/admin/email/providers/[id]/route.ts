import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, notFound, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import {
  updateProvider, deleteProvider, ProviderPatch,
  InvalidProviderConfigError, UnknownProviderTypeError,
} from "@/lib/domain/emailProviders";

type Params = { params: Promise<{ id: string }> };

export const PATCH = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;

  const parsed = ProviderPatch.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    const updated = await updateProvider(ctx, (await params).id, parsed.data);
    return updated ? Response.json(updated) : notFound("email provider");
  } catch (err) {
    if (err instanceof InvalidProviderConfigError
        || err instanceof UnknownProviderTypeError) {
      return problem(422, "validation", "Validation failed", { detail: err.message });
    }
    throw err;
  }
});

export const DELETE = safe(async (req: Request, { params }: Params) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;
  const done = await deleteProvider(ctx, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("email provider");
});
