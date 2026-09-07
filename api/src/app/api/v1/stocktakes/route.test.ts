import { describe, it, expect, beforeAll } from "vitest";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { systemCtx } from "@/lib/jobs/context";
import { createLocation } from "@/lib/domain/locations";
import { createAsset, getAsset } from "@/lib/domain/assets";
import { withTenant } from "@/lib/db";
import { GET as LIST, POST as OPEN } from "./route";
import { GET as DETAIL } from "./[id]/route";
import { POST as COUNT } from "./[id]/count/route";
import { POST as CLOSE } from "./[id]/close/route";
import type { Ctx } from "@/lib/http/handler";

let orgId: string;
let ctx: Ctx;
let managerSession: string;
let viewerSession: string;
let scopedSession: string;
let warehouse: string;
let otherSite: string;
let tagA: string;
let assetB: string;

const post = (session: string, path: string, body: unknown) =>
  new Request(`http://api.test${path}`, {
    method: "POST",
    headers: {
      cookie: `ams_session=${session}`,
      "content-type": "application/json",
      origin: "http://api.test",
    },
    body: JSON.stringify(body),
  });

const get = (session: string, path = "/api/v1/stocktakes") =>
  new Request(`http://api.test${path}`, {
    headers: { cookie: `ams_session=${session}` },
  });

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  orgId = await createOrg("Stocktake API Org");
  ctx = systemCtx(orgId);

  const manager = await createUserWithRole(orgId, "Manager");
  managerSession = await createSession(manager.id, orgId);
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId,
  );

  warehouse = (await createLocation(ctx, { name: "API Warehouse" })).id;
  otherSite = (await createLocation(ctx, { name: "API Other site" })).id;

  const a = await createAsset(ctx, { name: "API Forklift", location_id: warehouse });
  const b = await createAsset(ctx, { name: "API Pallet", location_id: warehouse });
  tagA = (await getAsset(ctx, a.id))!.asset_tag;
  assetB = b.id;

  // A manager limited to the other site only.
  const scoped = await createUserWithRole(orgId, "Manager");
  await withTenant(orgId, (c) =>
    c.query(
      "INSERT INTO user_location_scopes (org_id, user_id, location_id) VALUES ($1,$2,$3)",
      [orgId, scoped.id, otherSite],
    ),
  );
  scopedSession = await createSession(scoped.id, orgId);
});

describe("POST /api/v1/stocktakes", () => {
  it("refuses a viewer, who cannot run a count", async () => {
    const res = await OPEN(post(viewerSession, "/api/v1/stocktakes", {
      location_id: warehouse, name: "Nope",
    }));
    expect(res.status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await OPEN(new Request("http://api.test/api/v1/stocktakes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location_id: warehouse, name: "Nope" }),
    }));
    expect(res.status).toBe(401);
  });

  it("rejects a body with no location", async () => {
    const res = await OPEN(post(managerSession, "/api/v1/stocktakes", { name: "No place" }));
    expect(res.status).toBe(422);
  });

  it("opens a session with the expected assets recorded", async () => {
    const res = await OPEN(post(managerSession, "/api/v1/stocktakes", {
      location_id: warehouse, name: "Opened by API",
    }));
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: string; expected_ids: string[] };
    expect(body.expected_ids.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses to open a count at a branch outside the caller's scope", async () => {
    // Otherwise a branch-limited manager could count, and adjust, a site they
    // are not responsible for.
    const res = await OPEN(post(scopedSession, "/api/v1/stocktakes", {
      location_id: warehouse, name: "Not my site",
    }));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/stocktakes", () => {
  it("lets someone who runs counts read the list", async () => {
    const res = await LIST(get(managerSession));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string }[] };
    expect(body.data.some((s) => s.name === "Opened by API")).toBe(true);
  });

  it("refuses a viewer, who does not hold stocktake:read", async () => {
    // Viewer is "reads the register and runs reports". Phase 1b listed its
    // permissions explicitly rather than deriving them from everything ending
    // in :read, for exactly this reason - a count is operational history, like
    // the audit trail, not part of the register a viewer is meant to see.
    expect((await LIST(get(viewerSession))).status).toBe(403);
  });

  it("hides sessions at branches the caller cannot see", async () => {
    const res = await LIST(get(scopedSession));
    const body = (await res.json()) as { data: { name: string }[] };
    expect(body.data.some((s) => s.name === "Opened by API")).toBe(false);
  });
});

describe("counting and closing", () => {
  let sessionId: string;

  beforeAll(async () => {
    const res = await OPEN(post(managerSession, "/api/v1/stocktakes", {
      location_id: warehouse, name: "Counting via API",
    }));
    sessionId = ((await res.json()) as { id: string }).id;
  });

  it("records a scan and says what it was", async () => {
    const res = await COUNT(
      post(managerSession, `/api/v1/stocktakes/${sessionId}/count`, { tag: tagA }),
      withId(sessionId),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { outcome: string })
      .toMatchObject({ outcome: "expected" });
  });

  it("reports an unknown tag as a normal outcome, not an error", async () => {
    const res = await COUNT(
      post(managerSession, `/api/v1/stocktakes/${sessionId}/count`, { tag: "NOPE-1" }),
      withId(sessionId),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { outcome: string })
      .toMatchObject({ outcome: "unknown_tag" });
  });

  it("refuses a viewer trying to count", async () => {
    const res = await COUNT(
      post(viewerSession, `/api/v1/stocktakes/${sessionId}/count`, { tag: tagA }),
      withId(sessionId),
    );
    expect(res.status).toBe(403);
  });

  it("returns the reconciliation with the session", async () => {
    const res = await DETAIL(
      get(managerSession, `/api/v1/stocktakes/${sessionId}`), withId(sessionId),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      session: { name: string };
      reconciliation: { expected: number; counted: number; missing: unknown[] };
    };
    expect(body.session.name).toBe("Counting via API");
    expect(body.reconciliation.counted).toBe(1);
    expect(body.reconciliation.missing.length).toBeGreaterThan(0);
  });

  it("closes and writes the findings back when asked", async () => {
    const res = await CLOSE(
      post(managerSession, `/api/v1/stocktakes/${sessionId}/close`, { adjust: true }),
      withId(sessionId),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { adjusted: number }).toMatchObject({ adjusted: 1 });
    expect((await getAsset(ctx, assetB))!.status).toBe("lost");
  });

  it("answers 409 when the session is already closed", async () => {
    const res = await CLOSE(
      post(managerSession, `/api/v1/stocktakes/${sessionId}/close`, { adjust: true }),
      withId(sessionId),
    );
    expect(res.status).toBe(409);
  });

  it("answers 404 for a session that does not exist", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    const res = await DETAIL(
      get(managerSession, `/api/v1/stocktakes/${missing}`), withId(missing),
    );
    expect(res.status).toBe(404);
  });
});
