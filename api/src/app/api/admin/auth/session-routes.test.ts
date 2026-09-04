import { describe, it, expect, beforeAll } from "vitest";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { GET as ME } from "./me/route";
import { POST as LOGOUT } from "./logout/route";

let orgId: string;
let userId: string;

const withCookie = (url: string, sid: string, method = "GET") =>
  new Request(url, { method, headers: { cookie: `ams_session=${sid}` } });

beforeAll(async () => {
  orgId = await createOrg("Session Routes Org");
  userId = (await createUserWithRole(orgId, "Manager")).id;
});

describe("GET /api/admin/auth/me", () => {
  it("refuses an unauthenticated caller", async () => {
    const res = await ME(new Request("http://api.test/api/admin/auth/me"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("returns the caller's identity and effective scopes", async () => {
    const sid = await createSession(userId, orgId);
    const res = await ME(withCookie("http://api.test/api/admin/auth/me", sid));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      org_id: string;
      user: {
        id: string;
        name: string;
        permissions: string[];
        location_scope: string[] | null;
      };
    };
    expect(body.org_id).toBe(orgId);
    expect(body.user.id).toBe(userId);
    // A manager runs the register but does not administer the organisation.
    expect(body.user.permissions).toContain("assets:write");
    expect(body.user.permissions).toContain("categories:write");
    expect(body.user.permissions).not.toContain("roles:write");
    expect(body.user.permissions).not.toContain("settings:write");
    // Unscoped, so the dashboard shows every branch.
    expect(body.user.location_scope).toBeNull();
  });

  it("never returns the password hash", async () => {
    const sid = await createSession(userId, orgId);
    const raw = await (await ME(withCookie("http://api.test/api/admin/auth/me", sid))).text();
    expect(raw).not.toContain("password");
    expect(raw).not.toContain("scrypt$");
  });
});

describe("POST /api/admin/auth/logout", () => {
  it("clears the cookie and invalidates the session", async () => {
    const sid = await createSession(userId, orgId);
    const res = await LOGOUT(
      withCookie("http://api.test/api/admin/auth/logout", sid, "POST"),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");

    // The session must be gone server-side, not merely forgotten by the client.
    const after = await ME(withCookie("http://api.test/api/admin/auth/me", sid));
    expect(after.status).toBe(401);
  });

  it("is harmless without a session", async () => {
    const res = await LOGOUT(
      new Request("http://api.test/api/admin/auth/logout", { method: "POST" }),
    );
    expect(res.status).toBe(204);
  });
});
