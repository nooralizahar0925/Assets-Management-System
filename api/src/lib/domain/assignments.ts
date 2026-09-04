import { z } from "zod";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { recordEvent } from "./audit";
import { dispatch } from "../notify/dispatch";

/** The asset exists but is in a state this operation cannot act on. */
export class TransitionError extends Error {
  readonly status = 409;
}

/**
 * The asset does not exist, or has been deleted.
 *
 * Kept distinct from TransitionError so a handler answers 404 rather than 409.
 * Telling an integrator to resolve a conflict on a record that is not there
 * sends them looking for a state that does not exist.
 */
export class AssetNotFoundError extends Error {
  readonly status = 404;
}

export const CheckOutInput = z.object({
  assignee_type: z.enum(["user", "location", "external"]),
  assignee_id: z.string().uuid().nullish(),
  assignee_label: z.string().max(200).nullish(),
  location_id: z.string().uuid().nullish(),
  due_at: z.string().datetime().nullish(),
  note: z.string().max(2000).nullish(),
});
export type CheckOutInput = z.infer<typeof CheckOutInput>;

export const CheckInInput = z.object({
  note: z.string().max(2000).nullish(),
  condition: z.string().max(120).nullish(),
  location_id: z.string().uuid().nullish(),
});
export type CheckInInput = z.infer<typeof CheckInInput>;

export interface Assignment {
  id: string;
  asset_id: string;
  assignee_type: "user" | "location" | "external";
  assignee_id: string | null;
  assignee_label: string | null;
  location_id: string | null;
  checked_out_at: string;
  due_at: string | null;
  checked_in_at: string | null;
  checkout_note: string | null;
  checkin_note: string | null;
  condition: string | null;
}

// An asset in maintenance can be issued straight back out; a retired or lost
// one cannot, and neither can one already in someone's hands.
const CHECKOUTABLE = new Set(["available", "maintenance"]);

export async function checkOut(
  ctx: Ctx,
  assetId: string,
  raw: CheckOutInput,
): Promise<Assignment> {
  const input = CheckOutInput.parse(raw);
  const assignment = await withTenant(ctx.orgId, async (c) => {
    // FOR UPDATE holds the row for the transaction, so two concurrent
    // check-outs cannot both read "available" and both proceed. The unique
    // index on one open assignment per asset is the backstop.
    const { rows: assetRows } = await c.query<{ status: string }>(
      "SELECT status FROM assets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      [assetId],
    );
    const asset = assetRows[0];
    if (!asset) throw new AssetNotFoundError("Asset not found");
    if (!CHECKOUTABLE.has(asset.status)) {
      throw new TransitionError(`Cannot check out an asset that is ${asset.status}.`);
    }

    const { rows } = await c.query<Assignment>(
      `INSERT INTO assignments
         (org_id, asset_id, assignee_type, assignee_id, assignee_label,
          location_id, checked_out_by, due_at, checkout_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        ctx.orgId, assetId, input.assignee_type, input.assignee_id ?? null,
        input.assignee_label ?? null, input.location_id ?? null,
        ctx.actor.type === "user" ? ctx.actor.id : null,
        input.due_at ?? null, input.note ?? null,
      ],
    );

    await c.query(
      `UPDATE assets SET
         status = 'in_use',
         assignee_id = $2,
         location_id = coalesce($3, location_id)
       WHERE id = $1`,
      [
        assetId,
        input.assignee_type === "user" ? input.assignee_id ?? null : null,
        input.location_id ?? null,
      ],
    );

    await recordEvent(c, ctx, {
      assetId,
      event: "asset.checked_out",
      changes: {
        status: { from: asset.status, to: "in_use" },
        assignee: {
          from: null,
          to: input.assignee_label ?? input.assignee_id ?? input.location_id,
        },
      },
      note: input.note ?? null,
    });
    return rows[0];
  });

  // Fired after the transaction commits: a queued email must never be able to
  // roll back a completed check-out, and dispatch never throws.
  await dispatch(ctx, "asset.checked_out", {
    assetId,
    assigneeId: input.assignee_type === "user" ? input.assignee_id ?? null : null,
    actorId: ctx.actor.type === "user" ? ctx.actor.id : null,
    asset: await getAssetSummary(ctx, assetId),
    assignment,
  });

  return assignment;
}

export async function checkIn(
  ctx: Ctx,
  assetId: string,
  raw: CheckInInput,
): Promise<Assignment> {
  const input = CheckInInput.parse(raw);
  const assignment = await withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<Assignment>(
      `UPDATE assignments SET
         checked_in_at = now(),
         checked_in_by = $2,
         checkin_note  = $3,
         condition     = $4
       WHERE asset_id = $1 AND checked_in_at IS NULL
       RETURNING *`,
      [
        assetId,
        ctx.actor.type === "user" ? ctx.actor.id : null,
        input.note ?? null,
        input.condition ?? null,
      ],
    );
    if (rows.length === 0) {
      // Either the asset is not out, or it does not exist. Distinguish the two
      // so the caller gets 404 rather than a conflict on a phantom record.
      const { rows: exists } = await c.query(
        "SELECT 1 FROM assets WHERE id = $1 AND deleted_at IS NULL", [assetId],
      );
      if (exists.length === 0) throw new AssetNotFoundError("Asset not found");
      throw new TransitionError("This asset is not currently checked out.");
    }

    await c.query(
      `UPDATE assets SET
         status = 'available',
         assignee_id = NULL,
         location_id = coalesce($2, location_id)
       WHERE id = $1`,
      [assetId, input.location_id ?? null],
    );

    await recordEvent(c, ctx, {
      assetId,
      event: "asset.checked_in",
      changes: { status: { from: "in_use", to: "available" } },
      note: input.note ?? null,
    });
    return rows[0];
  });

  await dispatch(ctx, "asset.checked_in", {
    assetId,
    assigneeId: assignment.assignee_id,
    actorId: ctx.actor.type === "user" ? ctx.actor.id : null,
    asset: await getAssetSummary(ctx, assetId),
    assignment,
  });

  return assignment;
}

/** The few asset fields a notification template needs, without a full row fetch. */
async function getAssetSummary(ctx: Ctx, assetId: string) {
  return withTenant(ctx.orgId, async (c) =>
    (await c.query<{ name: string; asset_tag: string; status: string }>(
      "SELECT name, asset_tag, status::text AS status FROM assets WHERE id = $1",
      [assetId],
    )).rows[0] ?? null,
  );
}

export const addNote = (ctx: Ctx, assetId: string, note: string) =>
  withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query(
      "SELECT 1 FROM assets WHERE id = $1 AND deleted_at IS NULL", [assetId],
    );
    if (rows.length === 0) return false;
    await recordEvent(c, ctx, { assetId, event: "asset.note", note });
    return true;
  });

export const listAssignments = (ctx: Ctx, assetId: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Assignment>(
      `SELECT a.*, u.name AS assignee_user_name, l.name AS location_name
         FROM assignments a
         LEFT JOIN users u ON u.id = a.assignee_id
         LEFT JOIN locations l ON l.id = a.location_id
        WHERE a.asset_id = $1
        ORDER BY a.checked_out_at DESC, a.id DESC`,
      [assetId],
    )).rows,
  );
