import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/http/handler";
import { createAsset } from "@/lib/domain/assets";
import { POST as CHECKOUT } from "./[id]/checkout/route";
import { POST as CHECKIN } from "./[id]/checkin/route";
import { POST as NOTE } from "./[id]/notes/route";

let orgId: string;
let adminCtx: Ctx;
let jakarta: string;
let bekasi: string;
let technicianSession: string;
let viewerSession: string;
let scopedSession: string;
let someoneId: string;

const call = (session: string, id: string, path: string, body: unknown) => ({
  request: new Request(`http://api.test/api/v1/assets/${id}/${path}`, {
    method: "POST",
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  }),
  ctx: { params: Promise.resolve({ id }) },
});

beforeAll(async () => {
  orgId = await createOrg("Custody Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  someoneId = admin.id;
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

const newAsset = (name: string, locationId: string | null = null) =>
  createAsset(adminCtx, { name, location_id: locationId });

describe("POST /api/v1/assets/:id/checkout", () => {
  it("refuses a viewer", async () => {
    const a = await newAsset("Viewer blocked");
    const { request, ctx } = call(viewerSession, a.id, "checkout", {
      assignee_type: "user", assignee_id: someoneId,
    });
    expect((await CHECKOUT(request, ctx)).status).toBe(403);
  });

  it("lets a technician check an asset out", async () => {
    const a = await newAsset("Tech checkout");
    const { request, ctx } = call(technicianSession, a.id, "checkout", {
      assignee_type: "user", assignee_id: someoneId,
    });
    expect((await CHECKOUT(request, ctx)).status).toBe(201);
  });

  it("rejects a missing assignee_type with 422", async () => {
    const a = await newAsset("Bad input");
    const { request, ctx } = call(technicianSession, a.id, "checkout", {});
    expect((await CHECKOUT(request, ctx)).status).toBe(422);
  });

  it("reports a double check-out as 409", async () => {
    const a = await newAsset("Twice out");
    const first = call(technicianSession, a.id, "checkout", {
      assignee_type: "user", assignee_id: someoneId,
    });
    await CHECKOUT(first.request, first.ctx);

    const second = call(technicianSession, a.id, "checkout", {
      assignee_type: "user", assignee_id: someoneId,
    });
    const res = await CHECKOUT(second.request, second.ctx);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/in_use/);
  });

  it("reports a missing asset as 404, not 409", async () => {
    const { request, ctx } = call(
      technicianSession, "00000000-0000-0000-0000-000000000000", "checkout",
      { assignee_type: "user", assignee_id: someoneId },
    );
    expect((await CHECKOUT(request, ctx)).status).toBe(404);
  });
});

describe("POST /api/v1/assets/:id/checkin", () => {
  it("returns an asset and reports 200", async () => {
    const a = await newAsset("Returnable");
    const out = call(technicianSession, a.id, "checkout", {
      assignee_type: "user", assignee_id: someoneId,
    });
    await CHECKOUT(out.request, out.ctx);

    const { request, ctx } = call(technicianSession, a.id, "checkin", {
      condition: "good",
    });
    const res = await CHECKIN(request, ctx);
    expect(res.status).toBe(200);
    expect((await res.json()) as { condition: string }).toMatchObject({
      condition: "good",
    });
  });

  it("reports checking in an idle asset as 409", async () => {
    const a = await newAsset("Never out");
    const { request, ctx } = call(technicianSession, a.id, "checkin", {});
    expect((await CHECKIN(request, ctx)).status).toBe(409);
  });

  it("refuses a viewer", async () => {
    const a = await newAsset("Viewer checkin");
    const { request, ctx } = call(viewerSession, a.id, "checkin", {});
    expect((await CHECKIN(request, ctx)).status).toBe(403);
  });
});

describe("POST /api/v1/assets/:id/notes", () => {
  it("records a note", async () => {
    const a = await newAsset("Notable");
    const { request, ctx } = call(technicianSession, a.id, "notes", {
      note: "Casing cracked",
    });
    expect((await NOTE(request, ctx)).status).toBe(204);
  });

  it("rejects an empty note", async () => {
    const a = await newAsset("Empty note");
    const { request, ctx } = call(technicianSession, a.id, "notes", { note: "" });
    expect((await NOTE(request, ctx)).status).toBe(422);
  });

  it("refuses a viewer, who cannot change the record", async () => {
    const a = await newAsset("Viewer note");
    const { request, ctx } = call(viewerSession, a.id, "notes", { note: "x" });
    expect((await NOTE(request, ctx)).status).toBe(403);
  });
});

describe("branch scope on custody", () => {
  it("lets a scoped user check out in their branch", async () => {
    const a = await newAsset("Bekasi tool", bekasi);
    const { request, ctx } = call(scopedSession, a.id, "checkout", {
      assignee_type: "user", assignee_id: someoneId,
    });
    expect((await CHECKOUT(request, ctx)).status).toBe(201);
  });

  it("refuses a scoped user checking out another branch's asset", async () => {
    const a = await newAsset("Jakarta tool", jakarta);
    const { request, ctx } = call(scopedSession, a.id, "checkout", {
      assignee_type: "user", assignee_id: someoneId,
    });
    expect((await CHECKOUT(request, ctx)).status).toBe(403);
  });

  it("refuses a scoped user sending an asset to another branch", async () => {
    const a = await newAsset("Bekasi mover", bekasi);
    const { request, ctx } = call(scopedSession, a.id, "checkout", {
      assignee_type: "location", location_id: jakarta,
    });
    expect((await CHECKOUT(request, ctx)).status).toBe(403);
  });

  it("refuses a scoped user checking in another branch's asset", async () => {
    const a = await newAsset("Jakarta return", jakarta);
    const out = call(technicianSession, a.id, "checkout", {
      assignee_type: "user", assignee_id: someoneId,
    });
    await CHECKOUT(out.request, out.ctx);

    const { request, ctx } = call(scopedSession, a.id, "checkin", {});
    expect((await CHECKIN(request, ctx)).status).toBe(403);
  });
});
