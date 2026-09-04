import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg } from "@/test/org";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { GET as ME } from "./me/route";
import { POST as LOGOUT } from "./logout/route";

let orgId: string;
let userId: string;

const withCookie = (url: string, sid: string, method = "GET") =>
  new Request(url, { method, headers: { cookie: `ams_session=${sid}` } });

beforeAll(async () => {
  orgId = await createOrg("Session Routes Org");
  userId = await withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO users (org_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, 'Route User', 'manager') RETURNING id`,
      [orgId, `routes-${orgId}@session.test`, await hashPassword("pw")],
    );
    return rows[0].id;
  });
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
      user: { id: string; name: string; scopes: string[] };
    };
    expect(body.org_id).toBe(orgId);
    expect(body.user.id).toBe(userId);
    // A manager writes but does not administer.
    expect(body.user.scopes).toContain("assets:write");
    expect(body.user.scopes).not.toContain("admin");
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
