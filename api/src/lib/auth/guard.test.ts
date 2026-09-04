import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import type { Ctx } from "../http/handler";
import { createSession } from "./session";
import { mintApiKey } from "./apikey";
import { requireAuth, isResponse, locationScopeClause } from "./guard";

let orgId: string;
let adminSession: string;
let viewerSession: string;
let readKey: string;
let adminKey: string;

const originalBaseUrl = process.env.APP_BASE_URL;

beforeAll(async () => {
  process.env.APP_BASE_URL = "https://app.example.test";
  orgId = await createOrg("Guard Org");
  adminSession = await createSession(
    (await createUserWithRole(orgId, "Administrator")).id, orgId);
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId);
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

  it("lets a key with the admin scope satisfy every permission", async () => {
    for (const scope of ["assets:read", "assets:write", "reports:read"] as const) {
      const res = await requireAuth(req({ key: adminKey }), scope);
      expect(isResponse(res), `admin should satisfy ${scope}`).toBe(false);
    }
  });

  it("refuses a viewer an administrative permission", async () => {
    const res = await requireAuth(req({ session: viewerSession }), "roles:write");
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

describe("branch scope", () => {
  let jakarta: string;
  let bekasi: string;
  let unscopedSession: string;
  let scopedSession: string;
  let unscopedCtx: Ctx;
  let scopedCtx: Ctx;

  beforeAll(async () => {
    [jakarta, bekasi] = await withTenant(orgId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO locations (org_id, name) VALUES ($1,'Jakarta'), ($1,'Bekasi')
         RETURNING id`,
        [orgId],
      );
      return [rows[0].id, rows[1].id];
    });

    const unscoped = await createUserWithRole(orgId, "Technician");
    const scoped = await createUserWithRole(orgId, "Technician");

    await withTenant(orgId, (c) =>
      c.query(
        `INSERT INTO user_location_scopes (org_id, user_id, location_id)
         VALUES ($1, $2, $3)`,
        [orgId, scoped.id, bekasi],
      ),
    );

    unscopedSession = await createSession(unscoped.id, orgId);
    scopedSession = await createSession(scoped.id, orgId);

    unscopedCtx = (await requireAuth(req({ session: unscopedSession }), "assets:read")) as Ctx;
    scopedCtx = (await requireAuth(req({ session: scopedSession }), "assets:read")) as Ctx;
  });

  it("allows an unscoped user to act on any branch", async () => {
    const res = await requireAuth(req({ session: unscopedSession }), "assets:write", {
      locationId: jakarta,
    });
    expect(isResponse(res)).toBe(false);
  });

  it("allows a scoped user inside their branch", async () => {
    const res = await requireAuth(req({ session: scopedSession }), "assets:write", {
      locationId: bekasi,
    });
    expect(isResponse(res)).toBe(false);
  });

  it("refuses a scoped user outside their branch", async () => {
    const res = await requireAuth(req({ session: scopedSession }), "assets:write", {
      locationId: jakarta,
    });
    expect((res as Response).status).toBe(403);
    const body = (await (res as Response).json()) as { detail: string };
    expect(body.detail).toMatch(/branch/i);
  });

  it("refuses a scoped user an asset with no location at all", async () => {
    // An unplaced asset belongs to no branch, so a branch-scoped user has no
    // claim on it. Allowing it would make "unplaced" a hole in every scope.
    const res = await requireAuth(req({ session: scopedSession }), "assets:write", {
      locationId: null,
    });
    expect((res as Response).status).toBe(403);
  });

  it("ignores branch scope when the handler names no location", async () => {
    const res = await requireAuth(req({ session: scopedSession }), "categories:read");
    expect(isResponse(res)).toBe(false);
  });

  it("does not branch-scope an api key", async () => {
    // Keys belong to the organisation, not to a person at a site.
    const res = await requireAuth(req({ key: adminKey }), "assets:write", {
      locationId: jakarta,
    });
    expect(isResponse(res)).toBe(false);
  });

  it("does not widen what a scoped user may do", async () => {
    expect([...scopedCtx.actor.permissions].sort()).toEqual(
      [...unscopedCtx.actor.permissions].sort(),
    );
  });

  describe("locationScopeClause", () => {
    it("matches everything for an unscoped user", () => {
      expect(locationScopeClause(unscopedCtx, "a.location_id")).toEqual({
        sql: "TRUE",
        params: [],
      });
    });

    it("restricts to the user's branches when scoped", () => {
      const { sql, params } = locationScopeClause(scopedCtx, "a.location_id");
      expect(sql).toBe("a.location_id = ANY($1::uuid[])");
      expect(params).toEqual([[bekasi]]);
    });

    it("honours the caller's parameter offset so it composes", () => {
      const { sql } = locationScopeClause(scopedCtx, "a.location_id", 4);
      expect(sql).toBe("a.location_id = ANY($4::uuid[])");
    });
  });
});
