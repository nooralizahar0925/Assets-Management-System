import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withTenant } from "@/lib/db";
import { withPlatform } from "@/lib/platform/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { forgetEntitlements } from "@/lib/entitlements";
import { GET as LIST, POST as INVITE } from "./route";
import { DELETE as REVOKE } from "../invitations/[id]/route";
import { POST as ACCEPT } from "../auth/accept-invitation/route";

/**
 * Inviting a colleague, through the real routes.
 *
 * Until this existed there was no way to create a user at all: every
 * organisation was permanently a one-person organisation, and the onboarding
 * checklist told people to invite colleagues using a screen that could only
 * list the ones already there.
 */

let orgId: string;
let adminSession: string;
let viewerSession: string;
let technicianRole: string;

const unique = (p: string) =>
  `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@invite-routes.test`;

beforeAll(async () => {
  orgId = await createOrg("Invite Routes Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  const viewer = await createUserWithRole(orgId, "Viewer");
  adminSession = await createSession(admin.id, orgId);
  viewerSession = await createSession(viewer.id, orgId);

  technicianRole = await withTenant(orgId, async (c) =>
    (await c.query<{ id: string }>(
      "SELECT id FROM roles WHERE lower(name) = 'technician'",
    )).rows[0].id,
  );
});

beforeEach(async () => {
  await withTenant(orgId, (c) => c.query("DELETE FROM user_invitations"));
  await withPlatform((c) =>
    c.query("UPDATE organizations SET limit_overrides = '{}'::jsonb WHERE id = $1",
      [orgId]),
  );
  forgetEntitlements(orgId);
});

const request = (session: string, body?: unknown) =>
  new Request("http://api.test/api/admin/users", {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const invite = (email = unique("colleague")) =>
  INVITE(request(adminSession, {
    email, name: "Rina Kusuma", role_id: technicianRole,
  }));

/** The token never leaves the email, so a test reads it the way a link does. */
const tokenFor = async (email: string) => {
  const body = await withTenant(orgId, async (c) =>
    (await c.query<{ text_body: string }>(
      `SELECT text_body FROM email_messages
        WHERE $1 = ANY(to_addresses) ORDER BY created_at DESC LIMIT 1`,
      [email],
    )).rows[0]?.text_body ?? "",
  );
  return body.match(/accept-invitation\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
};

describe("inviting somebody", () => {
  it("is refused to a role that cannot manage people", async () => {
    const res = await INVITE(request(viewerSession, {
      email: unique("nope"), name: "Nope", role_id: technicianRole,
    }));
    expect(res.status).toBe(403);
  });

  it("creates an invitation and says it was emailed", async () => {
    const res = await invite();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ emailed: true, role_name: "Technician" });
  });

  it("never returns the token", async () => {
    // Anybody who can invite could otherwise impersonate the invitee, without
    // the invitee ever receiving anything.
    const res = await invite();
    expect(JSON.stringify(await res.json())).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });

  it("sends an email carrying the link", async () => {
    const email = unique("emailed");
    await invite(email);
    expect(await tokenFor(email)).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });

  it("shows the pending invitation on the People list", async () => {
    // Without this an administrator invites the same person twice and wonders
    // why nothing happened the first time.
    const email = unique("pending");
    await invite(email);

    const body = await (await LIST(request(adminSession))).json() as {
      invitations: { email: string }[];
    };
    expect(body.invitations.map((i) => i.email)).toContain(email);
  });

  it("refuses an address that already has an account", async () => {
    const existing = await createUserWithRole(orgId, "Viewer");
    const res = await INVITE(request(adminSession, {
      email: existing.email, name: "Clash", role_id: technicianRole,
    }));
    expect(res.status).toBe(409);
  });

  it("is refused once the plan's people limit is reached", async () => {
    await withPlatform((c) =>
      c.query(
        `UPDATE organizations SET limit_overrides = '{"max_users": 2}'::jsonb
          WHERE id = $1`, [orgId],
      ),
    );
    forgetEntitlements(orgId);

    const res = await invite();
    expect(res.status).toBe(402);
    expect((await res.json() as { type: string }).type).toContain("plan-limit");
  });
});

describe("accepting an invitation", () => {
  const accept = (token: string, password: string) =>
    ACCEPT(new Request("http://api.test/api/admin/auth/accept-invitation", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
      body: JSON.stringify({ token, password }),
    }));

  it("creates the account and signs them in at once", async () => {
    // Making somebody who has just chosen a password type it again on the next
    // screen is a pointless way to greet them.
    const email = unique("accepting");
    await invite(email);

    const res = await accept(await tokenFor(email), "a-password-they-chose");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") ?? "").toContain("ams_session=");
  });

  it("refuses a password too short to be worth having", async () => {
    const email = unique("weak");
    await invite(email);

    expect((await accept(await tokenFor(email), "short")).status).toBe(422);
  });

  it("refuses a token that has been used", async () => {
    const email = unique("twice");
    await invite(email);
    const token = await tokenFor(email);

    await accept(token, "a-password-they-chose");
    const second = await accept(token, "a-password-they-chose");

    expect(second.status).toBe(410);
    expect((await second.json() as { type: string }).type)
      .toContain("invitation-invalid");
  });

  it("refuses a token that was revoked", async () => {
    // An invitation sent to the wrong address is a credential in a stranger's
    // inbox, and withdrawing it has to work immediately.
    const email = unique("revoked");
    const created = await (await invite(email)).json() as { id: string };
    const token = await tokenFor(email);

    const revoked = await REVOKE(
      new Request("http://api.test/x", {
        method: "DELETE", headers: { cookie: `ams_session=${adminSession}` },
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    expect(revoked.status).toBe(204);

    expect((await accept(token, "a-password-they-chose")).status).toBe(410);
  });

  it("refuses an invented token", async () => {
    expect((await accept("not-a-real-token-but-long-enough", "whatever-password"))
      .status).toBe(410);
  });
});
