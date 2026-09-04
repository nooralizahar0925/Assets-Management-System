import { describe, it, expect, beforeAll } from "vitest";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { GET as LIST, POST as CREATE } from "./route";
import { GET as GET_ONE, DELETE as REMOVE } from "./[id]/route";
import { GET as RUN_REPORT } from "../reports/[key]/route";

let orgId: string;
let viewerSession: string;

const req = (session: string, method = "GET", body?: unknown) =>
  new Request("http://api.test/api/v1/saved-reports", {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const one = (session: string, id: string, method = "GET") => ({
  request: new Request(`http://api.test/api/v1/saved-reports/${id}`, {
    method, headers: { cookie: `ams_session=${session}` },
  }),
  ctx: { params: Promise.resolve({ id }) },
});

beforeAll(async () => {
  orgId = await createOrg("Saved Report Org");
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId);
});

describe("saved reports", () => {
  it("refuses an unauthenticated caller", async () => {
    const res = await LIST(new Request("http://api.test/api/v1/saved-reports"));
    expect(res.status).toBe(401);
  });

  it("saves a report key with its filter set", async () => {
    const res = await CREATE(req(viewerSession, "POST", {
      name: "Weekly overdue", report_key: "assignments-overdue", params: { days: 7 },
    }));
    expect(res.status).toBe(201);
    expect((await res.json()) as { report_key: string }).toMatchObject({
      report_key: "assignments-overdue",
    });
  });

  it("rejects an unknown report key with 422", async () => {
    // A saved report pointing at a report that does not exist is a scheduled
    // email that fails silently every week.
    const res = await CREATE(req(viewerSession, "POST", {
      name: "Bogus", report_key: "not-a-report", params: {},
    }));
    expect(res.status).toBe(422);
  });

  it("reports a duplicate name as a conflict", async () => {
    await CREATE(req(viewerSession, "POST", {
      name: "Dupe", report_key: "assets-by-status", params: {},
    }));
    const res = await CREATE(req(viewerSession, "POST", {
      name: "Dupe", report_key: "assets-by-status", params: {},
    }));
    expect(res.status).toBe(409);
  });

  it("lists, fetches and deletes", async () => {
    const created = (await (await CREATE(req(viewerSession, "POST", {
      name: "Disposable", report_key: "assets-by-category", params: {},
    }))).json()) as { id: string };

    const listed = (await (await LIST(req(viewerSession))).json()) as {
      data: { id: string }[];
    };
    expect(listed.data.map((r) => r.id)).toContain(created.id);

    const fetched = one(viewerSession, created.id);
    expect((await GET_ONE(fetched.request, fetched.ctx)).status).toBe(200);

    const removed = one(viewerSession, created.id, "DELETE");
    expect((await REMOVE(removed.request, removed.ctx)).status).toBe(204);

    const gone = one(viewerSession, created.id);
    expect((await GET_ONE(gone.request, gone.ctx)).status).toBe(404);
  });

  it("does not expose another organisation's saved report", async () => {
    const otherOrg = await createOrg("Other Saved Org");
    const otherSession = await createSession(
      (await createUserWithRole(otherOrg, "Viewer")).id, otherOrg);
    const theirs = (await (await CREATE(req(otherSession, "POST", {
      name: "Theirs", report_key: "assets-by-status", params: {},
    }))).json()) as { id: string };

    const { request, ctx } = one(viewerSession, theirs.id);
    expect((await GET_ONE(request, ctx)).status).toBe(404);
  });
});

describe("report formats end to end", () => {
  const run = (key: string, format: string) => ({
    request: new Request(
      `http://api.test/api/v1/reports/${key}?format=${format}`,
      { headers: { cookie: `ams_session=${viewerSession}` } },
    ),
    ctx: { params: Promise.resolve({ key }) },
  });

  it("serves xlsx", async () => {
    const { request, ctx } = run("assets-by-status", "xlsx");
    const res = await RUN_REPORT(request, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    // A real zip container starts with PK.
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
  });

  it("serves pdf", async () => {
    const { request, ctx } = run("assets-by-status", "pdf");
    const res = await RUN_REPORT(request, ctx);
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("serves svg", async () => {
    const { request, ctx } = run("assets-by-status", "svg");
    const res = await RUN_REPORT(request, ctx);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  });

  it("serves png", async () => {
    const { request, ctx } = run("assets-by-status", "png");
    const res = await RUN_REPORT(request, ctx);
    expect(res.headers.get("content-type")).toBe("image/png");
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  });

  it("serves a chartless report as svg without failing", async () => {
    // assignments-overdue declares chart type "none".
    const { request, ctx } = run("assignments-overdue", "svg");
    const res = await RUN_REPORT(request, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("no chart");
  });
});
