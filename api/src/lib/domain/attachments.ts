import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";
import { putObject, deleteObject, getObject, presignGet } from "../storage/s3";
import { recordEvent } from "./audit";

export class UnsupportedTypeError extends Error {
  readonly status = 415;
}

export const ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif",
  "application/pdf", "text/plain", "text/csv",
]);
export const MAX_BYTES = 25 * 1024 * 1024;

export type AttachmentKind = "file" | "photo" | "condition_in" | "condition_out";

export interface Attachment {
  id: string;
  asset_id: string | null;
  assignment_id: string | null;
  kind: AttachmentKind;
  object_key: string;
  filename: string;
  content_type: string;
  size_bytes: string;
  created_at: string;
}

interface AddInput {
  assetId: string | null;
  assignmentId?: string | null;
  kind: AttachmentKind;
  filename: string;
  contentType: string;
  size: number;
  body: Buffer;
}

export async function addAttachment(ctx: Ctx, input: AddInput): Promise<Attachment> {
  if (!ALLOWED_TYPES.has(input.contentType)) {
    throw new UnsupportedTypeError(
      `${input.contentType} is not an accepted file type. ` +
      `Accepted: ${[...ALLOWED_TYPES].join(", ")}.`,
    );
  }
  if (input.size > MAX_BYTES) {
    throw new UnsupportedTypeError("Attachments are limited to 25 MB.");
  }

  // Key is org-prefixed so a bucket listing can never cross tenants, and
  // randomised so an uploaded filename cannot overwrite another.
  const key =
    `${ctx.orgId}/${input.assetId ?? "unfiled"}/${randomUUID()}${extname(input.filename)}`;
  await putObject(key, input.body, input.contentType);

  return withTenant(ctx.orgId, async (c) => {
    const { rows } = await c.query<Attachment>(
      `INSERT INTO attachments
         (org_id, asset_id, assignment_id, kind, object_key, filename,
          content_type, size_bytes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, asset_id, assignment_id, kind, object_key, filename,
                 content_type, size_bytes, created_at`,
      [
        ctx.orgId, input.assetId, input.assignmentId ?? null, input.kind, key,
        input.filename, input.contentType, input.size,
        ctx.actor.type === "user" ? ctx.actor.id : null,
      ],
    );
    if (input.assetId) {
      await recordEvent(c, ctx, {
        assetId: input.assetId,
        event: "asset.attachment_added",
        changes: { filename: { from: null, to: input.filename } },
      });
    }
    return rows[0];
  });
}

export const listAttachments = (ctx: Ctx, assetId: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Attachment>(
      `SELECT id, asset_id, assignment_id, kind, object_key, filename,
              content_type, size_bytes, created_at
         FROM attachments WHERE asset_id = $1
        ORDER BY created_at DESC, id DESC`,
      [assetId],
    )).rows,
  );

export const getAttachment = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Attachment>(
      `SELECT id, asset_id, assignment_id, kind, object_key, filename,
              content_type, size_bytes, created_at
         FROM attachments WHERE id = $1`,
      [id],
    )).rows[0] ?? null,
  );

export async function deleteAttachment(ctx: Ctx, id: string): Promise<boolean> {
  const attachment = await getAttachment(ctx, id);
  if (!attachment) return false;

  await withTenant(ctx.orgId, async (c) => {
    await c.query("DELETE FROM attachments WHERE id = $1", [id]);
    if (attachment.asset_id) {
      await recordEvent(c, ctx, {
        assetId: attachment.asset_id,
        event: "asset.attachment_removed",
        changes: { filename: { from: attachment.filename, to: null } },
      });
    }
  });

  // Storage is cleaned after the row is gone: an orphaned object is
  // recoverable, a row pointing at a deleted object is not.
  await deleteObject(attachment.object_key).catch(() => undefined);
  return true;
}

export const readAttachmentBody = (key: string) => getObject(key);
export const attachmentUrl = (key: string) => presignGet(key, 300);
