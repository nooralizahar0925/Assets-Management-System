import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset } from "./assets";
import {
  addAttachment, listAttachments, deleteAttachment, getAttachment,
  readAttachmentBody, UnsupportedTypeError,
} from "./attachments";

let orgId: string;
let ctx: Ctx;
let assetId: string;

// A one-pixel PNG, so the test exercises real bytes rather than a text stand-in.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

beforeAll(async () => {
  orgId = await createOrg("Attachment Org");
  const tech = await createUserWithRole(orgId, "Technician", { name: "Tech" });
  ctx = {
    orgId,
    actor: {
      type: "user", id: tech.id, label: "Tech", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
  assetId = (await createAsset(ctx, { name: "Photographed drill" })).id;
});

const auditEvents = () =>
  withTenant(orgId, async (c) =>
    (await c.query<{ event: string }>(
      "SELECT event FROM audit_events WHERE asset_id = $1", [assetId],
    )).rows.map((r) => r.event),
  );

describe("addAttachment", () => {
  it("stores the file and returns its metadata", async () => {
    const att = await addAttachment(ctx, {
      assetId, kind: "photo", filename: "front.png",
      contentType: "image/png", size: PNG.length, body: PNG,
    });
    expect(att).toMatchObject({
      filename: "front.png", content_type: "image/png", kind: "photo",
    });
    expect(att.object_key).toMatch(new RegExp(`^${orgId}/`));
  });

  it("stores bytes that come back byte-identical", async () => {
    const att = await addAttachment(ctx, {
      assetId, kind: "photo", filename: "roundtrip.png",
      contentType: "image/png", size: PNG.length, body: PNG,
    });
    const back = await readAttachmentBody(att.object_key);
    expect(back.equals(PNG)).toBe(true);
  });

  it("namespaces the object key by organisation so tenants cannot collide", async () => {
    const att = await addAttachment(ctx, {
      assetId, kind: "file", filename: "manual.pdf",
      contentType: "application/pdf", size: 4, body: Buffer.from("%PDF"),
    });
    expect(att.object_key.startsWith(`${orgId}/`)).toBe(true);
  });

  it("randomises the key so one upload cannot overwrite another", async () => {
    const a = await addAttachment(ctx, {
      assetId, kind: "file", filename: "same.pdf",
      contentType: "application/pdf", size: 4, body: Buffer.from("%PDF"),
    });
    const b = await addAttachment(ctx, {
      assetId, kind: "file", filename: "same.pdf",
      contentType: "application/pdf", size: 4, body: Buffer.from("%PDF"),
    });
    expect(a.object_key).not.toBe(b.object_key);
  });

  it("rejects a content type that is not on the allowlist", async () => {
    await expect(addAttachment(ctx, {
      assetId, kind: "file", filename: "payload.exe",
      contentType: "application/x-msdownload", size: 4, body: Buffer.from("MZ\0\0"),
    })).rejects.toBeInstanceOf(UnsupportedTypeError);
  });

  it("rejects a file over the size limit", async () => {
    await expect(addAttachment(ctx, {
      assetId, kind: "file", filename: "huge.pdf",
      contentType: "application/pdf", size: 26 * 1024 * 1024, body: Buffer.alloc(1),
    })).rejects.toThrow(/25 MB/);
  });

  it("writes an asset.attachment_added audit event", async () => {
    await addAttachment(ctx, {
      assetId, kind: "photo", filename: "side.png",
      contentType: "image/png", size: PNG.length, body: PNG,
    });
    expect(await auditEvents()).toContain("asset.attachment_added");
  });

  it("accepts the condition kinds a damage claim rests on", async () => {
    // Spec 13.4: before/after inspection photos are the basis of a rental
    // damage claim, so the kinds must round-trip exactly.
    for (const kind of ["condition_in", "condition_out"] as const) {
      const att = await addAttachment(ctx, {
        assetId, kind, filename: `${kind}.png`,
        contentType: "image/png", size: PNG.length, body: PNG,
      });
      expect(att.kind).toBe(kind);
    }
  });
});

describe("listAttachments", () => {
  it("returns the asset's attachments newest first", async () => {
    const list = await listAttachments(ctx, assetId);
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0].created_at >= list[1].created_at).toBe(true);
  });

  it("does not return another asset's attachments", async () => {
    const other = await createAsset(ctx, { name: "Unphotographed" });
    expect(await listAttachments(ctx, other.id)).toEqual([]);
  });
});

describe("deleteAttachment", () => {
  it("removes the row and reports success", async () => {
    const att = await addAttachment(ctx, {
      assetId, kind: "file", filename: "temp.txt",
      contentType: "text/plain", size: 5, body: Buffer.from("hello"),
    });
    await expect(deleteAttachment(ctx, att.id)).resolves.toBe(true);
    const list = await listAttachments(ctx, assetId);
    expect(list.find((a) => a.id === att.id)).toBeUndefined();
    await expect(getAttachment(ctx, att.id)).resolves.toBeNull();
  });

  it("records the removal in the audit trail", async () => {
    const att = await addAttachment(ctx, {
      assetId, kind: "file", filename: "audited.txt",
      contentType: "text/plain", size: 2, body: Buffer.from("hi"),
    });
    await deleteAttachment(ctx, att.id);
    expect(await auditEvents()).toContain("asset.attachment_removed");
  });

  it("returns false for an unknown id", async () => {
    await expect(deleteAttachment(ctx, randomUUID())).resolves.toBe(false);
  });
});

describe("tenant isolation", () => {
  it("does not expose another organisation's attachment", async () => {
    const otherOrg = await createOrg("Other Attachment Org");
    const otherUser = await createUserWithRole(otherOrg, "Manager");
    const otherCtx: Ctx = {
      orgId: otherOrg,
      actor: {
        type: "user", id: otherUser.id, label: "Other", scopes: ["admin"],
        permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
        locationScope: null,
      },
    };
    const theirAsset = await createAsset(otherCtx, { name: "Theirs" });
    const theirs = await addAttachment(otherCtx, {
      assetId: theirAsset.id, kind: "file", filename: "private.txt",
      contentType: "text/plain", size: 6, body: Buffer.from("secret"),
    });

    await expect(getAttachment(ctx, theirs.id)).resolves.toBeNull();
    await expect(deleteAttachment(ctx, theirs.id)).resolves.toBe(false);
  });
});
