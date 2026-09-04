import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg } from "../../test/org";
import { hashPassword } from "./password";
import {
  createSession,
  readSession,
  destroySession,
  sessionCookie,
  clearSessionCookie,
} from "./session";

let orgId: string;
let adminId: string;
let viewerId: string;

async function createUser(
  org: string,
  email: string,
  role: "admin" | "viewer",
): Promise<string> {
  return withTenant(org, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO users (org_id, email, password_hash, name, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [org, email, await hashPassword("pw"), email.split("@")[0], role],
    );
    return rows[0].id;
  });
}

beforeAll(async () => {
  orgId = await createOrg("Session Org");
  adminId = await createUser(orgId, `admin-${orgId}@example.test`, "admin");
  viewerId = await createUser(orgId, `viewer-${orgId}@example.test`, "viewer");
});

const withCookie = (id: string) =>
  new Request("http://x/api/admin/auth/me", {
    headers: { cookie: `ams_session=${id}` },
  });

describe("sessions", () => {
  it("resolves a session cookie to its user and tenant", async () => {
    const sid = await createSession(adminId, orgId);
    const ctx = await readSession(withCookie(sid));
    expect(ctx).toMatchObject({
      orgId,
      actor: { type: "user", id: adminId },
    });
  });

  it("grants an admin the admin scope and a viewer only read scopes", async () => {
    const admin = await readSession(withCookie(await createSession(adminId, orgId)));
    const viewer = await readSession(withCookie(await createSession(viewerId, orgId)));
    expect(admin?.actor.scopes).toContain("admin");
    expect(viewer?.actor.scopes).toEqual(["assets:read", "reports:read"]);
    expect(viewer?.actor.scopes).not.toContain("assets:write");
  });

  it("returns null when there is no cookie", async () => {
    await expect(
      readSession(new Request("http://x/api/admin/auth/me")),
    ).resolves.toBeNull();
  });

  it("returns null for an unknown session id", async () => {
    await expect(readSession(withCookie("not-a-real-session"))).resolves.toBeNull();
  });

  it("refuses an expired session", async () => {
    const sid = await createSession(adminId, orgId);
    await withTenant(orgId, (c) =>
      c.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE id=$1", [sid]),
    );
    await expect(readSession(withCookie(sid))).resolves.toBeNull();
  });

  it("stops resolving once the session is destroyed", async () => {
    const sid = await createSession(adminId, orgId);
    await destroySession(withCookie(sid));
    await expect(readSession(withCookie(sid))).resolves.toBeNull();
  });

  it("sets an HttpOnly, SameSite cookie and clears it with a zero max-age", () => {
    const set = sessionCookie("abc");
    expect(set).toContain("HttpOnly");
    expect(set).toContain("SameSite=Lax");
    expect(set).toContain("Path=/");
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });
});
