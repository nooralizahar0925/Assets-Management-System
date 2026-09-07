import {
  requireAuth, isResponse, withinLocationScope, branchForbidden,
} from "@/lib/auth/guard";
import { validationProblem, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { withIdempotency } from "@/lib/http/idempotency";
import { dispatch } from "@/lib/notify/dispatch";
import { parsePagination, parseSort, paginated } from "@/lib/http/pagination";
import {
  AssetInput, STATUSES, SORTABLE, listAssets, createAsset, CustomFieldError,
  type AssetStatus, type AssetFilters,
} from "@/lib/domain/assets";

function readFilters(url: URL): AssetFilters {
  const statuses = url.searchParams
    .getAll("status")
    .flatMap((s) => s.split(","))
    .filter((s): s is AssetStatus => (STATUSES as readonly string[]).includes(s));

  // `custom[os]=macOS` filters on the JSONB column. The key pattern matches the
  // one field keys are validated against, so no arbitrary text reaches the query.
  const custom: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    const match = key.match(/^custom\[([a-z][a-z0-9_]*)\]$/);
    if (match) custom[match[1]] = value;
  }

  return {
    q: url.searchParams.get("q") ?? undefined,
    status: statuses.length ? statuses : undefined,
    categoryId: url.searchParams.get("category_id") ?? undefined,
    locationId: url.searchParams.get("location_id") ?? undefined,
    assigneeId: url.searchParams.get("assignee_id") ?? undefined,
    custom: Object.keys(custom).length ? custom : undefined,
  };
}

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:read");
  if (isResponse(ctx)) return ctx;

  const url = new URL(req.url);
  const page = parsePagination(url);
  const sort = parseSort(url, SORTABLE, "created_at");
  // listAssets applies the caller's branch scope itself, so a scoped user's
  // page and total both reflect only what they can see.
  const { rows, total } = await listAssets(ctx, readFilters(url), page, sort);
  return paginated(rows, page, total);
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;

  const parsed = AssetInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  // A branch-scoped user may only create assets inside their own branches -
  // otherwise they could file an asset somewhere they cannot then see.
  if (!withinLocationScope(ctx, parsed.data.location_id ?? null)) {
    return branchForbidden();
  }

  // Creating an asset is the write integrators retry most: a timeout leaves
  // them unable to tell whether it happened, and retrying without this makes
  // two.
  return withIdempotency(req, ctx, async () => {
    try {
      const asset = await createAsset(ctx, parsed.data);
      // Dispatched here rather than inside createAsset: an import calls that
      // function once per row, and a thousand-row spreadsheet should announce
      // itself as one import.completed, not a thousand deliveries. A replayed
      // idempotent request never reaches this line, so a retry cannot double.
      await dispatch(ctx, "asset.created", {
        assetId: asset.id,
        actorId: ctx.actor.type === "user" ? ctx.actor.id : null,
        asset: { name: asset.name, asset_tag: asset.asset_tag, status: asset.status },
      });
      return Response.json(asset, { status: 201 });
    } catch (err) {
      if (err instanceof CustomFieldError) {
        return problem(422, "validation", "Validation failed", { detail: err.message });
      }
      if ((err as { code?: string }).code === "23505") {
        return problem(409, "conflict", "Duplicate value", {
          detail: "An asset with that tag or serial number already exists.",
        });
      }
      throw err;
    }
  });
});
