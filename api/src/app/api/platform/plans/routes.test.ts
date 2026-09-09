import { describe, it, expect, beforeAll } from "vitest";
import { withPlatform } from "@/lib/platform/db";
import { hashPassword } from "@/lib/auth/password";
import { createPlatformSession } from "@/lib/platform/auth";
import { GET as LIST, POST as CREATE } from "./route";
import { PATCH, DELETE, GET as SHOW } from "./[code]/route";

let cookie: string;

beforeAll(async () => {
  const adminId = await withPlatform(async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO platform_admins (email, password_hash, name)
       VALUES ($1, $2, 'Plans Operator') RETURNING id`,
      [`plans-ops-${Date.now()}@platform.test`, await hashPassword("pw")],
    )).rows[0].id,
  );
  cookie = `ams_platform=${await createPlatformSession(adminId)}`;
});

const req = (method: string, body?: unknown) =>
  new Request("http://api.test/api/platform/plans", {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const anon = (method: string) =>
  new Request("http://api.test/api/platform/plans", { method });

const params = (code: string) => ({ params: Promise.resolve({ code }) });

describe("the plan catalogue over HTTP", () => {
  it("is refused to anybody without a platform session", async () => {
    expect((await LIST(anon("GET"))).status).toBe(401);
    expect((await CREATE(anon("POST"))).status).toBe(401);
  });

  it("is refused to a tenant session", async () => {
    const res = await LIST(new Request("http://api.test/api/platform/plans", {
      headers: { cookie: "ams_session=a-valid-looking-tenant-session" },
    }));
    expect(res.status).toBe(401);
  });

  it("returns the plans and the feature catalogue together", async () => {
    // The console renders a switch per feature beside each plan. Fetching the
    // two separately means rendering a switch whose label has not arrived.
    const body = await (await LIST(req("GET"))).json() as {
      data: { code: string }[];
      features: { key: string; label: string }[];
    };

    expect(body.data.map((p) => p.code)).toContain("starter");
    expect(body.features.some((f) => f.key === "stocktake")).toBe(true);
    expect(body.features.every((f) => f.label.length > 3)).toBe(true);
  });

  it("creates a plan", async () => {
    const res = await CREATE(req("POST", {
      code: "route-test-plan",
      name: "Route Test",
      price_minor: 100_000,
      features: ["core", "reports"],
      limits: { max_assets: 100 },
    }));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      code: "route-test-plan", price_minor: 100_000,
    });
  });

  it("refuses a plan selling a feature nothing enforces", async () => {
    const res = await CREATE(req("POST", {
      code: "route-test-nonsense",
      name: "Nonsense",
      // A price, because it is required: a plan with no price is a billing
      // question nobody meant to answer, so it is never defaulted to zero.
      price_minor: 1,
      features: ["teleportation"],
    }));

    expect(res.status).toBe(422);
    expect((await res.json() as { detail: string }).detail).toContain("teleportation");
  });

  it("refuses a code that would not survive a URL", async () => {
    const res = await CREATE(req("POST", {
      code: "Not A Code", name: "x", price_minor: 0,
    }));
    expect(res.status).toBe(422);
  });

  it("changes one field without blanking the others", async () => {
    // A console that sends only what changed must not lose the rest.
    const res = await PATCH(req("PATCH", { price_minor: 111_000 }),
      params("route-test-plan"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      price_minor: 111_000,
      name: "Route Test",
      features: ["core", "reports"],
    });
  });

  it("will not rename a plan out from under the customers on it", async () => {
    // The code is the identity. Taking it from the body would quietly create
    // a second plan and leave those customers pointing at the old one.
    await PATCH(req("PATCH", { code: "something-else", name: "Renamed" }),
      params("route-test-plan"));

    expect((await SHOW(req("GET"), params("route-test-plan"))).status).toBe(200);
    expect((await SHOW(req("GET"), params("something-else"))).status).toBe(404);
  });

  it("says what it cannot find", async () => {
    expect((await SHOW(req("GET"), params("no-such-plan"))).status).toBe(404);
    expect((await PATCH(req("PATCH", {}), params("no-such-plan"))).status).toBe(404);
  });

  it("deletes a plan nobody is on", async () => {
    const res = await DELETE(req("DELETE"), params("route-test-plan"));
    expect(res.status).toBe(204);
    expect((await SHOW(req("GET"), params("route-test-plan"))).status).toBe(404);
  });

  it("refuses to delete a plan somebody is on, and says how many", async () => {
    // Its own plan, with exactly one customer on it. Asserting against a
    // shared plan counts whatever every other test file has created, and the
    // number is then nobody's to predict.
    const code = "route-occupied-plan";
    await CREATE(req("POST", {
      code, name: "Occupied", price_minor: 1, features: ["core"],
    }));

    const orgId = await withPlatform(async (c) =>
      (await c.query<{ id: string }>(
        `INSERT INTO organizations (name, slug, plan_code)
         VALUES ('Plan Holder', $1, $2) RETURNING id`,
        [`plan-holder-${Date.now()}`, code],
      )).rows[0].id,
    );

    const res = await DELETE(req("DELETE"), params(code));
    expect(res.status).toBe(409);
    expect((await res.json() as { detail: string }).detail)
      .toMatch(/1 organisation is on/);

    await withPlatform((c) =>
      c.query("DELETE FROM organizations WHERE id = $1", [orgId]),
    );
    await DELETE(req("DELETE"), params(code));
  });

  it("records every change where the operator cannot erase it", async () => {
    await CREATE(req("POST", {
      code: "route-audited-plan", name: "Audited",
      price_minor: 1, features: ["core"],
    }));

    const entry = await withPlatform(async (c) =>
      (await c.query<{ action: string; detail: { code?: string } }>(
        `SELECT action, detail FROM platform_audit
          WHERE action = 'plan.saved' ORDER BY occurred_at DESC LIMIT 1`,
      )).rows[0],
    );

    expect(entry.action).toBe("plan.saved");
    expect(entry.detail.code).toBe("route-audited-plan");

    await DELETE(req("DELETE"), params("route-audited-plan"));
  });
});
