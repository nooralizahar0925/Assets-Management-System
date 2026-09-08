import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { systemCtx } from "@/lib/jobs/context";
import { createAsset } from "@/lib/domain/assets";
import { createLocation } from "@/lib/domain/locations";
import { GET as LIST, POST as CREATE } from "./route";
import { POST as COMPLETE } from "./[id]/complete/route";
import { GET as SERVICES } from "../services/route";
import type { Ctx } from "@/lib/http/handler";

let orgId: string;
let ctx: Ctx;
let technicianSession: string;
let viewerSession: string;
let scopedSession: string;
let assetId: string;
let otherSite: string;

const today = () => new Date().toISOString().slice(0, 10);

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

const get = (session: string, path: string) =>
  new Request(`http://api.test${path}`, {
    headers: { cookie: `ams_session=${session}` },
  });

const withId = (id: string) => ({ params: Promise.resolve({ id }) });

beforeAll(async () => {
  orgId = await createOrg("Maintenance API Org");
  ctx = systemCtx(orgId);

  technicianSession = await createSession(
    (await createUserWithRole(orgId, "Technician")).id, orgId,
  );
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId,
  );

  const site = (await createLocation(ctx, { name: "Plant floor" })).id;
  otherSite = (await createLocation(ctx, { name: "Elsewhere" })).id;
  assetId = (await createAsset(ctx, { name: "API forklift", location_id: site })).id;

  const scoped = await createUserWithRole(orgId, "Technician");
  await withTenant(orgId, (c) =>
    c.query(
      "INSERT INTO user_location_scopes (org_id, user_id, location_id) VALUES ($1,$2,$3)",
      [orgId, scoped.id, otherSite],
    ),
  );
  scopedSession = await createSession(scoped.id, orgId);
});

describe("POST /api/v1/maintenance/schedules", () => {
  it("refuses a viewer", async () => {
    const res = await CREATE(post(viewerSession, "/api/v1/maintenance/schedules", {
      asset_id: assetId, description: "No", every_days: 30,
    }));
    expect(res.status).toBe(403);
  });

  it("rejects a schedule with no interval", async () => {
    const res = await CREATE(post(technicianSession, "/api/v1/maintenance/schedules", {
      asset_id: assetId, description: "Nothing to go on",
    }));
    expect(res.status).toBe(422);
  });

  it("creates a schedule for a technician", async () => {
    const res = await CREATE(post(technicianSession, "/api/v1/maintenance/schedules", {
      asset_id: assetId, description: "250-hour service",
      every_hours: 250, current_hours: 900,
    }));
    expect(res.status).toBe(201);
    expect((await res.json()) as { next_due_hours: number })
      .toMatchObject({ next_due_hours: 1150 });
  });

  it("refuses to schedule work on an asset at another branch", async () => {
    const res = await CREATE(post(scopedSession, "/api/v1/maintenance/schedules", {
      asset_id: assetId, description: "Not my machine", every_days: 30,
    }));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/maintenance/schedules", () => {
  it("lets a technician see what is scheduled", async () => {
    const res = await LIST(get(technicianSession, "/api/v1/maintenance/schedules"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { description: string }[] };
    expect(body.data.some((s) => s.description === "250-hour service")).toBe(true);
  });

  it("narrows to one asset when asked", async () => {
    const res = await LIST(get(
      technicianSession, `/api/v1/maintenance/schedules?asset_id=${assetId}`,
    ));
    const body = (await res.json()) as { data: { asset_id: string }[] };
    expect(body.data.every((s) => s.asset_id === assetId)).toBe(true);
  });

  it("refuses a viewer, who does not hold maintenance:read", async () => {
    expect((await LIST(get(viewerSession, "/api/v1/maintenance/schedules"))).status)
      .toBe(403);
  });
});

describe("completing a service", () => {
  let scheduleId: string;

  beforeAll(async () => {
    const res = await CREATE(post(technicianSession, "/api/v1/maintenance/schedules", {
      asset_id: assetId, description: "Quarterly", every_days: 90,
    }));
    scheduleId = ((await res.json()) as { id: string }).id;
  });

  it("records the work and rolls the schedule forward", async () => {
    const res = await COMPLETE(
      post(technicianSession,
        `/api/v1/maintenance/schedules/${scheduleId}/complete`,
        { at: today(), note: "Filters replaced", cost: 450000 }),
      withId(scheduleId),
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as { last_service_at: string })
      .toMatchObject({ last_service_at: today() });
  });

  it("shows the work in the asset's service history", async () => {
    const res = await SERVICES(get(
      technicianSession, `/api/v1/maintenance/services?asset_id=${assetId}`,
    ));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { note: string | null }[] };
    expect(body.data.some((s) => s.note === "Filters replaced")).toBe(true);
  });

  it("needs an asset to report history for", async () => {
    const res = await SERVICES(get(technicianSession, "/api/v1/maintenance/services"));
    expect(res.status).toBe(422);
  });

  it("answers 404 for a schedule that does not exist", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    const res = await COMPLETE(
      post(technicianSession,
        `/api/v1/maintenance/schedules/${missing}/complete`, { at: today() }),
      withId(missing),
    );
    expect(res.status).toBe(404);
  });
});
