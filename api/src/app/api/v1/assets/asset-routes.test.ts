import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/http/handler";
import { createAsset } from "@/lib/domain/assets";
import { createCategory } from "@/lib/domain/categories";
import { GET, PATCH, DELETE } from "./[id]/route";

let orgId: string;
let adminCtx: Ctx;
let categoryId: string;
let jakarta: string;
let bekasi: string;

let managerSession: string;
let viewerSession: string;
let technicianSession: string;
let scopedSession: string;

const call = (session: string, id: string, method: string, body?: unknown) => ({
  request: new Request(`http://api.test/api/v1/assets/${id}`, {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  ctx: { params: Promise.resolve({ id }) },
});

beforeAll(async () => {
  orgId = await createOrg("Asset Routes Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  adminCtx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };

  [jakarta, bekasi] = await withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO locations (org_id, name) VALUES ($1,'Jakarta'), ($1,'Bekasi')
       RETURNING id`,
      [orgId],
    );
    return [rows[0].id, rows[1].id];
  });

  categoryId = (await createCategory(adminCtx, {
    name: "Routed", kind: "it",
    field_schema: { fields: [
      { key: "ram_gb", label: "RAM", type: "number", required: false },
    ] },
  })).id;

  managerSession = await createSession(
    (await createUserWithRole(orgId, "Manager")).id, orgId);
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId);
  technicianSession = await createSession(
    (await createUserWithRole(orgId, "Technician")).id, orgId);

  const scoped = await createUserWithRole(orgId, "Manager");
  await withTenant(orgId, (c) =>
    c.query(
      `INSERT INTO user_location_scopes (org_id, user_id, location_id)
       VALUES ($1, $2, $3)`,
      [orgId, scoped.id, bekasi],
    ),
  );
  scopedSession = await createSession(scoped.id, orgId);
});

const newAsset = (name: string, locationId: string | null = null) =>
  createAsset(adminCtx, { name, category_id: categoryId, location_id: locationId });

describe("GET /api/v1/assets/:id", () => {
  it("refuses an unauthenticated caller", async () => {
    const a = await newAsset("Unauth");
    const { request, ctx } = call("not-a-session", a.id, "GET");
    expect((await GET(request, ctx)).status).toBe(401);
  });

  it("lets a viewer read an asset", async () => {
    const a = await newAsset("Readable");
    const { request, ctx } = call(viewerSession, a.id, "GET");
    expect((await GET(request, ctx)).status).toBe(200);
  });

  it("reports an unknown id as not found", async () => {
    const { request, ctx } = call(viewerSession, "00000000-0000-0000-0000-000000000000", "GET");
    expect((await GET(request, ctx)).status).toBe(404);
  });

  it("reports a soft-deleted asset as not found", async () => {
    const a = await newAsset("Gone");
    const del = call(managerSession, a.id, "DELETE");
    await DELETE(del.request, del.ctx);
    const { request, ctx } = call(viewerSession, a.id, "GET");
    expect((await GET(request, ctx)).status).toBe(404);
  });
});

describe("PATCH /api/v1/assets/:id", () => {
  it("refuses a viewer", async () => {
    const a = await newAsset("Guarded");
    const { request, ctx } = call(viewerSession, a.id, "PATCH", { name: "Nope" });
    expect((await PATCH(request, ctx)).status).toBe(403);
  });

  it("lets a technician edit an asset", async () => {
    const a = await newAsset("Editable");
    const { request, ctx } = call(technicianSession, a.id, "PATCH", { name: "Edited" });
    const res = await PATCH(request, ctx);
    expect(res.status).toBe(200);
    expect((await res.json()) as { name: string }).toMatchObject({ name: "Edited" });
  });

  it("rejects an invalid custom field with 422, not 500", async () => {
    const a = await newAsset("Typed");
    const { request, ctx } = call(managerSession, a.id, "PATCH", {
      custom: { ram_gb: "loads" },
    });
    const res = await PATCH(request, ctx);
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("reports a duplicate serial number as 409", async () => {
    await newAsset("First");
    const first = await createAsset(adminCtx, {
      name: "SerialHolder", category_id: categoryId, serial_no: "DUP-1",
    });
    const second = await newAsset("SerialTaker");
    expect(first.serial_no).toBe("DUP-1");

    const { request, ctx } = call(managerSession, second.id, "PATCH", {
      serial_no: "DUP-1",
    });
    expect((await PATCH(request, ctx)).status).toBe(409);
  });
});

describe("DELETE /api/v1/assets/:id", () => {
  it("refuses a technician, who may edit but not delete", async () => {
    const a = await newAsset("Undeletable");
    const { request, ctx } = call(technicianSession, a.id, "DELETE");
    expect((await DELETE(request, ctx)).status).toBe(403);
  });

  it("lets a manager delete", async () => {
    const a = await newAsset("Deletable");
    const { request, ctx } = call(managerSession, a.id, "DELETE");
    expect((await DELETE(request, ctx)).status).toBe(204);
  });
});

describe("branch scope", () => {
  it("lets a scoped user read an asset in their branch", async () => {
    const a = await newAsset("In Bekasi", bekasi);
    const { request, ctx } = call(scopedSession, a.id, "GET");
    expect((await GET(request, ctx)).status).toBe(200);
  });

  it("refuses a scoped user an asset in another branch", async () => {
    const a = await newAsset("In Jakarta", jakarta);
    const { request, ctx } = call(scopedSession, a.id, "GET");
    const res = await GET(request, ctx);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/branch/i);
  });

  it("refuses a scoped user an asset with no location", async () => {
    const a = await newAsset("Unplaced", null);
    const { request, ctx } = call(scopedSession, a.id, "GET");
    expect((await GET(request, ctx)).status).toBe(403);
  });

  it("refuses a scoped user editing outside their branch", async () => {
    const a = await newAsset("Jakarta Edit", jakarta);
    const { request, ctx } = call(scopedSession, a.id, "PATCH", { name: "Nope" });
    expect((await PATCH(request, ctx)).status).toBe(403);
  });

  it("refuses a scoped user moving an asset out of their branches", async () => {
    // Otherwise a scoped user could push an asset somewhere they can no longer
    // see, which is a one-way loss of visibility.
    const a = await newAsset("Stays Put", bekasi);
    const { request, ctx } = call(scopedSession, a.id, "PATCH", {
      location_id: jakarta,
    });
    expect((await PATCH(request, ctx)).status).toBe(403);
  });

  it("lets an unscoped manager move an asset anywhere", async () => {
    const a = await newAsset("Mobile", bekasi);
    const { request, ctx } = call(managerSession, a.id, "PATCH", {
      location_id: jakarta,
    });
    expect((await PATCH(request, ctx)).status).toBe(200);
  });

  it("refuses a scoped user deleting outside their branch", async () => {
    const a = await newAsset("Jakarta Delete", jakarta);
    const { request, ctx } = call(scopedSession, a.id, "DELETE");
    expect((await DELETE(request, ctx)).status).toBe(403);
  });
});
