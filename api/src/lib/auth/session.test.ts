import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
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

beforeAll(async () => {
  orgId = await createOrg("Session Org");
  adminId = (await createUserWithRole(orgId, "Administrator")).id;
  viewerId = (await createUserWithRole(orgId, "Viewer")).id;
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

  it("resolves permissions from the role, not from a hardcoded scope list", async () => {
    const admin = await readSession(withCookie(await createSession(adminId, orgId)));
    const viewer = await readSession(withCookie(await createSession(viewerId, orgId)));

    expect(admin?.actor.permissions).toContain("roles:write");
    expect(admin?.actor.permissions).toContain("assets:delete");

    expect(viewer?.actor.permissions).toContain("assets:read");
    expect(viewer?.actor.permissions).not.toContain("assets:write");
    // A viewer reads the register; the organisation's keys and administrative
    // history are not part of that.
    expect(viewer?.actor.permissions).not.toContain("api_keys:read");
    expect(viewer?.actor.permissions).not.toContain("audit:read");
  });

  it("reports no branch restriction for an unscoped user", async () => {
    const ctx = await readSession(withCookie(await createSession(adminId, orgId)));
    expect(ctx?.actor.locationScope).toBeNull();
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
