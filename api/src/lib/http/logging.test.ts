import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { safe } from "./handler";
import { setRequestActor, resolveRequestId } from "./logging";

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    lines.push(String(line));
  });
});

afterEach(() => vi.restoreAllMocks());

const parsed = () => lines.map((l) => JSON.parse(l) as Record<string, unknown>);
const requestLines = () => parsed().filter((l) => l.level === "info");

const ok = safe(async (_req: Request) => Response.json({ fine: true }));

describe("request identity", () => {
  it("echoes an inbound request id, so a trace survives the proxy", async () => {
    const res = await ok(new Request("http://api.test/api/v1/assets", {
      headers: { "x-request-id": "edge-abc-123" },
    }));
    expect(res.headers.get("x-request-id")).toBe("edge-abc-123");
    expect(requestLines()[0].request_id).toBe("edge-abc-123");
  });

  it("generates one when nothing upstream supplied it", async () => {
    const res = await ok(new Request("http://api.test/api/v1/assets"));
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestLines()[0].request_id).toBe(id);
  });

  it("refuses an absurd inbound id rather than logging whatever arrives", async () => {
    // The header is attacker-controlled: a megabyte of text, or newlines that
    // forge extra log lines, must not reach the log.
    const res = await ok(new Request("http://api.test/api/v1/assets", {
      headers: { "x-request-id": "a".repeat(500) },
    }));
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects an id containing a newline", () => {
    // Not reachable through a Request - Headers refuses to construct with one -
    // so the rule is checked where it lives. A forwarded id could arrive by
    // some other route, and a newline would forge extra log lines.
    const forged = { headers: { get: () => "abc\ndef" } } as unknown as Request;
    expect(resolveRequestId(forged)).not.toContain("\n");
  });
});

describe("the request log line", () => {
  it("records what is needed to find one request again", async () => {
    await ok(new Request("http://api.test/api/v1/assets/abc-123", { method: "GET" }));

    const line = requestLines()[0];
    expect(line).toMatchObject({
      level: "info", method: "GET", status: 200,
      path: "/api/v1/assets/abc-123",
    });
    expect(typeof line.duration_ms).toBe("number");
  });

  it("keeps the query string out, because it carries what people searched for", async () => {
    await ok(new Request("http://api.test/api/v1/assets?q=chief%20executive%20laptop"));
    expect(lines.join(" ")).not.toContain("chief");
    expect(requestLines()[0].path).toBe("/api/v1/assets");
  });

  it("never writes a cookie or an authorization header", async () => {
    await ok(new Request("http://api.test/api/v1/assets", {
      headers: {
        cookie: "ams_session=super-secret-value",
        authorization: "Bearer ams_live_secretkey",
      },
    }));
    const all = lines.join(" ");
    expect(all).not.toContain("super-secret-value");
    expect(all).not.toContain("ams_live_secretkey");
    expect(all.toLowerCase()).not.toContain("authorization");
  });

  it("carries the organisation once a handler has resolved one", async () => {
    // "It failed this morning" is unanswerable without knowing whose data was
    // involved.
    const handler = safe(async (_req: Request) => {
      setRequestActor({ orgId: "org-42", actorType: "user" });
      return Response.json({ fine: true });
    });
    await handler(new Request("http://api.test/api/v1/assets"));

    expect(requestLines()[0]).toMatchObject({
      org_id: "org-42", actor_type: "user",
    });
  });

  it("logs a failed request with its status rather than staying silent", async () => {
    const failing = safe(async (_req: Request) => new Response(null, { status: 404 }));
    await failing(new Request("http://api.test/api/v1/assets/missing"));
    expect(requestLines()[0]).toMatchObject({ status: 404 });
  });

  it("still logs when the handler throws, and answers 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = safe(async (_req: Request) => { throw new Error("kaboom"); });

    const res = await boom(new Request("http://api.test/api/v1/assets"));
    expect(res.status).toBe(500);
    expect(requestLines()[0]).toMatchObject({ status: 500 });
    // The trace has to survive the failure; that is when it is needed.
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("attribution through a real guarded route", () => {
  it("names the organisation without the handler doing anything", async () => {
    // The synthetic test above calls setRequestActor itself, so it would pass
    // even if the guard never did. This goes through requireAuth, which is
    // where the attribution has to happen for every route at once.
    const { createOrg, createUserWithRole } = await import("@/test/org");
    const { createSession } = await import("@/lib/auth/session");
    const { GET } = await import("@/app/api/v1/categories/route");

    const orgId = await createOrg("Logging Org");
    const user = await createUserWithRole(orgId, "Manager");
    const session = await createSession(user.id, orgId);

    await GET(new Request("http://api.test/api/v1/categories", {
      headers: { cookie: `ams_session=${session}` },
    }));

    expect(requestLines()[0]).toMatchObject({
      org_id: orgId, actor_type: "user", status: 200,
    });
  });
});
