import { describe, it, expect, beforeAll } from "vitest";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { GET, POST } from "./route";
import { GET as GET_ONE, PATCH } from "./[id]/route";

let orgId: string;
let otherOrgId: string;
let managerSession: string;
let viewerSession: string;
let technicianSession: string;

const req = (session: string, method = "GET", body?: unknown) =>
  new Request("http://api.test/api/v1/categories", {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const one = (session: string, id: string, method = "GET", body?: unknown) => ({
  request: new Request(`http://api.test/api/v1/categories/${id}`, {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  ctx: { params: Promise.resolve({ id }) },
});

const laptops = {
  name: "Laptops",
  kind: "it" as const,
  field_schema: {
    fields: [
      { key: "os", label: "OS", type: "enum" as const, required: true,
        options: ["Windows 11", "macOS"] },
      { key: "ram_gb", label: "RAM (GB)", type: "number" as const, required: false },
    ],
  },
};

beforeAll(async () => {
  orgId = await createOrg("Category Org");
  otherOrgId = await createOrg("Other Category Org");
  managerSession = await createSession(
    (await createUserWithRole(orgId, "Manager")).id, orgId);
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId);
  technicianSession = await createSession(
    (await createUserWithRole(orgId, "Technician")).id, orgId);
});

describe("authorization", () => {
  it("refuses an unauthenticated caller", async () => {
    expect((await GET(new Request("http://api.test/api/v1/categories"))).status).toBe(401);
  });

  it("lets a viewer read categories", async () => {
    // A viewer holds categories:read - custom fields are part of reading the
    // register, not an administrative concern.
    expect((await GET(req(viewerSession))).status).toBe(200);
  });

  it("refuses a viewer creating one", async () => {
    expect((await POST(req(viewerSession, "POST", laptops))).status).toBe(403);
  });

  it("refuses a technician creating one", async () => {
    // A technician updates assets but does not decide what fields they carry.
    expect((await POST(req(technicianSession, "POST", laptops))).status).toBe(403);
  });

  it("lets a manager create one", async () => {
    expect((await POST(req(managerSession, "POST", laptops))).status).toBe(201);
  });
});

describe("validation", () => {
  it("rejects an unknown kind", async () => {
    const res = await POST(req(managerSession, "POST", { name: "X", kind: "vehicle" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("rejects an enum field with no options", async () => {
    const res = await POST(req(managerSession, "POST", {
      name: "Broken", kind: "it",
      field_schema: { fields: [{ key: "os", label: "OS", type: "enum", required: true }] },
    }));
    expect(res.status).toBe(422);
  });

  it("rejects a field key that is not a safe identifier", async () => {
    const res = await POST(req(managerSession, "POST", {
      name: "Unsafe", kind: "it",
      field_schema: { fields: [{ key: "drop table", label: "X", type: "string", required: false }] },
    }));
    expect(res.status).toBe(422);
  });

  it("defaults to an empty field schema", async () => {
    const res = await POST(req(managerSession, "POST", { name: "Bare", kind: "media" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { field_schema: { fields: unknown[] } };
    expect(body.field_schema.fields).toEqual([]);
  });

  it("reports a duplicate name as a conflict", async () => {
    await POST(req(managerSession, "POST", { name: "Twice", kind: "it" }));
    const res = await POST(req(managerSession, "POST", { name: "Twice", kind: "it" }));
    expect(res.status).toBe(409);
  });
});

describe("reads and updates", () => {
  it("returns a category with its field schema", async () => {
    const created = (await (await POST(
      req(managerSession, "POST", { ...laptops, name: "Readable" }),
    )).json()) as { id: string };

    const { request, ctx } = one(viewerSession, created.id);
    const res = await GET_ONE(request, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { field_schema: { fields: { key: string }[] } };
    expect(body.field_schema.fields.map((f) => f.key)).toEqual(["os", "ram_gb"]);
  });

  it("reports an unknown id as not found", async () => {
    const { request, ctx } = one(viewerSession, "00000000-0000-0000-0000-000000000000");
    expect((await GET_ONE(request, ctx)).status).toBe(404);
  });

  it("updates the field schema", async () => {
    const created = (await (await POST(
      req(managerSession, "POST", { name: "Evolving", kind: "equipment" }),
    )).json()) as { id: string };

    const { request, ctx } = one(managerSession, created.id, "PATCH", {
      field_schema: {
        fields: [{ key: "hours_run", label: "Hours run", type: "number", required: false }],
      },
    });
    const res = await PATCH(request, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { field_schema: { fields: { key: string }[] } };
    expect(body.field_schema.fields.map((f) => f.key)).toEqual(["hours_run"]);
  });

  it("refuses a viewer updating one", async () => {
    const created = (await (await POST(
      req(managerSession, "POST", { name: "Guarded", kind: "it" }),
    )).json()) as { id: string };
    const { request, ctx } = one(viewerSession, created.id, "PATCH", { name: "Nope" });
    expect((await PATCH(request, ctx)).status).toBe(403);
  });
});

describe("tenant isolation", () => {
  it("does not list another organisation's categories", async () => {
    const otherManager = await createSession(
      (await createUserWithRole(otherOrgId, "Manager")).id, otherOrgId);
    await POST(req(otherManager, "POST", { name: "Theirs Only", kind: "it" }));

    const body = (await (await GET(req(managerSession))).json()) as {
      data: { name: string }[];
    };
    expect(body.data.map((c) => c.name)).not.toContain("Theirs Only");
  });

  it("reports another organisation's category as missing, not forbidden", async () => {
    const otherManager = await createSession(
      (await createUserWithRole(otherOrgId, "Manager")).id, otherOrgId);
    const theirs = (await (await POST(
      req(otherManager, "POST", { name: "Hidden", kind: "it" }),
    )).json()) as { id: string };

    const { request, ctx } = one(managerSession, theirs.id);
    expect((await GET_ONE(request, ctx)).status).toBe(404);
  });
});
