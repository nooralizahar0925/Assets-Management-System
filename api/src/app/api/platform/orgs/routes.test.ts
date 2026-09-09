import { describe, it, expect, beforeAll } from "vitest";
import { withPlatform } from "@/lib/platform/db";
import { hashPassword } from "@/lib/auth/password";
import { createPlatformSession } from "@/lib/platform/auth";
import { GET as LIST, POST as CREATE } from "./route";
import { GET as SHOW, PATCH, DELETE } from "./[id]/route";
import { POST as SUSPEND, DELETE as RESUME } from "./[id]/suspend/route";

let cookie: string;

beforeAll(async () => {
  const adminId = await withPlatform(async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO platform_admins (email, password_hash, name)
       VALUES ($1, $2, 'Orgs Operator') RETURNING id`,
      [`orgs-ops-${Date.now()}@platform.test`, await hashPassword("pw")],
    )).rows[0].id,
  );
  cookie = `ams_platform=${await createPlatformSession(adminId)}`;
});

const req = (method: string, body?: unknown) =>
  new Request("http://api.test/api/platform/orgs", {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const unique = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function create(overrides: Record<string, unknown> = {}) {
  const slug = unique("route-co");
  const res = await CREATE(req("POST", {
    name: "Route Co",
    slug,
    adminName: "Rina",
    adminEmail: `${slug}@route.test`,
    planCode: "starter",
    ...overrides,
  }));
  return { res, slug };
}

describe("managing customers over HTTP", () => {
  it("is refused without a platform session", async () => {
    const res = await LIST(new Request("http://api.test/api/platform/orgs"));
    expect(res.status).toBe(401);
  });

  it("is refused to a tenant session", async () => {
    const res = await LIST(new Request("http://api.test/api/platform/orgs", {
      headers: { cookie: "ams_session=a-valid-looking-tenant-session" },
    }));
    expect(res.status).toBe(401);
  });

  it("creates a customer and hands back the password once", async () => {
    const { res, slug } = await create();
    expect(res.status).toBe(201);

    const body = await res.json() as { orgId: string; password: string };
    expect(body.orgId).toBeTruthy();
    expect(body.password.length).toBeGreaterThan(12);
    expect(slug).toBeTruthy();
  });

  it("refuses a slug already in use", async () => {
    const { slug } = await create();
    const { res } = await create({ slug });
    expect(res.status).toBe(409);
  });

  it("lists customers with what they hold, including the empty ones", async () => {
    // A customer with no assets yet is exactly the one worth seeing: they are
    // the one who has not started. A plain join would drop them.
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    const body = await (await LIST(req("GET"))).json() as {
      data: { id: string; assets: number; users: number }[];
    };

    const row = body.data.find((o) => o.id === orgId)!;
    expect(row).toBeDefined();
    expect(row.assets).toBe(0);
    expect(row.users).toBe(1);
  });

  it("shows one customer with what they can actually do", async () => {
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    const body = await (await SHOW(req("GET"), params(orgId))).json() as {
      entitlements: { features: string[]; plan_code: string | null };
    };

    expect(body.entitlements.plan_code).toBe("starter");
    expect(body.entitlements.features).toContain("core");
  });

  it("changes one field without blanking the rest", async () => {
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    await PATCH(req("PATCH", { notes: "Rings every Tuesday." }), params(orgId));
    const after = await (await SHOW(req("GET"), params(orgId))).json() as {
      notes: string; plan_code: string; name: string;
    };

    expect(after.notes).toBe("Rings every Tuesday.");
    expect(after.plan_code).toBe("starter");
    expect(after.name).toBe("Route Co");
  });

  it("can clear a date, which is different from not mentioning it", async () => {
    // coalesce cannot tell "clear the renewal" from "I did not send one", and
    // an operator who cannot clear a date ends up editing the database.
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    await PATCH(req("PATCH", { renews_on: "2027-01-01" }), params(orgId));
    await PATCH(req("PATCH", { renews_on: null }), params(orgId));

    const after = await (await SHOW(req("GET"), params(orgId))).json() as {
      renews_on: string | null;
    };
    expect(after.renews_on).toBeNull();
  });

  it("moves a customer between plans", async () => {
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    await PATCH(req("PATCH", { plan_code: "professional" }), params(orgId));
    const after = await (await SHOW(req("GET"), params(orgId))).json() as {
      entitlements: { features: string[] };
    };
    expect(after.entitlements.features).toContain("stocktake");
  });

  it("suspends only with a reason", async () => {
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    expect((await SUSPEND(req("POST", {}), params(orgId))).status).toBe(422);
    expect((await SUSPEND(req("POST", { reason: "Unpaid" }), params(orgId))).status)
      .toBe(204);

    const after = await (await SHOW(req("GET"), params(orgId))).json() as {
      suspended_at: string | null;
    };
    expect(after.suspended_at).not.toBeNull();
  });

  it("resumes without needing one", async () => {
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    await SUSPEND(req("POST", { reason: "Unpaid" }), params(orgId));
    expect((await RESUME(req("DELETE"), params(orgId))).status).toBe(204);

    const after = await (await SHOW(req("GET"), params(orgId))).json() as {
      suspended_at: string | null;
    };
    expect(after.suspended_at).toBeNull();
  });

  it("will not delete without the slug typed exactly", async () => {
    const { res: created, slug } = await create();
    const { orgId } = await created.json() as { orgId: string };

    const wrong = await DELETE(req("DELETE", { slug: "not-it" }), params(orgId));
    expect(wrong.status).toBe(409);
    expect((await SHOW(req("GET"), params(orgId))).status).toBe(200);

    const right = await DELETE(req("DELETE", { slug }), params(orgId));
    expect(right.status).toBe(204);
    expect((await SHOW(req("GET"), params(orgId))).status).toBe(404);
  });

  it("says what it cannot find", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    expect((await SHOW(req("GET"), params(missing))).status).toBe(404);
    expect((await PATCH(req("PATCH", { notes: "x" }), params(missing))).status).toBe(404);
    // A real reason, or validation refuses it before existence is ever
    // checked - which is the right order, and not what this asserts.
    expect((await SUSPEND(req("POST", { reason: "Unpaid" }), params(missing))).status)
      .toBe(404);
  });
});
