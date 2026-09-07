import { requireAuth, isResponse } from "@/lib/auth/guard";
import { problem, forbidden } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { dispatch } from "@/lib/notify/dispatch";
import {
  parseUpload, suggestMapping, runImport, type ColumnMap,
} from "@/lib/domain/imports";
import { getCategory } from "@/lib/domain/categories";

const MAX_BYTES = 10 * 1024 * 1024;

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:import");
  if (isResponse(ctx)) return ctx;

  // Imported assets carry no location - the column map has no location field -
  // so a branch-scoped user would create assets they immediately cannot see.
  // Refusing with a clear reason beats silently filing work into a blind spot.
  if (ctx.actor.locationScope !== null) {
    return forbidden(
      "Importing is not available to an account limited to specific branches, " +
        "because imported assets have no location and would not be visible to you.",
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return problem(422, "validation", "Validation failed", {
      detail: "Send the spreadsheet as multipart form field `file`.",
    });
  }
  if (file.size > MAX_BYTES) {
    return problem(413, "payload-too-large", "File too large", {
      detail: "Imports are limited to 10 MB. Split the file and import in batches.",
    });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { headers, rows } = await parseUpload(buffer, file.name);
  if (rows.length === 0) {
    return problem(422, "validation", "Validation failed", {
      detail: "The file contains no data rows.",
    });
  }

  const categoryId = (form?.get("category_id") as string) || null;
  const category = categoryId ? await getCategory(ctx, categoryId) : null;
  const schema = category?.field_schema ?? { fields: [] };

  // No mapping supplied means "tell me what you would do": return the suggestion
  // and the headers so the UI can render the mapping step.
  const rawMapping = form?.get("mapping");
  if (!rawMapping) {
    return Response.json({
      headers,
      row_count: rows.length,
      sample: rows.slice(0, 5),
      suggested_mapping: suggestMapping(headers, schema),
    });
  }

  let mapping: ColumnMap;
  try {
    mapping = JSON.parse(String(rawMapping));
  } catch {
    return problem(422, "validation", "Validation failed", {
      detail: "`mapping` must be a JSON object of source header to target field.",
    });
  }

  // Defaults to a dry run: committing has to be asked for explicitly, so a
  // caller who forgets the flag previews rather than rewrites the register.
  const dryRun = String(form?.get("dry_run") ?? "true") !== "false";
  const result = await runImport(ctx, {
    rows, mapping, categoryId, dryRun, filename: file.name,
  });

  // Only a committed run is an event. A dry run changed nothing, and telling
  // somebody their import finished when it wrote no rows is worse than silence.
  if (!dryRun) {
    await dispatch(ctx, "import.completed", {
      assetId: null,
      importId: result.job_id,
      actorId: ctx.actor.type === "user" ? ctx.actor.id : null,
      filename: file.name,
      total: result.total,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
    });
  }

  return Response.json(result, { status: dryRun ? 200 : 201 });
});
