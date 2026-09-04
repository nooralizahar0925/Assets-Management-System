import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withTenant } from "../db";
import { createOrg } from "../../test/org";
import { hashPassword } from "./password";
import { createSession } from "./session";
import { mintApiKey } from "./apikey";
import { requireAuth, isResponse } from "./guard";

let orgId: string;
let adminSession: string;
let viewerSession: string;
let readKey: string;
let adminKey: string;

const originalBaseUrl = process.env.APP_BASE_URL;

async function createUser(role: "admin" | "viewer"): Promise<string> {
  return withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO users (org_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orgId, `${role}-${crypto.randomUUID()}@guard.test`, await hashPassword("pw"), role, role],
    );
    return rows[0].id;
  });
}

beforeAll(async () => {
  process.env.APP_BASE_URL = "https://app.example.test";
  orgId = await createOrg("Guard Org");
  adminSession = await createSession(await createUser("admin"), orgId);
  viewerSession = await createSession(await createUser("viewer"), orgId);
  readKey = (await mintApiKey(orgId, "reader", ["assets:read"])).plaintext;
  adminKey = (await mintApiKey(orgId, "admin key", ["admin"])).plaintext;
});

afterAll(() => {
  process.env.APP_BASE_URL = originalBaseUrl;
});

const req = (opts: {
  method?: string;
  session?: string;
  key?: string;
  origin?: string;
}) => {
  const headers = new Headers();
  if (opts.session) headers.set("cookie", `ams_session=${opts.session}`);
  if (opts.key) headers.set("authorization", `Bearer ${opts.key}`);
  if (opts.origin) headers.set("origin", opts.origin);
  return new Request("https://app.example.test/api/v1/assets", {
    method: opts.method ?? "GET",
    headers,
  });
};

describe("requireAuth — credentials", () => {
  it("refuses a request with no credential", async () => {
    const res = await requireAuth(req({}), "assets:read");
    expect(isResponse(res)).toBe(true);
    expect((res as Response).status).toBe(401);
  });

  it("refuses an unknown api key", async () => {
    const res = await requireAuth(req({ key: "ams_live_dead.beef" }), "assets:read");
    expect((res as Response).status).toBe(401);
  });

  it("accepts a session cookie", async () => {
    const res = await requireAuth(req({ session: adminSession }), "assets:read");
    expect(isResponse(res)).toBe(false);
    expect(res).toMatchObject({ orgId, actor: { type: "user" } });
  });

  it("accepts an api key", async () => {
    const res = await requireAuth(req({ key: readKey }), "assets:read");
    expect(res).toMatchObject({ orgId, actor: { type: "api_key" } });
  });

  it("prefers the api key when both are present", async () => {
    const res = await requireAuth(
      req({ key: readKey, session: adminSession }),
      "assets:read",
    );
    expect(res).toMatchObject({ actor: { type: "api_key" } });
  });
});

describe("requireAuth — scopes", () => {
  it("refuses a credential lacking the scope", async () => {
    const res = await requireAuth(req({ key: readKey }), "assets:write");
    expect((res as Response).status).toBe(403);
    const body = (await (res as Response).json()) as { detail: string };
    expect(body.detail).toContain("assets:write");
  });

  it("lets admin stand in for any scope", async () => {
    for (const scope of ["assets:read", "assets:write", "reports:read"] as const) {
      const res = await requireAuth(req({ key: adminKey }), scope);
      expect(isResponse(res), `admin should satisfy ${scope}`).toBe(false);
    }
  });

  it("refuses a viewer the admin scope", async () => {
    const res = await requireAuth(req({ session: viewerSession }), "admin");
    expect((res as Response).status).toBe(403);
  });

  it("grants a viewer read but not write", async () => {
    expect(isResponse(await requireAuth(req({ session: viewerSession }), "assets:read")))
      .toBe(false);
    expect(isResponse(await requireAuth(req({ session: viewerSession }), "assets:write")))
      .toBe(true);
  });
});

describe("requireAuth — cross-origin writes", () => {
  it("refuses a cookie-authenticated write from another origin", async () => {
    const res = await requireAuth(
      req({ session: adminSession, method: "POST", origin: "https://evil.example" }),
      "assets:write",
    );
    expect((res as Response).status).toBe(403);
  });

  it("allows a cookie-authenticated write from the app origin", async () => {
    const res = await requireAuth(
      req({
        session: adminSession,
        method: "POST",
        origin: "https://app.example.test",
      }),
      "assets:write",
    );
    expect(isResponse(res)).toBe(false);
  });

  it("allows a cookie-authenticated read from another origin", async () => {
    // Reads are not state-changing, and blocking them would break nothing an
    // attacker cares about while breaking legitimate embedding.
    const res = await requireAuth(
      req({ session: adminSession, origin: "https://evil.example" }),
      "assets:read",
    );
    expect(isResponse(res)).toBe(false);
  });

  it("does not apply the origin check to api keys", async () => {
    // A key is never attached ambiently by a browser, so it is not a CSRF
    // vector — and server-to-server callers legitimately send any origin.
    const res = await requireAuth(
      req({ key: adminKey, method: "POST", origin: "https://anywhere.example" }),
      "assets:write",
    );
    expect(isResponse(res)).toBe(false);
  });

  it("allows a write with no origin header at all", async () => {
    // curl and server-side clients send none, and are not subject to CSRF.
    const res = await requireAuth(
      req({ session: adminSession, method: "POST" }),
      "assets:write",
    );
    expect(isResponse(res)).toBe(false);
  });
});
