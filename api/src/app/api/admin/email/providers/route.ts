import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, conflict, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import {
  listProviders, createProvider, ProviderInput,
  DuplicateProviderError, InvalidProviderConfigError, UnknownProviderTypeError,
} from "@/lib/domain/emailProviders";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;
  // Secrets come back masked - listProviders never decrypts.
  return Response.json({ data: await listProviders(ctx) });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;

  const parsed = ProviderInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    return Response.json(await createProvider(ctx, parsed.data), { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateProviderError) return conflict(err.message);
    if (err instanceof InvalidProviderConfigError
        || err instanceof UnknownProviderTypeError) {
      return problem(422, "validation", "Validation failed", { detail: err.message });
    }
    throw err;
  }
});
