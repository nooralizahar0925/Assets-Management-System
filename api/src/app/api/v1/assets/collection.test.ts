import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/http/handler";
import { createAsset } from "@/lib/domain/assets";
import { createCategory } from "@/lib/domain/categories";
import { GET, POST } from "./route";

let orgId: string;
let adminCtx: Ctx;
let categoryId: string;
let jakarta: string;
let bekasi: string;
let managerSession: string;
let viewerSession: string;
let scopedSession: string;

const req = (session: string, query = "", method = "GET", body?: unknown) =>
  new Request(`http://api.test/api/v1/assets${query}`, {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

interface Page {
  data: { name: string; asset_tag: string; status: string }[];
  meta: { page: number; per_page: number; total: number; total_pages: number };
}

beforeAll(async () => {
  orgId = await createOrg("Collection Org");
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
    name: "Collected", kind: "it", field_schema: { fields: [] },
  })).id;

  await createAsset(adminCtx, {
    name: "Alpha", category_id: categoryId, location_id: jakarta, status: "available",
  });
  await createAsset(adminCtx, {
    name: "Beta", category_id: categoryId, location_id: bekasi, status: "in_use",
  });

  managerSession = await createSession(
    (await createUserWithRole(orgId, "Manager")).id, orgId);
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId);

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

describe("GET /api/v1/assets", () => {
  it("refuses an unauthenticated caller", async () => {
    expect((await GET(new Request("http://api.test/api/v1/assets"))).status).toBe(401);
  });

  it("returns a paginated envelope", async () => {
    const body = (await (await GET(req(viewerSession))).json()) as Page;
    expect(body.meta).toMatchObject({ page: 1, per_page: 50 });
    expect(body.meta.total).toBeGreaterThanOrEqual(2);
    expect(body.data.length).toBe(body.meta.total);
  });

  it("filters by status from the query string", async () => {
    const body = (await (await GET(req(viewerSession, "?status=in_use"))).json()) as Page;
    expect(body.data.every((a) => a.status === "in_use")).toBe(true);
  });

  it("accepts several statuses as a comma list", async () => {
    const body = (await (await GET(
      req(viewerSession, "?status=in_use,available"),
    )).json()) as Page;
    expect(body.meta.total).toBeGreaterThanOrEqual(2);
  });

  it("searches by name", async () => {
    const body = (await (await GET(req(viewerSession, "?q=alph"))).json()) as Page;
    expect(body.data.map((a) => a.name)).toEqual(["Alpha"]);
  });

  it("ignores a sort column that is not allowlisted", async () => {
    // parseSort falls back rather than erroring, and password_hash is not a
    // column on assets at all - if it reached ORDER BY the query would fail.
    const res = await GET(req(viewerSession, "?sort=password_hash"));
    expect(res.status).toBe(200);
  });

  it("caps an absurd per_page rather than honouring it", async () => {
    const body = (await (await GET(req(viewerSession, "?per_page=100000"))).json()) as Page;
    expect(body.meta.per_page).toBe(200);
  });

  it("shows a branch-scoped caller only their branch, total included", async () => {
    const body = (await (await GET(req(scopedSession))).json()) as Page;
    expect(body.data.map((a) => a.name)).toEqual(["Beta"]);
    expect(body.meta.total).toBe(1);
  });
});

describe("POST /api/v1/assets", () => {
  it("refuses a viewer", async () => {
    const res = await POST(req(viewerSession, "", "POST", {
      name: "Nope", category_id: categoryId,
    }));
    expect(res.status).toBe(403);
  });

  it("creates an asset and allocates a tag", async () => {
    const res = await POST(req(managerSession, "", "POST", {
      name: "Created", category_id: categoryId,
    }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { asset_tag: string; status: string };
    expect(body.asset_tag).toMatch(/^AMS-\d{6}$/);
    expect(body.status).toBe("available");
  });

  it("rejects a missing name with 422", async () => {
    const res = await POST(req(managerSession, "", "POST", { category_id: categoryId }));
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("reports a duplicate asset tag as 409", async () => {
    await POST(req(managerSession, "", "POST", {
      name: "TagOwner", category_id: categoryId, asset_tag: "FIXED-1",
    }));
    const res = await POST(req(managerSession, "", "POST", {
      name: "TagThief", category_id: categoryId, asset_tag: "FIXED-1",
    }));
    expect(res.status).toBe(409);
  });

  it("lets a scoped user create inside their branch", async () => {
    const res = await POST(req(scopedSession, "", "POST", {
      name: "Scoped Create", category_id: categoryId, location_id: bekasi,
    }));
    expect(res.status).toBe(201);
  });

  it("refuses a scoped user creating in another branch", async () => {
    const res = await POST(req(scopedSession, "", "POST", {
      name: "Wrong Branch", category_id: categoryId, location_id: jakarta,
    }));
    expect(res.status).toBe(403);
  });

  it("refuses a scoped user creating an asset with no location", async () => {
    // Otherwise a scoped user could file an asset they immediately lose sight of.
    const res = await POST(req(scopedSession, "", "POST", {
      name: "Nowhere", category_id: categoryId,
    }));
    expect(res.status).toBe(403);
  });
});
