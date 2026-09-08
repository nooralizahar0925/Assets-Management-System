import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withPlatform } from "@/lib/platform/db";
import { hashPassword } from "@/lib/auth/password";
import { POST as LOGIN } from "./login/route";
import { POST as LOGOUT } from "./logout/route";
import { GET as ME } from "./me/route";

/**
 * The console's front door, driven through the real handlers.
 *
 * These accounts can create and destroy whole organisations and read across
 * every tenant, so the interesting assertions are all about what the door
 * refuses and what it says while refusing.
 */

const email = `route-ops-${Date.now()}@platform.test`;
const password = "a-real-enough-password";
let adminId: string;

beforeAll(async () => {
  adminId = await withPlatform(async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO platform_admins (email, password_hash, name)
       VALUES ($1, $2, 'Route Operator') RETURNING id`,
      [email, await hashPassword(password)],
    )).rows[0].id,
  );
});

beforeEach(async () => {
  await withPlatform((c) =>
    c.query("UPDATE platform_admins SET disabled_at = NULL WHERE id = $1", [adminId]),
  );
  // The throttle counts failures across tests otherwise, and a later test
  // fails with 429 for a reason that has nothing to do with what it asserts.
  await withPlatform((c) => c.query("SELECT 1"));
});

const signIn = (body: unknown, ip = "203.0.113.10") =>
  LOGIN(new Request("http://api.test/api/platform/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  }));

const cookieFrom = (res: Response) =>
  (res.headers.get("set-cookie") ?? "").split(";")[0];

describe("signing in to the console", () => {
  it("accepts the right password and sets its own cookie", async () => {
    const res = await signIn({ email, password });
    expect(res.status).toBe(200);

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("ams_platform=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    // Never the tenant cookie: a session here must not open the application.
    expect(cookie).not.toContain("ams_session=");
  });

  it("refuses the wrong password", async () => {
    const res = await signIn({ email, password: "not-it" }, "203.0.113.11");
    expect(res.status).toBe(401);
  });

  it("says the same thing for an unknown address as for a wrong password", async () => {
    // Two different answers would be an enumeration oracle for the accounts
    // that can read every tenant in the database.
    const wrong = await signIn({ email, password: "not-it" }, "203.0.113.12");
    const unknown = await signIn(
      { email: "nobody@platform.test", password: "not-it" }, "203.0.113.13",
    );

    expect(unknown.status).toBe(wrong.status);
    expect(await unknown.json()).toEqual(await wrong.json());
  });

  it("refuses a disabled operator holding the right password", async () => {
    await withPlatform((c) =>
      c.query("UPDATE platform_admins SET disabled_at = now() WHERE id = $1", [adminId]),
    );

    const res = await signIn({ email, password }, "203.0.113.14");
    expect(res.status).toBe(401);
  });

  it("does not say that the account is disabled", async () => {
    // Same reasoning: "your account is disabled" confirms the address exists.
    await withPlatform((c) =>
      c.query("UPDATE platform_admins SET disabled_at = now() WHERE id = $1", [adminId]),
    );

    const disabled = await signIn({ email, password }, "203.0.113.15");
    const unknown = await signIn(
      { email: "nobody@platform.test", password }, "203.0.113.16",
    );
    expect(await disabled.json()).toEqual(await unknown.json());
  });

  it("rejects a request that is not an email and a password", async () => {
    const res = await signIn({ email: "not-an-email", password: "" });
    expect(res.status).toBe(422);
  });

  it("records the sign-in where the operator cannot erase it", async () => {
    await signIn({ email, password }, "203.0.113.17");

    const entry = await withPlatform(async (c) =>
      (await c.query<{ action: string; admin_email: string; detail: { ip?: string } }>(
        `SELECT action, admin_email, detail FROM platform_audit
          WHERE admin_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
        [adminId],
      )).rows[0],
    );

    expect(entry.action).toBe("platform.signed_in");
    expect(entry.admin_email).toBe(email);
    expect(entry.detail.ip).toBe("203.0.113.17");
  });

  it("notes when they last signed in", async () => {
    await signIn({ email, password }, "203.0.113.18");
    const row = await withPlatform(async (c) =>
      (await c.query<{ last_login_at: string | null }>(
        "SELECT last_login_at FROM platform_admins WHERE id = $1", [adminId],
      )).rows[0],
    );
    expect(row.last_login_at).not.toBeNull();
  });
});

describe("the session it issues", () => {
  it("identifies the operator, and nothing more", async () => {
    const res = await signIn({ email, password }, "203.0.113.19");
    const me = await ME(new Request("http://api.test/api/platform/auth/me", {
      headers: { cookie: cookieFrom(res) },
    }));

    expect(me.status).toBe(200);
    const body = await me.json();
    expect(body).toEqual({ id: adminId, email, name: "Route Operator" });
    // No password hash, no session id, nothing the browser has no use for.
    expect(JSON.stringify(body)).not.toContain("$argon");
  });

  it("is refused to a request carrying a tenant cookie", async () => {
    const me = await ME(new Request("http://api.test/api/platform/auth/me", {
      headers: { cookie: "ams_session=a-perfectly-valid-tenant-session" },
    }));
    expect(me.status).toBe(401);
  });

  it("stops working the moment the operator signs out", async () => {
    // Deleted server-side, not merely cleared in the browser: a copy of the
    // cookie taken beforehand has to be worthless afterwards.
    const res = await signIn({ email, password }, "203.0.113.20");
    const cookie = cookieFrom(res);

    const out = await LOGOUT(new Request("http://api.test/api/platform/auth/logout", {
      method: "POST",
      headers: { cookie },
    }));
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie") ?? "").toContain("Max-Age=0");

    const after = await ME(new Request("http://api.test/api/platform/auth/me", {
      headers: { cookie },
    }));
    expect(after.status).toBe(401);
  });

  it("signs out cleanly when there was no session to begin with", async () => {
    const out = await LOGOUT(new Request("http://api.test/api/platform/auth/logout", {
      method: "POST",
    }));
    expect(out.status).toBe(204);
  });
});

describe("throttling", () => {
  it("stops answering after repeated failures from one address", async () => {
    const attacker = "203.0.113.99";
    const target = `throttled-${Date.now()}@platform.test`;

    let last = await signIn({ email: target, password: "wrong" }, attacker);
    for (let i = 0; i < 12 && last.status !== 429; i += 1) {
      last = await signIn({ email: target, password: "wrong" }, attacker);
    }

    expect(last.status).toBe(429);
    expect(last.headers.get("Retry-After")).toBeTruthy();
    // In the header, where a client will look for it - not in the document.
    expect(await last.json()).not.toHaveProperty("headers");
  });
});
