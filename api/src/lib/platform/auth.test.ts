import { describe, it, expect, beforeAll } from "vitest";
import { withPlatform } from "./db";
import { hashPassword } from "../auth/password";
import {
  createPlatformSession, requirePlatform, platformCookie, clearPlatformCookie,
} from "./auth";

/**
 * Two identity planes that must never accept each other's credentials.
 *
 * A tenant administrator holding a perfectly valid session is, to the console,
 * an anonymous stranger - and the reverse. Everything else here follows from
 * that one property.
 */

let adminId: string;
const email = `ops-${Date.now()}@platform.test`;

beforeAll(async () => {
  adminId = await withPlatform(async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO platform_admins (email, password_hash, name)
       VALUES ($1, $2, 'Operator') RETURNING id`,
      [email, await hashPassword("pw")],
    )).rows[0].id,
  );
});

const request = (cookie: string) =>
  new Request("http://api.test/api/platform/orgs", { headers: { cookie } });

describe("platform sessions", () => {
  it("resolves a valid session to the operator", async () => {
    const sid = await createPlatformSession(adminId);
    const actor = await requirePlatform(request(`ams_platform=${sid}`));
    expect(actor).toMatchObject({ id: adminId, name: "Operator", email });
  });

  it("refuses a tenant session, whatever it contains", async () => {
    // The assertion that matters most in this whole phase.
    const result = await requirePlatform(request("ams_session=anything-at-all"));
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("refuses a request with no cookie at all", async () => {
    const result = await requirePlatform(request(""));
    expect((result as Response).status).toBe(401);
  });

  it("refuses a session id that was never issued", async () => {
    const result = await requirePlatform(request("ams_platform=made-up"));
    expect((result as Response).status).toBe(401);
  });

  it("refuses an expired session", async () => {
    // Written rather than aged: the platform role holds no UPDATE on
    // platform_sessions, deliberately - a session is issued and destroyed,
    // never edited - so the expired one is inserted as such.
    const sid = "expired-session-for-the-test";
    await withPlatform((c) =>
      c.query(
        `INSERT INTO platform_sessions (id, admin_id, expires_at)
         VALUES ($1, $2, now() - interval '1 minute')
         ON CONFLICT (id) DO NOTHING`,
        [sid, adminId],
      ),
    );

    const result = await requirePlatform(request(`ams_platform=${sid}`));
    expect((result as Response).status).toBe(401);
  });

  it("refuses a disabled operator's existing session", async () => {
    // Disabling somebody has to end their access now, not when their session
    // happens to lapse. This is the difference between revoking access and
    // asking somebody to please stop.
    const sid = await createPlatformSession(adminId);
    await withPlatform((c) =>
      c.query("UPDATE platform_admins SET disabled_at = now() WHERE id = $1", [adminId]),
    );

    const result = await requirePlatform(request(`ams_platform=${sid}`));
    expect((result as Response).status).toBe(401);

    await withPlatform((c) =>
      c.query("UPDATE platform_admins SET disabled_at = NULL WHERE id = $1", [adminId]),
    );
  });

  it("expires sooner than a tenant session", async () => {
    // This session can create and destroy whole organisations. An unattended
    // browser should stop being able to well before a week is out.
    const sid = await createPlatformSession(adminId);
    const hours = await withPlatform(async (c) =>
      Number((await c.query<{ hours: string }>(
        `SELECT EXTRACT(EPOCH FROM (expires_at - now())) / 3600 AS hours
           FROM platform_sessions WHERE id = $1`,
        [sid],
      )).rows[0].hours),
    );
    expect(hours).toBeGreaterThan(1);
    expect(hours).toBeLessThanOrEqual(12);
  });
});

describe("the platform cookie", () => {
  it("is not the tenant cookie", () => {
    expect(platformCookie("abc")).toContain("ams_platform=");
    expect(platformCookie("abc")).not.toContain("ams_session=");
  });

  it("is HttpOnly and SameSite=Strict", () => {
    // Strict rather than Lax: nothing links into the console from anywhere
    // else, so there is no navigation to preserve and no reason to send it.
    const cookie = platformCookie("abc");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("is marked Secure when the deployment is served over TLS", () => {
    const before = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://ams.example.com";
    expect(platformCookie("abc")).toContain("Secure");
    process.env.APP_BASE_URL = before;
  });

  it("clears with the same attributes it was set with", () => {
    // A cookie cleared with different attributes is not cleared at all.
    const cleared = clearPlatformCookie();
    expect(cleared).toContain("ams_platform=;");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("SameSite=Strict");
  });
});
