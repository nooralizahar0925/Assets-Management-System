import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/http/handler";
import { createAsset } from "@/lib/domain/assets";
import { checkOut, addNote } from "@/lib/domain/assignments";
import { GET as HISTORY } from "./assets/[id]/history/route";
import { GET as LOCATIONS, POST as CREATE_LOCATION } from "./locations/route";
import { GET as USERS } from "./users/route";

let orgId: string;
let adminCtx: Ctx;
let adminId: string;
let managerSession: string;
let viewerSession: string;
let technicianSession: string;
let scopedSession: string;
let jakarta: string;
let bekasi: string;

const get = (session: string, url: string) =>
  new Request(url, { headers: { cookie: `ams_session=${session}` } });

const post = (session: string, url: string, body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  orgId = await createOrg("Catalog Org");
  const admin = await createUserWithRole(orgId, "Administrator", { name: "Rina" });
  adminId = admin.id;
  adminCtx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Rina", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };

  [jakarta, bekasi] = await withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO locations (org_id, name) VALUES ($1,'Jakarta HQ'), ($1,'Bekasi Plant')
       RETURNING id`,
      [orgId],
    );
    return [rows[0].id, rows[1].id];
  });

  managerSession = await createSession(
    (await createUserWithRole(orgId, "Manager")).id, orgId);
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId);
  technicianSession = await createSession(
    (await createUserWithRole(orgId, "Technician")).id, orgId);

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

describe("GET /api/v1/assets/:id/history", () => {
  it("returns events and assignments together", async () => {
    const asset = await createAsset(adminCtx, { name: "Storied", location_id: bekasi });
    await checkOut(adminCtx, asset.id, { assignee_type: "user", assignee_id: adminId });
    await addNote(adminCtx, asset.id, "A note");

    const res = await HISTORY(
      get(viewerSession, `http://api.test/api/v1/assets/${asset.id}/history`),
      { params: Promise.resolve({ id: asset.id }) },
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      data: {
        events: { event: string; actor_label: string }[];
        assignments: { assignee_id: string }[];
      };
    };
    expect(body.data.events.map((e) => e.event)).toContain("asset.checked_out");
    expect(body.data.assignments).toHaveLength(1);
    expect(body.data.events[0].actor_label).toBe("Rina");
  });

  it("reports an unknown asset as not found", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const res = await HISTORY(
      get(viewerSession, `http://api.test/api/v1/assets/${id}/history`),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(404);
  });

  it("refuses a scoped user another branch's history", async () => {
    // The history names who held the asset and when, so it is exactly as
    // sensitive as the asset itself.
    const asset = await createAsset(adminCtx, { name: "Jakarta story", location_id: jakarta });
    const res = await HISTORY(
      get(scopedSession, `http://api.test/api/v1/assets/${asset.id}/history`),
      { params: Promise.resolve({ id: asset.id }) },
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/locations", () => {
  it("refuses an unauthenticated caller", async () => {
    const res = await LOCATIONS(new Request("http://api.test/api/v1/locations"));
    expect(res.status).toBe(401);
  });

  it("returns the tree with a display path and depth", async () => {
    await CREATE_LOCATION(post(managerSession, "http://api.test/api/v1/locations", {
      name: "Floor 1", parent_id: jakarta,
    }));

    const body = (await (await LOCATIONS(
      get(viewerSession, "http://api.test/api/v1/locations"),
    )).json()) as { data: { name: string; depth: number; path: string }[] };

    const floor = body.data.find((l) => l.name === "Floor 1")!;
    expect(floor.depth).toBe(1);
    expect(floor.path).toBe("Jakarta HQ / Floor 1");

    const root = body.data.find((l) => l.name === "Bekasi Plant")!;
    expect(root.depth).toBe(0);
  });

  it("counts the assets at each location", async () => {
    await createAsset(adminCtx, { name: "Counted", location_id: bekasi });
    const body = (await (await LOCATIONS(
      get(viewerSession, "http://api.test/api/v1/locations"),
    )).json()) as { data: { name: string; asset_count: number }[] };
    const plant = body.data.find((l) => l.name === "Bekasi Plant")!;
    expect(plant.asset_count).toBeGreaterThan(0);
  });

  it("refuses a viewer creating a location", async () => {
    const res = await CREATE_LOCATION(
      post(viewerSession, "http://api.test/api/v1/locations", { name: "Nope" }),
    );
    expect(res.status).toBe(403);
  });

  it("refuses a technician creating a location", async () => {
    const res = await CREATE_LOCATION(
      post(technicianSession, "http://api.test/api/v1/locations", { name: "Nope" }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects an empty name with 422", async () => {
    const res = await CREATE_LOCATION(
      post(managerSession, "http://api.test/api/v1/locations", { name: "" }),
    );
    expect(res.status).toBe(422);
  });
});

describe("GET /api/v1/users", () => {
  it("lets a technician read the check-out picker", async () => {
    // A technician holds no users:read, but cannot issue an asset without
    // knowing who to issue it to.
    const res = await USERS(get(technicianSession, "http://api.test/api/v1/users"));
    expect(res.status).toBe(200);
  });

  it("returns names and holdings but never email or role", async () => {
    const body = (await (await USERS(
      get(technicianSession, "http://api.test/api/v1/users"),
    )).json()) as { data: Record<string, unknown>[] };

    expect(body.data.length).toBeGreaterThan(0);
    for (const user of body.data) {
      expect(user).toHaveProperty("name");
      expect(user).toHaveProperty("assigned_count");
      expect(user).not.toHaveProperty("email");
      expect(user).not.toHaveProperty("role");
      expect(user).not.toHaveProperty("password_hash");
    }
  });

  it("does not list another organisation's people", async () => {
    const otherOrg = await createOrg("Other Catalog Org");
    await createUserWithRole(otherOrg, "Manager", { name: "Outsider" });

    const body = (await (await USERS(
      get(managerSession, "http://api.test/api/v1/users"),
    )).json()) as { data: { name: string }[] };
    expect(body.data.map((u) => u.name)).not.toContain("Outsider");
  });
});
