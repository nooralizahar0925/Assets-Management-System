import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/http/handler";
import { createAsset } from "@/lib/domain/assets";
import { GET as LIST, POST as UPLOAD } from "../assets/[id]/attachments/route";
import { GET as DOWNLOAD, DELETE as REMOVE } from "./[id]/route";

let orgId: string;
let adminCtx: Ctx;
let assetId: string;
let jakartaAssetId: string;
let technicianSession: string;
let viewerSession: string;
let scopedSession: string;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const upload = (session: string, id: string, file: File, kind?: string) => {
  const form = new FormData();
  form.set("file", file);
  if (kind) form.set("kind", kind);
  return {
    request: new Request(`http://api.test/api/v1/assets/${id}/attachments`, {
      method: "POST",
      headers: { cookie: `ams_session=${session}` },
      body: form,
    }),
    ctx: { params: Promise.resolve({ id }) },
  };
};

const plain = (session: string, url: string, id: string, method = "GET") => ({
  request: new Request(url, {
    method,
    headers: { cookie: `ams_session=${session}` },
  }),
  ctx: { params: Promise.resolve({ id }) },
});

beforeAll(async () => {
  orgId = await createOrg("Attachment Routes Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  adminCtx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };

  const [jakarta, bekasi] = await withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO locations (org_id, name) VALUES ($1,'Jakarta'), ($1,'Bekasi')
       RETURNING id`,
      [orgId],
    );
    return [rows[0].id, rows[1].id];
  });

  assetId = (await createAsset(adminCtx, { name: "Documented", location_id: bekasi })).id;
  jakartaAssetId = (await createAsset(adminCtx, {
    name: "Elsewhere", location_id: jakarta,
  })).id;

  technicianSession = await createSession(
    (await createUserWithRole(orgId, "Technician")).id, orgId);
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId);

  const scoped = await createUserWithRole(orgId, "Technician");
  await withTenant(orgId, (c) =>
    c.query(
      `INSERT INTO user_location_scopes (org_id, user_id, location_id)
       VALUES ($1, $2, $3)`,
      [orgId, scoped.id, bekasi],
    ),
  );
  scopedSession = await createSession(scoped.id, orgId);
});

describe("POST /api/v1/assets/:id/attachments", () => {
  it("refuses a viewer", async () => {
    const { request, ctx } = upload(
      viewerSession, assetId, new File([PNG], "v.png", { type: "image/png" }),
    );
    expect((await UPLOAD(request, ctx)).status).toBe(403);
  });

  it("uploads a photo and returns its metadata", async () => {
    const { request, ctx } = upload(
      technicianSession, assetId,
      new File([PNG], "front.png", { type: "image/png" }), "condition_out",
    );
    const res = await UPLOAD(request, ctx);
    expect(res.status).toBe(201);
    expect((await res.json()) as { kind: string }).toMatchObject({
      kind: "condition_out", filename: "front.png",
    });
  });

  it("rejects an executable with 415", async () => {
    const { request, ctx } = upload(
      technicianSession, assetId,
      new File([Buffer.from("MZ")], "bad.exe", { type: "application/x-msdownload" }),
    );
    const res = await UPLOAD(request, ctx);
    expect(res.status).toBe(415);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("rejects a request with no file", async () => {
    const res = await UPLOAD(
      new Request(`http://api.test/api/v1/assets/${assetId}/attachments`, {
        method: "POST",
        headers: { cookie: `ams_session=${technicianSession}` },
        body: new FormData(),
      }),
      { params: Promise.resolve({ id: assetId }) },
    );
    expect(res.status).toBe(422);
  });

  it("reports an unknown asset as not found", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const { request, ctx } = upload(
      technicianSession, id, new File([PNG], "x.png", { type: "image/png" }),
    );
    expect((await UPLOAD(request, ctx)).status).toBe(404);
  });
});

describe("GET /api/v1/attachments/:id", () => {
  it("serves the bytes back with the right content type", async () => {
    const up = upload(
      technicianSession, assetId,
      new File([PNG], "served.png", { type: "image/png" }),
    );
    const created = (await (await UPLOAD(up.request, up.ctx)).json()) as { id: string };

    const { request, ctx } = plain(
      viewerSession, `http://api.test/api/v1/attachments/${created.id}`, created.id,
    );
    const res = await DOWNLOAD(request, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toContain("served.png");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("reports an unknown attachment as not found", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const { request, ctx } = plain(
      viewerSession, `http://api.test/api/v1/attachments/${id}`, id,
    );
    expect((await DOWNLOAD(request, ctx)).status).toBe(404);
  });
});

describe("DELETE /api/v1/attachments/:id", () => {
  it("removes an attachment", async () => {
    const up = upload(
      technicianSession, assetId,
      new File([PNG], "doomed.png", { type: "image/png" }),
    );
    const created = (await (await UPLOAD(up.request, up.ctx)).json()) as { id: string };

    const { request, ctx } = plain(
      technicianSession, `http://api.test/api/v1/attachments/${created.id}`,
      created.id, "DELETE",
    );
    expect((await REMOVE(request, ctx)).status).toBe(204);
  });

  it("refuses a viewer", async () => {
    const up = upload(
      technicianSession, assetId,
      new File([PNG], "kept.png", { type: "image/png" }),
    );
    const created = (await (await UPLOAD(up.request, up.ctx)).json()) as { id: string };

    const { request, ctx } = plain(
      viewerSession, `http://api.test/api/v1/attachments/${created.id}`,
      created.id, "DELETE",
    );
    expect((await REMOVE(request, ctx)).status).toBe(403);
  });
});

describe("branch scope", () => {
  it("lets a scoped user attach to an asset in their branch", async () => {
    const { request, ctx } = upload(
      scopedSession, assetId, new File([PNG], "mine.png", { type: "image/png" }),
    );
    expect((await UPLOAD(request, ctx)).status).toBe(201);
  });

  it("refuses a scoped user attaching to another branch's asset", async () => {
    const { request, ctx } = upload(
      scopedSession, jakartaAssetId,
      new File([PNG], "theirs.png", { type: "image/png" }),
    );
    expect((await UPLOAD(request, ctx)).status).toBe(403);
  });

  it("refuses a scoped user downloading another branch's attachment", async () => {
    // The attachment inherits its asset's branch: a condition photo is exactly
    // as sensitive as the asset it documents.
    const up = upload(
      technicianSession, jakartaAssetId,
      new File([PNG], "private.png", { type: "image/png" }),
    );
    const created = (await (await UPLOAD(up.request, up.ctx)).json()) as { id: string };

    const { request, ctx } = plain(
      scopedSession, `http://api.test/api/v1/attachments/${created.id}`, created.id,
    );
    expect((await DOWNLOAD(request, ctx)).status).toBe(403);
  });

  it("lists only what a scoped user may see", async () => {
    const { request, ctx } = plain(
      scopedSession, `http://api.test/api/v1/assets/${jakartaAssetId}/attachments`,
      jakartaAssetId,
    );
    expect((await LIST(request, ctx)).status).toBe(403);
  });
});
