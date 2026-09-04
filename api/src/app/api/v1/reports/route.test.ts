import { describe, it, expect, beforeAll } from "vitest";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/http/handler";
import { createAsset } from "@/lib/domain/assets";
import { GET as LIST } from "./route";
import { GET as RUN } from "./[key]/route";

let orgId: string;
let adminCtx: Ctx;
let viewerSession: string;
let technicianSession: string;

const list = (session: string) =>
  new Request("http://api.test/api/v1/reports", {
    headers: { cookie: `ams_session=${session}` },
  });

const run = (session: string, key: string, query = "") => ({
  request: new Request(`http://api.test/api/v1/reports/${key}${query}`, {
    headers: { cookie: `ams_session=${session}` },
  }),
  ctx: { params: Promise.resolve({ key }) },
});

beforeAll(async () => {
  orgId = await createOrg("Report Routes Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  adminCtx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
  await createAsset(adminCtx, { name: "Reported", purchase_cost: 1_000_000 });

  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId);
  technicianSession = await createSession(
    (await createUserWithRole(orgId, "Technician")).id, orgId);
});

describe("GET /api/v1/reports", () => {
  it("refuses an unauthenticated caller", async () => {
    expect((await LIST(new Request("http://api.test/api/v1/reports"))).status).toBe(401);
  });

  it("lets a viewer see the catalogue", async () => {
    // A viewer holds reports:read - reading the register is the point of the role.
    const res = await LIST(list(viewerSession));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { key: string; formats: string[]; chart: { type: string } }[];
    };
    expect(body.data).toHaveLength(9);
    expect(body.data[0].formats).toContain("csv");
    expect(body.data[0].chart).toHaveProperty("type");
  });

  it("lets a technician see it too", async () => {
    expect((await LIST(list(technicianSession))).status).toBe(200);
  });
});

describe("GET /api/v1/reports/:key", () => {
  it("returns JSON by default", async () => {
    const { request, ctx } = run(viewerSession, "assets-by-status");
    const res = await RUN(request, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { key: string; rows: unknown[] } };
    expect(body.data.key).toBe("assets-by-status");
    expect(Array.isArray(body.data.rows)).toBe(true);
  });

  it("returns CSV when asked", async () => {
    const { request, ctx } = run(viewerSession, "assets-by-status", "?format=csv");
    const res = await RUN(request, ctx);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(await res.text()).toContain("Status,Assets,Value");
  });

  it("reports an unknown report key as not found", async () => {
    const { request, ctx } = run(viewerSession, "not-a-report");
    expect((await RUN(request, ctx)).status).toBe(404);
  });

  it("rejects an unsupported format with 422", async () => {
    const { request, ctx } = run(viewerSession, "assets-by-status", "?format=parquet");
    const res = await RUN(request, ctx);
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("clamps an absurd days parameter rather than trusting it", async () => {
    const { request, ctx } = run(viewerSession, "expiring", "?days=999999");
    const res = await RUN(request, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { params: { days: number } } };
    expect(body.data.params.days).toBeLessThanOrEqual(3650);
  });

  it("ignores a non-numeric days parameter", async () => {
    const { request, ctx } = run(viewerSession, "expiring", "?days=lots");
    const res = await RUN(request, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { params: { days?: number } } };
    expect(body.data.params.days).toBeUndefined();
  });

  it("carries the filter summary a printed header needs", async () => {
    const { request, ctx } = run(viewerSession, "expiring", "?days=30");
    const body = (await (await RUN(request, ctx)).json()) as {
      data: { filter_summary: string };
    };
    expect(body.data.filter_summary).toBe("Next 30 days");
  });
});
