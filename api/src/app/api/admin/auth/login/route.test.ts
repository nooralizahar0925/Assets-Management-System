import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withTenant, query } from "@/lib/db";
import { createOrg } from "@/test/org";
import { hashPassword } from "@/lib/auth/password";
import { POST } from "./route";

let orgId: string;
let email: string;

const PASSWORD = "correct horse battery staple";

const login = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://api.test/api/admin/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  orgId = await createOrg("Login Org");
  email = `user-${orgId}@login.test`;
  await withTenant(orgId, async (c) => {
    await c.query(
      `INSERT INTO users (org_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, 'Login User', 'admin')`,
      [orgId, email, await hashPassword(PASSWORD)],
    );
  });
});

beforeEach(async () => {
  // Each test starts from an unthrottled state.
  await query("DELETE FROM login_attempts");
});

describe("POST /api/admin/auth/login", () => {
  it("rejects a malformed body with a validation problem", async () => {
    const res = await login({ email: "not-an-email" });
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });

  it("signs in with the right password and sets an HttpOnly cookie", async () => {
    const res = await login({ email, password: PASSWORD });
    expect(res.status).toBe(200);

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("ams_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const body = (await res.json()) as { org_id: string; role: string };
    expect(body.org_id).toBe(orgId);
    expect(body.role).toBe("admin");
  });

  it("refuses the wrong password without saying the account exists", async () => {
    const res = await login({ email, password: "wrong" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { title: string };
    expect(body.title).toBe("Authentication required");
  });

  it("gives an unknown address the same answer as a wrong password", async () => {
    const unknown = await login({ email: "nobody@login.test", password: "wrong" });
    const known = await login({ email, password: "wrong" });
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
  });

  it("spends comparable time on an unknown address as on a known one", async () => {
    // The point of the dummy-hash verify: without it an unknown address returns
    // in about a millisecond while a known one pays for a full scrypt
    // derivation, which answers "is this address registered?" from timing
    // alone. The bound is loose because CI timing is noisy - it is checking
    // that the work happens at all, not measuring it precisely.
    const time = async (address: string) => {
      const started = performance.now();
      await login({ email: address, password: "wrong" });
      return performance.now() - started;
    };

    const unknownMs = await time("ghost@login.test");
    const knownMs = await time(email);

    expect(unknownMs).toBeGreaterThan(knownMs * 0.4);
  });

  it("throttles after repeated failures for one address", async () => {
    for (let i = 0; i < 10; i++) {
      await login({ email, password: "wrong" });
    }
    const res = await login({ email, password: "wrong" });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("throttles the correct password too, once the limit is hit", async () => {
    // Otherwise the limiter is trivially bypassed by an attacker who guesses
    // right on attempt eleven.
    for (let i = 0; i < 10; i++) {
      await login({ email, password: "wrong" });
    }
    expect((await login({ email, password: PASSWORD })).status).toBe(429);
  });

  it("clears the counter after a successful sign-in", async () => {
    for (let i = 0; i < 3; i++) await login({ email, password: "wrong" });
    expect((await login({ email, password: PASSWORD })).status).toBe(200);

    const remaining = await query<{ n: string }>(
      "SELECT count(*) AS n FROM login_attempts WHERE key LIKE 'email:%'",
    );
    expect(Number(remaining[0].n)).toBe(0);
  });

  it("never stores the address in plaintext", async () => {
    await login({ email, password: "wrong" });
    const rows = await query<{ key: string }>("SELECT key FROM login_attempts");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.key).not.toContain(email);
  });
});
