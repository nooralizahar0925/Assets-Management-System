import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[id]/route";
import { GET as PERMISSIONS } from "../permissions/route";
import { PUT as ASSIGN } from "../users/[id]/role/route";

let orgId: string;
let adminSession: string;
let viewerSession: string;
let adminUserId: string;

const req = (session: string, method = "GET", body?: unknown) =>
  new Request("http://api.test/api/admin/roles", {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const withId = (session: string, id: string, method: string, body?: unknown) => ({
  request: new Request(`http://api.test/api/admin/roles/${id}`, {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  ctx: { params: Promise.resolve({ id }) },
});

async function roleNamed(name: string): Promise<{ id: string }> {
  const body = (await (await GET(req(adminSession))).json()) as {
    data: { id: string; name: string }[];
  };
  return body.data.find((r) => r.name === name)!;
}

beforeAll(async () => {
  orgId = await createOrg("Role Routes Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  adminUserId = admin.id;
  adminSession = await createSession(admin.id, orgId);
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId,
  );
  // A second administrator, so the lockout guard is not tripped by tests that
  // are not about it.
  await createUserWithRole(orgId, "Administrator");
});

describe("GET /api/admin/roles", () => {
  it("refuses a caller without roles:read", async () => {
    expect((await GET(req(viewerSession))).status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await GET(new Request("http://api.test/api/admin/roles"));
    expect(res.status).toBe(401);
  });

  it("lists the seeded roles with their permissions and holder counts", async () => {
    const body = (await (await GET(req(adminSession))).json()) as {
      data: { name: string; is_system: boolean; permissions: string[]; user_count: number }[];
    };
    const names = body.data.map((r) => r.name);
    expect(names).toContain("Administrator");
    expect(names).toContain("Viewer");

    const admin = body.data.find((r) => r.name === "Administrator")!;
    expect(admin.is_system).toBe(true);
    expect(admin.permissions).toContain("roles:write");
    expect(admin.user_count).toBeGreaterThan(0);
  });
});

describe("POST /api/admin/roles", () => {
  it("refuses a viewer", async () => {
    const res = await POST(
      req(viewerSession, "POST", { name: "Nope", permissions: ["assets:read"] }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects an unknown permission with a validation problem", async () => {
    const res = await POST(
      req(adminSession, "POST", { name: "Bogus", permissions: ["assets:teleport"] }),
    );
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("rejects an empty permission list", async () => {
    const res = await POST(
      req(adminSession, "POST", { name: "Empty", permissions: [] }),
    );
    expect(res.status).toBe(422);
  });

  it("creates a custom role", async () => {
    const res = await POST(
      req(adminSession, "POST", {
        name: "Warehouse", description: "Floor staff",
        permissions: ["assets:read", "custody:write"],
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { is_system: boolean; permissions: string[] };
    expect(body.is_system).toBe(false);
    expect(body.permissions.sort()).toEqual(["assets:read", "custody:write"]);
  });

  it("reports a duplicate name as a conflict, not a crash", async () => {
    await POST(req(adminSession, "POST", { name: "Twice", permissions: ["assets:read"] }));
    const res = await POST(
      req(adminSession, "POST", { name: "twice", permissions: ["assets:read"] }),
    );
    expect(res.status).toBe(409);
  });
});

describe("PATCH /api/admin/roles/:id", () => {
  it("replaces the permission set", async () => {
    const created = (await (await POST(
      req(adminSession, "POST", {
        name: "Shifting", permissions: ["assets:read", "assets:write"],
      }),
    )).json()) as { id: string };

    const { request, ctx } = withId(adminSession, created.id, "PATCH", {
      permissions: ["assets:read"],
    });
    const res = await PATCH(request, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { permissions: string[] };
    expect(body.permissions).toEqual(["assets:read"]);
  });

  it("refuses to strip roles:write from the last role that grants it", async () => {
    const admin = await roleNamed("Administrator");
    const { request, ctx } = withId(adminSession, admin.id, "PATCH", {
      permissions: ["assets:read"],
    });
    const res = await PATCH(request, ctx);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toMatch(/nobody able to manage roles/i);
  });
});

describe("DELETE /api/admin/roles/:id", () => {
  it("refuses to delete a system role", async () => {
    const viewer = await roleNamed("Viewer");
    const { request, ctx } = withId(adminSession, viewer.id, "DELETE");
    expect((await DELETE(request, ctx)).status).toBe(403);
  });

  it("refuses to delete a role somebody still holds", async () => {
    const created = (await (await POST(
      req(adminSession, "POST", { name: "Occupied", permissions: ["assets:read"] }),
    )).json()) as { id: string };

    const holder = await createUserWithRole(orgId, "Viewer");
    await withTenant(orgId, (c) =>
      c.query("UPDATE users SET role_id = $2 WHERE id = $1", [holder.id, created.id]),
    );

    const { request, ctx } = withId(adminSession, created.id, "DELETE");
    const res = await DELETE(request, ctx);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/still hold/i);
  });

  it("deletes an unused custom role", async () => {
    const created = (await (await POST(
      req(adminSession, "POST", { name: "Disposable", permissions: ["assets:read"] }),
    )).json()) as { id: string };

    const { request, ctx } = withId(adminSession, created.id, "DELETE");
    expect((await DELETE(request, ctx)).status).toBe(204);
  });

  it("reports an unknown id as not found", async () => {
    const { request, ctx } = withId(
      adminSession, "00000000-0000-0000-0000-000000000000", "DELETE",
    );
    expect((await DELETE(request, ctx)).status).toBe(404);
  });
});

describe("GET /api/admin/permissions", () => {
  it("returns the vocabulary grouped for the editor", async () => {
    const res = await PERMISSIONS(
      new Request("http://api.test/api/admin/permissions", {
        headers: { cookie: `ams_session=${adminSession}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { group: string; permissions: { key: string; label: string }[] }[];
    };
    const groups = body.data.map((g) => g.group);
    expect(groups).toContain("Assets");
    expect(groups).toContain("Administration");
    for (const group of body.data) {
      for (const p of group.permissions) {
        expect(p.label.length).toBeGreaterThan(3);
      }
    }
  });
});

describe("PUT /api/admin/users/:id/role", () => {
  const assign = (session: string, userId: string, body: unknown) =>
    ASSIGN(
      new Request(`http://api.test/api/admin/users/${userId}/role`, {
        method: "PUT",
        headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: userId }) },
    );

  it("refuses a caller without users:write", async () => {
    const viewer = await roleNamed("Viewer");
    const target = await createUserWithRole(orgId, "Viewer");
    const res = await assign(viewerSession, target.id, { role_id: viewer.id });
    expect(res.status).toBe(403);
  });

  it("assigns a role with a branch scope", async () => {
    const role = await roleNamed("Technician");
    const target = await createUserWithRole(orgId, "Viewer");
    const locationId = await withTenant(orgId, async (c) =>
      (await c.query<{ id: string }>(
        "INSERT INTO locations (org_id, name) VALUES ($1,'Depot') RETURNING id", [orgId],
      )).rows[0].id,
    );

    const res = await assign(adminSession, target.id, {
      role_id: role.id, location_ids: [locationId],
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as { locationIds: string[] }).toMatchObject({
      locationIds: [locationId],
    });
  });

  it("treats an omitted location list as organisation-wide", async () => {
    const role = await roleNamed("Technician");
    const target = await createUserWithRole(orgId, "Viewer");
    const res = await assign(adminSession, target.id, { role_id: role.id });
    expect(res.status).toBe(200);
    expect((await res.json()) as { locationIds: string[] }).toMatchObject({
      locationIds: [],
    });
  });

  it("rejects a non-uuid role id", async () => {
    const target = await createUserWithRole(orgId, "Viewer");
    expect((await assign(adminSession, target.id, { role_id: "nope" })).status).toBe(422);
  });

  it("refuses to demote the last person who can manage roles", async () => {
    // Move every other administrator off the role first, so the caller is the
    // only one left - which is the situation the guard exists for.
    const viewer = await roleNamed("Viewer");
    const admin = await roleNamed("Administrator");
    await withTenant(orgId, (c) =>
      c.query(
        "UPDATE users SET role_id = $1 WHERE org_id = $2 AND role_id = $3 AND id <> $4",
        [viewer.id, orgId, admin.id, adminUserId],
      ),
    );

    const res = await assign(adminSession, adminUserId, { role_id: viewer.id });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/nobody able/i);
  });
});
