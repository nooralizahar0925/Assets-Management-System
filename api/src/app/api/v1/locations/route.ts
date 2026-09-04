import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, conflict } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listLocations, createLocation, LocationInput } from "@/lib/domain/locations";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "locations:read");
  if (isResponse(ctx)) return ctx;
  // Not branch-filtered: a scoped user still needs the whole tree for context,
  // and a location name is not tenant data worth hiding from a colleague.
  return Response.json({ data: await listLocations(ctx) });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "locations:write");
  if (isResponse(ctx)) return ctx;
  const parsed = LocationInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  try {
    return Response.json(await createLocation(ctx, parsed.data), { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return conflict("A location with that name already exists.");
    }
    throw err;
  }
});
