import { describe, it, expect, beforeAll } from "vitest";
import { withPlatform } from "@/lib/platform/db";
import { hashPassword } from "@/lib/auth/password";
import { createPlatformSession } from "@/lib/platform/auth";
import { GET as LIST, POST as CREATE } from "./route";
import { GET as SHOW, PATCH, DELETE } from "./[id]/route";
import { POST as SUSPEND, DELETE as RESUME } from "./[id]/suspend/route";
import { PUT as ENTITLEMENTS } from "./[id]/entitlements/route";

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

describe("one customer's exceptions to their plan", () => {
  const ENT = "http://api.test/api/platform/orgs/x/entitlements";

  const put = (body: unknown) =>
    new Request(ENT, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("adds a feature the plan does not include", async () => {
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    const res = await ENTITLEMENTS(
      put({ overrides: [{ feature_key: "stocktake", enabled: true }] }),
      params(orgId),
    );

    expect(res.status).toBe(200);
    expect((await res.json() as { features: string[] }).features)
      .toContain("stocktake");
  });

  it("withdraws one it does", async () => {
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    const res = await ENTITLEMENTS(
      put({ overrides: [{ feature_key: "labels", enabled: false }] }),
      params(orgId),
    );
    expect((await res.json() as { features: string[] }).features)
      .not.toContain("labels");
  });

  it("replaces the whole set rather than merging", async () => {
    // The console shows every feature at once and knows what it means to
    // leave out. Merging would make two half-finished edits land a customer
    // somewhere neither operator intended.
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    await ENTITLEMENTS(
      put({ overrides: [{ feature_key: "stocktake", enabled: true }] }),
      params(orgId),
    );
    const res = await ENTITLEMENTS(
      put({ overrides: [{ feature_key: "webhooks", enabled: true }] }),
      params(orgId),
    );

    const { features } = await res.json() as { features: string[] };
    expect(features).toContain("webhooks");
    expect(features).not.toContain("stocktake");
  });

  it("refuses to switch off the register", async () => {
    // The resolver puts it back regardless. Storing an override that is
    // silently ignored would tell the next operator a lie about what they did.
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    const res = await ENTITLEMENTS(
      put({ overrides: [{ feature_key: "core", enabled: false }] }),
      params(orgId),
    );
    expect(res.status).toBe(422);
  });

  it("refuses a feature nothing enforces", async () => {
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    const res = await ENTITLEMENTS(
      put({ overrides: [{ feature_key: "teleportation", enabled: true }] }),
      params(orgId),
    );
    expect(res.status).toBe(422);
  });

  it("records what changed, both sides of it", async () => {
    // "Who turned this on, and what was it before" is the question asked
    // months later by somebody who was not there.
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    await ENTITLEMENTS(
      put({ overrides: [{ feature_key: "stocktake", enabled: true, note: "Promised in the demo" }] }),
      params(orgId),
    );

    const entry = await withPlatform(async (c) =>
      (await c.query<{ detail: { to?: { feature_key: string; note?: string }[] } }>(
        `SELECT detail FROM platform_audit
          WHERE org_id = $1 AND action = 'org.entitlements_changed'
          ORDER BY occurred_at DESC LIMIT 1`,
        [orgId],
      )).rows[0],
    );

    expect(entry.detail.to?.[0].feature_key).toBe("stocktake");
    expect(entry.detail.to?.[0].note).toBe("Promised in the demo");
  });

  it("says what it cannot find", async () => {
    const res = await ENTITLEMENTS(
      put({ overrides: [] }),
      params("00000000-0000-0000-0000-000000000000"),
    );
    expect(res.status).toBe(404);
  });
});

describe("the detail a customer's page is built from", () => {
  it("carries usage beside the limits it is measured against", async () => {
    // A limit means nothing on screen without the number it is measured
    // against, and fetching them separately invites two different answers.
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    const body = await (await SHOW(req("GET"), params(orgId))).json() as {
      usage: { assets: number; users: number; storage_mb: number };
    };

    expect(body.usage.assets).toBe(0);
    expect(body.usage.users).toBe(1);
    expect(body.usage.storage_mb).toBe(0);
  });

  it("carries the overrides themselves, not only their effect", async () => {
    // The console has to show where each feature comes from: "from the
    // Professional plan" and "turned on for this customer" are different
    // facts, and the operator needs to know which one they are changing.
    const { res: created } = await create();
    const { orgId } = await created.json() as { orgId: string };

    await ENTITLEMENTS(
      new Request("http://api.test/x", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          overrides: [{ feature_key: "webhooks", enabled: true, note: "Agreed" }],
        }),
      }),
      params(orgId),
    );

    const body = await (await SHOW(req("GET"), params(orgId))).json() as {
      overrides: { feature_key: string; enabled: boolean; note: string }[];
    };

    expect(body.overrides).toHaveLength(1);
    expect(body.overrides[0]).toMatchObject({
      feature_key: "webhooks", enabled: true, note: "Agreed",
    });
  });
});
